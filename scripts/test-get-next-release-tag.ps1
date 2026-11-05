$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'get-next-release-tag.ps1'

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ($Actual -cne $Expected) {
        throw "$Message Expected '$Expected' but got '$Actual'."
    }
}

# Numeric, not lexical, ordering: v1.0.9 < v1.0.14.
$tags = @('v1.0.9', 'v1.0.14', 'v1.0.13', 'recovery/manual-1-1', 'v2', 'v1.0.14-rc1', 'latest')
Assert-Equal (& $script -Bump patch -ExistingTags $tags) 'v1.0.15' 'Patch bump must use numeric ordering and ignore non-release tags.'
Assert-Equal (& $script -Bump minor -ExistingTags $tags) 'v1.1.0' 'Minor bump must reset patch.'
Assert-Equal (& $script -Bump major -ExistingTags $tags) 'v2.0.0' 'Major bump must reset minor and patch.'
Assert-Equal (& $script -Bump minor -ExistingTags @('v1.9.0', 'v1.10.0')) 'v1.11.0' 'Minor ordering must be numeric.'

$threw = $false
try {
    & $script -Bump patch -ExistingTags @('recovery/manual-1-1', 'v1.0') | Out-Null
}
catch {
    $threw = $_.Exception.Message -match 'No existing'
}
if (-not $threw) {
    throw 'Bumping without any vMAJOR.MINOR.PATCH tag must fail.'
}

Write-Output 'Release tag calculation tests passed.'
