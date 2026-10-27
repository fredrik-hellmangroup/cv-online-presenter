param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^https://')]
    [string]$Url,

    [ValidateRange(1, 120)]
    [int]$TimeoutSeconds = 15
)

$ErrorActionPreference = 'Stop'
$response = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec $TimeoutSeconds
if ($response.status -ne 'ok') {
    throw "Health endpoint returned an unexpected response."
}
Write-Output 'Health check passed.'
