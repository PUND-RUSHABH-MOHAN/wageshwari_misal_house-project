<#
.SYNOPSIS
  Checks the deployed delivery flow (Part 7c): confirm -> auto-assign -> delivery boy's tab ->
  Picked up, with an admin account and a delivery-boy account (Cognito groups `admin` and
  `delivery`; one person can be both).
  It places ONE real cash order for tomorrow from the admin account, confirms it, makes sure it
  is with the test delivery boy (reassigning if another boy got it), marks it Picked up, and then
  cancels it from the kitchen with the reason "Verify script test". The delivery boy's duty
  status is put back the way it was. A temporary address is created and deleted if needed.
  Works in Windows PowerShell 5.1 and PowerShell 7.

.EXAMPLE
  .\backend\scripts\verify-delivery.ps1 -Email owner@example.com -DeliveryEmail ramu@example.com
  .\backend\scripts\verify-delivery.ps1 -Email owner@example.com -DeliveryEmail owner@example.com
#>
param(
  [Parameter(Mandatory = $true)] [string] $Email,
  [Parameter(Mandatory = $true)] [string] $DeliveryEmail,
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

function Add-Group([string] $Who, [string] $Group) {
  Write-Host "$Who is not in the '$Group' group yet. Add it, log in again, then run this again:" -ForegroundColor Yellow
  Write-Host "  aws cognito-idp admin-add-user-to-group --user-pool-id ap-south-1_Szcz11NPr --username $Who --group-name $Group --profile wmh --region ap-south-1"
  exit 1
}

$istNow = [DateTime]::UtcNow.AddHours(5.5)
$tomorrow = $istNow.AddDays(1).ToString("yyyy-MM-dd")

$admin = Login $Email
if ($admin.user.role -ne "admin") { Add-Group $Email "admin" }
$t = $admin.token
if ($DeliveryEmail -eq $Email) { $boyLogin = $admin } else { $boyLogin = Login $DeliveryEmail }
if (-not (@($boyLogin.user.roles) -contains "delivery")) { Add-Group $DeliveryEmail "delivery" }
$bt = $boyLogin.token

$tempAddress = $null
$orderId = $null
$wasOnDuty = $null
try {
  Write-Host "`n--- Access ---"
  Check "GET /delivery/orders without token" (Invoke-Api GET "/delivery/orders") 401
  if ($DeliveryEmail -ne $Email -and -not (@($admin.user.roles) -contains "delivery")) {
    Check "admin without the delivery group gets 403" (Invoke-Api GET "/delivery/orders" -Token $t) 403 "FORBIDDEN"
  }
  if (-not (@($boyLogin.user.roles) -contains "admin")) {
    Check "delivery boy can't use admin routes" (Invoke-Api GET "/admin/delivery-boys" -Token $bt) 403 "FORBIDDEN"
  }

  Write-Host "`n--- Delivery boy goes on duty ---"
  $me = Invoke-Api GET "/delivery/me" -Token $bt
  Check "GET /delivery/me" $me 200 -Extra "$($me.Body.name), on duty: $($me.Body.on_duty)"
  $wasOnDuty = [bool] $me.Body.on_duty
  $boyId = $me.Body.id
  $duty = Invoke-Api PATCH "/delivery/me" @{ on_duty = $true } -Token $bt
  Check "PATCH /delivery/me (on duty)" $duty 200 -Extra "active orders: $($duty.Body.active_orders)"
  if ($duty.Status -ne 200) {
    Write-Host "Add a mobile number to $DeliveryEmail in the app's Account tab, then run this again." -ForegroundColor Yellow
    throw "Delivery boy couldn't go on duty."
  }
  $boys = Invoke-Api GET "/admin/delivery-boys" -Token $t
  Assert "admin sees him on duty" (@($boys.Body | Where-Object { $_.id -eq $boyId -and $_.on_duty }).Count -eq 1)

  Write-Host "`n--- One real order (tomorrow, then cancelled) ---"
  $list = Invoke-Api GET "/addresses" -Token $t
  if (@($list.Body).Count -lt 5) {
    $r = Invoke-Api POST "/addresses" @{
      label = "Other"; receiver_name = "WMH Delivery Test"; receiver_phone = "9876543210"
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
  $o = Invoke-Api POST "/orders" @{
    address_id = $addressId; delivery_date = $tomorrow; slot_label = "Afternoon 12:00 - 1:00 PM"; payment_method = "cod"
    items = @(@{ product_id = $item.id; quantity = $qty })
  } -Token $t -Key ("verify-" + [Guid]::NewGuid().ToString("N"))
  Check "place a cash order" $o 201 -Extra "$($o.Body.order_number) $($o.Body.status)"
  if ($o.Status -ne 201) { throw "Couldn't place the test order." }
  $orderId = $o.Body.id
  Check "delivery boy can't see it before assignment" (Invoke-Api POST "/delivery/orders/$orderId/status" @{ status = "OUT_FOR_DELIVERY" } -Token $bt) 404 "NOT_FOUND"

  Write-Host "`n--- Confirm -> auto-assign ---"
  $c = Invoke-Api POST "/admin/orders/$orderId/status" @{ status = "CONFIRMED" } -Token $t
  Check "kitchen: Confirm order" $c 200 -Extra "$($c.Body.status), auto-assign: $($c.Body.auto_assign), to: $($c.Body.delivery_boy.name)"
  Assert "it was assigned automatically" (($c.Body.status -eq "ASSIGNED") -and ($c.Body.auto_assign -eq "assigned"))
  if ($c.Body.delivery_boy.id -ne $boyId) {
    Write-Host "      Another on-duty delivery boy got it; moving it to $DeliveryEmail for the test."
    $re = Invoke-Api POST "/admin/orders/$orderId/assign" @{ delivery_boy_id = $boyId } -Token $t
    Check "reassign by hand" $re 200 -Extra $re.Body.delivery_boy.name
  }
  $again = Invoke-Api POST "/admin/orders/$orderId/status" @{ status = "CONFIRMED" } -Token $t
  Assert "second Confirm changes nothing" (($again.Status -eq 200) -and ($again.Body.auto_assign -eq "unchanged") -and ($again.Body.delivery_boy.id -eq $boyId))
  Check "assign someone unknown is 404" (Invoke-Api POST "/admin/orders/$orderId/assign" @{ delivery_boy_id = "nobody" } -Token $t) 404 "NOT_FOUND"

  Write-Host "`n--- Delivery boy's tab ---"
  $jobs = Invoke-Api GET "/delivery/orders" -Token $bt
  $job = @($jobs.Body | Where-Object { $_.id -eq $orderId }) | Select-Object -First 1
  Check "GET /delivery/orders" $jobs 200 -Extra "$(@($jobs.Body).Count) order(s)"
  Assert "he sees customer, phone, address, cash" (($job.customer.phone) -and ($job.address.line1) -and ($job.address.state -eq "Maharashtra") -and ($job.collect_cash -eq $o.Body.total))
  $mine = Invoke-Api GET "/orders/$orderId" -Token $t
  Assert "customer sees the delivery boy" ($mine.Body.delivery_boy.name -and $mine.Body.delivery_boy.phone) "$($mine.Body.delivery_boy.name)"
  Check "customer can't cancel once assigned" (Invoke-Api POST "/orders/$orderId/cancel" -Token $t) 409 "ORDER_NOT_CANCELLABLE"
  Check "can't skip Picked up" (Invoke-Api POST "/delivery/orders/$orderId/status" @{ status = "DELIVERED" } -Token $bt) 409 "INVALID_STATUS_CHANGE"
  $up = Invoke-Api POST "/delivery/orders/$orderId/status" @{ status = "OUT_FOR_DELIVERY" } -Token $bt
  Check "delivery boy: Picked up" $up 200 -Extra $up.Body.status
  Check "Picked up twice is harmless" (Invoke-Api POST "/delivery/orders/$orderId/status" @{ status = "OUT_FOR_DELIVERY" } -Token $bt) 200

  Write-Host "`n--- Clean up ---"
  $x = Invoke-Api POST "/admin/orders/$orderId/status" @{ status = "CANCELLED"; reason = "Verify script test" } -Token $t
  Check "kitchen cancels the test order" $x 200 -Extra $x.Body.status
  if ($x.Status -eq 200) { $orderId = $null }
  $after = @((Invoke-Api GET "/delivery/orders" -Token $bt).Body | Where-Object { $_.id -eq $x.Body.id }) | Select-Object -First 1
  Assert "his tab shows it cancelled, details hidden" (($null -eq $after) -or (($after.status -eq "CANCELLED") -and (-not $after.customer)))
  Check "can't deliver a cancelled order" (Invoke-Api POST "/delivery/orders/$($x.Body.id)/status" @{ status = "DELIVERED" } -Token $bt) 409 "INVALID_STATUS_CHANGE"
  $steps = ($x.Body.status_history | ForEach-Object { $_.status }) -join " > "
  Write-Host "      History: $steps"
} finally {
  if ($orderId) {
    Invoke-Api POST "/admin/orders/$orderId/status" @{ status = "CANCELLED"; reason = "Verify script test" } -Token $t | Out-Null
    Write-Host "Cancelled the test order after an error." -ForegroundColor Yellow
  }
  if ($wasOnDuty -eq $false) {
    $off = Invoke-Api PATCH "/delivery/me" @{ on_duty = $false } -Token $bt
    Check "delivery boy back off duty (as before)" $off 200
  }
  if ($tempAddress) {
    Check "delete test address" (Invoke-Api DELETE "/addresses/$tempAddress" -Token $t) 204
  }
}

Write-Host ""
if ($script:failed -eq 0) {
  Write-Host "All delivery checks passed." -ForegroundColor Green
} else {
  Write-Host "$($script:failed) check(s) failed." -ForegroundColor Red
  exit 1
}
