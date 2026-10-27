param(
    [Parameter(Mandatory = $true)] [string]$DeploymentRoot,
    [Parameter(Mandatory = $true)] [string]$SiteName,
    [Parameter(Mandatory = $true)] [string]$AppPoolName,
    [Parameter(Mandatory = $true)] [ValidatePattern('^https://')][string]$HealthUrl,
    [Parameter(Mandatory = $true)] [ValidatePattern('^[A-Za-z0-9._-]+$')][string]$ReleaseId
)

$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

$rootPath = [System.IO.Path]::GetFullPath($DeploymentRoot)
$releasePath = Join-Path (Join-Path $rootPath 'releases') $ReleaseId
if (-not (Test-Path -LiteralPath (Join-Path $releasePath 'web.config') -PathType Leaf)) {
    throw "IIS release '$ReleaseId' is not present in the release store."
}

$sitePath = "IIS:\Sites\$SiteName"
$currentPath = (Get-Item -LiteralPath $sitePath).physicalPath
try {
    Set-ItemProperty -LiteralPath $sitePath -Name physicalPath -Value $releasePath
    Restart-WebAppPool -Name $AppPoolName
    & "$PSScriptRoot/health-check.ps1" -Url $HealthUrl
}
catch {
    $rollbackError = $_
    if (-not [string]::IsNullOrWhiteSpace($currentPath)) {
        Set-ItemProperty -LiteralPath $sitePath -Name physicalPath -Value $currentPath
        Restart-WebAppPool -Name $AppPoolName
        & "$PSScriptRoot/health-check.ps1" -Url $HealthUrl
    }
    throw $rollbackError
}

$metadataPath = Join-Path $releasePath 'wwwroot/build-metadata.json'
if (Test-Path -LiteralPath $metadataPath) {
    $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
    Write-Output "Rolled back to $ReleaseId (app $($metadata.appRevision), content $($metadata.contentRevision))."
} else {
    Write-Output "Rolled back to $ReleaseId."
}
