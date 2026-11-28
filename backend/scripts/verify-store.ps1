<#
.SYNOPSIS
  Checks the deployed store switch (Part 7b) and the cooking-time setting (part 7d) with an
  account in the Cognito `admin` group.
  It switches online orders OFF for a few seconds (message "Verify script test"), checks that
  GET /store and POST /orders see it, then switches them back ON. If the store is already
  closed when you run it, it leaves it closed and only does the read-only checks.
  Pass -CustomerEmail (a normal, non-admin account) to also check that customers get 403.
  Works in Windows PowerShell 5.1 and PowerShell 7.

.EXAMPLE
  .\backend\scripts\verify-store.ps1 -Email owner@example.com
  .\backend\scripts\verify-store.ps1 -Email owner@example.com -CustomerEmail you+wmh1@gmail.com
#>
param(
  [Parameter(Mandatory = $true)] [string] $Email,
  [string] $CustomerEmail = "",
  [string] $ApiBaseUrl = "https://cyfnnlsjga.execute-api.ap-south-1.amazonaws.com"
)

$ErrorActionPreference = "Stop"
$base = $ApiBaseUrl.TrimEnd("/")
$script:failed = 0

function Invoke-Api {
  param([string] $Method, [string] $Path, $Body = $null, [string] $Token = $null, [string] $Key = $null)
  $headers = @{}
  if ($Token) { $headers["Authorization"] = "Bearer $Token" }
  if ($Key) { $headers["Idempotency-Key"] = $Key }
  $params = @{ Method = $Method; Uri = "$base$Path"; Headers = $headers; ContentType = "application/json; charset=utf-8"; UseBasicParsing = $true }
  if ($null -ne $Body) { $params.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Compress -Depth 6)) }
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
    Write-Host ("PASS  {0,-48} {1} {2}" -f $Label, $Result.Status, $detail) -ForegroundColor Green
  } else {
    $script:failed++
    Write-Host ("FAIL  {0,-48} got {1} {2}, want {3} {4}" -f $Label, $Result.Status, $detail, $Expected, $ErrorCode) -ForegroundColor Red
  }
}

function Assert([string] $Label, [bool] $Condition, [string] $Extra = "") {
  Check $Label ([pscustomobject] @{ Status = [int] $Condition; Body = $null }) 1 -Extra $Extra
}

function Login([string] $Who) {
  $secure = Read-Host "Password for $Who" -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  $r = Invoke-Api POST "/auth/login" @{ email = $Who; password = $plain }
  if ($r.Status -ne 200) { Write-Host "Login failed for ${Who}: $($r.Status) $($r.Body.error.message)" -ForegroundColor Red; exit 1 }
  return $r.Body
}

$istNow = [DateTime]::UtcNow.AddHours(5.5)

Write-Host "--- Public status ---"
$before = Invoke-Api GET "/store"
Check "GET /store (no login)" $before 200 -Extra "accepting_orders=$($before.Body.accepting_orders), hours $($before.Body.opens_at)-$($before.Body.closes_at)"
Assert "hours are 09:00 - 21:00" ($before.Body.opens_at -eq "09:00" -and $before.Body.closes_at -eq "21:00")
Assert "last order 20:30, cooking time 5-90 min (part 7d)" (($before.Body.last_order_at -eq "20:30") -and ($before.Body.prep_minutes -ge 5) -and ($before.Body.prep_minutes -le 90)) "prep=$($before.Body.prep_minutes) min"
$wasOpen = [bool] $before.Body.accepting_orders

$admin = Login $Email
if ($admin.user.role -ne "admin") {
  Write-Host "$Email is not in the 'admin' group yet. Add it, then run this again:" -ForegroundColor Yellow
  Write-Host "  aws cognito-idp admin-add-user-to-group --user-pool-id ap-south-1_Szcz11NPr --username $Email --group-name admin --profile wmh --region ap-south-1"
  exit 1
}
$t = $admin.token

Write-Host "`n--- Access and validation ---"
Check "PATCH /admin/store without token" (Invoke-Api PATCH "/admin/store" @{ accepting_orders = $true }) 401
if ($CustomerEmail) {
  $customer = Login $CustomerEmail
  Check "customer account gets 403" (Invoke-Api PATCH "/admin/store" @{ accepting_orders = $false } -Token $customer.token) 403 "FORBIDDEN"
}
Check "accepting_orders missing is refused" (Invoke-Api PATCH "/admin/store" @{ message = "hi" } -Token $t) 400 "VALIDATION_ERROR"
Check "accepting_orders as text is refused" (Invoke-Api PATCH "/admin/store" @{ accepting_orders = "no" } -Token $t) 400 "VALIDATION_ERROR"
Check "message over 120 chars is refused" (Invoke-Api PATCH "/admin/store" @{ accepting_orders = $false; message = ("x" * 121) } -Token $t) 400 "VALIDATION_ERROR"
Check "unknown field is refused" (Invoke-Api PATCH "/admin/store" @{ accepting_orders = $true; open = $true } -Token $t) 400 "VALIDATION_ERROR"
Check "cooking time 91 min is refused" (Invoke-Api PATCH "/admin/store" @{ prep_minutes = 91 } -Token $t) 400 "VALIDATION_ERROR"
Check "cooking time as text is refused" (Invoke-Api PATCH "/admin/store" @{ prep_minutes = "20" } -Token $t) 400 "VALIDATION_ERROR"

if (-not $wasOpen) {
  Write-Host "`nThe store is closed right now (`"$($before.Body.message)`"), so the stop/start test is skipped." -ForegroundColor Yellow
  Write-Host "Turn online orders back on in the Kitchen tab, then run this again for the full test."
} else {
  Write-Host "`n--- Stop online orders for a few seconds, then start again ---"
  try {
    $stop = Invoke-Api PATCH "/admin/store" @{ accepting_orders = $false; message = "Verify script test" } -Token $t
    Check "PATCH /admin/store (stop)" $stop 200 -Extra "updated_by=$($stop.Body.updated_by)"
    $closed = Invoke-Api GET "/store"
    Assert "GET /store shows closed + message" ((-not $closed.Body.accepting_orders) -and $closed.Body.message -eq "Verify script test") "message: $($closed.Body.message)"
    # Any well-formed order: the switch is checked before the address and dishes.
    $order = @{
      address_id = "adr_0000000000000000"
      payment_method = "cod"; items = @(@{ product_id = "prd_chaha"; quantity = 1 })
    }
    Check "POST /orders while closed" (Invoke-Api POST "/orders" $order -Token $t -Key ("verify-" + [Guid]::NewGuid().ToString("N"))) 409 "STORE_CLOSED"
  } finally {
    $start = Invoke-Api PATCH "/admin/store" @{ accepting_orders = $true } -Token $t
    Check "PATCH /admin/store (start again)" $start 200
    $open = Invoke-Api GET "/store"
    Assert "GET /store shows open, message cleared" ($open.Body.accepting_orders -and $open.Body.message -eq "") "accepting_orders=$($open.Body.accepting_orders)"
    Assert "cooking time kept through stop/start" ($open.Body.prep_minutes -eq $before.Body.prep_minutes) "$($open.Body.prep_minutes) min"
    if (-not $open.Body.accepting_orders) {
      Write-Host "Online orders are still OFF. Turn them on in the Kitchen tab." -ForegroundColor Red
    }
  }
}

Write-Host ""
if ($script:failed -eq 0) {
  Write-Host "All store checks passed." -ForegroundColor Green
} else {
  Write-Host "$($script:failed) check(s) failed." -ForegroundColor Red
  exit 1
}
