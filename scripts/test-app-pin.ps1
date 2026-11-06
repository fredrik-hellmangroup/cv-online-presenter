$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'AppPin.psm1') -Force

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ($Actual -cne $Expected) { throw "$Message Expected '$Expected' but got '$Actual'." }
}

function Assert-Rejected {
    param([scriptblock]$Body, [string]$Pattern, [string]$Message)
    $rejected = $false
    try { & $Body | Out-Null }
    catch { $rejected = $_.Exception.Message -match $Pattern }
    if (-not $rejected) { throw $Message }
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('app-pin-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null
$savedConfig = @{}
foreach ($name in 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0') { $savedConfig[$name] = [Environment]::GetEnvironmentVariable($name) }
try {
    # A local repository stands in for GitHub through a git URL rewrite, so no network is needed.
    $remote = Join-Path $work 'remote'
    git init --quiet $remote
    git -C $remote -c user.name=test -c user.email=test@example.invalid commit --quiet --allow-empty -m init
    foreach ($tag in 'v1.0.9', 'v1.0.14', 'v1.2.0', 'v1.10.0', 'v2.0.0', 'v2.0.0-rc1', 'recovery/manual-1-1', 'latest') {
        git -C $remote tag $tag
    }
    $env:GIT_CONFIG_COUNT = '1'
    $env:GIT_CONFIG_KEY_0 = 'url.' + ($remote -replace '\\', '/') + '.insteadOf'
    $env:GIT_CONFIG_VALUE_0 = 'https://github.com/owner/app.git'

    # Numeric, not lexical, ordering: v1.10.0 > v1.2.0. Non-release tags are ignored.
    Assert-Equal (Resolve-AppVersion -Repository 'owner/app' -Spec 'latest') 'v2.0.0' 'latest must pick the highest release.'
    Assert-Equal (Resolve-AppVersion -Repository 'owner/app' -Spec 'v1.*') 'v1.10.0' 'v1.* must pick the highest v1 release.'
    Assert-Equal (Resolve-AppVersion -Repository 'owner/app' -Spec 'v1.0.*') 'v1.0.14' 'v1.0.* must pick the highest v1.0 release.'
    Assert-Equal (Resolve-AppVersion -Repository 'owner/app' -Spec 'v1.2.0') 'v1.2.0' 'An exact existing tag must resolve to itself.'
    Assert-Rejected { Resolve-AppVersion -Repository 'owner/app' -Spec 'v1.2.1' } 'does not exist' 'A missing exact tag must be rejected.'
    Assert-Rejected { Resolve-AppVersion -Repository 'owner/app' -Spec 'v3.*' } 'No release tag matches' 'An empty range must be rejected.'
    Assert-Rejected { Resolve-AppVersion -Repository 'owner/app' -Spec 'main' } 'Version must be' 'A branch name must be rejected.'
    Assert-Rejected { Resolve-AppVersion -Repository 'owner/app' -Spec 'v1.0.9-rc1' } 'Version must be' 'A pre-release tag must be rejected.'

    # Update-AppPin rewrites every caller and drops the obsolete app_sha input.
    $content = Join-Path $work 'content'
    New-Item -ItemType Directory -Path (Join-Path $content '.github/workflows') | Out-Null
    $workflow = @'
jobs:
  validate:
    uses: owner/app/.github/workflows/validate-content.yml@0123456789abcdef0123456789abcdef01234567
    with:
      app_repository: owner/app
      app_sha: 0123456789abcdef0123456789abcdef01234567
'@
    foreach ($name in 'a.yml', 'b.yml') { Set-Content -LiteralPath (Join-Path $content ".github/workflows/$name") -Value $workflow }

    & (Join-Path $PSScriptRoot 'Update-AppPin.ps1') -ContentRoot $content -To 'v1.*' -SkipRegenerate | Out-Null
    foreach ($name in 'a.yml', 'b.yml') {
        $text = Get-Content -LiteralPath (Join-Path $content ".github/workflows/$name") -Raw
        if ($text -cnotmatch 'validate-content\.yml@v1\.10\.0\r?\n') { throw "$name must be pinned to v1.10.0." }
        if ($text -match 'app_sha') { throw "$name must not keep app_sha." }
        if ($text -cnotmatch 'app_repository: owner/app') { throw "$name must keep app_repository." }
    }
    Assert-Equal (Get-AppPinReference -ContentRoot $content).Ref 'v1.10.0' 'The pin reference must reflect the rewrite.'

    Write-Output 'App pin tests passed.'
}
finally {
    foreach ($name in $savedConfig.Keys) { [Environment]::SetEnvironmentVariable($name, $savedConfig[$name]) }
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
