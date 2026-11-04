param(
    [string]$PackagePath = '',
    [Parameter(Mandatory = $true)][string]$StateDirectory,
    [Parameter(Mandatory = $true)][ValidateSet('release', 'manual')][string]$Mode,
    [Parameter(Mandatory = $true)][string]$SourceCommit,
    [Parameter(Mandatory = $true)][string]$ExpectedPackageSha256,
    [Parameter(Mandatory = $true)][string]$StateRecordPath,
    [string]$SourceTag = '',
    [switch]$ManualMain,
    [switch]$AllowPendingRecovery
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Import-Module (Join-Path $PSScriptRoot 'production-state.psm1') -Force

function Invoke-GhJson {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    $result = & gh @Arguments
    if ($LASTEXITCODE -ne 0) { throw "GitHub CLI command failed: gh $($Arguments -join ' ')" }
    return ($result -join [Environment]::NewLine) | ConvertFrom-Json
}

function Get-ReleaseAsset {
    param([string]$Tag, [string]$AssetName, [string]$Directory)
    $release = Invoke-GhJson release view $Tag --repo $env:GITHUB_REPOSITORY --json assets
    $assets = @($release.assets | Where-Object { $_.name -ceq $AssetName })
    if ($assets.Count -ne 1 -or $assets[0].digest -notmatch '^sha256:[a-f0-9]{64}$') {
        throw "Immutable release '$Tag' must expose exactly one '$AssetName' with a GitHub SHA-256 digest."
    }
    New-Item -ItemType Directory -Path $Directory -Force | Out-Null
    & gh release download $Tag --repo $env:GITHUB_REPOSITORY --pattern $AssetName --dir $Directory
    if ($LASTEXITCODE -ne 0) { throw "Could not download immutable asset '$AssetName' from '$Tag'." }
    $path = Join-Path $Directory $AssetName
    $digest = Assert-PackageSha256 -Path $path -ExpectedSha256 $assets[0].digest
    return [PSCustomObject]@{ path = $path; digest = $digest; asset = $assets[0] }
}

function Invoke-GitWithScopedToken {
    param([Parameter(Mandatory = $true)][string[]]$GitArguments)
    if ([string]::IsNullOrWhiteSpace($env:GH_TOKEN)) { throw 'GH_TOKEN is required for authenticated repository operations.' }
    $authorization = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$env:GH_TOKEN"))
    $env:GIT_CONFIG_COUNT = '1'
    $env:GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader'
    $env:GIT_CONFIG_VALUE_0 = "AUTHORIZATION: basic $authorization"
    try {
        $output = & git @GitArguments
        if ($LASTEXITCODE -ne 0) { throw "GitHub repository operation failed (git $($GitArguments -join ' '))." }
        return $output
    }
    finally {
        Remove-Item Env:GIT_CONFIG_COUNT, Env:GIT_CONFIG_KEY_0, Env:GIT_CONFIG_VALUE_0 -ErrorAction SilentlyContinue
        $authorization = $null
    }
}

function Invoke-StateBranchCommit {
    param([Parameter(Mandatory = $true)][string]$Message)

    git -C $StateDirectory add -- lkg-v1.json pending-v1.json
    if ($LASTEXITCODE -ne 0) { throw 'Could not stage production-state files.' }
    git -C $StateDirectory config user.name 'github-actions[bot]'
    git -C $StateDirectory config user.email '41898282+github-actions[bot]@users.noreply.github.com'
    git -C $StateDirectory commit -m $Message
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the production-state commit.' }

    # Non-force push is a compare-and-swap; scoped credentials never enter persistent git config.
    Invoke-GitWithScopedToken -GitArguments @('-C', $StateDirectory, 'push', 'origin', 'HEAD:production-state') | Out-Null
}

function Read-PackageMetadata {
    param([string]$ZipPath, [string]$Destination)
    if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
    Expand-Archive -LiteralPath $ZipPath -DestinationPath $Destination -Force
    foreach ($required in @('web.config', 'Portfolio.Web.dll', 'wwwroot/build-metadata.json')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Destination $required) -PathType Leaf)) { throw "Package is missing required file '$required'." }
    }
    $metadata = Get-Content -LiteralPath (Join-Path $Destination 'wwwroot/build-metadata.json') -Raw | ConvertFrom-Json
    foreach ($field in @('appRevision', 'contentRevision', 'buildId')) {
        if ([string]::IsNullOrWhiteSpace([string]$metadata.$field)) { throw "Embedded build metadata '$field' is missing." }
    }
    return $metadata
}

function Invoke-DeploySync {
    param([string]$PublishDirectory)
    $deployPassword = $env:DEPLOY_PASSWORD
    if ([string]::IsNullOrWhiteSpace($deployPassword)) { throw 'DEPLOY_PASSWORD is not configured.' }
    $env:DEPLOY_PASSWORD = $deployPassword
    $ghToken = $env:GH_TOKEN
    $githubToken = $env:GITHUB_TOKEN
    Remove-Item Env:GH_TOKEN, Env:GITHUB_TOKEN -ErrorAction SilentlyContinue
    try {
        & powershell.exe -NoProfile -NonInteractive -File (Join-Path $PSScriptRoot 'deploy-beebyte-iis.ps1') `
            -SourcePath $PublishDirectory `
            -DeployContentPath $env:MSDEPLOY_CONTENT_PATH `
            -DeployServerUrl $env:MSDEPLOY_SERVER_URL `
            -DeploySiteName $env:MSDEPLOY_SITE_NAME `
            -DeployUsername $env:DEPLOY_USERNAME `
            -DeployCertificateSha256 $env:MSDEPLOY_CERTIFICATE_SHA256 `
            -OfflinePagePath (Join-Path (Split-Path -Parent $PSScriptRoot) 'deployment/app_offline.htm')
        if ($LASTEXITCODE -ne 0) { throw "MSDeploy sync failed with exit code $LASTEXITCODE." }
    }
    finally {
        if ($ghToken) { $env:GH_TOKEN = $ghToken }
        if ($githubToken) { $env:GITHUB_TOKEN = $githubToken }
        $ghToken = $null
        $githubToken = $null
    }
}

function Invoke-LiveVerification {
    param([string]$PublishDirectory)
    & (Join-Path $PSScriptRoot 'health-check.ps1') -Url $env:DEPLOY_HEALTH_URL
    $metadataUri = [Uri]::new([Uri]$env:DEPLOY_HEALTH_URL, '/build-metadata.json')
    & (Join-Path $PSScriptRoot 'verify-build-metadata.ps1') `
        -Url $metadataUri.AbsoluteUri `
        -ExpectedMetadataPath (Join-Path $PublishDirectory 'wwwroot/build-metadata.json')
    # The app_offline.htm response is the only supported remote observation available. IIS may
    # return the offline page for every path while the marker is active; never attempt remote deletion.
    $markerUri = [Uri]::new([Uri]$env:DEPLOY_HEALTH_URL, '/app_offline.htm')
    try {
        $response = Invoke-WebRequest -Uri $markerUri -Method Get -TimeoutSec 15 -MaximumRedirection 0 -SkipHttpErrorCheck
        if ([int]$response.StatusCode -notin @(200, 404)) { throw "Marker endpoint returned unexpected HTTP $([int]$response.StatusCode)." }
        if ($response.Content -match '(?i)data-deployment-status\s*=\s*["'']offline["'']|Tillf&auml;lligt underh&aring;ll') {
            throw 'The active root app_offline.htm marker remains observable.'
        }
    }
    catch {
        if ($_.Exception.Message -like '*active root app_offline.htm marker*') { throw }
        if ($_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
            if ($status -eq 404) { return }
        }
        throw "Could not verify the app_offline.htm marker endpoint: $($_.Exception.Message)"
    }
}

$statePath = Join-Path $StateDirectory 'lkg-v1.json'
$pendingPath = Join-Path $StateDirectory 'pending-v1.json'
$operationState = @{ priorRecord = $null; rollback = $null; candidate = $null; extractedCandidate = $null; pending = $null }

$operations = @{
    ReadState = {
        if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { throw "production-state branch record '$statePath' is missing." }
        try { $operationState.priorRecord = ConvertFrom-LkgJson -Json (Get-Content -LiteralPath $statePath -Raw) }
        catch { throw "production-state LKG record is malformed: $($_.Exception.Message)" }
        return $operationState.priorRecord
    }.GetNewClosure()
    ReadPending = {
        if (-not (Test-Path -LiteralPath $pendingPath -PathType Leaf)) { return $null }
        try { $operationState.pending = Get-Content -LiteralPath $pendingPath -Raw | ConvertFrom-Json }
        catch { throw "production-state pending record is malformed: $($_.Exception.Message)" }
        foreach ($field in @('schemaVersion', 'runId', 'runAttempt', 'candidate')) {
            if ($null -eq $operationState.pending.PSObject.Properties[$field]) { throw "production-state pending record is missing '$field'." }
        }
        if ([int]$operationState.pending.schemaVersion -ne 1) { throw 'production-state pending schemaVersion must be 1.' }
        return $operationState.pending
    }.GetNewClosure()
    SetPending = {
        param($artifact, $priorArtifact)
        $pending = [PSCustomObject]@{
            schemaVersion = 1
            runId = [string]$env:GITHUB_RUN_ID
            runAttempt = [string]$env:GITHUB_RUN_ATTEMPT
            createdAtUtc = [DateTime]::UtcNow.ToString('o')
            candidate = [PSCustomObject]@{ releaseTag = [string]$artifact.releaseTag; assetName = [string]$artifact.assetName; commit = [string]$artifact.commit; packageSha256 = [string]$artifact.packageSha256 }
            priorLkgPackageSha256 = [string]$priorArtifact.packageSha256
        }
        $pending | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $pendingPath -Encoding utf8
        Invoke-StateBranchCommit -Message 'production-state: mark deployment pending'
    }.GetNewClosure()
    ResolveRollbackPackage = {
        param($artifact)
        $rollback = Get-ReleaseAsset -Tag $artifact.releaseTag -AssetName $artifact.assetName -Directory (Join-Path $env:RUNNER_TEMP 'issue56-rollback')
        if ($rollback.digest -cne $artifact.packageSha256) { throw 'Published rollback asset digest does not match the durable LKG record.' }
        $metadata = Read-PackageMetadata -ZipPath $rollback.path -Destination (Join-Path $env:RUNNER_TEMP 'issue56-rollback-publish')
        foreach ($field in @('appRevision', 'contentRevision', 'buildId')) {
            if ([string]$metadata.$field -cne [string]$artifact.$field) { throw "LKG embedded metadata '$field' does not match the durable record." }
        }
        $operationState.rollback = [PSCustomObject]@{ path = $rollback.path; publishPath = (Join-Path $env:RUNNER_TEMP 'issue56-rollback-publish') }
        return $operationState.rollback
    }.GetNewClosure()
    ValidateCandidate = {
        param($artifact)
        if (-not (Test-Path -LiteralPath $artifact.path -PathType Leaf)) { throw 'Candidate package is missing.' }
        $digest = Assert-PackageSha256 -Path $artifact.path -ExpectedSha256 $artifact.packageSha256
        if ($digest -cne $artifact.packageSha256) { throw 'Candidate package digest differs from its verified artifact digest.' }
        $metadata = Read-PackageMetadata -ZipPath $artifact.path -Destination $artifact.publishPath
        foreach ($field in @('appRevision', 'contentRevision', 'buildId')) {
            if ([string]$metadata.$field -cne [string]$artifact.$field) { throw "Candidate embedded metadata '$field' does not match its artifact identity." }
        }
        if ([string]$metadata.appRevision -cne [string]$artifact.commit) { throw 'Candidate appRevision does not match its source commit.' }
    }.GetNewClosure()
    ArchiveCandidate = {
        param($artifact)
        $tag = "recovery/manual-$($env:GITHUB_RUN_ID)-$($env:GITHUB_RUN_ATTEMPT)"
        $assetName = "cv-online-presenter-manual-$($env:GITHUB_RUN_ID)-$($env:GITHUB_RUN_ATTEMPT).zip"
        $originalDigest = Assert-PackageSha256 -Path $artifact.path -ExpectedSha256 $artifact.packageSha256
        $archived = Get-ReleaseAsset -Tag $tag -AssetName $assetName -Directory (Join-Path $env:RUNNER_TEMP 'issue56-archived-candidate')
        if ($archived.digest -cne $originalDigest) { throw 'Archived manual-main release bytes differ from the exact built package.' }
        $artifact.releaseTag = $tag
        $artifact.assetName = $assetName
        $artifact.packageSha256 = $archived.digest
        return $artifact
    }.GetNewClosure()
    SyncCandidate = { param($artifact) Invoke-DeploySync -PublishDirectory $artifact.publishPath }.GetNewClosure()
    VerifyCandidate = { param($artifact) Invoke-LiveVerification -PublishDirectory $artifact.publishPath }.GetNewClosure()
    SyncRollback = { param($package, $artifact) Invoke-DeploySync -PublishDirectory $package.publishPath }.GetNewClosure()
    ClearPending = {
        param($artifact)
        if (Test-Path -LiteralPath $pendingPath -PathType Leaf) { Remove-Item -LiteralPath $pendingPath -Force }
        Invoke-StateBranchCommit -Message 'production-state: verified rollback restored prior LKG'
    }.GetNewClosure()
    VerifyRollback = { param($artifact) Invoke-LiveVerification -PublishDirectory $operationState.rollback.publishPath }.GetNewClosure()
    WriteState = {
        param($artifact)
        $record = New-LkgRecord -Artifact $artifact -VerifiedAtUtc ([DateTime]::UtcNow.ToString('o')) -Workflow $env:GITHUB_WORKFLOW -RunId $env:GITHUB_RUN_ID -RunAttempt $env:GITHUB_RUN_ATTEMPT
        $record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $statePath -Encoding utf8
        if (Test-Path -LiteralPath $pendingPath -PathType Leaf) { Remove-Item -LiteralPath $pendingPath -Force }
        Invoke-StateBranchCommit -Message 'production-state: record verified live artifact and clear pending'
        $mirrorResult = Write-LkgStateMirror -Record $record -Path $StateRecordPath
        if (-not $mirrorResult.Written) {
            Write-Warning -Message "Durable production-state commit succeeded; $($mirrorResult.Warning)" -WarningAction Continue
        }
        return $record
    }.GetNewClosure()
}

$candidateReleaseTag = $SourceTag
$candidateSourceTag = $null
$candidateAssetName = ''
if ($SourceTag) {
    if ($SourceTag -match '^v[0-9]+\.[0-9]+\.[0-9]+$') {
        $candidateSourceTag = $SourceTag
        $candidateAssetName = "cv-online-presenter-$SourceTag.zip"
    } elseif ($Mode -eq 'manual' -and $SourceTag -match '^recovery/manual-([0-9]+-[0-9]+)$') {
        $candidateAssetName = "cv-online-presenter-manual-$($Matches[1]).zip"
    } else {
        throw 'Release tag is not an allowed immutable production artifact locator.'
    }
    $published = Get-ReleaseAsset -Tag $SourceTag -AssetName $candidateAssetName -Directory (Join-Path $env:RUNNER_TEMP 'issue56-candidate-release')
    if ($published.digest -cne $ExpectedPackageSha256.ToLowerInvariant()) {
        throw 'Release candidate bytes do not match the digest produced by the current package job.'
    }
    $resolvedPackagePath = $published.path
    $candidateDigest = Assert-PackageSha256 -Path $published.path -ExpectedSha256 $ExpectedPackageSha256
    try { Invoke-GitWithScopedToken -GitArguments @('fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main') | Out-Null }
    catch { throw "Could not refresh origin/main before source validation: $($_.Exception.Message)" }
    $tagRefspec = "refs/tags/${SourceTag}:refs/tags/${SourceTag}"
    try { Invoke-GitWithScopedToken -GitArguments @('fetch', '--no-tags', 'origin', $tagRefspec) | Out-Null }
    catch { throw "Could not resolve source tag '$SourceTag': $($_.Exception.Message)" }
    $SourceCommit = (git rev-list -n 1 "refs/tags/$SourceTag").Trim()
    if ($LASTEXITCODE -ne 0 -or $SourceCommit -notmatch '^[a-f0-9]{40,64}$') { throw "Could not resolve source tag '$SourceTag' to a commit." }
    git merge-base --is-ancestor $SourceCommit origin/main
    if ($LASTEXITCODE -ne 0) { throw "Source tag '$SourceTag' is not reachable from main." }
} elseif ($ManualMain) {
    $resolvedPackagePath = (Resolve-Path -LiteralPath $PackagePath).Path
    $candidateDigest = Assert-PackageSha256 -Path $resolvedPackagePath -ExpectedSha256 $ExpectedPackageSha256
} else {
    throw 'Only an explicitly approved manual-main package may lack a source release tag.'
}
$candidatePublish = Join-Path $env:RUNNER_TEMP 'issue56-candidate-publish'
$metadata = Read-PackageMetadata -ZipPath $resolvedPackagePath -Destination $candidatePublish

$candidate = [PSCustomObject]@{
    path = $resolvedPackagePath
    publishPath = $candidatePublish
    sourceTag = $candidateSourceTag
    commit = $SourceCommit.ToLowerInvariant()
    appRevision = [string]$metadata.appRevision
    contentRevision = [string]$metadata.contentRevision
    buildId = [string]$metadata.buildId
    packageSha256 = $candidateDigest
    releaseTag = $candidateReleaseTag
    assetName = $candidateAssetName
}
if ($ManualMain -and $SourceTag) { throw 'ManualMain cannot be combined with a source release tag.' }
if ($Mode -eq 'release' -or ($SourceTag -and -not $ManualMain)) {
    $releaseCommit = $candidate.commit
    if ($metadata.appRevision -cne $releaseCommit) { throw 'Candidate embedded appRevision does not match workflow source commit.' }
}
try {
    Invoke-LkgDeployment -Operations $operations -Candidate $candidate -ArchiveCandidateBeforeDeploy:$ManualMain -AllowPendingRecovery:$AllowPendingRecovery
}
catch {
    Write-Error -ErrorRecord $_
    exit 1
}
