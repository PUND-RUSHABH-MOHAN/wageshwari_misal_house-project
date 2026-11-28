<#
.SYNOPSIS
  Checks the deployed orders API (Part 5, updated for part 7d) with a real, already-confirmed account.
  It asks for a delivery estimate, places ONE real cash-on-delivery order (for today, now: there
  are no dates or slots since part 7d) and then cancels it, so you'll see one cancelled order in
  the app's Orders tab afterwards. Orders are only taken 9:00 AM - 8:30 PM India time; outside
  those hours the script checks that the server refuses with KITCHEN_CLOSED and stops there. A temporary address is created
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
$minutesNow = $istNow.Hour * 60 + $istNow.Minute
$orderingOpen = ($minutesNow -ge 9 * 60) -and ($minutesNow -le 20 * 60 + 30)  # store.py: 9:00 - 20:30 IST

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
  $body = @{ address_id = $addressId; payment_method = "cod"; items = $items }
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
  $bad = $body.Clone(); $bad.address_id = "adr_0000000000000000"
  Check "someone else's / unknown address is 404" (Invoke-Api POST "/orders" $bad -Token $t -Key (New-Key)) 404 "NOT_FOUND"

  Write-Host "`n--- Delivery estimate (part 7d) ---"
  Check "GET /orders/estimate without token" (Invoke-Api GET "/orders/estimate") 401
  $e = Invoke-Api GET "/orders/estimate?address_id=$addressId" -Token $t
  Check "GET /orders/estimate?address_id=" $e 200 -Extra ("{0} min = {1} cooking + {2} travel, can_order={3}" -f $e.Body.total_minutes, $e.Body.prep_minutes, $e.Body.travel_minutes, $e.Body.can_order)
  if ($e.Status -eq 200) {
    Assert "total = cooking + travel" ($e.Body.total_minutes -ge $e.Body.prep_minutes + $e.Body.travel_minutes - 5) "rounded up to 5 min"
    $eta = [DateTime]::Parse($e.Body.estimated_delivery_at).ToUniversalTime()
    Assert "estimate is in the future" ($eta -gt [DateTime]::UtcNow) $eta.AddHours(5.5).ToString("HH:mm")
    Assert "uses the address (not approximate)" (-not $e.Body.approximate)
    Assert "can_order matches the clock (9:00 - 20:30 IST)" ([bool] $e.Body.can_order -eq $orderingOpen) $e.Body.closed_reason
  }
  Check "unknown address_id is 404" (Invoke-Api GET "/orders/estimate?address_id=adr_0000000000000000" -Token $t) 404 "NOT_FOUND"

  if (-not $orderingOpen) {
    Write-Host "`n--- Outside ordering hours ---"
    Check "order now is refused (kitchen closed)" (Invoke-Api POST "/orders" $body -Token $t -Key (New-Key)) 409 "KITCHEN_CLOSED"
    Write-Host "SKIP  placing and cancelling a real order: run again between 9:00 AM and 8:30 PM IST." -ForegroundColor Yellow
  } else {

  Write-Host "`n--- Place one real order (today, now, COD) ---"
  $key = New-Key
  $o = Invoke-Api POST "/orders" $body -Token $t -Key $key
  Check "POST /orders" $o 201 -Extra "$($o.Body.order_number) total=$($o.Body.total)"
  if ($o.Status -eq 201) {
    $order = $o.Body
    Assert "order number is WMH-YYYYMMDD-NNNN" ($order.order_number -match '^WMH-\d{8}-\d{4}$') $order.order_number
    Assert "status PENDING (waits for the hotel), payment pending" (($order.status -eq "PENDING") -and ($order.payment_status -eq "pending"))
    Assert "server bill = menu prices + Rs 30 + 5% GST" ($order.total -eq $expectedTotal) "want $expectedTotal"
    Assert "address snapshot is a copy" ($order.address_snapshot.id -eq $addressId) $order.address_snapshot.line1
    Assert "for today, no slot" (($order.delivery_date -eq $today) -and (-not $order.slot_label)) $order.delivery_date
    Assert "has an estimated delivery time" ([bool] $order.estimated_delivery_at) ([DateTime]::Parse($order.estimated_delivery_at).ToUniversalTime().AddHours(5.5).ToString("HH:mm") + " IST")
    Assert "first estimate is kept too" ($order.original_estimated_delivery_at -eq $order.estimated_delivery_at)

    $again = Invoke-Api POST "/orders" $body -Token $t -Key $key
    Check "retry with same key returns same order" $again 201 -Extra $again.Body.order_number
    Assert "  ...and it's the same order id" ($again.Body.id -eq $order.id)
    # Old app builds still send a date and slot: they are ignored, so this is the same request.
    $old = $body.Clone(); $old.delivery_date = $istNow.AddDays(3).ToString("yyyy-MM-dd"); $old.slot_label = "Morning 9:00 - 10:00 AM"
    $replay = Invoke-Api POST "/orders" $old -Token $t -Key $key
    Assert "old date/slot fields are ignored (same order)" (($replay.Status -eq 201) -and ($replay.Body.id -eq $order.id)) "$($replay.Status)"
    $changed = $body.Clone(); $changed.items = @(@{ product_id = $spicy.id; quantity = [int] $qty + 1; spice_level = "mild" })
    Check "same key, different order is refused" (Invoke-Api POST "/orders" $changed -Token $t -Key $key) 409 "IDEMPOTENCY_CONFLICT"

    $l = Invoke-Api GET "/orders" -Token $t
    Check "GET /orders" $l 200 -Extra "$(@($l.Body).Count) order(s)"
    Assert "newest order is listed first" (@($l.Body)[0].id -eq $order.id)
    Check "GET /orders/{id}" (Invoke-Api GET "/orders/$($order.id)" -Token $t) 200
    Check "unknown order id is 404" (Invoke-Api GET "/orders/ord_0000000000000000000" -Token $t) 404 "NOT_FOUND"

    Write-Host "`n--- Cancel ---"
    $c = Invoke-Api POST "/orders/$($order.id)/cancel" -Token $t
    Check "POST /orders/{id}/cancel" $c 200 -Extra $c.Body.status
    Assert "status is now CANCELLED, with the time" (($c.Body.status -eq "CANCELLED") -and [bool] $c.Body.cancelled_at)
    Assert "cash order: no refund needed" (-not $c.Body.refund_status) "$($c.Body.refund_status)"
    Check "cancelling twice is harmless" (Invoke-Api POST "/orders/$($order.id)/cancel" -Token $t) 200
  }
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
