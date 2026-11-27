<#
.SYNOPSIS
  Checks the deployed direct-UPI payment flow (Part 7) with an account in the Cognito `admin`
  group, acting as both customer and kitchen. No real money moves: it places ONE UPI order for
  tomorrow, reports a made-up 12-digit UTR, confirms "Payment received" as the kitchen, and then
  cancels the order from the kitchen with the reason "Verify script test".
  A second order is placed and cancelled by the customer before paying.
  Works in Windows PowerShell 5.1 and PowerShell 7.

.EXAMPLE
  .\backend\scripts\verify-payments.ps1 -Email owner@example.com
#>
param(
  [Parameter(Mandatory = $true)] [string] $Email,
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

function New-Key { return "verify-" + [Guid]::NewGuid().ToString("N") }

$istNow = [DateTime]::UtcNow.AddHours(5.5)
$tomorrow = $istNow.AddDays(1).ToString("yyyy-MM-dd")

$secure = Read-Host "Password for $Email" -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$login = Invoke-Api POST "/auth/login" @{ email = $Email; password = $plain }
if ($login.Status -ne 200) { Write-Host "Login failed: $($login.Status) $($login.Body.error.message)" -ForegroundColor Red; exit 1 }
if ($login.Body.user.role -ne "admin") {
  Write-Host "$Email must be in the 'admin' group (it confirms and cancels the test order as the kitchen)." -ForegroundColor Yellow
  exit 1
}
$t = $login.Body.token
Write-Host "Logged in as $Email (admin). India time now: $($istNow.ToString('yyyy-MM-dd HH:mm'))`n"

$tempAddress = $null
try {
  $list = Invoke-Api GET "/addresses" -Token $t
  if (@($list.Body).Count -lt 5) {
    $r = Invoke-Api POST "/addresses" @{
      label = "Other"; receiver_name = "WMH UPI Test"; receiver_phone = "9876543210"
      line1 = "Plot 7, Test Residency"; pincode = "431203"; latitude = 19.8700; longitude = 75.8600
    } -Token $t
    if ($r.Status -ne 201) { throw "Couldn't create a test address: $($r.Body.error.message)" }
    $tempAddress = $r.Body.id
    $addressId = $tempAddress
  } else {
    $addressId = @($list.Body)[0].id
  }
  $menu = @((Invoke-Api GET "/products").Body | Where-Object { $_.is_available })
  $item = $menu | Sort-Object price | Select-Object -Last 1
  $qty = [int] [Math]::Max(1, [Math]::Ceiling(10000 / $item.price))
  $body = @{
    address_id = $addressId; delivery_date = $tomorrow; slot_label = "Lunch 12:00 - 1:00 PM"; payment_method = "online"
    items = @(@{ product_id = $item.id; quantity = $qty })
  }

  Write-Host "--- Customer cancels before paying ---"
  $a = Invoke-Api POST "/orders" $body -Token $t -Key (New-Key)
  Check "place a UPI order" $a 201 -Extra "$($a.Body.order_number) $($a.Body.status)"
  if ($a.Status -eq 201) {
    Check "cancel before paying" (Invoke-Api POST "/orders/$($a.Body.id)/cancel" -Token $t) 200
    Check "paying a cancelled order is refused" (Invoke-Api POST "/orders/$($a.Body.id)/payment" @{ utr = "100000000001" } -Token $t) 409 "ORDER_NOT_PAYABLE"
  }

  Write-Host "`n--- Pay, then the kitchen confirms ---"
  $o = Invoke-Api POST "/orders" $body -Token $t -Key (New-Key)
  Check "place a UPI order" $o 201 -Extra $o.Body.order_number
  if ($o.Status -eq 201) {
    $id = $o.Body.id
    $pay = $o.Body.upi_payment
    Assert "status PENDING_PAYMENT" ($o.Body.status -eq "PENDING_PAYMENT") $o.Body.status
    Assert "has a UPI link" ($pay.uri -like "upi://pay?pa=*") $pay.uri
    Assert "link amount = order total" ($pay.amount -eq ("{0:0.00}" -f ($o.Body.total / 100))) "Rs $($pay.amount) to $($pay.upi_id)"
    Assert "has a pay-by time" ([bool] $o.Body.payment_expires_at) $o.Body.payment_expires_at
    Write-Host "      UPI ID customers see: $($pay.upi_id) ($($pay.payee_name))"

    Check "bad UTR is refused" (Invoke-Api POST "/orders/$id/payment" @{ utr = "12345" } -Token $t) 400 "VALIDATION_ERROR"
    $fakeUtr = "9" + (Get-Random -Minimum 10000 -Maximum 99999) + (Get-Random -Minimum 100000 -Maximum 999999)  # made up, 12 digits
    $p = Invoke-Api POST "/orders/$id/payment" @{ utr = $fakeUtr } -Token $t
    Check "send the UTR (I've paid)" $p 200 -Extra "$($p.Body.payment_status) UTR $fakeUtr"
    Check "customer can't cancel after paying" (Invoke-Api POST "/orders/$id/cancel" -Token $t) 409 "ORDER_NOT_CANCELLABLE"

    $board = Invoke-Api GET "/admin/orders?date=$tomorrow" -Token $t
    $onBoard = @($board.Body | Where-Object { $_.id -eq $id })
    Assert "kitchen sees it with the UTR" (($onBoard.Count -eq 1) -and ($onBoard[0].utr -eq $fakeUtr))
    Check "kitchen can't cook before payment" (Invoke-Api POST "/admin/orders/$id/status" @{ status = "PREPARING" } -Token $t) 409 "INVALID_STATUS_CHANGE"
    $c = Invoke-Api POST "/admin/orders/$id/status" @{ status = "CONFIRMED" } -Token $t
    Check "kitchen: Payment received" $c 200 -Extra "$($c.Body.status) / $($c.Body.payment_status)"
    Assert "order is paid, link gone" (($c.Body.payment_status -eq "paid") -and (-not $c.Body.upi_payment))
    $x = Invoke-Api POST "/admin/orders/$id/status" @{ status = "CANCELLED"; reason = "Verify script test" } -Token $t
    Check "clean up: kitchen cancels the test order" $x 200 -Extra $x.Body.status
  }
} finally {
  if ($tempAddress) {
    Write-Host "`n--- Cleanup ---"
    Check "delete test address" (Invoke-Api DELETE "/addresses/$tempAddress" -Token $t) 204
  }
}

Write-Host "`nAuto-cancel of unpaid orders runs every 10 minutes. See its log with:"
Write-Host "  aws logs tail /aws/lambda/wmh-expire --since 1h --profile wmh --region ap-south-1"
Write-Host ""
if ($script:failed -eq 0) {
  Write-Host "All checks passed." -ForegroundColor Green
} else {
  Write-Host "$($script:failed) check(s) failed." -ForegroundColor Red
  exit 1
}
