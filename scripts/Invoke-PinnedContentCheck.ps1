<#
.SYNOPSIS
Validates a content repository with the app release its workflows are pinned to.

.DESCRIPTION
Clones the app at the exact release tag referenced by the content repository's caller
workflows (or -AppVersion), verifies the checkout like the reusable workflows do, then runs
that checkout's scripts\validate-content.ps1 against -ContentRoot. The checkout is temporary.
Use scripts\validate-content.ps1 directly when you already have the right app checkout.

.EXAMPLE
.\scripts\Invoke-PinnedContentCheck.ps1 -ContentRoot D:\work\private-portfolio-content

.EXAMPLE
.\scripts\Invoke-PinnedContentCheck.ps1 -ContentRoot D:\work\private-portfolio-content -Generate
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ContentRoot,

    # Defaults to the release tag referenced by the content repository's .github\workflows\*.yml.
    [ValidatePattern('^v[0-9]+\.[0-9]+\.[0-9]+$')]
    [string]$AppVersion,

    # owner/repository (GitHub.com) of the app. Defaults to the repository the callers reference.
    [string]$AppRepository,

    # Regenerate pages and provenance before checking.
    [switch]$Generate,

    # Keep the temporary app checkout for inspection.
    [switch]$KeepCheckout
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'AppPin.psm1') -Force

$contentRootPath = (Resolve-Path -LiteralPath $ContentRoot).Path
$pin = Get-AppPinReference -ContentRoot $contentRootPath
if (-not $AppRepository) { $AppRepository = $pin.Repository }
if (-not $AppVersion) {
    if ($pin.Ref -cnotmatch '^v[0-9]+\.[0-9]+\.[0-9]+$') {
        throw "Caller workflows reference '$($pin.Ref)', not a release tag. Run scripts\Update-AppPin.ps1 -To <version|latest> first."
    }
    $AppVersion = $pin.Ref
}

$checkout = New-TemporaryCheckoutPath -Version $AppVersion
try {
    Write-Host "Using app release $AppVersion from $AppRepository."
    Install-AppCheckout -Repository $AppRepository -Version $AppVersion -Path $checkout
    & (Join-Path $checkout 'scripts/validate-content.ps1') -ContentRoot $contentRootPath -AppVersion $AppVersion -TestTooling -Generate:$Generate
}
finally {
    if ($KeepCheckout) { Write-Host "App checkout kept at $checkout" }
    elseif (Test-Path -LiteralPath $checkout) { Remove-Item -LiteralPath $checkout -Recurse -Force }
}
