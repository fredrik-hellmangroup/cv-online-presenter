<#
.SYNOPSIS
Creates a private content repository for a fork of the app.

.DESCRIPTION
Run from a checkout of your app fork. Resolves the app release (default: latest), clones it to a
temporary folder, and creates -Path as a new git repository containing the app's synthetic content
template, caller workflows pinned to that release tag, a README, and provenance generated with that
release. Optionally creates the private GitHub repository (-CreateGitHubRepository) and protects the
app's v* tags (-ProtectAppTags). Replace the synthetic content with your own before publishing; the
manual steps are described in docs\fork-guide.md.

.EXAMPLE
.\scripts\New-ContentRepository.ps1 -Path D:\work\my-portfolio-content

.EXAMPLE
.\scripts\New-ContentRepository.ps1 -Path D:\work\my-portfolio-content -CreateGitHubRepository -ProtectAppTags
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    # New, empty or non-existing directory for the content repository.
    [Parameter(Mandatory = $true)]
    [string]$Path,

    # owner/repository of your app fork. Defaults to this checkout's 'origin' remote.
    [string]$AppRepository,

    # 'latest', a range such as 'v1.*', or an exact release tag of the fork. The fork needs at least one release tag.
    [string]$AppVersion = 'latest',

    # Name of the GitHub repository to create. Defaults to '<app-repository-name>-content'.
    [string]$Name,

    # Owner of the GitHub repository to create. Defaults to the owner of the app repository.
    [string]$Owner,

    # Create the private repository on GitHub with the gh CLI and push the initial commit.
    [switch]$CreateGitHubRepository,

    # Create a ruleset in the app repository that forbids updating and deleting v* tags (needs gh and admin rights).
    [switch]$ProtectAppTags
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'AppPin.psm1') -Force

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$templateRoot = Join-Path $repositoryRoot 'templates/content-repository'
$utf8 = [Text.UTF8Encoding]::new($false)

if (-not $AppRepository) {
    $origin = (git -C $repositoryRoot remote get-url origin 2>$null)
    if ($LASTEXITCODE -ne 0 -or $origin -cnotmatch 'github\.com[:/](?<repo>[A-Za-z0-9-]+/[A-Za-z0-9._-]+?)(?:\.git)?/?$') {
        throw 'Cannot derive the app repository from the origin remote; pass -AppRepository owner/repository.'
    }
    $AppRepository = $Matches['repo']
}
if ($AppRepository -cnotmatch '^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$') { throw "-AppRepository must be owner/repository, not '$AppRepository'." }
$appOwner, $appName = $AppRepository -split '/'
if (-not $Name) { $Name = "$appName-content" }
if (-not $Owner) { $Owner = $appOwner }

if ((Test-Path -LiteralPath $Path) -and @(Get-ChildItem -LiteralPath $Path -Force).Count -gt 0) {
    throw "$Path already exists and is not empty."
}

$version = Resolve-AppVersion -Repository $AppRepository -Spec $AppVersion
Write-Host "Using $AppRepository at release $version."
if (-not $PSCmdlet.ShouldProcess($Path, "Create content repository pinned to $version")) { return }

function Expand-Template {
    param([string]$Source, [string]$Destination)
    $text = [IO.File]::ReadAllText($Source).Replace("`r`n", "`n")
    $text = $text.Replace('__APP_REPOSITORY__', $AppRepository).Replace('__APP_VERSION__', $version).Replace('__CONTENT_NAME__', $Name)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
    [IO.File]::WriteAllText($Destination, $text, $utf8)
}

$checkout = New-TemporaryCheckoutPath -Version $version
try {
    Install-AppCheckout -Repository $AppRepository -Version $version -Path $checkout

    New-Item -ItemType Directory -Force -Path $Path | Out-Null
    $contentRoot = (Resolve-Path -LiteralPath $Path).Path
    Copy-Item -LiteralPath (Join-Path $checkout 'content') -Destination (Join-Path $contentRoot 'content') -Recurse
    # The template's content/README.md documents the app, not your content.
    Remove-Item -LiteralPath (Join-Path $contentRoot 'content/README.md') -ErrorAction SilentlyContinue

    foreach ($workflow in 'content.yml', 'deploy-content.yml', 'provision-activation-token.yml') {
        Expand-Template (Join-Path $templateRoot ".github/workflows/$workflow") (Join-Path $contentRoot ".github/workflows/$workflow")
    }
    Expand-Template (Join-Path $templateRoot 'README.md') (Join-Path $contentRoot 'README.md')
    Expand-Template (Join-Path $templateRoot 'gitignore.template') (Join-Path $contentRoot '.gitignore')

    & (Join-Path $checkout 'scripts/validate-content.ps1') -ContentRoot $contentRoot -AppVersion $version -Generate

    Invoke-Native 'git init' { git -C $contentRoot init --quiet --initial-branch=main } | Out-Null
    Invoke-Native 'git add' { git -C $contentRoot add -A } | Out-Null
    Invoke-Native 'git commit' { git -C $contentRoot commit --quiet -m "chore: initial content from $AppRepository@$version" } | Out-Null
}
finally {
    if (Test-Path -LiteralPath $checkout) { Remove-Item -LiteralPath $checkout -Recurse -Force }
}

if ($CreateGitHubRepository) {
    Invoke-Native 'Creating the GitHub repository' { gh repo create "$Owner/$Name" --private --source $contentRoot --remote origin --push } | Out-Null
    Write-Host "Created private repository $Owner/$Name."
}

if ($ProtectAppTags) {
    $ruleset = @{
        name          = 'protect-version-tags'
        target        = 'tag'
        enforcement   = 'active'
        bypass_actors = @()
        conditions    = @{ ref_name = @{ include = @('refs/tags/v*'); exclude = @() } }
        rules         = @(@{ type = 'update' }, @{ type = 'deletion' })
    } | ConvertTo-Json -Depth 6
    $ruleset | gh api -X POST "repos/$AppRepository/rulesets" --input - | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warning "Could not create the v* tag ruleset in $AppRepository; create it manually." }
    else { Write-Host "Protected v* tags in $AppRepository." }
}

Write-Host ''
Write-Host "Content repository created at $contentRoot (pinned to $AppRepository@$version)."
Write-Host 'Next steps:'
Write-Host '  1. Replace the synthetic content with your own (docs/fork-guide.md), then run scripts\Invoke-PinnedContentCheck.ps1 -ContentRoot <path> -Generate.'
if (-not $CreateGitHubRepository) { Write-Host '  2. Create a PRIVATE GitHub repository and push this one (or rerun with -CreateGitHubRepository).' }
Write-Host '  3. Configure the production-content environment secrets and variables listed in the new README.'
if (-not $ProtectAppTags) { Write-Host '  4. Protect v* tags in the app repository (ruleset: forbid update and deletion).' }
