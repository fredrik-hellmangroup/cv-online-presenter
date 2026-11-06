Set-StrictMode -Version Latest

$script:ReleaseTagPattern = '^v[0-9]+\.[0-9]+\.[0-9]+$'
$script:WorkflowUsesPattern = '^\s*uses:\s*(?<repo>[A-Za-z0-9-]+/[A-Za-z0-9._-]+)/\.github/workflows/[A-Za-z0-9._-]+\.ya?ml@(?<ref>\S+)'

function Invoke-Native {
    param([string]$Description, [scriptblock]$Command)
    $output = & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Description failed with exit code $LASTEXITCODE." }
    $output
}

# Only GitHub.com repositories are supported.
function Get-AppRepositoryUrl {
    param([Parameter(Mandatory = $true)][string]$Repository)
    if ($Repository -cnotmatch '^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$') { throw "App repository must be owner/repository, not '$Repository'." }
    "https://github.com/$Repository.git"
}

# Reads the single app repository and release reference that every caller workflow pins.
function Get-AppPinReference {
    param([Parameter(Mandatory = $true)][string]$ContentRoot)

    $files = @(Get-ChildItem -LiteralPath (Join-Path $ContentRoot '.github/workflows') -Filter '*.yml' -File)
    $pins = @(foreach ($file in $files) {
        foreach ($match in (Select-String -LiteralPath $file.FullName -Pattern $script:WorkflowUsesPattern)) {
            [pscustomobject]@{
                File       = $file.FullName
                Repository = $match.Matches[0].Groups['repo'].Value
                Ref        = $match.Matches[0].Groups['ref'].Value
            }
        }
    })
    if ($pins.Count -eq 0) { throw 'No caller workflow references an app reusable workflow.' }
    if (@($pins.Repository | Sort-Object -Unique).Count -ne 1 -or @($pins.Ref | Sort-Object -Unique).Count -ne 1) {
        throw 'Caller workflows reference different app repositories or releases; align them first.'
    }
    [pscustomobject]@{ Repository = $pins[0].Repository; Ref = $pins[0].Ref; Files = @($pins.File | Sort-Object -Unique) }
}

# Resolves 'latest', a partial 'v0.*' / 'v0.1.*', or an exact 'vX.Y.Z' to an existing release tag.
function Resolve-AppVersion {
    param(
        [Parameter(Mandatory = $true)][string]$Repository,
        [Parameter(Mandatory = $true)][string]$Spec
    )

    $prefix = $null
    if ($Spec -ceq 'latest') { $prefix = '' }
    elseif ($Spec -cmatch '^(v[0-9]+(?:\.[0-9]+)?)\.\*$') { $prefix = $Matches[1] + '.' }
    elseif ($Spec -cnotmatch $script:ReleaseTagPattern) {
        throw "Version must be 'latest', a range such as 'v0.*', or an exact release tag such as 'v0.1.1'."
    }

    $url = Get-AppRepositoryUrl $Repository
    $lines = Invoke-Native 'Listing app release tags' { git ls-remote --tags --refs $url 'refs/tags/v*' }
    $tags = @(foreach ($line in $lines) {
        if ($line -cmatch 'refs/tags/(v[0-9]+\.[0-9]+\.[0-9]+)$') { $Matches[1] }
    })
    if ($null -eq $prefix) {
        if ($tags -cnotcontains $Spec) { throw "Release tag $Spec does not exist in $Repository." }
        return $Spec
    }

    $candidates = @($tags | Where-Object { $_.StartsWith($prefix, [StringComparison]::Ordinal) } |
        Sort-Object { [version]$_.Substring(1) } -Descending)
    if ($candidates.Count -eq 0) { throw "No release tag matches '$Spec' in $Repository." }
    $candidates[0]
}

# Clones the app at an exact release tag and verifies it like the reusable workflows do.
function Install-AppCheckout {
    param(
        [Parameter(Mandatory = $true)][string]$Repository,
        [Parameter(Mandatory = $true)][string]$Version,
        [Parameter(Mandatory = $true)][string]$Path
    )

    if ($Version -cnotmatch $script:ReleaseTagPattern) { throw "Version must be an exact release tag, not '$Version'." }
    if (Test-Path -LiteralPath $Path) { throw "Checkout path already exists: $Path" }
    $url = Get-AppRepositoryUrl $Repository

    # The app's synthetic fixtures require LF line endings.
    Invoke-Native 'Cloning the app repository' { git -c core.autocrlf=false clone --quiet $url $Path } | Out-Null
    Invoke-Native "Checking out $Version" { git -c core.autocrlf=false -C $Path checkout --quiet --detach "refs/tags/$Version" } | Out-Null

    $head = (Invoke-Native 'Reading app HEAD' { git -C $Path rev-parse HEAD }).Trim()
    $tagCommit = (Invoke-Native 'Resolving the release tag' { git -C $Path rev-parse --verify "refs/tags/$Version^{commit}" }).Trim()
    if ($head -cne $tagCommit) { throw "Checkout does not match release tag $Version." }

    git -C $Path merge-base --is-ancestor $head refs/remotes/origin/main
    if ($LASTEXITCODE -ne 0) { throw "Release $Version is not reachable from the app repository's main branch." }

    $fileVersion = (Get-Content -LiteralPath (Join-Path $Path 'VERSION') -Raw).Trim()
    if ("v$fileVersion" -cne $Version) { throw "VERSION ($fileVersion) does not match release tag $Version." }
}

function New-TemporaryCheckoutPath {
    param([string]$Version)
    Join-Path ([IO.Path]::GetTempPath()) ('cv-online-presenter-app-{0}-{1}' -f $Version, [guid]::NewGuid().ToString('N').Substring(0, 8))
}

Export-ModuleMember -Function Invoke-Native, Get-AppRepositoryUrl, Get-AppPinReference, Resolve-AppVersion, Install-AppCheckout, New-TemporaryCheckoutPath
