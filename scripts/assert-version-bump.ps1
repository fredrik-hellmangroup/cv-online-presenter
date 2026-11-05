param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyString()]
    [string]$Version,

    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [string[]]$ExistingTags,

    # Bootstrap: the VERSION file is introduced and must equal the latest existing release.
    [switch]$AllowCurrent
)

$ErrorActionPreference = 'Stop'

if ($Version -cnotmatch '\A(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\z') {
    throw "VERSION must contain exactly MAJOR.MINOR.PATCH (for example 1.2.3), but found '$Version'."
}
$requested = @([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])

$latest = $null
foreach ($tag in $ExistingTags) {
    if ($tag -cmatch '^v(\d+)\.(\d+)\.(\d+)$') {
        $candidate = @([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])
        if ($null -eq $latest -or
            $candidate[0] -gt $latest[0] -or
            ($candidate[0] -eq $latest[0] -and $candidate[1] -gt $latest[1]) -or
            ($candidate[0] -eq $latest[0] -and $candidate[1] -eq $latest[1] -and $candidate[2] -gt $latest[2])) {
            $latest = $candidate
        }
    }
}
if ($null -eq $latest) {
    throw 'No existing vMAJOR.MINOR.PATCH release tag was found to compare VERSION with.'
}

$allowed = @(
    "$($latest[0]).$($latest[1]).$($latest[2] + 1)"
    "$($latest[0]).$($latest[1] + 1).0"
    "$($latest[0] + 1).0.0"
)
if ($AllowCurrent) {
    $allowed += "$($latest[0]).$($latest[1]).$($latest[2])"
}

if ($Version -cnotin $allowed) {
    throw "VERSION $Version is not a valid next release after v$($latest[0]).$($latest[1]).$($latest[2]). Allowed: $($allowed -join ', ')."
}

"v$Version"
