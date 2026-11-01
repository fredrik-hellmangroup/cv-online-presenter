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

    [string]$OfflinePagePath,

    [string]$WebDeployAssemblyPath = 'C:\Program Files\IIS\Microsoft Web Deploy V3\Microsoft.Web.Deployment.dll',

    # Content-release mode: SourcePath holds site.json + pages/, DeployContentPath is the
    # (new) release folder. Sync is additive and never touches the app, web.config or app_offline.
    [switch]$ContentRelease,

    [switch]$WhatIf,

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
            SslPolicyErrors disallowedErrors = errors & ~SslPolicyErrors.RemoteCertificateNameMismatch;
            if (certificate == null || disallowedErrors != SslPolicyErrors.None || string.IsNullOrEmpty(ExpectedSha256))
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
        try {
            if (-not $connectTask.Wait($socketTimeoutMilliseconds)) {
                throw "Timed out connecting to the Web Deploy endpoint after $socketTimeoutMilliseconds ms."
            }
            $connectTask.GetAwaiter().GetResult()
        }
        catch {
            throw "Could not connect to Web Deploy endpoint '$($Endpoint.Host):$($Endpoint.Port)': $($_.Exception.GetBaseException().Message)"
        }
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

function Assert-CertificateValidationPolicy {
    param([Parameter(Mandatory = $true)][System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate)

    $actualSha256 = $Certificate.GetCertHashString([System.Security.Cryptography.HashAlgorithmName]::SHA256)
    try {
        [CvOnlinePresenter.Deployment.CertificateValidation]::ExpectedSha256 = $actualSha256
        $callback = [CvOnlinePresenter.Deployment.CertificateValidation]::RequirePinned
        if (-not $callback.Invoke($null, $Certificate, $null, [System.Net.Security.SslPolicyErrors]::None)) {
            throw 'Certificate validation policy rejected a clean, correctly pinned certificate.'
        }
        if (-not $callback.Invoke(
                $null,
                $Certificate,
                $null,
                [System.Net.Security.SslPolicyErrors]::RemoteCertificateNameMismatch
            )) {
            throw 'Certificate validation policy rejected the expected IP hostname mismatch.'
        }
        if ($callback.Invoke(
                $null,
                $Certificate,
                $null,
                [System.Net.Security.SslPolicyErrors]::RemoteCertificateChainErrors
            )) {
            throw 'Certificate validation policy accepted certificate chain errors.'
        }
        if ($callback.Invoke(
                $null,
                $Certificate,
                $null,
                [System.Net.Security.SslPolicyErrors]::RemoteCertificateNameMismatch -bor
                    [System.Net.Security.SslPolicyErrors]::RemoteCertificateChainErrors
            )) {
            throw 'Certificate validation policy accepted chain errors combined with a hostname mismatch.'
        }
        [CvOnlinePresenter.Deployment.CertificateValidation]::ExpectedSha256 = '0' * 64
        if ($callback.Invoke($null, $Certificate, $null, [System.Net.Security.SslPolicyErrors]::None)) {
            throw 'Certificate validation policy accepted an incorrect SHA-256 pin.'
        }
    }
    finally {
        [CvOnlinePresenter.Deployment.CertificateValidation]::ExpectedSha256 = $null
    }

    Write-Output 'Certificate validation policy self-test passed.'
}

function Assert-TrustedEndpoint {
    param([Parameter(Mandatory = $true)][Uri]$Endpoint)

    $client = [System.Net.Sockets.TcpClient]::new()
    $stream = $null
    try {
        $connectTask = $client.ConnectAsync($Endpoint.Host, $Endpoint.Port)
        try {
            if (-not $connectTask.Wait($socketTimeoutMilliseconds)) {
                throw "Timed out connecting to the trusted Web Deploy endpoint after $socketTimeoutMilliseconds ms."
            }
            $connectTask.GetAwaiter().GetResult()
        }
        catch {
            throw "Could not connect to trusted Web Deploy endpoint '$($Endpoint.Host):$($Endpoint.Port)': $($_.Exception.GetBaseException().Message)"
        }
        $stream = [System.Net.Security.SslStream]::new(
            $client.GetStream(),
            $false,
            [CvOnlinePresenter.Deployment.CertificateValidation]::RequirePinned
        )
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

if ($ContentRelease) {
    if (-not (Test-Path -LiteralPath (Join-Path $resolvedSourcePath 'site.json') -PathType Leaf)) {
        throw "SourcePath is missing required file 'site.json'."
    }
    if (-not (Test-Path -LiteralPath (Join-Path $resolvedSourcePath 'pages') -PathType Container)) {
        throw "SourcePath is missing required folder 'pages'."
    }
}
else {
    foreach ($requiredFile in @('web.config', 'Portfolio.Web.dll')) {
        if (-not (Test-Path -LiteralPath (Join-Path $resolvedSourcePath $requiredFile) -PathType Leaf)) {
            throw "SourcePath is missing required file '$requiredFile'."
        }
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
$resolvedOfflinePagePath = $null
if (-not $ContentRelease) {
    if ([string]::IsNullOrWhiteSpace($OfflinePagePath) -or
        -not (Test-Path -LiteralPath $OfflinePagePath -PathType Leaf)) {
        throw "OfflinePagePath '$OfflinePagePath' must be a file."
    }
    $resolvedOfflinePagePath = (Resolve-Path -LiteralPath $OfflinePagePath).Path
    $offlinePageLength = (Get-Item -LiteralPath $resolvedOfflinePagePath).Length
    if ($offlinePageLength -lt 1 -or $offlinePageLength -gt 1MB) {
        throw 'OfflinePagePath must contain a non-empty HTML file no larger than 1 MB.'
    }
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
    $assemblySignature = Get-AuthenticodeSignature -LiteralPath $WebDeployAssemblyPath
    if ($assemblySignature.Status -ne 'Valid' -or $null -eq $assemblySignature.SignerCertificate) {
        throw 'Microsoft.Web.Deployment.dll must have a valid Authenticode signature.'
    }
    Assert-CertificateValidationPolicy -Certificate $assemblySignature.SignerCertificate
    Write-Output "Validated MSDeploy experiment inputs for site '$deploySiteName'."
    return
}
if (-not (Test-Path -LiteralPath $WebDeployAssemblyPath -PathType Leaf)) {
    throw "Microsoft.Web.Deployment.dll was not found at '$WebDeployAssemblyPath'."
}
Add-Type -Path $WebDeployAssemblyPath

$pinnedConnection = Get-PinnedRemoteCertificate -Endpoint $endpoint -ExpectedSha256 $certificateSha256
$certificate = $pinnedConnection.Certificate
$certificateAdded = $false
$pinCallbackInstalled = $false
$previousCertificateCallback = $null
$certificatePath = Join-Path ([IO.Path]::GetTempPath()) "cv-online-presenter-$($certificate.Thumbprint).cer"
$store = [System.Security.Cryptography.X509Certificates.X509Store]::new(
    [System.Security.Cryptography.X509Certificates.StoreName]::Root,
    [System.Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine
)

try {
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

    [CvOnlinePresenter.Deployment.CertificateValidation]::ExpectedSha256 = $certificateSha256
    Assert-TrustedEndpoint -Endpoint $endpoint
    $previousCertificateCallback = [System.Net.ServicePointManager]::ServerCertificateValidationCallback
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback =
        [CvOnlinePresenter.Deployment.CertificateValidation]::RequirePinned
    $pinCallbackInstalled = $true

    $sourceOptions = [Microsoft.Web.Deployment.DeploymentBaseOptions]::new()
    $destinationOptions = [Microsoft.Web.Deployment.DeploymentBaseOptions]::new()
    $destinationOptions.ComputerName = $endpoint.AbsoluteUri
    $destinationOptions.UserName = $deployUsername
    $destinationOptions.AuthenticationType = 'Basic'
    $destinationOptions.IncludeAcls = $false
    $destinationOptions.RetryAttempts = 10
    $destinationOptions.RetryInterval = 5000
    $destinationOptions.SkipDirectory('(?:^|[\\/])\.well-known(?:[\\/]|$)')

    $offlineTemplateRelativePath = 'App_Data\app_offline.template.htm'
    $destinationProviderOptions = [Microsoft.Web.Deployment.DeploymentProviderOptions]::new(
        [Microsoft.Web.Deployment.DeploymentWellKnownProvider]::ContentPath
    )
    $destinationProviderOptions.Path = $deployContentPath
    if (-not $ContentRelease) {
        $destinationProviderOptions.ProviderSettings['AppOfflineTemplate'].Value = $offlineTemplateRelativePath
    }

    $templateDestinationProviderOptions = [Microsoft.Web.Deployment.DeploymentProviderOptions]::new(
        [Microsoft.Web.Deployment.DeploymentWellKnownProvider]::ContentPath
    )
    $templateDestinationProviderOptions.Path = "$deployContentPath/$($offlineTemplateRelativePath -replace '\\', '/')"
    foreach ($link in $destinationOptions.LinkExtensions) {
        if ($link.Name -in @('AppPoolExtension', 'ContentExtension', 'CertificateExtension')) {
            $link.Enabled = $false
        }
    }

    $syncOptions = [Microsoft.Web.Deployment.DeploymentSyncOptions]::new()
    $syncOptions.DoNotDelete = $false
    $syncOptions.WhatIf = $WhatIf
    if ($ContentRelease) {
        $syncOptions.DoNotDelete = $true
    }
    else {
        $appOfflineHandlerType = [Microsoft.Web.Deployment.DeploymentManager].Assembly.GetType(
            'Microsoft.Web.Deployment.AppOfflineRuleHandler',
            $true
        )
        $appOfflineHandler = [Activator]::CreateInstance($appOfflineHandlerType, $true)
        $appOfflineRule = [Microsoft.Web.Deployment.DeploymentRule]::new('AppOffline', $appOfflineHandler)
        $syncOptions.Rules.Add($appOfflineRule)
    }

    $templateSyncOptions = [Microsoft.Web.Deployment.DeploymentSyncOptions]::new()
    $templateSyncOptions.DoNotDelete = $true
    $templateSyncOptions.WhatIf = $WhatIf

    $templateSource = $null
    $source = $null
    $destinationOptions.Password = $password
    try {
        if (-not $ContentRelease) {
            $templateSource = [Microsoft.Web.Deployment.DeploymentManager]::CreateObject(
                [Microsoft.Web.Deployment.DeploymentWellKnownProvider]::ContentPath,
                $resolvedOfflinePagePath,
                $sourceOptions
            )
            $templateResult = $templateSource.SyncTo(
                $templateDestinationProviderOptions,
                $destinationOptions,
                $templateSyncOptions
            )
            if ($templateResult.Errors -gt 0) {
                throw "MSDeploy reported $($templateResult.Errors) offline-template synchronization error(s)."
            }
            Write-Output (
                "MSDeploy synchronized the offline template with {0} change(s)." -f
                $templateResult.TotalChanges
            )
        }

        $source = [Microsoft.Web.Deployment.DeploymentManager]::CreateObject(
            [Microsoft.Web.Deployment.DeploymentWellKnownProvider]::ContentPath,
            $resolvedSourcePath,
            $sourceOptions
        )
        $result = $source.SyncTo(
            $destinationProviderOptions,
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
        if ($null -ne $templateSource) {
            $templateSource.Dispose()
        }
        $destinationOptions.Password = $null
    }
}
finally {
    try {
        if ($pinCallbackInstalled) {
            [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $previousCertificateCallback
        }
        [CvOnlinePresenter.Deployment.CertificateValidation]::ExpectedSha256 = $null
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
            Remove-Item -LiteralPath $certificatePath -Force -ErrorAction SilentlyContinue
            $certificate.Dispose()
            $password = $null
        }
    }
}

Write-Output "MSDeploy experiment completed for site '$deploySiteName'."
