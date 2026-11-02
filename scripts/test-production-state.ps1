$ErrorActionPreference = 'Stop'
$modulePath = Join-Path $PSScriptRoot 'production-state.psm1'
Import-Module $modulePath -Force
$script:passed = 0
$script:failed = 0

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) {
        throw $Message
    }
}

function Assert-Throws([scriptblock]$Action, [string]$Contains) {
    try {
        & $Action
        throw "Expected exception containing '$Contains'."
    }
    catch {
        if ($_.Exception.Message -notlike "*$Contains*") {
            throw "Unexpected exception: $($_.Exception.Message)"
        }
    }
}

function Test-Case([string]$Name, [scriptblock]$Body) {
    try {
        & $Body
        $script:passed++
        Write-Host "PASS $Name"
    }
    catch {
        $script:failed++
        Write-Host "FAIL $Name :: $($_.Exception.Message)"
    }
}

function New-Artifact([string]$Path, [string]$Tag = 'v1.0.1') {
    $hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    return [PSCustomObject]@{
        sourceTag = $Tag
        commit = ('a' * 40)
        appRevision = ('a' * 40)
        contentRevision = ('b' * 40)
        buildId = '123'
        packageSha256 = $hash
        releaseTag = $Tag
        assetName = "cv-online-presenter-$Tag.zip"
    }
}

function New-TestState([string]$Path) {
    $artifact = New-Artifact $Path
    return New-LkgRecord `
        -Artifact $artifact `
        -VerifiedAtUtc '2026-01-01T00:00:00Z' `
        -Workflow 'release.yml' `
        -RunId '1' `
        -RunAttempt '1'
}

function New-Ops($State, $RollbackPath, [hashtable]$Flags = @{}) {
    $callLog = [System.Collections.Generic.List[string]]::new()
    $script:calls = $callLog

    return @{
        ReadState = {
            if ($Flags.badState) {
                throw 'malformed LKG'
            }
            return $State
        }.GetNewClosure()
        ResolveRollbackPackage = {
            param($artifact)
            if ($Flags.missingAsset) {
                throw 'asset unavailable'
            }
            return @{ path = $RollbackPath }
        }.GetNewClosure()
        ValidateCandidate = {
            param($candidate)
            if ($Flags.badCandidate) {
                throw 'candidate invalid'
            }
            $callLog.Add('validate')
        }.GetNewClosure()
        ArchiveCandidate = {
            param($candidate)
            $callLog.Add('archive')
            return [PSCustomObject]@{
                sourceTag = $null
                commit = $candidate.commit
                appRevision = $candidate.appRevision
                contentRevision = $candidate.contentRevision
                buildId = $candidate.buildId
                packageSha256 = $candidate.packageSha256
                releaseTag = 'recovery/manual-2-1'
                assetName = 'cv-online-presenter-manual-2-1.zip'
            }
        }.GetNewClosure()
        SyncCandidate = {
            param($candidate)
            $callLog.Add('syncCandidate')
            if ($Flags.syncFail) {
                throw 'sync failed'
            }
        }.GetNewClosure()
        VerifyCandidate = {
            param($candidate)
            $callLog.Add('verifyCandidate')
            if ($Flags.http503) {
                throw 'HTTP 503 persists at health check'
            }
            if ($Flags.healthFail) {
                throw 'health failed'
            }
            if ($Flags.metadataFail) {
                throw 'metadata mismatch'
            }
            if ($Flags.markerFail) {
                throw 'marker remains observable'
            }
        }.GetNewClosure()
        SyncRollback = {
            param($package, $artifact)
            $callLog.Add('syncRollback')
            if ($Flags.rollbackFail) {
                throw 'rollback sync failed'
            }
        }.GetNewClosure()
        VerifyRollback = {
            param($artifact)
            $callLog.Add('verifyRollback')
            if ($Flags.http503) {
                throw 'persistent HTTP 503 after restoration'
            }
            if ($Flags.rollbackMarkerFail) {
                throw 'restored app_offline marker remains observable'
            }
            if ($Flags.rollbackVerifyFail) {
                throw 'restoration verification failed'
            }
        }.GetNewClosure()
        WriteState = {
            param($candidate)
            $callLog.Add('writeState')
            if ($Flags.stateFail) {
                throw 'push rejected'
            }
            return New-LkgRecord `
                -Artifact $candidate `
                -VerifiedAtUtc '2026-01-02T00:00:00Z' `
                -Workflow 'test' `
                -RunId '2' `
                -RunAttempt '1'
        }.GetNewClosure()
    }
}

$temp = Join-Path ([IO.Path]::GetTempPath()) "issue56-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $temp | Out-Null
try {
    $rollbackPath = Join-Path $temp 'prior.zip'
    [IO.File]::WriteAllText($rollbackPath, 'prior immutable bytes')
    $candidatePath = Join-Path $temp 'candidate.zip'
    [IO.File]::WriteAllText($candidatePath, 'candidate bytes')
    $state = New-TestState $rollbackPath
    $candidate = New-Artifact $candidatePath 'v1.0.2'

    Test-Case 'successful candidate verified then LKG updated' {
        $ops = New-Ops $state $rollbackPath
        $result = Invoke-LkgDeployment $ops $candidate
        Assert-True ($result.Status -eq 'DeployedAndRecorded') 'wrong result'
        Assert-True ($script:calls[-1] -eq 'writeState') 'state write must be last'
    }
    Test-Case 'sync failure gets exactly one rollback' {
        $ops = New-Ops $state $rollbackPath @{ syncFail = $true }
        Assert-Throws { Invoke-LkgDeployment $ops $candidate } 'single rollback attempt restored'
        Assert-True (($script:calls | Where-Object { $_ -eq 'syncRollback' }).Count -eq 1) 'rollback count was not one'
        Assert-True (-not ($script:calls -contains 'writeState')) 'LKG updated after failed candidate'
    }
    Test-Case 'health failure gets one rollback' {
        $ops = New-Ops $state $rollbackPath @{ healthFail = $true }
        Assert-Throws { Invoke-LkgDeployment $ops $candidate } 'health failed'
        Assert-True (($script:calls | Where-Object { $_ -eq 'syncRollback' }).Count -eq 1) 'rollback count was not one'
    }
    Test-Case 'metadata mismatch gets one rollback' {
        $ops = New-Ops $state $rollbackPath @{ metadataFail = $true }
        Assert-Throws { Invoke-LkgDeployment $ops $candidate } 'metadata mismatch'
        Assert-True (($script:calls | Where-Object { $_ -eq 'syncRollback' }).Count -eq 1) 'rollback count was not one'
    }
    Test-Case 'rollback failure reports both causes and never retries' {
        $ops = New-Ops $state $rollbackPath @{ syncFail = $true; rollbackFail = $true }
        Assert-Throws { Invoke-LkgDeployment $ops $candidate } 'rollback sync failed'
        Assert-True (($script:calls | Where-Object { $_ -eq 'syncRollback' }).Count -eq 1) 'second rollback attempted'
    }
    Test-Case 'restoration marker verification failure is a recovery failure' {
        $ops = New-Ops $state $rollbackPath @{ syncFail = $true; rollbackMarkerFail = $true }
        Assert-Throws { Invoke-LkgDeployment $ops $candidate } 'restored app_offline marker remains observable'
        Assert-True (($script:calls | Where-Object { $_ -eq 'syncRollback' }).Count -eq 1) 'second rollback attempted'
    }
    Test-Case 'candidate cleanup marker failure starts bounded rollback' {
        $ops = New-Ops $state $rollbackPath @{ markerFail = $true }
        Assert-Throws { Invoke-LkgDeployment $ops $candidate } 'marker remains observable'
        Assert-True (($script:calls | Where-Object { $_ -eq 'syncRollback' }).Count -eq 1) 'rollback missing'
    }
    Test-Case 'unavailable LKG fails before any sync' {
        $ops = New-Ops $state $rollbackPath
        $ops.ReadState = { throw 'LKG branch record unavailable' }
        Assert-Throws { Invoke-LkgDeployment $ops $candidate } 'record unavailable'
        Assert-True (-not ($script:calls -contains 'syncCandidate')) 'candidate synced'
    }
    Test-Case 'malformed LKG fails before any sync' {
        $ops = New-Ops $state $rollbackPath @{ badState = $true }
        Assert-Throws { Invoke-LkgDeployment $ops $candidate } 'malformed LKG'
        Assert-True (-not ($script:calls -contains 'syncCandidate')) 'candidate synced'
    }
    Test-Case 'unavailable rollback asset fails closed' {
        $ops = New-Ops $state $rollbackPath @{ missingAsset = $true }
        Assert-Throws { Invoke-LkgDeployment $ops $candidate } 'asset unavailable'
        Assert-True (-not ($script:calls -contains 'syncCandidate')) 'candidate synced'
    }
    Test-Case 'digest mismatch fails closed before sync' {
        $ops = New-Ops $state $rollbackPath
        $expected = $state.artifact.packageSha256
        $state.artifact.packageSha256 = '0' * 64
        Assert-Throws { Invoke-LkgDeployment $ops $candidate } 'do not match'
        Assert-True (-not ($script:calls -contains 'syncCandidate')) 'candidate synced'
        $state.artifact.packageSha256 = $expected
    }
    Test-Case 'manual rollback is recorded as newly live artifact' {
        $ops = New-Ops $state $rollbackPath
        $result = Invoke-LkgDeployment $ops $state.artifact
        Assert-True ($result.Record.artifact.releaseTag -eq $state.artifact.releaseTag) 'rollback artifact was not candidate LKG'
    }
    Test-Case 'manual-main LKG has nullable source tag and recovery locator' {
        $manual = [PSCustomObject]@{
            sourceTag = $null
            commit = 'c' * 40
            appRevision = 'c' * 40
            contentRevision = 'd' * 40
            buildId = '88'
            packageSha256 = $candidate.packageSha256
            releaseTag = 'recovery/manual-88-1'
            assetName = 'cv-online-presenter-manual-88-1.zip'
        }
        $record = New-LkgRecord `
            -Artifact $manual `
            -VerifiedAtUtc '2026-01-03T00:00:00Z' `
            -Workflow 'MSDeploy experiment' `
            -RunId '88' `
            -RunAttempt '1'
        Assert-True ($null -eq $record.artifact.sourceTag) 'manual-main source tag must be null'
        Assert-True ($record.artifact.releaseTag -eq $manual.releaseTag) 'recovery locator missing'
    }
    Test-Case 'manual-main archive precedes deployment and record update' {
        $ops = New-Ops $state $rollbackPath
        $result = Invoke-LkgDeployment $ops $candidate -ArchiveCandidateBeforeDeploy
        Assert-True ($script:calls.IndexOf('archive') -lt $script:calls.IndexOf('syncCandidate')) 'archive was not before deploy'
        Assert-True ($script:calls[-1] -eq 'writeState') 'record not updated'
        Assert-True ($null -eq $result.Record.artifact.sourceTag) 'manual-main source tag is not null'
        Assert-True ($result.Record.artifact.releaseTag -eq 'recovery/manual-2-1') 'manual archive locator was not recorded'
    }
    Test-Case 'manual-main deployment failure does not update LKG' {
        $ops = New-Ops $state $rollbackPath @{ syncFail = $true }
        Assert-Throws { Invoke-LkgDeployment $ops $candidate -ArchiveCandidateBeforeDeploy } 'sync failed'
        Assert-True (-not ($script:calls -contains 'writeState')) 'LKG updated after failed manual-main deploy'
    }
    Test-Case 'archive callback required for manual-main' {
        $ops = New-Ops $state $rollbackPath
        $ops.Remove('ArchiveCandidate')
        Assert-Throws { Invoke-LkgDeployment $ops $candidate -ArchiveCandidateBeforeDeploy } 'archive operation'
    }
    Test-Case 'persistent 503 is surfaced for provider escalation without app-pool operation' {
        $ops = New-Ops $state $rollbackPath @{ http503 = $true }
        Assert-Throws { Invoke-LkgDeployment $ops $candidate } 'operator/provider escalation'
        Assert-True ($script:calls -contains 'syncRollback') 'bounded rollback not attempted'
        Assert-True (-not ($script:calls -contains 'restartPool')) 'app pool was touched'
    }
    Test-Case 'state write occurs only after successful candidate verification' {
        $ops = New-Ops $state $rollbackPath @{ stateFail = $true }
        Assert-Throws { Invoke-LkgDeployment $ops $candidate } 'LKG write failed'
        Assert-True ($script:calls.IndexOf('verifyCandidate') -lt $script:calls.IndexOf('writeState')) 'state write preceded verification'
        Assert-True (-not ($script:calls -contains 'syncRollback')) 'state failure triggered rollback'
    }
    Test-Case 'ambiguous state write fails distinctly and asks reconciliation' {
        $ops = New-Ops $state $rollbackPath @{ stateFail = $true }
        Assert-Throws { Invoke-LkgDeployment $ops $candidate } 'Reconciliation is required'
    }
    Test-Case 'malformed required record fields rejected' {
        $broken = [PSCustomObject]@{ schemaVersion = 1 }
        Assert-Throws { Assert-LkgRecord $broken } 'artifact'
    }
    Test-Case 'missing package bytes rejected' {
        Assert-Throws { Assert-PackageSha256 (Join-Path $temp 'absent.zip') ('a' * 64) } 'unavailable'
    }
    Test-Case 'package digest mismatch rejected' {
        Assert-Throws { Assert-PackageSha256 $candidatePath ('a' * 64) } 'do not match'
    }
    Test-Case 'release and manual workflows use bounded deployment with isolated permissions' {
        $repoRoot = Split-Path -Parent $PSScriptRoot
        foreach ($workflow in @('release.yml', 'msdeploy-experiment.yml')) {
            $text = Get-Content -LiteralPath (Join-Path $repoRoot ".github/workflows/$workflow") -Raw
            Assert-True ($text.Contains('group: production-deployment')) "$workflow lacks shared production concurrency"
            Assert-True ($text.Contains('ref: production-state')) "$workflow does not read durable production state"
            Assert-True ($text.Contains('record-state:')) "$workflow lacks isolated LKG write job"
            Assert-True ($text.Contains('contents: read')) "$workflow lacks read-only default permissions"
            Assert-True ($text.Contains('run-production-deployment.ps1')) "$workflow bypasses bounded recovery orchestration"
            Assert-True ($text.Contains('package_sha256')) "$workflow does not pass package-job digest"
        }
        $release = Get-Content -LiteralPath (Join-Path $repoRoot '.github/workflows/release.yml') -Raw
        Assert-True ($release.Contains('tags: ["v*.*.*"]')) 'automatic v*.*.* release trigger changed'
        Assert-True ($release.IndexOf('publish-release:') -lt $release.IndexOf('deploy:')) 'release publication must precede deployment'
        Assert-True ($release.Contains('contents: read') -and $release.Contains('contents: write')) 'release write scope is not isolated'

        $manual = Get-Content -LiteralPath (Join-Path $repoRoot '.github/workflows/msdeploy-experiment.yml') -Raw
        Assert-True ($manual.Contains('archive_manual_recovery:')) 'manual-main recovery publication is not isolated'
        Assert-True ($manual.Contains('--target $env:SOURCE_COMMIT')) 'manual recovery tag does not point to the packaged source commit'
        Assert-True ($manual.Contains('recovery/manual-')) 'manual recovery prefix is missing'
        Assert-True (-not $manual.Contains('tags: ["recovery/**"]')) 'recovery tags must not trigger automatic deployment'

        $runner = Get-Content -LiteralPath (Join-Path $repoRoot 'scripts/run-production-deployment.ps1') -Raw
        Assert-True ($runner.Contains('ExpectedPackageSha256')) 'deployment runner does not accept a package-job digest'
        Assert-True ($runner.Contains('$published.digest -cne $ExpectedPackageSha256.ToLowerInvariant()')) 'release package digest is not compared with the package-job digest'
        Assert-True ($runner.Contains('Assert-PackageSha256 -Path $resolvedPackagePath -ExpectedSha256 $ExpectedPackageSha256')) 'manual package bytes are not bound to the package-job digest'
    }
}
finally {
    Remove-Item -LiteralPath $temp -Recurse -Force
}

Write-Host "Summary: $script:passed passed; $script:failed failed"
if ($script:failed -gt 0) {
    exit 1
}
