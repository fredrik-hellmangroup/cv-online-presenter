param(
    [Parameter(Mandatory = $true)]
    [string]$SourcePath,

    [Parameter(Mandatory = $true)]
    [string]$FtpHost,

    [int]$FtpPort = 21,

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

function Invoke-FtpRequest {
    param(
        [Parameter(Mandatory = $true)]
        [Uri]$Uri,

        [Parameter(Mandatory = $true)]
        [string]$Method,

        [byte[]]$Body
    )

    $request = [System.Net.FtpWebRequest]::Create($Uri)
    $request.Method = $Method
    $request.EnableSsl = $true
    $request.UsePassive = $true
    $request.UseBinary = $true
    $request.KeepAlive = $false
    $request.Credentials = [System.Net.NetworkCredential]::new($Username, $password)
    $request.Timeout = 30000
    $request.ReadWriteTimeout = 30000

    if ($null -ne $Body) {
        $request.ContentLength = $Body.Length
        $stream = $null
        try {
            $stream = $request.GetRequestStream()
            $stream.Write($Body, 0, $Body.Length)
        }
        finally {
            if ($null -ne $stream) {
                $stream.Dispose()
            }
        }
    }

    $response = $null
    try {
        $response = [System.Net.FtpWebResponse]$request.GetResponse()
        return $response.StatusDescription
    }
    finally {
        if ($null -ne $response) {
            $response.Dispose()
        }
    }
}

function Remove-FtpFileIfExists {
    param([Parameter(Mandatory = $true)][Uri]$Uri)

    try {
        Invoke-FtpRequest -Uri $Uri -Method ([System.Net.WebRequestMethods+Ftp]::GetFileSize) | Out-Null
    }
    catch [System.Net.WebException] {
        if ($_.Exception.Message -match '550|not found|unavailable') {
            return
        }
        throw
    }

    try {
        Invoke-FtpRequest -Uri $Uri -Method ([System.Net.WebRequestMethods+Ftp]::DeleteFile) | Out-Null
    }
    catch {
        throw "Could not delete existing remote file '$Uri': $($_.Exception.Message)"
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

$files = Get-ChildItem -LiteralPath $resolvedSourcePath -File -Recurse
$directorySet = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($file in $files) {
    $relativeDirectory = $file.Directory.FullName.Substring($resolvedSourcePath.Length).TrimStart('\')
    if ($relativeDirectory) {
        $parts = $relativeDirectory -replace '\\', '/' -split '/'
        $pathParts = [System.Collections.Generic.List[string]]::new()
        foreach ($part in $parts) {
            [void]$pathParts.Add($part)
            [void]$directorySet.Add(($pathParts -join '/'))
        }
    }
}
$directories = $directorySet | Sort-Object

$offlinePath = "$remoteRoot/app_offline.htm"
$offlineUri = Get-FtpUri -Path $offlinePath -FtpServerHost $ftpHostValue -Port $FtpPort
$offlineBody = [Text.Encoding]::UTF8.GetBytes('<!doctype html><title>Deploying</title><p>Temporarily offline for deployment.</p>')
$offlineUploaded = $false
$deploymentSucceeded = $false

try {
    Write-Host "Connecting to $ftpHostValue on explicit FTPS port $FtpPort."
    Invoke-FtpRequest -Uri $offlineUri -Method ([System.Net.WebRequestMethods+Ftp]::UploadFile) -Body $offlineBody | Out-Null
    $offlineUploaded = $true
    Wait-ForRemoteApplicationStop

    foreach ($directory in $directories) {
        $directoryUri = Get-FtpUri -Path "$remoteRoot/$directory" -FtpServerHost $ftpHostValue -Port $FtpPort
        try {
            Invoke-FtpRequest -Uri $directoryUri -Method ([System.Net.WebRequestMethods+Ftp]::MakeDirectory) | Out-Null
        }
        catch [System.Net.WebException] {
            try {
                Invoke-FtpRequest -Uri $directoryUri -Method ([System.Net.WebRequestMethods+Ftp]::ListDirectory) | Out-Null
            }
            catch {
                throw "Could not create or verify remote directory '$directory': $($_.Exception.Message)"
            }
        }
    }

    foreach ($file in $files) {
        $relativePath = $file.FullName.Substring($resolvedSourcePath.Length).TrimStart('\') -replace '\\', '/'
        $remoteFilePath = "$remoteRoot/$relativePath"
        $fileUri = Get-FtpUri -Path $remoteFilePath -FtpServerHost $ftpHostValue -Port $FtpPort
        Write-Host "Uploading $relativePath."
        Remove-FtpFileIfExists -Uri $fileUri
        Invoke-FtpRequest -Uri $fileUri -Method ([System.Net.WebRequestMethods+Ftp]::UploadFile) -Body ([IO.File]::ReadAllBytes($file.FullName)) | Out-Null
    }
    $deploymentSucceeded = $true
}
finally {
    if ($offlineUploaded -and $deploymentSucceeded) {
        try {
            Invoke-FtpRequest -Uri $offlineUri -Method ([System.Net.WebRequestMethods+Ftp]::DeleteFile) | Out-Null
        }
        catch {
            throw "Deployment completed but app_offline.htm could not be removed: $($_.Exception.Message)"
        }
    }
    elseif ($offlineUploaded) {
        Write-Warning 'Deployment failed after app_offline.htm was uploaded; it was left in place for recovery.'
    }
}

Write-Output "Explicit FTPS deployment completed for '$ftpHostValue/$remoteRoot'."
