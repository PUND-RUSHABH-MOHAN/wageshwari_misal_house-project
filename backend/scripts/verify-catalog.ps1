<#
.SYNOPSIS
  Checks the deployed menu API (Part 3) and the CloudFront photos. No login or email needed.
  Works in Windows PowerShell 5.1 and PowerShell 7.

.EXAMPLE
  .\backend\scripts\verify-catalog.ps1
#>
param(
  [string] $ApiBaseUrl = "https://cyfnnlsjga.execute-api.ap-south-1.amazonaws.com",
  [string] $MediaBucket = "wmh-media-630287363216"
)

$ErrorActionPreference = "Stop"
$base = $ApiBaseUrl.TrimEnd("/")
$script:failed = 0

function Check([string] $Label, [bool] $Ok, [string] $Detail = "") {
  if ($Ok) {
    Write-Host ("PASS  {0,-52} {1}" -f $Label, $Detail) -ForegroundColor Green
  } else {
    $script:failed++
    Write-Host ("FAIL  {0,-52} {1}" -f $Label, $Detail) -ForegroundColor Red
  }
}

function Get-Status([string] $Uri, [string] $Method = "GET") {
  try {
    $r = Invoke-WebRequest -Uri $Uri -Method $Method -UseBasicParsing
    # Decode the raw bytes as UTF-8 ourselves, so Marathi names survive in PowerShell 5.1 too.
    $text = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
    return [pscustomobject] @{ Status = [int] $r.StatusCode; Headers = $r.Headers; Text = $text; Length = $r.RawContentLength }
  } catch {
    if ($null -eq $_.Exception.Response) { throw }
    return [pscustomobject] @{ Status = [int] $_.Exception.Response.StatusCode; Headers = @{}; Text = $null; Length = 0 }
  }
}

Write-Host "`n--- GET /categories ---"
$r = Get-Status "$base/categories"
Check "status 200" ($r.Status -eq 200) "$($r.Status)"
Check "Cache-Control header" ("$($r.Headers['Cache-Control'])" -like "*max-age=60*") "$($r.Headers['Cache-Control'])"
$cats = $r.Text | ConvertFrom-Json
if ($cats -isnot [array]) { $cats = @($cats) }
Check "4 categories" ($cats.Count -eq 4) "$($cats.Count)"
Check "sorted by sort_order" ((($cats | ForEach-Object { $_.id }) -join ",") -eq "cat_misal,cat_thali,cat_vadapav,cat_chaha") (($cats | ForEach-Object { $_.name }) -join ", ")
Check "Marathi names present" ($cats[0].name_mr.Length -gt 0) "$($cats[0].name_mr)"

Write-Host "`n--- GET /products ---"
$r = Get-Status "$base/products"
Check "status 200" ($r.Status -eq 200) "$($r.Status)"
$prods = $r.Text | ConvertFrom-Json
if ($prods -isnot [array]) { $prods = @($prods) }
Check "6 products" ($prods.Count -eq 6) "$($prods.Count)"
$badPrice = $prods | Where-Object { $_.price -isnot [int] -and $_.price -isnot [long] }
Check "prices are integer paise" ($null -eq $badPrice) (($prods | ForEach-Object { "$($_.name) Rs$($_.price / 100)" }) -join ", ")
$misal = $prods | Where-Object { $_.id -eq "prd_misal_pav" }
Check "Misal Pav = 9000 paise, spice picker on" ($misal.price -eq 9000 -and $misal.has_spice_level -eq $true) "$($misal.price)"
$fields = "id,category_id,name,name_mr,description,price,image_url,is_veg,has_spice_level,is_available" -split ","
$missing = $fields | Where-Object { -not ($misal.PSObject.Properties.Name -contains $_) }
Check "Product has every contract field" ($missing.Count -eq 0) ($missing -join ",")

Write-Host "`n--- Photos via CloudFront ---"
$urls = @($cats | ForEach-Object { $_.image_url }) + @($prods | ForEach-Object { $_.image_url }) | Sort-Object -Unique
foreach ($u in $urls) {
  $p = Get-Status $u
  $type = "$($p.Headers['Content-Type'])"
  Check ("photo " + ($u -split "/")[-1]) ($p.Status -eq 200 -and $type -eq "image/jpeg") "$($p.Status) $type $([math]::Round($p.Length / 1KB))KB"
}
Check "photos are on cloudfront.net" (($urls | Where-Object { $_ -notlike "https://*.cloudfront.net/menu/*" }).Count -eq 0) ($urls[0] -replace "/menu/.*", "")

Write-Host "`n--- Bucket is private ---"
$direct = Get-Status "https://$MediaBucket.s3.ap-south-1.amazonaws.com/menu/misal.jpg"
Check "direct S3 URL is refused" ($direct.Status -eq 403) "$($direct.Status) (expected 403)"

Write-Host ""
if ($script:failed -eq 0) {
  Write-Host "All checks passed." -ForegroundColor Green
} else {
  Write-Host "$($script:failed) check(s) failed." -ForegroundColor Red
  exit 1
}
