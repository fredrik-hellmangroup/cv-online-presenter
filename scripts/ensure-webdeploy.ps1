param(
    [string]$InstallRoot = 'C:\Program Files\IIS\Microsoft Web Deploy V3',
    [string]$InstallerPath = (Join-Path $env:TEMP 'WebDeploy_amd64_en-US.msi')
)

$ErrorActionPreference = 'Stop'
$msDeployPath = Join-Path $InstallRoot 'msdeploy.exe'
$assemblyPath = Join-Path $InstallRoot 'Microsoft.Web.Deployment.dll'

if (-not (Test-Path -LiteralPath $msDeployPath -PathType Leaf)) {
    $installerUrl = 'https://download.microsoft.com/download/0/1/D/01DC28EA-638C-4A22-A57B-4CEF97755C6C/WebDeploy_amd64_en-US.msi'
    $expectedInstallerSha256 = '2150f9d1ab67e1b7b63559fb977ba9adc49f2b064fe2669a2e70d313a36b9a3d'
    try {
        Invoke-WebRequest -Uri $installerUrl -OutFile $InstallerPath -MaximumRedirection 0
        $actualInstallerSha256 = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualInstallerSha256 -cne $expectedInstallerSha256) {
            throw 'The Microsoft Web Deploy installer did not match the pinned SHA-256 digest.'
        }

        $installerSignature = Get-AuthenticodeSignature -LiteralPath $InstallerPath
        if (
            $installerSignature.Status -ne 'Valid' -or
            $installerSignature.SignerCertificate.Subject -notmatch '(^|, )O=Microsoft Corporation(, |$)'
        ) {
            throw 'The Microsoft Web Deploy installer does not have a valid Microsoft Authenticode signature.'
        }

        $installer = Start-Process msiexec.exe `
            -ArgumentList @('/i', "`"$InstallerPath`"", '/qn', '/norestart', 'ADDLOCAL=ALL') `
            -Wait `
            -PassThru
        if ($installer.ExitCode -notin @(0, 3010, 1641)) {
            throw "Microsoft Web Deploy installation failed with exit code $($installer.ExitCode)."
        }
    }
    finally {
        Remove-Item -LiteralPath $InstallerPath -Force -ErrorAction SilentlyContinue
    }
}

$expectedVersions = @{
    $msDeployPath = '7.1.9419.0650'
    $assemblyPath = '7.1.9419.0646'
}
foreach ($entry in $expectedVersions.GetEnumerator()) {
    if (-not (Test-Path -LiteralPath $entry.Key -PathType Leaf)) {
        throw "Verified Web Deploy file '$($entry.Key)' was not found."
    }
    if ((Get-Item -LiteralPath $entry.Key).VersionInfo.FileVersion -cne $entry.Value) {
        throw "Web Deploy file '$($entry.Key)' does not match version '$($entry.Value)'."
    }

    $signature = Get-AuthenticodeSignature -LiteralPath $entry.Key
    if (
        $signature.Status -ne 'Valid' -or
        $signature.SignerCertificate.Subject -notmatch '(^|, )O=Microsoft Corporation(, |$)'
    ) {
        throw "Web Deploy file '$($entry.Key)' does not have a valid Microsoft Authenticode signature."
    }
}

Write-Output "Verified Microsoft Web Deploy at '$InstallRoot'."
