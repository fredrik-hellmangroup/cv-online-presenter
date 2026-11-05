param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('patch', 'minor', 'major')]
    [string]$Bump,

    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [string[]]$ExistingTags
)

$ErrorActionPreference = 'Stop'

$versions = foreach ($tag in $ExistingTags) {
    if ($tag -cmatch '^v(\d+)\.(\d+)\.(\d+)$') {
        [PSCustomObject]@{
            Major = [int]$Matches[1]
            Minor = [int]$Matches[2]
            Patch = [int]$Matches[3]
        }
    }
}

$latest = $versions |
    Sort-Object -Property Major, Minor, Patch -Descending |
    Select-Object -First 1
if ($null -eq $latest) {
    throw 'No existing vMAJOR.MINOR.PATCH release tag was found to bump from.'
}

switch ($Bump) {
    'major' { "v$($latest.Major + 1).0.0" }
    'minor' { "v$($latest.Major).$($latest.Minor + 1).0" }
    'patch' { "v$($latest.Major).$($latest.Minor).$($latest.Patch + 1)" }
}
