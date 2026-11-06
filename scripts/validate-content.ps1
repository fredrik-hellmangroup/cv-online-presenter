<#
.SYNOPSIS
Validates a content repository with this checkout's content tooling.

.DESCRIPTION
Runs the same source, generation, provenance and validator steps as the reusable
validate-content workflow. Run it from an app checkout that is at the release tag
the content should be pinned to. -AppVersion defaults to the exact release tag at HEAD.

.EXAMPLE
.\scripts\validate-content.ps1 -ContentRoot D:\work\private-portfolio-content

.EXAMPLE
.\scripts\validate-content.ps1 -ContentRoot D:\work\private-portfolio-content -AppVersion v0.1.1 -Generate
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ContentRoot,

    # Release tag (vMAJOR.MINOR.PATCH) that HEAD of this checkout must be. Defaults to the exact tag at HEAD.
    [ValidatePattern('^v[0-9]+\.[0-9]+\.[0-9]+$')]
    [string]$AppVersion,

    # Regenerate mapped pages and provenance before checking. Only run once every mapped seed output exists.
    [switch]$Generate,

    # Also run the content tooling's own tests.
    [switch]$TestTooling
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$contentRootPath = (Resolve-Path -LiteralPath $ContentRoot).Path

function Invoke-Step {
    param([string]$Name, [scriptblock]$Body)
    Write-Host "==> $Name"
    & $Body
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE." }
}

Push-Location $repositoryRoot
try {
    if (-not $AppVersion) {
        $exact = @(git describe --tags --exact-match --match 'v[0-9]*' HEAD 2>$null)
        if ($LASTEXITCODE -eq 0 -and $exact.Count -eq 1 -and $exact[0] -cmatch '^v[0-9]+\.[0-9]+\.[0-9]+$') {
            $AppVersion = $exact[0]
        }
    }

    $pin = @()
    if ($AppVersion) {
        $pin = @('--app-version', $AppVersion)
        Write-Host "Pinned to app release $AppVersion."
    }
    else {
        Write-Warning 'HEAD is not an exact release tag; running without an app version pin.'
    }

    if (-not (Test-Path -LiteralPath 'node_modules')) {
        Invoke-Step 'Install content tooling' { npm ci }
    }
    if ($TestTooling) {
        Invoke-Step 'Content tooling tests' { npm run test:content }
    }

    Invoke-Step 'Validate content source' { npm run content:source:validate -- --root $contentRootPath @pin }
    if ($Generate) {
        Invoke-Step 'Generate content' { npm run content:generate -- --root $contentRootPath @pin }
    }
    Invoke-Step 'Check generated content' { npm run content:check -- --root $contentRootPath @pin }
    Invoke-Step 'Validate content (Node.js)' { npm run content:validate -- --root $contentRootPath }
    Invoke-Step 'Validate content (.NET)' {
        dotnet run --project tools/Portfolio.Content.Validator -- --content (Join-Path $contentRootPath 'content/pages')
    }
    Write-Host 'Content validation passed.'
}
finally {
    Pop-Location
}
