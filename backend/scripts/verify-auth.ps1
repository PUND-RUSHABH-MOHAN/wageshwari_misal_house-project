<#
.SYNOPSIS
  End-to-end check of the deployed auth API (Part 1). Works in Windows PowerShell 5.1 and PowerShell 7.

.EXAMPLE
  .\backend\scripts\verify-auth.ps1 -ApiBaseUrl https://abc123.execute-api.ap-south-1.amazonaws.com -Email you+wmh1@gmail.com

  Use a fresh Gmail alias (you+wmh2@..., you+wmh3@...) per run: every run creates a real user,
  and Cognito's built-in sender allows ~50 emails a day.
#>
param(
  [Parameter(Mandatory = $true)] [string] $ApiBaseUrl,
  [Parameter(Mandatory = $true)] [string] $Email,
  [string] $Name = "WMH Test User",
  [string] $Phone = "9876543210"
)

$ErrorActionPreference = "Stop"
$base = $ApiBaseUrl.TrimEnd("/")
$script:failed = 0

function Invoke-Api {
  param([string] $Method, [string] $Path, $Body = $null, [string] $Token = $null)
  $headers = @{}
  if ($Token) { $headers["Authorization"] = "Bearer $Token" }
  $params = @{ Method = $Method; Uri = "$base$Path"; Headers = $headers; ContentType = "application/json"; UseBasicParsing = $true }
  if ($null -ne $Body) { $params.Body = ($Body | ConvertTo-Json -Compress) }
  try {
    $resp = Invoke-WebRequest @params
    $status = [int] $resp.StatusCode
    $content = $resp.Content
  } catch {
    if ($null -eq $_.Exception.Response) { throw }
    $status = [int] $_.Exception.Response.StatusCode
    $content = $_.ErrorDetails.Message
  }
  $json = $null
  if ($content) { $json = $content | ConvertFrom-Json }
  return [pscustomobject] @{ Status = $status; Body = $json }
}

function Check {
  param([string] $Label, $Result, [int] $Expected, [string] $ErrorCode = $null)
  $ok = $Result.Status -eq $Expected
  if ($ok -and $ErrorCode) { $ok = $Result.Body.error.code -eq $ErrorCode }
  $detail = if ($Result.Body -and $Result.Body.error) { " ($($Result.Body.error.code))" } else { "" }
  if ($ok) {
    Write-Host ("PASS  {0,-46} {1}{2}" -f $Label, $Result.Status, $detail) -ForegroundColor Green
  } else {
    $script:failed++
    $want = if ($ErrorCode) { "$Expected $ErrorCode" } else { "$Expected" }
    Write-Host ("FAIL  {0,-46} got {1}{2}, want {3}" -f $Label, $Result.Status, $detail, $want) -ForegroundColor Red
    if ($Result.Body) { Write-Host ("      " + ($Result.Body | ConvertTo-Json -Compress -Depth 5)) }
  }
}

$secure = Read-Host "Choose a password for $Email (8+ chars, a lowercase letter and a number)" -AsSecureString
$Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

Write-Host "`n--- Sign-up ---"
$r = Invoke-Api POST "/auth/register" @{ name = $Name; email = $Email; password = "short" ; phone = $Phone }
Check "register with weak password" $r 400 "WEAK_PASSWORD"

$r = Invoke-Api POST "/auth/register" @{ name = $Name; email = $Email; password = $Password; phone = $Phone }
if ($r.Status -eq 409) {
  Write-Host "      $Email already exists; use a new alias for a full run." -ForegroundColor Yellow
}
Check "register" $r 201
if ($r.Body.code_delivery) { Write-Host "      Code sent to $($r.Body.code_delivery.destination)" }

$r = Invoke-Api POST "/auth/login" @{ email = $Email; password = $Password }
Check "login before confirming" $r 403 "USER_NOT_CONFIRMED"

$r = Invoke-Api POST "/auth/confirm" @{ email = $Email; code = "000000" }
Check "confirm with wrong code" $r 400 "INVALID_CODE"

$code = Read-Host "Enter the 6-digit code from the email (check Spam; sender no-reply@verificationemail.com)"
$r = Invoke-Api POST "/auth/confirm" @{ email = $Email; code = $code.Trim() }
Check "confirm" $r 200

Write-Host "`n--- Login ---"
$r = Invoke-Api POST "/auth/login" @{ email = $Email; password = "wrongpass1" }
Check "login with wrong password" $r 401 "INVALID_CREDENTIALS"

$r = Invoke-Api POST "/auth/login" @{ email = $Email.ToUpper(); password = $Password }
Check "login (email in CAPS)" $r 200
$token = $r.Body.token
$refresh = $r.Body.refresh_token
if ($r.Status -eq 200) {
  Write-Host "      user = $($r.Body.user | ConvertTo-Json -Compress)"
  Write-Host "      expires_in = $($r.Body.expires_in)s"
}

Write-Host "`n--- /me ---"
$r = Invoke-Api GET "/me"
Check "GET /me without token (API Gateway rejects)" $r 401

$r = Invoke-Api GET "/me" -Token $token
Check "GET /me" $r 200

$r = Invoke-Api PATCH "/me" @{ name = "$Name (edited)" } -Token $token
Check "PATCH /me name" $r 200

$r = Invoke-Api PATCH "/me" @{ email = "other@example.com" } -Token $token
Check "PATCH /me email (not supported yet)" $r 400 "EMAIL_CHANGE_NOT_SUPPORTED"

$r = Invoke-Api PATCH "/me" @{ phone = "12345" } -Token $token
Check "PATCH /me bad phone" $r 400 "VALIDATION_ERROR"

Write-Host "`n--- Refresh + logout ---"
$r = Invoke-Api POST "/auth/refresh" @{ refresh_token = $refresh }
Check "refresh" $r 200
$r2 = Invoke-Api GET "/me" -Token $r.Body.token
Check "GET /me with refreshed token" $r2 200

$r = Invoke-Api POST "/auth/logout" @{ refresh_token = $refresh }
Check "logout" $r 204

$r = Invoke-Api POST "/auth/refresh" @{ refresh_token = $refresh }
Check "refresh after logout (revoked)" $r 401 "INVALID_REFRESH_TOKEN"

Write-Host "`n--- Password reset (no email needed for these) ---"
$r = Invoke-Api POST "/auth/password/forgot" @{ email = "nobody-$([guid]::NewGuid().ToString('N').Substring(0,8))@example.com" }
Check "forgot password, unknown email (no leak)" $r 200

Write-Host ""
if ($script:failed -eq 0) {
  Write-Host "All checks passed." -ForegroundColor Green
} else {
  Write-Host "$($script:failed) check(s) failed." -ForegroundColor Red
  exit 1
}
