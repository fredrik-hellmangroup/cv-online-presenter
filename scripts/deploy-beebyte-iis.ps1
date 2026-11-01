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
    [string]$DeployCertificateSha256,

    [Parameter(Mandatory = $true)]
    [string]$OfflinePagePath,

    [string]$WebDeployAssemblyPath = 'C:\Program Files\IIS\Microsoft Web Deploy V3\Microsoft.Web.Deployment.dll',

    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$password = $env:DEPLOY_PASSWORD
Remove-Item Env:DEPLOY_PASSWORD -ErrorAction SilentlyContinue
$socketTimeoutMilliseconds = 15000

if ($null -eq ('CvOnlinePresenter.Deployment.CertificateValidation' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace CvOnlinePresenter.Deployment
{
    public static class CertificateValidation
    {
        public static readonly RemoteCertificateValidationCallback AcceptAny = Validate;
        public static readonly RemoteCertificateValidationCallback RequirePinned = ValidatePinned;
        public static string ExpectedSha256 { get; set; }

        private static bool Validate(
            object sender,
            X509Certificate certificate,
            X509Chain chain,
            SslPolicyErrors errors)
        {
            return true;
        }

        private static bool ValidatePinned(
            object sender,
            X509Certificate certificate,
            X509Chain chain,
            SslPolicyErrors errors)
        {
            if (certificate == null || errors != SslPolicyErrors.None || string.IsNullOrEmpty(ExpectedSha256))
            {
                return false;
            }

            using (SHA256 sha256 = SHA256.Create())
            {
                string actual = BitConverter.ToString(sha256.ComputeHash(certificate.GetRawCertData()))
                    .Replace("-", string.Empty);
                return string.Equals(actual, ExpectedSha256, StringComparison.OrdinalIgnoreCase);
            }
        }
    }
}
'@
}

function Resolve-WebDeployEndpoint {
    param(
        [Parameter(Mandatory = $true)][string]$ServerUrl,
        [Parameter(Mandatory = $true)][string]$SiteName
    )

    $candidate = $ServerUrl.Trim()
    if ($candidate -notmatch '^[a-z][a-z0-9+.-]*://') {
        $candidate = "https://$candidate"
    }

    try {
        $uri = [Uri]$candidate
    }
    catch {
        throw 'MSDEPLOY_SERVER_URL must be a valid HTTPS URL or hostname.'
    }

    if ($uri.Scheme -ne 'https' -or [string]::IsNullOrWhiteSpace($uri.Host) -or $uri.UserInfo) {
        throw 'MSDEPLOY_SERVER_URL must use HTTPS and include a hostname without credentials.'
    }

    $builder = [UriBuilder]$uri
    if ($uri.IsDefaultPort) {
        $builder.Port = 8172
    }
    $builder.Path = 'msdeploy.axd'
    $builder.Query = "site=$([Uri]::EscapeDataString($SiteName))"
    return $builder.Uri
}

function Invoke-TlsAuthentication {
    param(
        [Parameter(Mandatory = $true)][System.Net.Security.SslStream]$Stream,
        [Parameter(Mandatory = $true)][string]$TargetHost
    )

    $Stream.ReadTimeout = $socketTimeoutMilliseconds
    $Stream.WriteTimeout = $socketTimeoutMilliseconds
    $Stream.AuthenticateAsClient($TargetHost)
}

function Get-PinnedRemoteCertificate {
    param(
        [Parameter(Mandatory = $true)][Uri]$Endpoint,
        [Parameter(Mandatory = $true)][string]$ExpectedSha256
    )

    $client = [System.Net.Sockets.TcpClient]::new()
    $stream = $null
    try {
        $connectTask = $client.ConnectAsync($Endpoint.Host, $Endpoint.Port)
        if (-not $connectTask.Wait($socketTimeoutMilliseconds)) {
            throw "Timed out connecting to the Web Deploy endpoint after $socketTimeoutMilliseconds ms."
        }
        $connectTask.GetAwaiter().GetResult()
        $stream = [System.Net.Security.SslStream]::new(
            $client.GetStream(),
            $false,
            [CvOnlinePresenter.Deployment.CertificateValidation]::AcceptAny
        )
        Invoke-TlsAuthentication `
            -Stream $stream `
            -TargetHost $Endpoint.Host
        $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($stream.RemoteCertificate)
        $actualSha256 = $certificate.GetCertHashString([System.Security.Cryptography.HashAlgorithmName]::SHA256)
        if (-not $actualSha256.Equals($ExpectedSha256, [StringComparison]::OrdinalIgnoreCase)) {
            $certificate.Dispose()
            throw 'The Web Deploy server certificate does not match MSDEPLOY_CERTIFICATE_SHA256.'
        }

        return [PSCustomObject]@{
            Certificate = $certificate
            Address = ([System.Net.IPEndPoint]$client.Client.RemoteEndPoint).Address.ToString()
        }
    }
    finally {
        if ($null -ne $stream) {
            $stream.Dispose()
        }
        $client.Dispose()
    }
}

function Assert-TrustedEndpoint {
    param([Parameter(Mandatory = $true)][Uri]$Endpoint)

    $client = [System.Net.Sockets.TcpClient]::new()
    $stream = $null
    try {
        $connectTask = $client.ConnectAsync($Endpoint.Host, $Endpoint.Port)
        if (-not $connectTask.Wait($socketTimeoutMilliseconds)) {
            throw "Timed out connecting to the trusted Web Deploy endpoint after $socketTimeoutMilliseconds ms."
        }
        $connectTask.GetAwaiter().GetResult()
        $stream = [System.Net.Security.SslStream]::new($client.GetStream(), $false)
        Invoke-TlsAuthentication `
            -Stream $stream `
            -TargetHost $Endpoint.Host
    }
    finally {
        if ($null -ne $stream) {
            $stream.Dispose()
        }
        $client.Dispose()
    }
}

if (-not (Test-Path -LiteralPath $SourcePath -PathType Container)) {
    throw "SourcePath '$SourcePath' must be a directory."
}

$resolvedSourcePath = (Resolve-Path -LiteralPath $SourcePath).Path
$deployContentPath = $DeployContentPath.Trim()
$deploySiteName = $DeploySiteName.Trim()
$deployUsername = $DeployUsername.Trim()
$certificateSha256 = $DeployCertificateSha256.Replace(':', '').Replace(' ', '').Trim()

foreach ($requiredFile in @('web.config', 'Portfolio.Web.dll')) {
    if (-not (Test-Path -LiteralPath (Join-Path $resolvedSourcePath $requiredFile) -PathType Leaf)) {
        throw "SourcePath is missing required file '$requiredFile'."
    }
}
if ([string]::IsNullOrWhiteSpace($deployContentPath)) {
    throw 'DEPLOY_CONTENT_PATH is required for MSDeploy.'
}
if ([string]::IsNullOrWhiteSpace($deploySiteName)) {
    throw 'MSDEPLOY_SITE_NAME is required.'
}
if ([string]::IsNullOrWhiteSpace($deployUsername)) {
    throw 'DEPLOY_USERNAME is required for MSDeploy.'
}
if ([string]::IsNullOrWhiteSpace($password)) {
    throw 'DEPLOY_PASSWORD is required for MSDeploy.'
}
if (-not (Test-Path -LiteralPath $OfflinePagePath -PathType Leaf)) {
    throw "OfflinePagePath '$OfflinePagePath' must be a file."
}
$resolvedOfflinePagePath = (Resolve-Path -LiteralPath $OfflinePagePath).Path
$offlinePageLength = (Get-Item -LiteralPath $resolvedOfflinePagePath).Length
if ($offlinePageLength -lt 1 -or $offlinePageLength -gt 1MB) {
    throw 'OfflinePagePath must contain a non-empty HTML file no larger than 1 MB.'
}
if ($certificateSha256 -notmatch '^[A-Fa-f0-9]{64}$') {
    throw 'MSDEPLOY_CERTIFICATE_SHA256 must contain a SHA-256 certificate fingerprint.'
}

$endpoint = Resolve-WebDeployEndpoint -ServerUrl $DeployServerUrl -SiteName $deploySiteName
if ($ValidateOnly) {
    if (-not (Test-Path -LiteralPath $WebDeployAssemblyPath -PathType Leaf)) {
        throw "Microsoft.Web.Deployment.dll was not found at '$WebDeployAssemblyPath'."
    }
    Add-Type -Path $WebDeployAssemblyPath
    [void][Microsoft.Web.Deployment.DeploymentSyncOptions]::new()
    Write-Output "Validated MSDeploy experiment inputs for site '$deploySiteName'."
    return
}
if (-not (Test-Path -LiteralPath $WebDeployAssemblyPath -PathType Leaf)) {
    throw "Microsoft.Web.Deployment.dll was not found at '$WebDeployAssemblyPath'."
}
Add-Type -Path $WebDeployAssemblyPath

$pinnedConnection = Get-PinnedRemoteCertificate -Endpoint $endpoint -ExpectedSha256 $certificateSha256
$certificate = $pinnedConnection.Certificate
$certificateDnsName = $certificate.GetNameInfo(
    [System.Security.Cryptography.X509Certificates.X509NameType]::DnsName,
    $false
).Trim()
if ($certificateDnsName -notmatch '^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$') {
    $certificate.Dispose()
    throw 'The pinned Web Deploy certificate must use a valid DNS name without wildcards.'
}

$trustedEndpoint = [UriBuilder]$endpoint
$trustedEndpoint.Host = $certificateDnsName
$hostsPath = Join-Path $env:WINDIR 'System32\drivers\etc\hosts'
$hostsEntry = "$($pinnedConnection.Address)`t$certificateDnsName`t# cv-online-presenter MSDeploy experiment"
$hostsEntryAdded = $false
$certificateAdded = $false
$pinCallbackInstalled = $false
$previousCertificateCallback = $null
$certificatePath = Join-Path ([IO.Path]::GetTempPath()) "cv-online-presenter-$($certificate.Thumbprint).cer"
$store = [System.Security.Cryptography.X509Certificates.X509Store]::new(
    [System.Security.Cryptography.X509Certificates.StoreName]::Root,
    [System.Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine
)

try {
    $existingAliases = Get-Content -LiteralPath $hostsPath | Where-Object {
        $tokens = (($_ -split '#', 2)[0] -split '\s+') | Where-Object { $_ }
        $tokens.Count -gt 1 -and $tokens[1..($tokens.Count - 1)] -contains $certificateDnsName
    }
    foreach ($alias in $existingAliases) {
        $existingAddress = ((($alias -split '#', 2)[0] -split '\s+')[0])
        if ($existingAddress -ne $pinnedConnection.Address) {
            throw "The certificate DNS name '$certificateDnsName' already resolves to another address in the hosts file."
        }
    }
    if (-not $existingAliases) {
        Add-Content -LiteralPath $hostsPath -Value $hostsEntry -Encoding ascii
        $hostsEntryAdded = $true
    }

    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
    $alreadyTrusted = $store.Certificates.Find(
        [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
        $certificate.Thumbprint,
        $false
    ).Count -gt 0
    if (-not $alreadyTrusted) {
        [IO.File]::WriteAllBytes(
            $certificatePath,
            $certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
        )
        & certutil.exe -f -addstore Root $certificatePath
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to add the pinned certificate to the machine root store (certutil exit code $LASTEXITCODE)."
        }
        $certificateAdded = $true
    }

    Assert-TrustedEndpoint -Endpoint $trustedEndpoint.Uri
    [CvOnlinePresenter.Deployment.CertificateValidation]::ExpectedSha256 = $certificateSha256
    $previousCertificateCallback = [System.Net.ServicePointManager]::ServerCertificateValidationCallback
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback =
        [CvOnlinePresenter.Deployment.CertificateValidation]::RequirePinned
    $pinCallbackInstalled = $true

    $sourceOptions = [Microsoft.Web.Deployment.DeploymentBaseOptions]::new()
    $destinationOptions = [Microsoft.Web.Deployment.DeploymentBaseOptions]::new()
    $destinationOptions.ComputerName = $trustedEndpoint.Uri.AbsoluteUri
    $destinationOptions.UserName = $deployUsername
    $destinationOptions.AuthenticationType = 'Basic'
    $destinationOptions.IncludeAcls = $false
    $destinationOptions.RetryAttempts = 10
    $destinationOptions.RetryInterval = 5000
    $destinationOptions.AddDefaultProviderSetting(
        'contentPath',
        'appOfflineTemplate',
        $resolvedOfflinePagePath
    )
    $destinationOptions.SkipDirectory('(?:^|[\\/])\.well-known(?:[\\/]|$)')
    foreach ($link in $destinationOptions.LinkExtensions) {
        if ($link.Name -in @('AppPoolExtension', 'ContentExtension', 'CertificateExtension')) {
            $link.Enabled = $false
        }
    }

    $syncOptions = [Microsoft.Web.Deployment.DeploymentSyncOptions]::new()
    $syncOptions.DoNotDelete = $true
    $appOfflineHandlerType = [Microsoft.Web.Deployment.DeploymentManager].Assembly.GetType(
        'Microsoft.Web.Deployment.AppOfflineRuleHandler',
        $true
    )
    $appOfflineHandler = [Activator]::CreateInstance($appOfflineHandlerType, $true)
    $appOfflineRule = [Microsoft.Web.Deployment.DeploymentRule]::new('AppOffline', $appOfflineHandler)
    $syncOptions.Rules.Add($appOfflineRule)

    $source = $null
    $destinationOptions.Password = $password
    try {
        $source = [Microsoft.Web.Deployment.DeploymentManager]::CreateObject(
            [Microsoft.Web.Deployment.DeploymentWellKnownProvider]::ContentPath,
            $resolvedSourcePath,
            $sourceOptions
        )
        $result = $source.SyncTo(
            [Microsoft.Web.Deployment.DeploymentWellKnownProvider]::ContentPath,
            $deployContentPath,
            $destinationOptions,
            $syncOptions
        )
        if ($result.Errors -gt 0) {
            throw "MSDeploy reported $($result.Errors) synchronization error(s)."
        }
        Write-Output (
            "MSDeploy synchronized {0} change(s): {1} added, {2} updated, {3} deleted." -f
            $result.TotalChanges,
            $result.ObjectsAdded,
            $result.ObjectsUpdated,
            $result.ObjectsDeleted
        )
    }
    finally {
        if ($null -ne $source) {
            $source.Dispose()
        }
        $destinationOptions.Password = $null
    }
}
finally {
    try {
        if ($pinCallbackInstalled) {
            [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $previousCertificateCallback
            [CvOnlinePresenter.Deployment.CertificateValidation]::ExpectedSha256 = $null
        }
        if ($certificateAdded) {
            & certutil.exe -delstore Root $certificate.Thumbprint
            if ($LASTEXITCODE -ne 0) {
                throw "Could not remove the temporary machine-root certificate (certutil exit code $LASTEXITCODE)."
            }
        }
    }
    finally {
        try {
            $store.Close()
        }
        finally {
            try {
                if ($hostsEntryAdded) {
                    $remainingHostsEntries = Get-Content -LiteralPath $hostsPath | Where-Object { $_ -ne $hostsEntry }
                    Set-Content -LiteralPath $hostsPath -Value $remainingHostsEntries -Encoding ascii
                }
            }
            finally {
                Remove-Item -LiteralPath $certificatePath -Force -ErrorAction SilentlyContinue
                $certificate.Dispose()
                $password = $null
            }
        }
    }
}

Write-Output "MSDeploy experiment completed for site '$deploySiteName'."
