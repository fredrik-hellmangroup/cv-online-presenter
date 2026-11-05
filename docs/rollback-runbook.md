# Beebyte rollback runbook

Last updated: 2026-11-03

Production rollback is a forward fix: revert the change on `main` and release a new version through the normal tag workflow. In addition, one bounded automatic recovery attempt restores the last-known-good package if a candidate sync or post-sync verification fails. There is no manual recovery or redeploy workflow. No local-filesystem/app-pool rollback script is used on the shared Beebyte host because it requires access to the local filesystem and app pool, which Beebyte does not provide.

```mermaid
flowchart LR
    A["Release tag"] --> C["Validate candidate and LKG digests"]
    C --> D["Deploy through Web Deploy"]
    D --> E{"Health, exact metadata, marker absent?"}
    E -->|yes| F(["Write verified live artifact to LKG"])
    E -->|no| R["One rollback attempt from prior LKG"]
    R --> V{"Restored health, exact metadata, marker absent?"}
    V -->|yes| X(["Candidate run fails; prior LKG retained"])
    V -->|no| G(["Report both failures; operator/provider escalation"])
```

## Rolling back a bad release

1. Confirm the protected `production-state` branch has a valid `lkg-v1.json` and that its exact recorded immutable package is available. The workflow validates this prior LKG before any sync; never select a rollback based on tag ordering or `latest`.
2. Revert the offending change on `main` through a normal pull request and cut a new release tag. The release workflow builds, publishes and deploys it like any other release.
3. `/health`, exact live `/build-metadata.json`, and the active root marker check must pass before the new artifact is recorded as the live LKG using a non-force state-branch update.

## Reconciling a pending deployment

If a run leaves `pending-v1.json` on `production-state` (failed or ambiguous rollback, or a failed final state write), every later release fails closed before sync. Reconcile it manually:

1. Check what is actually live: `/health` and `/build-metadata.json` on the production site.
2. If the previous LKG is live, delete `pending-v1.json` from `production-state` with a normal commit.
3. If a candidate release is live and healthy, update `lkg-v1.json` to that release (tag, asset, digest, metadata) and delete `pending-v1.json` in the same commit.
4. If production is unhealthy, escalate to the operator/provider first (see below), then reconcile.

Do not rebuild an old source tag when its release package exists. Never run FTPS automatically after an MSDeploy failure. The FTPS helper is break-glass only, for when WMSvc itself is unavailable. If you use it, record the exception and verify health, exact metadata, and offline-marker absence after restoration.

On a candidate sync, health, metadata, or marker-verification failure, the workflow makes exactly one sync to the prior LKG package and verifies health, exact metadata, and marker absence. It still reports the candidate run as failed. If restoration fails, both the original and recovery errors are reported and there is no retry. Do not manually remove a marker through unsupported APIs. Persistent HTTP 503 is operator/provider escalation; no app-pool restart is done by the workflows. The v1.0.10 incident showed an immutable redeploy may not recover a persistent 503.

## Durable LKG and failure limits

`production-state` is a dedicated branch containing the versioned `lkg-v1.json` record. It describes the artifact actually verified live, not the latest published tag. Record fields are: source tag, source commit, app/content/build metadata, package SHA-256, exact immutable release tag and asset name, workflow/run/attempt evidence, UTC verification time, and health/metadata/marker evidence. No fallback to `latest`, tag order, rebuilding, or a short-retention Actions artifact is permitted.

Before the release workflow syncs, it reads and validates the LKG record, downloads that exact GitHub Release asset, compares the GitHub-published digest with downloaded bytes and the record, and checks embedded metadata. Any missing/malformed record, unavailable asset, digest mismatch, or metadata mismatch fails closed. Bootstrap the protected branch from independently verified current production deployment evidence before enabling the deployment workflow.
After candidate and prior LKG package identities are validated, but before the first production sync, the workflow commits `pending-v1.json` to `production-state` while preserving `lkg-v1.json`. The non-force push is a compare-and-swap; a failed/ambiguous pending write prevents any production mutation. On successful candidate verification, one non-force state commit replaces LKG and clears pending. After automatic rollback succeeds and live health, exact metadata, and marker absence are verified, a non-force commit clears pending while retaining the old LKG. Failed/ambiguous rollback or final state update leaves pending in place. Subsequent release deployments fail closed before sync while pending exists and require the manual reconciliation above. GitHub branch state and IIS cannot be changed atomically; ambiguous outcomes require operator reconciliation. The writer token is supplied only to the workflow deployment step, removed from the child MSDeploy process, and state updates use non-force pushes.

Cleanup is limited to the existing Web Deploy ContentPath/AppOffline lifecycle. There is no established remote marker delete/readback API, so the workflow does not claim or attempt separate deletion; after restored health and metadata pass, it checks `/app_offline.htm` for the offline marker. It does not use a `finally` cleanup. Runner loss, network interruption, or WMSvc interruption can prevent restoration or confirmation. No unconditional recovery/cleanup guarantee is possible. `App_Data` and `.well-known` are preserved by the existing sync exclusions. No app-pool restart is attempted.

## Release notes

The tag workflow generates notes with commit summaries, content revision, migration review status, build provenance, and the previous release rollback reference. Review content and migration details before deployment. The first live rollback must run in an approved maintenance window before rollback readiness is claimed.
