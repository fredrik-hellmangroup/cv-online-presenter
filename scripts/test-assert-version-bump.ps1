$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'assert-version-bump.ps1'

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ($Actual -cne $Expected) {
        throw "$Message Expected '$Expected' but got '$Actual'."
    }
}

function Assert-Rejected {
    param([scriptblock]$Body, [string]$Pattern, [string]$Message)
    $rejected = $false
    try { & $Body | Out-Null }
    catch { $rejected = $_.Exception.Message -match $Pattern }
    if (-not $rejected) { throw $Message }
}

# Numeric, not lexical, ordering: v1.0.9 < v1.0.14. Non-release tags are ignored.
$tags = @('v1.0.9', 'v1.0.14', 'v1.0.13', 'recovery/manual-1-1', 'v2', 'v1.0.14-rc1', 'latest')
Assert-Equal (& $script -Version '1.0.15' -ExistingTags $tags) 'v1.0.15' 'Patch bump must be accepted.'
Assert-Equal (& $script -Version '1.1.0' -ExistingTags $tags) 'v1.1.0' 'Minor bump must reset patch.'
Assert-Equal (& $script -Version '2.0.0' -ExistingTags $tags) 'v2.0.0' 'Major bump must reset minor and patch.'
Assert-Equal (& $script -Version '1.11.0' -ExistingTags @('v1.9.0', 'v1.10.0')) 'v1.11.0' 'Minor ordering must be numeric.'

foreach ($invalid in @('1.0.14', '1.0.16', '1.2.0', '1.1.1', '2.0.1', '3.0.0', '0.9.9')) {
    Assert-Rejected { & $script -Version $invalid -ExistingTags $tags } 'not a valid next release' "Version '$invalid' must be rejected."
}
foreach ($malformed in @('v1.0.15', '1.0', '1.0.15 ', '1.0.15-rc1', '01.0.15', '')) {
    Assert-Rejected { & $script -Version $malformed -ExistingTags $tags } 'MAJOR\.MINOR\.PATCH' "Malformed version '$malformed' must be rejected."
}
Assert-Rejected { & $script -Version '1.0.1' -ExistingTags @('recovery/manual-1-1') } 'No existing' 'Bumping without any release tag must fail.'

Assert-Equal (& $script -Version '1.0.14' -ExistingTags $tags -AllowCurrent) 'v1.0.14' 'Bootstrap must accept the current release version.'
Assert-Rejected { & $script -Version '1.0.13' -ExistingTags $tags -AllowCurrent } 'not a valid next release' 'Bootstrap must not accept an older version.'

Write-Output 'VERSION bump validation tests passed.'
