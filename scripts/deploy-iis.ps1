param(
    [Parameter(Mandatory = $true)] [string]$ReleaseDirectory,
    [Parameter(Mandatory = $true)] [string]$DeploymentRoot,
    [Parameter(Mandatory = $true)] [string]$SiteName,
    [Parameter(Mandatory = $true)] [string]$AppPoolName,
    [Parameter(Mandatory = $true)] [ValidatePattern('^https://')][string]$HealthUrl,
    [Parameter(Mandatory = $true)] [ValidatePattern('^[A-Za-z0-9._-]+$')][string]$ReleaseId
)

$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

$artifactPath = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$rootPath = [System.IO.Path]::GetFullPath($DeploymentRoot)
$releasePath = Join-Path (Join-Path $rootPath 'releases') $ReleaseId
if (-not (Test-Path -LiteralPath $artifactPath -PathType Container)) { throw 'Release artifact directory is missing.' }
New-Item -ItemType Directory -Force -Path $releasePath | Out-Null
Copy-Item -Path (Join-Path $artifactPath '*') -Destination $releasePath -Recurse -Force

$site = Get-Item -LiteralPath "IIS:\Sites\$SiteName"
$previousPath = $site.physicalPath
try {
    Set-ItemProperty -LiteralPath "IIS:\Sites\$SiteName" -Name physicalPath -Value $releasePath
    Restart-WebAppPool -Name $AppPoolName
    & "$PSScriptRoot/health-check.ps1" -Url $HealthUrl
}
catch {
    if (-not [string]::IsNullOrWhiteSpace($previousPath)) {
        Set-ItemProperty -LiteralPath "IIS:\Sites\$SiteName" -Name physicalPath -Value $previousPath
        Restart-WebAppPool -Name $AppPoolName
    }
    throw
}

Write-Output "Deployed $ReleaseId to IIS site '$SiteName'."
