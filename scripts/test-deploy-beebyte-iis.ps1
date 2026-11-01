param(
    [string]$WebDeployAssemblyPath = 'C:\Program Files\IIS\Microsoft Web Deploy V3\Microsoft.Web.Deployment.dll'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$deployScriptPath = Join-Path $PSScriptRoot 'deploy-beebyte-iis.ps1'
$offlinePagePath = Join-Path $repositoryRoot 'deployment\app_offline.htm'
$workflowPath = Join-Path $repositoryRoot '.github\workflows\msdeploy-experiment.yml'
$temporarySourcePath = Join-Path ([IO.Path]::GetTempPath()) "cv-online-presenter-msdeploy-test-$([guid]::NewGuid().ToString('N'))"

function Invoke-Validation {
    param([Parameter(Mandatory = $true)][string]$PagePath)

    $arguments = @(
        '-NoProfile'
        '-NonInteractive'
        '-File'
        $deployScriptPath
        '-SourcePath'
        $temporarySourcePath
        '-DeployContentPath'
        'httpdocs'
        '-DeployServerUrl'
        'https://127.0.0.1'
        '-DeploySiteName'
        'test.example'
        '-DeployUsername'
        'validation-user'
        '-DeployCertificateSha256'
        ('A' * 64)
        '-OfflinePagePath'
        $PagePath
        '-WebDeployAssemblyPath'
        $WebDeployAssemblyPath
        '-ValidateOnly'
    )

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & powershell.exe @arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    return [PSCustomObject]@{
        ExitCode = $exitCode
        Output = ($output -join [Environment]::NewLine)
    }
}

if (-not (Test-Path -LiteralPath $offlinePagePath -PathType Leaf)) {
    throw "The branded offline page does not exist at '$offlinePagePath'."
}

$offlineHtml = [IO.File]::ReadAllText($offlinePagePath)
foreach ($requiredFragment in @(
        '<!doctype html>'
        'lang="sv-SE"'
        'data-deployment-status="offline"'
        'Tillf&auml;lligt underh&aring;ll'
    )) {
    if (-not $offlineHtml.Contains($requiredFragment)) {
        throw "The branded offline page is missing '$requiredFragment'."
    }
}
if ($offlineHtml -match '(?i)<script\b|(?:src|href)\s*=\s*["''](?:https?:)?//') {
    throw 'The branded offline page must not depend on scripts or remote resources.'
}

$deployScript = [IO.File]::ReadAllText($deployScriptPath)
foreach ($requiredDeployFragment in @(
        "ProviderSettings['AppOfflineTemplate'].Value"
        "'App_Data\app_offline.template.htm'"
        '$templateSource.SyncTo('
    )) {
    if (-not $deployScript.Contains($requiredDeployFragment)) {
        throw "The helper is missing offline-template bootstrap fragment '$requiredDeployFragment'."
    }
}
if ($deployScript.Contains(".Value = `$resolvedOfflinePagePath")) {
    throw 'AppOfflineTemplate must be a destination-relative path, not a local absolute path.'
}
if ($deployScript.Contains("AddDefaultProviderSetting(`r`n        'contentPath',`r`n        'appOfflineTemplate'")) {
    throw 'The helper must not rely on an unbound default AppOffline template setting.'
}

$workflow = [IO.File]::ReadAllText($workflowPath)
foreach ($requiredWorkflowFragment in @(
        'rollback_release_tag:'
        '$assets[0].digest'
        '$expectedInstallerSha256'
        'MSDEPLOY_CONTENT_PATH: ${{ vars.MSDEPLOY_CONTENT_PATH }}'
        'verify-build-metadata.ps1'
        "-OfflinePagePath '.\deployment\app_offline.htm'"
    )) {
    if (-not $workflow.Contains($requiredWorkflowFragment)) {
        throw "The MSDeploy workflow is missing '$requiredWorkflowFragment'."
    }
}
if ($workflow.Contains('choco install')) {
    throw 'The production deploy job must not execute an unverified Chocolatey package.'
}
if ($workflow.Contains('DEPLOY_CONTENT_PATH: ${{ vars.DEPLOY_CONTENT_PATH }}')) {
    throw 'MSDeploy must not reuse the FTPS-only DEPLOY_CONTENT_PATH value.'
}

New-Item -ItemType Directory -Path $temporarySourcePath | Out-Null
[IO.File]::WriteAllText((Join-Path $temporarySourcePath 'web.config'), '<configuration />')
[IO.File]::WriteAllBytes((Join-Path $temporarySourcePath 'Portfolio.Web.dll'), [byte[]](0))

try {
    $env:DEPLOY_PASSWORD = 'validation-only'
    $missingPage = Invoke-Validation -PagePath (Join-Path $temporarySourcePath 'missing.htm')
    if ($missingPage.ExitCode -eq 0 -or $missingPage.Output -notmatch 'OfflinePagePath') {
        throw "A missing offline page was not rejected as expected. Output: $($missingPage.Output)"
    }

    $validPage = Invoke-Validation -PagePath $offlinePagePath
    if ($validPage.ExitCode -ne 0) {
        throw "Valid MSDeploy inputs were rejected. Output: $($validPage.Output)"
    }
    if (
        $validPage.Output -notmatch 'Certificate validation policy self-test passed' -or
        $validPage.Output -notmatch 'Validated MSDeploy experiment inputs'
    ) {
        throw "Validation did not report certificate-policy and input success. Output: $($validPage.Output)"
    }
}
finally {
    Remove-Item Env:DEPLOY_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $temporarySourcePath -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output 'MSDeploy helper contract tests passed.'
