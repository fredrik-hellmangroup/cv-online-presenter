param(
    [Parameter(Mandatory = $true)]
    [string]$SourcePath,

    [Parameter(Mandatory = $true)]
    [string]$DeployContentPath,

    [Parameter(Mandatory = $true)]
    [string]$DeployServerUrl,

    [Parameter(Mandatory = $true)]
    [string]$DeploySiteName,

    [Parameter(Mandatory = $true)]
    [string]$DeployUsername,

    [Parameter(Mandatory = $true)]
    [string]$DeployPassword,

    [string]$MsDeployPath = 'C:\Program Files\IIS\Microsoft Web Deploy V3\msdeploy.exe',

    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'

function Format-WebDeployValue {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Value
    )

    return "'{0}'" -f $Value.Replace("'", "''")
}

function Resolve-WebDeployEndpoint {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ServerUrl,

        [Parameter(Mandatory = $true)]
        [string]$SiteName
    )

    $candidate = $ServerUrl.Trim()
    if ($candidate -notmatch '^[a-z][a-z0-9+.-]*://') {
        $candidate = "https://$candidate"
    }

    try {
        $uri = [Uri]$candidate
    }
    catch {
        throw "DEPLOY_SERVER_URL must be a valid HTTPS URL or hostname."
    }

    if ($uri.Scheme -ne 'https' -or [string]::IsNullOrWhiteSpace($uri.Host)) {
        throw 'DEPLOY_SERVER_URL must use HTTPS and include a hostname.'
    }

    $builder = [UriBuilder]$uri
    if ($uri.IsDefaultPort) {
        $builder.Port = 8172
    }
    $builder.Path = 'msdeploy.axd'
    $builder.Query = "site=$([Uri]::EscapeDataString($SiteName))"
    return $builder.Uri.AbsoluteUri
}

if (-not (Test-Path -LiteralPath $SourcePath -PathType Container)) {
    throw "SourcePath '$SourcePath' must be a directory."
}

$resolvedSourcePath = (Resolve-Path -LiteralPath $SourcePath).Path
$deployContentPath = $DeployContentPath.Trim()
$deploySiteName = $DeploySiteName.Trim()
$deployUsername = $DeployUsername.Trim()
$deployPassword = $DeployPassword

foreach ($requiredFile in @('web.config', 'Portfolio.Web.dll')) {
    if (-not (Test-Path -LiteralPath (Join-Path $resolvedSourcePath $requiredFile) -PathType Leaf)) {
        throw "SourcePath is missing required file '$requiredFile'."
    }
}

if ([string]::IsNullOrWhiteSpace($deployContentPath)) {
    throw 'DEPLOY_CONTENT_PATH is required for IIS deployment.'
}
if ([string]::IsNullOrWhiteSpace($deploySiteName)) {
    throw 'DEPLOY_SITE_NAME is required for IIS deployment.'
}
if ([string]::IsNullOrWhiteSpace($deployUsername)) {
    throw 'DEPLOY_USERNAME is required for IIS deployment.'
}
if ([string]::IsNullOrWhiteSpace($deployPassword)) {
    throw 'DEPLOY_PASSWORD is required for IIS deployment.'
}

$computerName = Resolve-WebDeployEndpoint -ServerUrl $DeployServerUrl -SiteName $deploySiteName

if ($ValidateOnly) {
    Write-Output "Validated IIS deployment inputs for site '$deploySiteName'."
    exit 0
}

if (-not (Test-Path -LiteralPath $MsDeployPath -PathType Leaf)) {
    throw "msdeploy.exe was not found at '$MsDeployPath'."
}

$sourceSettings = "contentPath=$(Format-WebDeployValue -Value $resolvedSourcePath)"
$destinationSettings = @(
    "contentPath=$(Format-WebDeployValue -Value $deployContentPath)"
    "computerName=$(Format-WebDeployValue -Value $computerName)"
    "userName=$(Format-WebDeployValue -Value $deployUsername)"
    "password=$(Format-WebDeployValue -Value $deployPassword)"
    'authType=Basic'
    'includeAcls=False'
) -join ','

$arguments = @(
    '-verb:sync'
    "-source:$sourceSettings"
    "-dest:$destinationSettings"
    '-enableRule:AppOffline'
    '-disableLink:AppPoolExtension'
    '-disableLink:ContentExtension'
    '-disableLink:CertificateExtension'
    '-skip:Directory=\\.well-known'
    '-retryAttempts:10'
    '-retryInterval:5000'
)

& $MsDeployPath @arguments
if ($LASTEXITCODE -ne 0) {
    throw "Web Deploy failed for site '$deploySiteName' with exit code $LASTEXITCODE."
}

Write-Output "IIS deployment completed for site '$deploySiteName'."
