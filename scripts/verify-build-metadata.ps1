param(
    [Parameter(Mandatory = $true)]
    [string]$Url,

    [Parameter(Mandatory = $true)]
    [string]$ExpectedMetadataPath,

    [ValidateRange(1, 120)]
    [int]$TimeoutSeconds = 15
)

$ErrorActionPreference = 'Stop'

try {
    $metadataUri = [Uri]$Url
}
catch {
    throw 'Url must be a valid absolute URI.'
}

$isLoopbackHttp = $metadataUri.Scheme -eq 'http' -and [IPAddress]::IsLoopback(
    [IPAddress]::Parse($metadataUri.Host)
)
if ($metadataUri.Scheme -ne 'https' -and -not $isLoopbackHttp) {
    throw 'Url must use HTTPS except for loopback tests.'
}
if (-not (Test-Path -LiteralPath $ExpectedMetadataPath -PathType Leaf)) {
    throw "ExpectedMetadataPath '$ExpectedMetadataPath' must be a file."
}

try {
    $expected = Get-Content -LiteralPath $ExpectedMetadataPath -Raw | ConvertFrom-Json
}
catch {
    throw "ExpectedMetadataPath does not contain valid JSON: $($_.Exception.Message)"
}

foreach ($revisionName in @('appRevision', 'contentRevision')) {
    if ($expected.$revisionName -notmatch '^[a-f0-9]{40}$') {
        throw "Expected metadata property '$revisionName' must be a 40-character lowercase Git revision."
    }
}
if ([string]::IsNullOrWhiteSpace($expected.buildId)) {
    throw "Expected metadata property 'buildId' is required."
}

$response = Invoke-WebRequest `
    -Uri $metadataUri `
    -Method Get `
    -Headers @{ 'Cache-Control' = 'no-cache' } `
    -MaximumRedirection 0 `
    -UseBasicParsing `
    -TimeoutSec $TimeoutSeconds
try {
    $live = $response.Content | ConvertFrom-Json
}
catch {
    throw "Live build metadata did not contain valid JSON: $($_.Exception.Message)"
}

foreach ($propertyName in @('appRevision', 'contentRevision', 'buildId')) {
    if ($live.$propertyName -cne $expected.$propertyName) {
        throw (
            "Live build metadata property '{0}' did not match the deployed artifact. Expected '{1}', received '{2}'." -f
            $propertyName,
            $expected.$propertyName,
            $live.$propertyName
        )
    }
}

Write-Output (
    "Build metadata verification passed for app '{0}', content '{1}', build '{2}'." -f
    $expected.appRevision,
    $expected.contentRevision,
    $expected.buildId
)
