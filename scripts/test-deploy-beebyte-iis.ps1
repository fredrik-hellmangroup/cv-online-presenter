param(
    [string]$WebDeployAssemblyPath = 'C:\Program Files\IIS\Microsoft Web Deploy V3\Microsoft.Web.Deployment.dll'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$deployScriptPath = Join-Path $PSScriptRoot 'deploy-beebyte-iis.ps1'
$offlinePagePath = Join-Path $repositoryRoot 'deployment\app_offline.htm'
$workflowPath = Join-Path $repositoryRoot '.github\workflows\msdeploy-experiment.yml'
$releaseWorkflowPath = Join-Path $repositoryRoot '.github\workflows\release.yml'
$installerScriptPath = Join-Path $PSScriptRoot 'ensure-webdeploy.ps1'
$temporarySourcePath = Join-Path $repositoryRoot ".test-state-msdeploy-$([guid]::NewGuid().ToString('N'))"

function Invoke-TokenValidation {
    param(
        [Parameter(Mandatory = $true)][string]$TokenSourcePath,
        [string]$DestinationPath = 'test.example/App_Data/content-releases',
        [string]$SiteName = 'test.example',
        [switch]$AlsoContentRelease
    )

    $arguments = @(
        '-NoProfile'
        '-NonInteractive'
        '-File'
        $deployScriptPath
        '-SourcePath'
        $TokenSourcePath
        '-DeployContentPath'
        $DestinationPath
        '-DeployServerUrl'
        'https://127.0.0.1:1'
        '-DeploySiteName'
        $SiteName
        '-DeployUsername'
        'validation-user'
        '-DeployCertificateSha256'
        ('A' * 64)
        '-ActivationTokenOnly'
        '-ValidateOnly'
    )
    if ($AlsoContentRelease) {
        $arguments += '-ContentRelease'
    }

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
        '$syncOptions.DoNotDelete = $false'
        '$ContentRelease'
        '$ActivationTokenOnly'
        "must contain exactly one regular file named 'activation-token.txt'"
        'ActivationTokenOnly DeployContentPath must exactly match DeploySiteName/App_Data/content-releases.'
        'activation-token.txt must not have leading or trailing whitespace.'
        'App_Data(?:[\\/]|$)'
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
if (-not $deployScript.Contains('if ($isContentOnlyMode) {' + [Environment]::NewLine + '        $syncOptions.DoNotDelete = $true')) {
    throw 'Content-only modes, including token provisioning, must disable deletion.'
}

$workflow = [IO.File]::ReadAllText($workflowPath)
foreach ($requiredWorkflowFragment in @(
        'rollback_release_tag:'
        '$assets[0].digest'
        'git merge-base --is-ancestor'
        "ensure-webdeploy.ps1"
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

$releaseWorkflow = [IO.File]::ReadAllText($releaseWorkflowPath)
foreach ($requiredReleaseFragment in @(
        'name: production-msdeploy'
        'MSDEPLOY_SERVER_URL: ${{ vars.MSDEPLOY_SERVER_URL }}'
        'MSDEPLOY_SITE_NAME: ${{ vars.MSDEPLOY_SITE_NAME }}'
        'MSDEPLOY_CONTENT_PATH: ${{ vars.MSDEPLOY_CONTENT_PATH }}'
        'MSDEPLOY_CERTIFICATE_SHA256: ${{ vars.MSDEPLOY_CERTIFICATE_SHA256 }}'
        "ensure-webdeploy.ps1"
        "deploy-beebyte-iis.ps1"
        "verify-build-metadata.ps1"
        "-OfflinePagePath '.\deployment\app_offline.htm'"
    )) {
    if (-not $releaseWorkflow.Contains($requiredReleaseFragment)) {
        throw "The primary release workflow is missing '$requiredReleaseFragment'."
    }
}
foreach ($forbiddenReleaseFragment in @(
        'deploy-beebyte-ftp.ps1'
        'DEPLOY_CONTENT_PATH: ${{ vars.DEPLOY_CONTENT_PATH }}'
        'Deploy release over explicit FTPS'
        'uses: actions/checkout@v'
        'uses: actions/setup-dotnet@v'
        'uses: actions/setup-node@v'
        'uses: actions/upload-artifact@v'
        'uses: actions/download-artifact@v'
    )) {
    if ($releaseWorkflow.Contains($forbiddenReleaseFragment)) {
        throw "The primary release workflow must not contain '$forbiddenReleaseFragment'."
    }
}

if (-not (Test-Path -LiteralPath $installerScriptPath -PathType Leaf)) {
    throw "The shared Web Deploy installer script does not exist at '$installerScriptPath'."
}
$installerScript = [IO.File]::ReadAllText($installerScriptPath)
foreach ($requiredInstallerFragment in @(
        '2150f9d1ab67e1b7b63559fb977ba9adc49f2b064fe2669a2e70d313a36b9a3d'
        '7.1.9419.0650'
        '7.1.9419.0646'
        'Get-AuthenticodeSignature'
        'O=Microsoft Corporation'
    )) {
    if (-not $installerScript.Contains($requiredInstallerFragment)) {
        throw "The shared Web Deploy installer is missing '$requiredInstallerFragment'."
    }
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
catch {
    Remove-Item -LiteralPath $temporarySourcePath -Recurse -Force -ErrorAction SilentlyContinue
    throw
}
finally {
    Remove-Item Env:DEPLOY_PASSWORD -ErrorAction SilentlyContinue
}

$tokenSourcePath = Join-Path $temporarySourcePath 'activation-token-source'
New-Item -ItemType Directory -Path $tokenSourcePath | Out-Null
$tokenSentinel = 'validation-only-token-value-not-for-output'
$tokenFilePath = Join-Path $tokenSourcePath 'activation-token.txt'
[IO.File]::WriteAllText($tokenFilePath, $tokenSentinel)

try {
    $validToken = Invoke-TokenValidation -TokenSourcePath $tokenSourcePath
    if (
        $validToken.ExitCode -ne 0 -or
        $validToken.Output -notmatch 'Validated activation-token provisioning inputs' -or
        $validToken.Output.Contains($tokenSentinel)
    ) {
        throw "Valid token-only inputs were not safely validated. Output: $($validToken.Output)"
    }

    [IO.File]::WriteAllText($tokenFilePath, 'T' * 32)
    $minimumLengthToken = Invoke-TokenValidation -TokenSourcePath $tokenSourcePath
    if ($minimumLengthToken.ExitCode -ne 0) {
        throw "A 32-character activation token was not accepted. Output: $($minimumLengthToken.Output)"
    }
    [IO.File]::WriteAllText($tokenFilePath, $tokenSentinel)

    $wrongNamePath = Join-Path $tokenSourcePath 'token.txt'
    Move-Item -LiteralPath $tokenFilePath -Destination $wrongNamePath
    $wrongName = Invoke-TokenValidation -TokenSourcePath $tokenSourcePath
    if ($wrongName.ExitCode -eq 0 -or $wrongName.Output -notmatch 'exactly one regular file') {
        throw "A differently named source file was not rejected. Output: $($wrongName.Output)"
    }
    Move-Item -LiteralPath $wrongNamePath -Destination $tokenFilePath

    $emptySourcePath = Join-Path $temporarySourcePath 'empty-token-source'
    New-Item -ItemType Directory -Path $emptySourcePath | Out-Null
    $emptySource = Invoke-TokenValidation -TokenSourcePath $emptySourcePath
    if ($emptySource.ExitCode -eq 0 -or $emptySource.Output -notmatch 'exactly one regular file') {
        throw "An empty token source directory was not rejected. Output: $($emptySource.Output)"
    }

    [IO.File]::WriteAllText($tokenFilePath, 'short')
    $shortToken = Invoke-TokenValidation -TokenSourcePath $tokenSourcePath
    if ($shortToken.ExitCode -eq 0 -or $shortToken.Output -notmatch 'at least 32 characters') {
        throw "A short activation token was not rejected. Output: $($shortToken.Output)"
    }

    [IO.File]::WriteAllText($tokenFilePath, $tokenSentinel)
    foreach ($whitespaceToken in @(" $tokenSentinel", "$tokenSentinel`r`n")) {
        [IO.File]::WriteAllText($tokenFilePath, $whitespaceToken)
        $invalidWhitespaceToken = Invoke-TokenValidation -TokenSourcePath $tokenSourcePath
        if ($invalidWhitespaceToken.ExitCode -eq 0 -or $invalidWhitespaceToken.Output -notmatch 'leading or trailing whitespace') {
            throw "An activation token with surrounding whitespace was not rejected. Output: $($invalidWhitespaceToken.Output)"
        }
    }
    [IO.File]::WriteAllText($tokenFilePath, $tokenSentinel)

    [IO.File]::WriteAllText((Join-Path $tokenSourcePath 'unexpected.txt'), 'extra')
    $extraFile = Invoke-TokenValidation -TokenSourcePath $tokenSourcePath
    if ($extraFile.ExitCode -eq 0 -or $extraFile.Output -notmatch 'exactly one regular file') {
        throw "An additional source file was not rejected. Output: $($extraFile.Output)"
    }
    Remove-Item -LiteralPath (Join-Path $tokenSourcePath 'unexpected.txt')

    $nestedDirectory = Join-Path $tokenSourcePath 'nested'
    New-Item -ItemType Directory -Path $nestedDirectory | Out-Null
    $nestedEntry = Invoke-TokenValidation -TokenSourcePath $tokenSourcePath
    if ($nestedEntry.ExitCode -eq 0 -or $nestedEntry.Output -notmatch 'exactly one regular file') {
        throw "A nested source directory was not rejected. Output: $($nestedEntry.Output)"
    }
    Remove-Item -LiteralPath $nestedDirectory -Force

    $normalizedDestination = Invoke-TokenValidation `
        -TokenSourcePath $tokenSourcePath `
        -DestinationPath 'TEST.EXAMPLE\App_Data\CONTENT-RELEASES'
    if ($normalizedDestination.ExitCode -ne 0) {
        throw "A destination differing only by separator and case was rejected. Output: $($normalizedDestination.Output)"
    }

    foreach ($unsafeDestination in @(
            'test.example/App_Data/content-releases/release-123'
            'test.example/../test.example/App_Data/content-releases'
            'other-site/App_Data/content-releases'
            '/test.example/App_Data/content-releases'
            'C:\test.example\App_Data\content-releases'
            '\\server\share\test.example\App_Data\content-releases'
            '//server/share/test.example/App_Data/content-releases'
        )) {
        $invalidDestination = Invoke-TokenValidation `
            -TokenSourcePath $tokenSourcePath `
            -DestinationPath $unsafeDestination
        if ($invalidDestination.ExitCode -eq 0 -or $invalidDestination.Output -notmatch 'exactly match DeploySiteName/App_Data/content-releases') {
            throw "An unsafe destination was not rejected. Output: $($invalidDestination.Output)"
        }
    }

    $exclusiveModes = Invoke-TokenValidation -TokenSourcePath $tokenSourcePath -AlsoContentRelease
    if ($exclusiveModes.ExitCode -eq 0 -or $exclusiveModes.Output -notmatch 'mutually exclusive') {
        throw "Conflicting deploy modes were not rejected. Output: $($exclusiveModes.Output)"
    }
}
finally {
    Remove-Item -LiteralPath $temporarySourcePath -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output 'MSDeploy helper contract tests passed.'
