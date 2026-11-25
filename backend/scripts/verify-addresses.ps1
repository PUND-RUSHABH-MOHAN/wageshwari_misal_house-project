<#
.SYNOPSIS
  Checks the deployed addresses API (Part 4) with a real, already-confirmed account.
  Addresses it creates are deleted again at the end. Works in Windows PowerShell 5.1 and PowerShell 7.

.EXAMPLE
  .\backend\scripts\verify-addresses.ps1 -Email you+wmh1@gmail.com
#>
param(
  [Parameter(Mandatory = $true)] [string] $Email,
  [string] $ApiBaseUrl = "https://cyfnnlsjga.execute-api.ap-south-1.amazonaws.com"
)

$ErrorActionPreference = "Stop"
$base = $ApiBaseUrl.TrimEnd("/")
$script:failed = 0
$created = New-Object System.Collections.ArrayList

# Hotel: 19°51'24.6"N 75°51'07.0"E. Test points around it.
$near = @{ latitude = 19.8700; longitude = 75.8600 }    # ~1.7 km
$far = @{ latitude = 19.8459; longitude = 75.9069 }     # Jalna head post office, ~5.9 km

function Invoke-Api {
  param([string] $Method, [string] $Path, $Body = $null, [string] $Token = $null)
  $headers = @{}
  if ($Token) { $headers["Authorization"] = "Bearer $Token" }
  $params = @{ Method = $Method; Uri = "$base$Path"; Headers = $headers; ContentType = "application/json; charset=utf-8"; UseBasicParsing = $true }
  if ($null -ne $Body) { $params.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Compress)) }
  try {
    $resp = Invoke-WebRequest @params
    $status = [int] $resp.StatusCode
    $content = [Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray())
  } catch {
    if ($null -eq $_.Exception.Response) { throw }
    $status = [int] $_.Exception.Response.StatusCode
    $content = $_.ErrorDetails.Message
  }
  $json = $null
  if ($content) { $json = $content | ConvertFrom-Json }
  return [pscustomobject] @{ Status = $status; Body = $json }
}

function Check([string] $Label, $Result, [int] $Expected, [string] $ErrorCode = $null, [string] $Extra = "") {
  $ok = $Result.Status -eq $Expected
  if ($ok -and $ErrorCode) { $ok = $Result.Body.error.code -eq $ErrorCode }
  $detail = if ($Result.Body -and $Result.Body.error) { "($($Result.Body.error.code)) $($Result.Body.error.message)" } else { $Extra }
  if ($ok) {
    Write-Host ("PASS  {0,-44} {1} {2}" -f $Label, $Result.Status, $detail) -ForegroundColor Green
  } else {
    $script:failed++
    Write-Host ("FAIL  {0,-44} got {1} {2}, want {3} {4}" -f $Label, $Result.Status, $detail, $Expected, $ErrorCode) -ForegroundColor Red
  }
}

function New-Body([hashtable] $Where, [hashtable] $Over = @{}) {
  $b = @{
    label = "Home"; receiver_name = "WMH Test"; receiver_phone = "9876543210"
    line1 = "Plot 7, Test Residency"; line2 = "Ekta Nagar"; pincode = "431203"
    latitude = $Where.latitude; longitude = $Where.longitude; is_default = $false
  }
  foreach ($k in $Over.Keys) { $b[$k] = $Over[$k] }
  return $b
}

$secure = Read-Host "Password for $Email" -AsSecureString
$password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$login = Invoke-Api POST "/auth/login" @{ email = $Email; password = $password }
if ($login.Status -ne 200) { Write-Host "Login failed: $($login.Status) $($login.Body.error.message)" -ForegroundColor Red; exit 1 }
$t = $login.Body.token
Write-Host "Logged in as $($login.Body.user.email)`n"

try {
  Write-Host "--- Access ---"
  Check "GET /addresses without token" (Invoke-Api GET "/addresses") 401
  $list = Invoke-Api GET "/addresses" -Token $t
  Check "GET /addresses" $list 200 -Extra "($(@($list.Body).Count) saved before the test)"
  $room = 5 - @($list.Body).Count

  Write-Host "`n--- Delivery area (3 km from the hotel) ---"
  Check "address ~5.9 km away is refused" (Invoke-Api POST "/addresses" (New-Body $far) -Token $t) 422 "OUT_OF_DELIVERY_AREA"
  $noLoc = New-Body $near; $noLoc.Remove("latitude"); $noLoc.Remove("longitude")
  Check "address without GPS is refused" (Invoke-Api POST "/addresses" $noLoc -Token $t) 400 "LOCATION_REQUIRED"
  Check "Pune pincode is refused" (Invoke-Api POST "/addresses" (New-Body $near @{ pincode = "411038" }) -Token $t) 400 "VALIDATION_ERROR"

  if ($room -lt 1) {
    Write-Host "`nThis account already has 5 addresses; delete one in the app to run the create/edit checks." -ForegroundColor Yellow
  } else {
    Write-Host "`n--- Create / edit / default / delete ---"
    $r = Invoke-Api POST "/addresses" (New-Body $near @{ city = "Pune" }) -Token $t
    Check "create ~1.7 km away" $r 201 -Extra "$($r.Body.distance_km) km, city=$($r.Body.city)"
    if ($r.Status -eq 201) {
      [void] $created.Add($r.Body.id)
      Check "server sets city = Jalna" ([pscustomobject] @{ Status = [int]($r.Body.city -eq "Jalna") }) 1
      $a1 = $r.Body.id

      $r = Invoke-Api PATCH "/addresses/$a1" @{ label = "Work"; landmark = "Opp. petrol pump" } -Token $t
      Check "PATCH label + landmark" $r 200 -Extra "$($r.Body.label), $($r.Body.landmark)"
      Check "PATCH location 5.9 km away is refused" (Invoke-Api PATCH "/addresses/$a1" $far -Token $t) 422 "OUT_OF_DELIVERY_AREA"

      if ($room -ge 2) {
        $r = Invoke-Api POST "/addresses" (New-Body $near @{ label = "Other" }) -Token $t
        Check "create a second address" $r 201
        if ($r.Status -eq 201) {
          [void] $created.Add($r.Body.id)
          $a2 = $r.Body.id
          Check "make the second one default" (Invoke-Api PATCH "/addresses/$a2" @{ is_default = $true } -Token $t) 200
          $l = Invoke-Api GET "/addresses" -Token $t
          $defaults = @($l.Body | Where-Object { $_.is_default })
          Check "exactly one default, listed first" ([pscustomobject] @{ Status = [int](($defaults.Count -eq 1) -and ($l.Body[0].id -eq $a2)) }) 1
        }
      }

      # Fill up to the limit, then expect the 6th to be refused.
      $l = Invoke-Api GET "/addresses" -Token $t
      for ($i = @($l.Body).Count; $i -lt 5; $i++) {
        $r = Invoke-Api POST "/addresses" (New-Body $near) -Token $t
        if ($r.Status -eq 201) { [void] $created.Add($r.Body.id) }
      }
      Check "6th address is refused (limit 5)" (Invoke-Api POST "/addresses" (New-Body $near) -Token $t) 409 "ADDRESS_LIMIT"
    }
  }
  Check "unknown address id is 404" (Invoke-Api DELETE "/addresses/adr_0000000000000000" -Token $t) 404
} finally {
  if ($created.Count -gt 0) { Write-Host "`n--- Cleanup ---" }
  foreach ($id in $created) {
    Check "delete $id" (Invoke-Api DELETE "/addresses/$id" -Token $t) 204
  }
}

Write-Host ""
if ($script:failed -eq 0) {
  Write-Host "All checks passed." -ForegroundColor Green
} else {
  Write-Host "$($script:failed) check(s) failed." -ForegroundColor Red
  exit 1
}
