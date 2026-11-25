<#
.SYNOPSIS
  Checks the deployed orders API (Part 5) with a real, already-confirmed account.
  It places ONE real cash-on-delivery order for tomorrow and then cancels it, so you'll see
  one cancelled order in the app's Orders tab afterwards. A temporary address is created
  (and deleted at the end) if the account has room; otherwise the default address is used.
  Works in Windows PowerShell 5.1 and PowerShell 7.

.EXAMPLE
  .\backend\scripts\verify-orders.ps1 -Email you+wmh1@gmail.com
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
    Write-Host ("PASS  {0,-46} {1} {2}" -f $Label, $Result.Status, $detail) -ForegroundColor Green
  } else {
    $script:failed++
    Write-Host ("FAIL  {0,-46} got {1} {2}, want {3} {4}" -f $Label, $Result.Status, $detail, $Expected, $ErrorCode) -ForegroundColor Red
  }
}

function Assert([string] $Label, [bool] $Condition, [string] $Extra = "") {
  Check $Label ([pscustomobject] @{ Status = [int] $Condition; Body = $null }) 1 -Extra $Extra
}

function New-Key { return "verify-" + [Guid]::NewGuid().ToString("N") }

# India time (the server uses IST, UTC+05:30)
$istNow = [DateTime]::UtcNow.AddHours(5.5)
$today = $istNow.ToString("yyyy-MM-dd")
$tomorrow = $istNow.AddDays(1).ToString("yyyy-MM-dd")
$morning = "Morning 8:00 - 9:00 AM"

$secure = Read-Host "Password for $Email" -AsSecureString
$password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$login = Invoke-Api POST "/auth/login" @{ email = $Email; password = $password }
if ($login.Status -ne 200) { Write-Host "Login failed: $($login.Status) $($login.Body.error.message)" -ForegroundColor Red; exit 1 }
$t = $login.Body.token
Write-Host "Logged in as $($login.Body.user.email). India time now: $($istNow.ToString('yyyy-MM-dd HH:mm'))`n"

$tempAddress = $null
try {
  # --- Setup: an address and two dishes from the live menu -------------------------------
  $list = Invoke-Api GET "/addresses" -Token $t
  if (@($list.Body).Count -lt 5) {
    $r = Invoke-Api POST "/addresses" @{
      label = "Other"; receiver_name = "WMH Order Test"; receiver_phone = "9876543210"
      line1 = "Plot 7, Test Residency"; pincode = "431203"; latitude = 19.8700; longitude = 75.8600
    } -Token $t
    if ($r.Status -ne 201) { Write-Host "Couldn't create a test address: $($r.Body.error.message)" -ForegroundColor Red; exit 1 }
    $tempAddress = $r.Body.id
    $addressId = $tempAddress
  } else {
    $addressId = @($list.Body)[0].id
  }

  $products = @((Invoke-Api GET "/products").Body | Where-Object { $_.is_available })
  $spicy = $products | Where-Object { $_.has_spice_level } | Sort-Object price | Select-Object -First 1
  $plain = $products | Where-Object { -not $_.has_spice_level } | Sort-Object price | Select-Object -First 1
  if (-not $spicy -or -not $plain) { Write-Host "Need one spicy and one plain dish on the menu." -ForegroundColor Red; exit 1 }
  $qty = [Math]::Max(1, [Math]::Ceiling(10000 / $spicy.price))  # reach the Rs 100 minimum
  $items = @(
    @{ product_id = $spicy.id; quantity = [int] $qty; spice_level = "teekha"; note = "verify script" },
    @{ product_id = $plain.id; quantity = 1 }
  )
  $body = @{ address_id = $addressId; delivery_date = $tomorrow; slot_label = $morning; payment_method = "cod"; items = $items }
  $subtotal = $spicy.price * $qty + $plain.price
  $tax = [Math]::Floor(($subtotal * 500 + 5000) / 10000)
  $expectedTotal = $subtotal + 3000 + $tax

  Write-Host "--- Access and validation ---"
  Check "GET /orders without token" (Invoke-Api GET "/orders") 401
  Check "POST /orders without Idempotency-Key" (Invoke-Api POST "/orders" $body -Token $t) 400 "VALIDATION_ERROR"
  $small = $body.Clone(); $small.items = @(@{ product_id = $plain.id; quantity = 1 })
  if ($plain.price -lt 10000) {
    Check "below Rs 100 minimum is refused" (Invoke-Api POST "/orders" $small -Token $t -Key (New-Key)) 422 "BELOW_MINIMUM_ORDER"
  }
  $online = $body.Clone(); $online.payment_method = "online"
  Check "online payment refused (COD only for now)" (Invoke-Api POST "/orders" $online -Token $t -Key (New-Key)) 400 "PAYMENT_METHOD_UNAVAILABLE"
  $later = $body.Clone(); $later.delivery_date = $istNow.AddDays(3).ToString("yyyy-MM-dd")
  Check "delivery in 3 days is refused" (Invoke-Api POST "/orders" $later -Token $t -Key (New-Key)) 409 "SLOT_UNAVAILABLE"
  if ($istNow.Hour * 60 + $istNow.Minute -ge 7 * 60 + 30) {
    $closed = $body.Clone(); $closed.delivery_date = $today
    Check "today's Morning slot (closed at 7:30)" (Invoke-Api POST "/orders" $closed -Token $t -Key (New-Key)) 409 "SLOT_UNAVAILABLE"
  }
  $bad = $body.Clone(); $bad.address_id = "adr_0000000000000000"
  Check "someone else's / unknown address is 404" (Invoke-Api POST "/orders" $bad -Token $t -Key (New-Key)) 404 "NOT_FOUND"

  Write-Host "`n--- Place one real order (tomorrow, Morning, COD) ---"
  $key = New-Key
  $o = Invoke-Api POST "/orders" $body -Token $t -Key $key
  Check "POST /orders" $o 201 -Extra "$($o.Body.order_number) total=$($o.Body.total)"
  if ($o.Status -eq 201) {
    $order = $o.Body
    Assert "order number is WMH-YYYYMMDD-NNNN" ($order.order_number -match '^WMH-\d{8}-\d{4}$') $order.order_number
    Assert "status CONFIRMED, payment pending" (($order.status -eq "CONFIRMED") -and ($order.payment_status -eq "pending"))
    Assert "server bill = menu prices + Rs 30 + 5% GST" ($order.total -eq $expectedTotal) "want $expectedTotal"
    Assert "address snapshot is a copy" ($order.address_snapshot.id -eq $addressId) $order.address_snapshot.line1

    $again = Invoke-Api POST "/orders" $body -Token $t -Key $key
    Check "retry with same key returns same order" $again 201 -Extra $again.Body.order_number
    Assert "  ...and it's the same order id" ($again.Body.id -eq $order.id)
    $changed = $body.Clone(); $changed.slot_label = "Lunch 12:00 - 1:00 PM"
    Check "same key, different order is refused" (Invoke-Api POST "/orders" $changed -Token $t -Key $key) 409 "IDEMPOTENCY_CONFLICT"

    $l = Invoke-Api GET "/orders" -Token $t
    Check "GET /orders" $l 200 -Extra "$(@($l.Body).Count) order(s)"
    Assert "newest order is listed first" (@($l.Body)[0].id -eq $order.id)
    Check "GET /orders/{id}" (Invoke-Api GET "/orders/$($order.id)" -Token $t) 200
    Check "unknown order id is 404" (Invoke-Api GET "/orders/ord_0000000000000000000" -Token $t) 404 "NOT_FOUND"

    Write-Host "`n--- Cancel ---"
    $c = Invoke-Api POST "/orders/$($order.id)/cancel" -Token $t
    Check "POST /orders/{id}/cancel" $c 200 -Extra $c.Body.status
    Assert "status is now CANCELLED" ($c.Body.status -eq "CANCELLED")
    Check "cancelling twice is harmless" (Invoke-Api POST "/orders/$($order.id)/cancel" -Token $t) 200
  }
} finally {
  if ($tempAddress) {
    Write-Host "`n--- Cleanup ---"
    Check "delete test address" (Invoke-Api DELETE "/addresses/$tempAddress" -Token $t) 204
  }
}

Write-Host ""
if ($script:failed -eq 0) {
  Write-Host "All checks passed." -ForegroundColor Green
} else {
  Write-Host "$($script:failed) check(s) failed." -ForegroundColor Red
  exit 1
}
