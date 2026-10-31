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

    [Parameter(Mandatory = $true)]
    [string]$DeployCertificateSha256,

    [string]$MsDeployPath = 'C:\Program Files\IIS\Microsoft Web Deploy V3\msdeploy.exe',

    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$socketTimeoutMilliseconds = 15000

if ($null -eq ('CvOnlinePresenter.Deployment.CertificateValidation' -as [type])) {
    Add-Type -TypeDefinition @'
using System.Net.Security;

namespace CvOnlinePresenter.Deployment
{
    public static class CertificateValidation
    {
        public static readonly RemoteCertificateValidationCallback AcceptAny =
            (_, _, _, _) => true;
    }
}
'@
}

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
        throw 'DEPLOY_SERVER_URL must be a valid HTTPS URL or hostname.'
    }

    if ($uri.Scheme -ne 'https' -or [string]::IsNullOrWhiteSpace($uri.Host) -or -not [string]::IsNullOrEmpty($uri.UserInfo)) {
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

function Invoke-TlsAuthentication {
    param(
        [Parameter(Mandatory = $true)]
        [System.Net.Security.SslStream]$Stream,

        [Parameter(Mandatory = $true)]
        [string]$TargetHost,

        [Parameter(Mandatory = $true)]
        [string]$TimeoutMessage
    )

    $options = [System.Net.Security.SslClientAuthenticationOptions]::new()
    $options.TargetHost = $TargetHost
    $cancellation = [System.Threading.CancellationTokenSource]::new($socketTimeoutMilliseconds)
    try {
        $Stream.AuthenticateAsClientAsync($options, $cancellation.Token).GetAwaiter().GetResult()
    }
    catch [System.OperationCanceledException] {
        throw $TimeoutMessage
    }
    finally {
        $cancellation.Dispose()
    }
}

function Get-PinnedRemoteCertificate {
    param(
        [Parameter(Mandatory = $true)]
        [Uri]$Endpoint,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedSha256
    )

    $client = [System.Net.Sockets.TcpClient]::new()
    $stream = $null
    try {
        Write-Host "Connecting to $($Endpoint.Host):$($Endpoint.Port) for certificate pin validation."
        $connectTask = $client.ConnectAsync($Endpoint.Host, $Endpoint.Port)
        if (-not $connectTask.Wait($socketTimeoutMilliseconds)) {
            throw "Timed out connecting to the Web Deploy endpoint after $socketTimeoutMilliseconds ms."
        }
        $connectTask.GetAwaiter().GetResult()
        $client.ReceiveTimeout = $socketTimeoutMilliseconds
        $client.SendTimeout = $socketTimeoutMilliseconds
        $stream = [System.Net.Security.SslStream]::new(
            $client.GetStream(),
            $false,
            [CvOnlinePresenter.Deployment.CertificateValidation]::AcceptAny
        )
        Invoke-TlsAuthentication `
            -Stream $stream `
            -TargetHost $Endpoint.Host `
            -TimeoutMessage "Timed out reading the Web Deploy TLS certificate after $socketTimeoutMilliseconds ms."
        Write-Host 'Received the Web Deploy TLS certificate.'
        $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($stream.RemoteCertificate)
        $actualSha256 = $certificate.GetCertHashString([System.Security.Cryptography.HashAlgorithmName]::SHA256)
        if (-not $actualSha256.Equals($ExpectedSha256, [StringComparison]::OrdinalIgnoreCase)) {
            $certificate.Dispose()
            throw 'The Web Deploy server certificate does not match DEPLOY_CERTIFICATE_SHA256.'
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
    param(
        [Parameter(Mandatory = $true)]
        [Uri]$Endpoint
    )

    $client = [System.Net.Sockets.TcpClient]::new()
    $stream = $null
    try {
        Write-Host "Connecting to $($Endpoint.Host):$($Endpoint.Port) with normal TLS validation."
        $connectTask = $client.ConnectAsync($Endpoint.Host, $Endpoint.Port)
        if (-not $connectTask.Wait($socketTimeoutMilliseconds)) {
            throw "Timed out connecting to the trusted Web Deploy endpoint after $socketTimeoutMilliseconds ms."
        }
        $connectTask.GetAwaiter().GetResult()
        $client.ReceiveTimeout = $socketTimeoutMilliseconds
        $client.SendTimeout = $socketTimeoutMilliseconds
        $stream = [System.Net.Security.SslStream]::new($client.GetStream(), $false)
        Invoke-TlsAuthentication `
            -Stream $stream `
            -TargetHost $Endpoint.Host `
            -TimeoutMessage "Timed out validating the Web Deploy TLS certificate after $socketTimeoutMilliseconds ms."
        Write-Host 'Normal TLS validation succeeded for the pinned Web Deploy certificate.'
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
$deployPassword = $DeployPassword
$deployCertificateSha256 = $DeployCertificateSha256.Replace(':', '').Replace(' ', '').Trim()

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
if ($deployCertificateSha256 -notmatch '^[A-Fa-f0-9]{64}$') {
    throw 'DEPLOY_CERTIFICATE_SHA256 must contain a SHA-256 certificate fingerprint.'
}

$computerName = Resolve-WebDeployEndpoint -ServerUrl $DeployServerUrl -SiteName $deploySiteName

if ($ValidateOnly) {
    Write-Output "Validated IIS deployment inputs for site '$deploySiteName'."
    exit 0
}

if (-not (Test-Path -LiteralPath $MsDeployPath -PathType Leaf)) {
    throw "msdeploy.exe was not found at '$MsDeployPath'."
}

$pinnedConnection = Get-PinnedRemoteCertificate -Endpoint ([Uri]$computerName) -ExpectedSha256 $deployCertificateSha256
$certificate = $pinnedConnection.Certificate
$certificateDnsName = $certificate.GetNameInfo(
    [System.Security.Cryptography.X509Certificates.X509NameType]::DnsName,
    $false
).Trim()
if ($certificateDnsName -notmatch '^[A-Za-z0-9-]+$') {
    $certificate.Dispose()
    throw 'The pinned Web Deploy certificate must use a single-label DNS name.'
}

$trustedEndpoint = [UriBuilder]$computerName
$trustedEndpoint.Host = $certificateDnsName
$trustedComputerName = $trustedEndpoint.Uri.AbsoluteUri
$hostsPath = Join-Path $env:WINDIR 'System32\drivers\etc\hosts'
$hostsEntry = "$($pinnedConnection.Address)`t$certificateDnsName`t# cv-online-presenter Web Deploy"
$hostsEntryAdded = $false
$certificateAdded = $false
$store = [System.Security.Cryptography.X509Certificates.X509Store]::new(
    [System.Security.Cryptography.X509Certificates.StoreName]::Root,
    [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
)

try {
    $existingAlias = Get-Content -LiteralPath $hostsPath | Where-Object {
        $tokens = (($_ -split '#', 2)[0] -split '\s+') | Where-Object { $_ }
        $tokens.Count -gt 1 -and $tokens[1..($tokens.Count - 1)] -contains $certificateDnsName
    }
    if ($existingAlias) {
        $existingAddress = ((($existingAlias | Select-Object -First 1) -split '#', 2)[0] -split '\s+')[0]
        if ($existingAddress -ne $pinnedConnection.Address) {
            throw "The certificate DNS name '$certificateDnsName' already resolves to another address in the hosts file."
        }
    }
    else {
        Add-Content -LiteralPath $hostsPath -Value $hostsEntry -Encoding ascii
        $hostsEntryAdded = $true
        Write-Host "Added a temporary hosts mapping for '$certificateDnsName'."
    }

    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $alreadyTrusted = $store.Certificates.Find(
        [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
        $certificate.Thumbprint,
        $false
    ).Count -gt 0
    if (-not $alreadyTrusted) {
        $store.Add($certificate)
        $certificateAdded = $true
        Write-Host 'Added the pinned certificate to the current-user root store temporarily.'
    }

    Assert-TrustedEndpoint -Endpoint $trustedEndpoint.Uri

    $sourceSettings = "contentPath=$(Format-WebDeployValue -Value $resolvedSourcePath)"
    $destinationSettings = @(
        "contentPath=$(Format-WebDeployValue -Value $deployContentPath)"
        "computerName=$(Format-WebDeployValue -Value $trustedComputerName)"
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

    Write-Host "Starting Web Deploy synchronization for site '$deploySiteName'."
    & $MsDeployPath @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Web Deploy failed for site '$deploySiteName' with exit code $LASTEXITCODE."
    }
    Write-Host "Web Deploy synchronization completed for site '$deploySiteName'."
}
finally {
    try {
        if ($certificateAdded) {
            $store.Remove($certificate)
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
                $certificate.Dispose()
            }
        }
    }
}

Write-Output "IIS deployment completed for site '$deploySiteName'."
