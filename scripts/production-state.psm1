Set-StrictMode -Version Latest

function Assert-LkgRecord {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Record)

    $required = @('schemaVersion', 'artifact', 'verifiedAtUtc', 'evidence')
    foreach ($name in $required) {
        if ($null -eq $Record.PSObject.Properties[$name]) { throw "LKG record is missing '$name'." }
    }
    if ([int]$Record.schemaVersion -ne 1) { throw 'LKG record schemaVersion must be 1.' }
    foreach ($name in @('sourceTag', 'commit', 'appRevision', 'contentRevision', 'buildId', 'packageSha256', 'releaseTag', 'assetName', 'workflow', 'runId', 'runAttempt')) {
        if ($null -eq $Record.artifact.PSObject.Properties[$name]) { throw "LKG artifact is missing '$name'." }
    }
    if ($Record.artifact.sourceTag -and $Record.artifact.sourceTag -notmatch '^v\d+\.\d+\.\d+$') { throw 'LKG sourceTag is invalid.' }
    if ($Record.artifact.commit -notmatch '^[a-f0-9]{40,64}$') { throw 'LKG commit is invalid.' }
    if ($Record.artifact.appRevision -cne $Record.artifact.commit) { throw 'LKG commit must match the embedded appRevision.' }
    if ($Record.artifact.packageSha256 -notmatch '^[a-f0-9]{64}$') { throw 'LKG packageSha256 is invalid.' }
    if ([string]::IsNullOrWhiteSpace([string]$Record.artifact.releaseTag) -or [string]::IsNullOrWhiteSpace([string]$Record.artifact.assetName)) { throw 'LKG immutable release locator is required.' }
    if ($Record.artifact.sourceTag) {
        if ($Record.artifact.releaseTag -cne $Record.artifact.sourceTag -or $Record.artifact.assetName -cne "cv-online-presenter-$($Record.artifact.sourceTag).zip") { throw 'LKG source release locator does not match its tag.' }
    } elseif ($Record.artifact.releaseTag -notmatch '^recovery/manual-\d+-\d+$' -or $Record.artifact.assetName -notmatch '^cv-online-presenter-manual-\d+-\d+\.zip$') {
        throw 'A manual-main LKG must identify its immutable recovery release asset.'
    }
    if ([string]::IsNullOrWhiteSpace([string]$Record.artifact.appRevision) -or [string]::IsNullOrWhiteSpace([string]$Record.artifact.contentRevision) -or [string]::IsNullOrWhiteSpace([string]$Record.artifact.buildId)) { throw 'LKG build metadata must be complete.' }
    if ([string]::IsNullOrWhiteSpace([string]$Record.artifact.workflow) -or [string]::IsNullOrWhiteSpace([string]$Record.artifact.runId) -or [string]::IsNullOrWhiteSpace([string]$Record.artifact.runAttempt)) { throw 'LKG workflow evidence must be complete.' }
    if ($Record.verifiedAtUtc -is [DateTime]) {
        if ($Record.verifiedAtUtc.Kind -ne [DateTimeKind]::Utc) { throw 'LKG verification timestamp must be UTC.' }
        $verifiedAt = [DateTimeOffset]$Record.verifiedAtUtc
    }
    elseif ($Record.verifiedAtUtc -is [string]) {
        $timestamp = $Record.verifiedAtUtc
        if ($timestamp -notmatch '\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})\z') {
            throw 'LKG verification timestamp must be a valid ISO-8601 timestamp.'
        }
        if ($timestamp.EndsWith('-00:00', [StringComparison]::Ordinal)) {
            throw 'LKG verification timestamp must not use the unknown -00:00 offset.'
        }

        $format = "yyyy-MM-dd'T'HH:mm:ss"
        if ($timestamp.Contains('.')) { $format += '.FFFFFFF' }
        if ($timestamp.EndsWith('Z', [StringComparison]::Ordinal)) { $format += "'Z'" }
        else { $format += 'zzz' }

        try {
            $verifiedAt = [DateTimeOffset]::ParseExact(
                $timestamp,
                $format,
                [Globalization.CultureInfo]::InvariantCulture,
                [Globalization.DateTimeStyles]::AssumeUniversal
            )
        }
        catch { throw 'LKG verification timestamp must be a valid ISO-8601 timestamp.' }
    }
    else {
        throw 'LKG verification timestamp must be a valid ISO-8601 timestamp.'
    }
    if ($verifiedAt.Offset -ne [TimeSpan]::Zero) { throw 'LKG verification timestamp must be UTC.' }
    if ($Record.evidence.health -cne 'passed' -or $Record.evidence.buildMetadata -cne 'exact-match' -or $Record.evidence.activeOfflineMarker -cne 'absent') { throw 'LKG verification evidence is incomplete or unsuccessful.' }
}

function ConvertFrom-LkgJson {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Json)

    $convertFromJson = Get-Command ConvertFrom-Json -ErrorAction Stop
    if (-not $convertFromJson.Parameters.ContainsKey('DateKind')) {
        throw 'LKG JSON parsing requires PowerShell ConvertFrom-Json -DateKind String support.'
    }
    return ConvertFrom-Json -InputObject $Json -DateKind String
}

function Assert-PackageSha256 {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$ExpectedSha256)

    if ($ExpectedSha256 -notmatch '^(?:sha256:)?[a-fA-F0-9]{64}$') { throw 'Expected package digest must be SHA-256.' }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Immutable package '$Path' is unavailable." }
    $expected = $ExpectedSha256 -replace '^sha256:', ''
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    if (-not $actual.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) { throw 'Package bytes do not match the recorded SHA-256 digest.' }
    return $actual.ToLowerInvariant()
}

function New-LkgRecord {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Artifact,
        [Parameter(Mandatory = $true)][string]$VerifiedAtUtc,
        [Parameter(Mandatory = $true)][string]$Workflow,
        [Parameter(Mandatory = $true)][string]$RunId,
        [Parameter(Mandatory = $true)][string]$RunAttempt
    )

    $record = [PSCustomObject]@{
        schemaVersion = 1
        verifiedAtUtc = $VerifiedAtUtc
        artifact = [PSCustomObject]@{
            sourceTag = $Artifact.sourceTag
            commit = [string]$Artifact.commit
            appRevision = [string]$Artifact.appRevision
            contentRevision = [string]$Artifact.contentRevision
            buildId = [string]$Artifact.buildId
            packageSha256 = ([string]$Artifact.packageSha256).ToLowerInvariant()
            releaseTag = [string]$Artifact.releaseTag
            assetName = [string]$Artifact.assetName
            workflow = $Workflow
            runId = $RunId
            runAttempt = $RunAttempt
        }
        evidence = [PSCustomObject]@{
            health = 'passed'
            buildMetadata = 'exact-match'
            activeOfflineMarker = 'absent'
        }
    }
    Assert-LkgRecord -Record $record
    return $record
}

function Invoke-LkgDeployment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][hashtable]$Operations,
        [Parameter(Mandatory = $true)]$Candidate,
        [switch]$ArchiveCandidateBeforeDeploy,
        [switch]$AllowPendingRecovery
    )

    foreach ($operation in @('ReadState', 'ReadPending', 'ResolveRollbackPackage', 'ValidateCandidate', 'SetPending', 'SyncCandidate', 'VerifyCandidate', 'SyncRollback', 'VerifyRollback', 'ClearPending', 'WriteState')) {
        if (-not $Operations.ContainsKey($operation) -or $Operations[$operation] -isnot [scriptblock]) { throw "Required injected operation '$operation' is missing." }
    }

    # A pending record means the preceding run could have changed production without advancing LKG.
    # Automatic releases must stop before resolving/syncing anything; only an explicit manual recovery may proceed.
    $prior = & $Operations.ReadState
    Assert-LkgRecord -Record $prior
    $pending = & $Operations.ReadPending
    if ($pending -and -not $AllowPendingRecovery) { throw 'A production deployment is pending reconciliation; automatic deployment is blocked before sync.' }
    if ($pending -and $AllowPendingRecovery -and -not $pending.candidate) { throw 'Pending production state is malformed; manual reconciliation cannot proceed.' }

    # Validate both immutable package identities before durably setting/replacing pending state.
    $rollbackPackage = & $Operations.ResolveRollbackPackage $prior.artifact
    if ($null -eq $rollbackPackage -or [string]::IsNullOrWhiteSpace([string]$rollbackPackage.path)) { throw 'Recorded rollback package is unavailable.' }
    Assert-PackageSha256 -Path $rollbackPackage.path -ExpectedSha256 $prior.artifact.packageSha256 | Out-Null
    & $Operations.ValidateCandidate $Candidate
    if ($ArchiveCandidateBeforeDeploy) {
        if (-not $Operations.ContainsKey('ArchiveCandidate') -or $Operations.ArchiveCandidate -isnot [scriptblock]) { throw 'Manual-main deployment requires an immutable recovery archive operation.' }
        $Candidate = & $Operations.ArchiveCandidate $Candidate
        & $Operations.ValidateCandidate $Candidate
    }

    # Must be durable before the first production mutation. The LKG record itself is not changed here.
    & $Operations.SetPending $Candidate $prior.artifact
    $pendingRecovery = [bool]$pending
    try {
        & $Operations.SyncCandidate $Candidate
        & $Operations.VerifyCandidate $Candidate
    }
    catch {
        $primaryFailure = $_.Exception.Message
        if ($pendingRecovery) {
            throw "Manual recovery deployment failed: $primaryFailure. Existing pending state remains for operator reconciliation; stale LKG rollback was intentionally not attempted."
        }
        try {
            & $Operations.SyncRollback $rollbackPackage $prior.artifact
            & $Operations.VerifyRollback $prior.artifact
        }
        catch {
            $recoveryFailure = $_.Exception.Message
            throw "Primary deployment failed: $primaryFailure. The single rollback attempt also failed: $recoveryFailure. Pending state is retained; operator/provider escalation required; no retry will be attempted."
        }
        try {
            & $Operations.ClearPending $prior.artifact
        }
        catch {
            throw "Primary deployment failed: $primaryFailure. The single rollback was verified and old LKG remains live, but pending-state clear failed or is ambiguous: $($_.Exception.Message). Automatic deployment remains blocked."
        }
        throw "Primary deployment failed: $primaryFailure. The single rollback attempt restored and verified the prior LKG; pending state was cleared and old LKG kept. If HTTP 503 persists, operator/provider escalation is required; no app-pool action was attempted."
    }

    # Candidate is live. Updating LKG and removing pending must be one non-force state-branch commit.
    try {
        $record = & $Operations.WriteState $Candidate
        Assert-LkgRecord -Record $record
        return [PSCustomObject]@{ Status = 'DeployedAndRecorded'; Record = $record }
    }
    catch {
        throw "Candidate is live and passed verification, but production-state LKG update/pending clear failed or is ambiguous: $($_.Exception.Message). Pending state must remain; reconciliation is required; no rollback was attempted."
    }
}

Export-ModuleMember -Function Assert-LkgRecord, Assert-PackageSha256, ConvertFrom-LkgJson, New-LkgRecord, Invoke-LkgDeployment
