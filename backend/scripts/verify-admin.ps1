<#
.SYNOPSIS
  Checks the deployed admin API (Part 6) with an account in the Cognito `admin` group.
  It places ONE real cash order for tomorrow from that account, moves it to PREPARING, and then
  cancels it from the kitchen with the reason "Verify script test". The menu is only read
  (one no-change write), so customers see nothing different.
  Pass -CustomerEmail (a normal, non-admin account) to also check that customers get 403.
  Works in Windows PowerShell 5.1 and PowerShell 7.

.EXAMPLE
  .\backend\scripts\verify-admin.ps1 -Email owner@example.com
  .\backend\scripts\verify-admin.ps1 -Email owner@example.com -CustomerEmail you+wmh1@gmail.com
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
$today = $istNow.ToString("yyyy-MM-dd")
$tomorrow = $istNow.AddDays(1).ToString("yyyy-MM-dd")

$admin = Login $Email
if ($admin.user.role -ne "admin") {
  Write-Host "$Email is not in the 'admin' group yet. Add it, then run this again:" -ForegroundColor Yellow
  Write-Host "  aws cognito-idp admin-add-user-to-group --user-pool-id ap-south-1_Szcz11NPr --username $Email --group-name admin --profile wmh --region ap-south-1"
  exit 1
}
$t = $admin.token
Write-Host "Logged in as $Email (role: admin). India time now: $($istNow.ToString('yyyy-MM-dd HH:mm'))`n"

$tempAddress = $null
try {
  Write-Host "--- Access ---"
  Check "GET /admin/orders without token" (Invoke-Api GET "/admin/orders") 401
  if ($CustomerEmail) {
    $customer = Login $CustomerEmail
    Check "customer account gets 403" (Invoke-Api GET "/admin/orders" -Token $customer.token) 403 "FORBIDDEN"
    Check "customer can't edit the menu" (Invoke-Api PATCH "/admin/products/prd_chaha" @{ price = 100 } -Token $customer.token) 403 "FORBIDDEN"
  }

  Write-Host "`n--- Order board ---"
  $board = Invoke-Api GET "/admin/orders" -Token $t
  Check "GET /admin/orders (today)" $board 200 -Extra "$(@($board.Body).Count) order(s) for $today"
  Check "bad date is refused" (Invoke-Api GET "/admin/orders?date=26-11-2026" -Token $t) 400 "VALIDATION_ERROR"

  Write-Host "`n--- Menu (read + one no-change write) ---"
  $cats = Invoke-Api GET "/admin/categories" -Token $t
  Check "GET /admin/categories" $cats 200 -Extra "$(@($cats.Body).Count) categories (hidden ones included)"
  $prods = Invoke-Api GET "/admin/products" -Token $t
  Check "GET /admin/products" $prods 200 -Extra "$(@($prods.Body).Count) dishes (hidden ones included)"
  $dish = @($prods.Body | Where-Object { $_.is_available -and $_.is_active }) | Select-Object -First 1
  if ($dish) {
    Check "PATCH a dish with its own price (no change)" (Invoke-Api PATCH "/admin/products/$($dish.id)" @{ price = [int] $dish.price } -Token $t) 200 -Extra $dish.name
    Check "price below Rs 1 is refused" (Invoke-Api PATCH "/admin/products/$($dish.id)" @{ price = 50 } -Token $t) 400 "VALIDATION_ERROR"
  }
  Check "unknown dish is 404" (Invoke-Api PATCH "/admin/products/prd_does_not_exist" @{ price = 100 } -Token $t) 404 "NOT_FOUND"

  Write-Host "`n--- One real order through the kitchen (tomorrow, then cancelled) ---"
  $list = Invoke-Api GET "/addresses" -Token $t
  if (@($list.Body).Count -lt 5) {
    $r = Invoke-Api POST "/addresses" @{
      label = "Other"; receiver_name = "WMH Kitchen Test"; receiver_phone = "9876543210"
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
    address_id = $addressId; delivery_date = $tomorrow; slot_label = "Afternoon 12:00 - 1:00 PM"; payment_method = "cod"
    items = @(@{ product_id = $item.id; quantity = $qty })
  }
  $o = Invoke-Api POST "/orders" $body -Token $t -Key ("verify-" + [Guid]::NewGuid().ToString("N"))
  Check "place an order (as a customer would)" $o 201 -Extra $o.Body.order_number
  if ($o.Status -eq 201) {
    $id = $o.Body.id
    $next = Invoke-Api GET "/admin/orders?date=$tomorrow" -Token $t
    Assert "it's on tomorrow's board" (@($next.Body | Where-Object { $_.id -eq $id }).Count -eq 1)
    Check "skipping a step is refused" (Invoke-Api POST "/admin/orders/$id/status" @{ status = "DELIVERED" } -Token $t) 409 "INVALID_STATUS_CHANGE"
    $p = Invoke-Api POST "/admin/orders/$id/status" @{ status = "PREPARING" } -Token $t
    Check "kitchen: Start preparing" $p 200 -Extra $p.Body.status
    Check "same step twice is refused" (Invoke-Api POST "/admin/orders/$id/status" @{ status = "PREPARING" } -Token $t) 409 "INVALID_STATUS_CHANGE"
    Check "customer can't cancel once cooking" (Invoke-Api POST "/orders/$id/cancel" -Token $t) 409 "ORDER_NOT_CANCELLABLE"
    Check "kitchen cancel needs a reason" (Invoke-Api POST "/admin/orders/$id/status" @{ status = "CANCELLED" } -Token $t) 400 "VALIDATION_ERROR"
    $c = Invoke-Api POST "/admin/orders/$id/status" @{ status = "CANCELLED"; reason = "Verify script test" } -Token $t
    Check "kitchen cancel with reason" $c 200 -Extra $c.Body.status
    $mine = Invoke-Api GET "/orders/$id" -Token $t
    Assert "customer sees the reason" ($mine.Body.cancel_reason -eq "Verify script test") $mine.Body.cancel_reason
    Assert "history has 3 steps" (@($c.Body.status_history).Count -eq 3) (($c.Body.status_history | ForEach-Object { $_.status }) -join " > ")
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
