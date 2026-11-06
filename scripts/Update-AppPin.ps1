<#
.SYNOPSIS
Moves a content repository to another release of the app tooling.

.DESCRIPTION
Resolves -To ('latest', a range such as 'v1.*', or an exact tag such as 'v1.0.15') to an
existing release tag, rewrites every caller workflow in -ContentRoot to that tag, removes the
obsolete app_sha input, and regenerates provenance with that release. Review the resulting diff
and open a content PR. Use -WhatIf to only show what would change.

.EXAMPLE
.\scripts\Update-AppPin.ps1 -ContentRoot D:\work\private-portfolio-content -To latest

.EXAMPLE
.\scripts\Update-AppPin.ps1 -ContentRoot D:\work\private-portfolio-content -To v1.0.15 -SkipRegenerate
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory = $true)]
    [string]$ContentRoot,

    [Parameter(Mandatory = $true)]
    [string]$To,

    # owner/repository (GitHub.com) of the app. Defaults to the repository the callers reference.
    [string]$AppRepository,

    # Only rewrite the workflows; regenerate provenance yourself with Invoke-PinnedContentCheck.ps1 -Generate.
    [switch]$SkipRegenerate
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'AppPin.psm1') -Force

$contentRootPath = (Resolve-Path -LiteralPath $ContentRoot).Path
$pin = Get-AppPinReference -ContentRoot $contentRootPath
if (-not $AppRepository) { $AppRepository = $pin.Repository }
$version = Resolve-AppVersion -Repository $AppRepository -Spec $To
Write-Host "'$To' resolved to $version (currently $($pin.Ref))."

$utf8 = [Text.UTF8Encoding]::new($false)
$usesPattern = '(?m)^(\s*uses:\s*[A-Za-z0-9-]+/[A-Za-z0-9._-]+/\.github/workflows/[A-Za-z0-9._-]+\.ya?ml)@\S+'
foreach ($file in $pin.Files) {
    if (-not $PSCmdlet.ShouldProcess($file, "Pin to $version")) { continue }
    $text = [IO.File]::ReadAllText($file)
    $updated = [regex]::Replace($text, $usesPattern, '${1}@' + $version)
    $updated = [regex]::Replace($updated, '(?m)^[ \t]*app_sha:[^\r\n]*\r?\n', '')
    if ($updated -cne $text) { [IO.File]::WriteAllText($file, $updated, $utf8) }
}

if ($SkipRegenerate) { return }
if ($PSCmdlet.ShouldProcess('content/generated-provenance.json', "Regenerate with app $version")) {
    & (Join-Path $PSScriptRoot 'Invoke-PinnedContentCheck.ps1') -ContentRoot $contentRootPath -AppRepository $AppRepository -AppVersion $version -Generate
}
