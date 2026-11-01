param(
    [Parameter(Mandatory = $true)]
    [string]$SourcePath,

    [Parameter(Mandatory = $true)]
    [string]$FtpHost,

    [int]$FtpPort = 21,

    [string]$CurlPath = 'curl.exe',

    [Parameter(Mandatory = $true)]
    [string]$RemotePath,

    [Parameter(Mandatory = $true)]
    [string]$Username,

    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$password = $env:DEPLOY_PASSWORD

function Get-RemotePath {
    param([string]$Path)

    $normalized = ($Path -replace '\\', '/').Trim('/')
    if ([string]::IsNullOrWhiteSpace($normalized) -or $normalized -match '(^|/)\.\.(/|$)') {
        throw 'DEPLOY_CONTENT_PATH must be a non-empty FTP path without parent-directory segments.'
    }

    return $normalized
}

function Get-FtpUri {
    param(
        [string]$Path,
        [string]$FtpServerHost,
        [int]$Port
    )

    $encodedPath = ($Path -split '/' | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/'
    return [Uri]::new("ftp://$FtpServerHost`:$Port/$encodedPath")
}

function Format-CurlConfigValue {
    param([Parameter(Mandatory = $true)][string]$Value)

    if ($Value -match '[\x00-\x1F\x7F]') {
        throw 'curl configuration values must not contain control characters.'
    }

    return $Value.Replace('\', '\\').Replace('"', '\"')
}

function Invoke-FtpsUpload {
    param(
        [Parameter(Mandatory = $true)]
        [Uri]$Uri,

        [Parameter(Mandatory = $true)]
        [string]$SourceFile
    )

    $configuration = @(
        'silent'
        'show-error'
        'fail'
        'ssl-reqd'
        'ftp-create-dirs'
        'connect-timeout = 30'
        'max-time = 120'
        "user = `"$(Format-CurlConfigValue -Value "$Username`:$password")`""
        "upload-file = `"$(Format-CurlConfigValue -Value $SourceFile)`""
        "url = `"$($Uri.AbsoluteUri)`""
    )
    $output = $configuration | & $CurlPath -q --config - 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "FTPS upload failed for '$Uri': $output"
    }
}

function Remove-FtpsFile {
    param([Parameter(Mandatory = $true)][Uri]$Uri)

    $request = [System.Net.FtpWebRequest]::Create($Uri)
    $request.Method = [System.Net.WebRequestMethods+Ftp]::DeleteFile
    $request.EnableSsl = $true
    $request.UsePassive = $true
    $request.KeepAlive = $false
    $request.Credentials = [System.Net.NetworkCredential]::new($Username, $password)
    $request.Timeout = 30000
    $response = $null
    try {
        $response = [System.Net.FtpWebResponse]$request.GetResponse()
    }
    finally {
        if ($null -ne $response) {
            $response.Dispose()
        }
    }
}

function Wait-ForRemoteApplicationStop {
    param([int]$Seconds = 10)

    Write-Host "Waiting $Seconds seconds for IIS to release application files."
    Start-Sleep -Seconds $Seconds
}

if (-not (Test-Path -LiteralPath $SourcePath -PathType Container)) {
    throw "SourcePath '$SourcePath' must be a directory."
}

$resolvedSourcePath = (Resolve-Path -LiteralPath $SourcePath).Path
$ftpHostValue = $FtpHost.Trim()
$remoteRoot = Get-RemotePath -Path $RemotePath

if ($ftpHostValue -notmatch '^(?=.{1,253}$)([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$') {
    throw 'DEPLOY_SERVER_URL must contain an FTP hostname only, without a scheme, path, or credentials.'
}
if ($FtpPort -lt 1 -or $FtpPort -gt 65535) {
    throw 'FTP port must be between 1 and 65535.'
}
if ([string]::IsNullOrWhiteSpace($Username)) {
    throw 'DEPLOY_USERNAME is required for FTP deployment.'
}
if ([string]::IsNullOrWhiteSpace($password)) {
    throw 'DEPLOY_PASSWORD is required for FTP deployment.'
}

foreach ($requiredFile in @('web.config', 'Portfolio.Web.dll')) {
    if (-not (Test-Path -LiteralPath (Join-Path $resolvedSourcePath $requiredFile) -PathType Leaf)) {
        throw "SourcePath is missing required file '$requiredFile'."
    }
}

if ($ValidateOnly) {
    Write-Output "Validated explicit FTPS deployment inputs for '$ftpHostValue/$remoteRoot'."
    exit 0
}

$curlCommand = Get-Command -Name $CurlPath -CommandType Application -ErrorAction SilentlyContinue
if ($null -eq $curlCommand) {
    throw "curl executable '$CurlPath' was not found."
}
$CurlPath = $curlCommand.Source

$files = Get-ChildItem -LiteralPath $resolvedSourcePath -File -Recurse
$offlinePath = "$remoteRoot/app_offline.htm"
$offlineUri = Get-FtpUri -Path $offlinePath -FtpServerHost $ftpHostValue -Port $FtpPort
$offlineLocalPath = Join-Path ([IO.Path]::GetTempPath()) "cv-online-presenter-$([guid]::NewGuid().ToString('N'))-app_offline.htm"
[IO.File]::WriteAllText(
    $offlineLocalPath,
    '<!doctype html><title>Deploying</title><p>Temporarily offline for deployment.</p>',
    [Text.UTF8Encoding]::new($false)
)
$offlineUploaded = $false
$deploymentSucceeded = $false

try {
    Write-Host "Connecting to $ftpHostValue on explicit FTPS port $FtpPort."
    Invoke-FtpsUpload -Uri $offlineUri -SourceFile $offlineLocalPath
    $offlineUploaded = $true
    Wait-ForRemoteApplicationStop

    foreach ($file in $files) {
        $relativePath = $file.FullName.Substring($resolvedSourcePath.Length).TrimStart('\') -replace '\\', '/'
        $remoteFilePath = "$remoteRoot/$relativePath"
        $fileUri = Get-FtpUri -Path $remoteFilePath -FtpServerHost $ftpHostValue -Port $FtpPort
        Write-Host "Uploading $relativePath."
        Invoke-FtpsUpload -Uri $fileUri -SourceFile $file.FullName
    }
    $deploymentSucceeded = $true
}
finally {
    try {
        if ($offlineUploaded -and $deploymentSucceeded) {
            try {
                Remove-FtpsFile -Uri $offlineUri
            }
            catch {
                throw "Deployment completed but app_offline.htm could not be removed: $($_.Exception.Message)"
            }
        }
        elseif ($offlineUploaded) {
            Write-Warning 'Deployment failed after app_offline.htm was uploaded; it was left in place for recovery.'
        }
    }
    finally {
        Remove-Item -LiteralPath $offlineLocalPath -Force -ErrorAction SilentlyContinue
    }
}

Write-Output "Explicit FTPS deployment completed for '$ftpHostValue/$remoteRoot'."
