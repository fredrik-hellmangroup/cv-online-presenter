# Rollback exercise status

## Local artifact smoke check

The current versioned publish output was started from its published folder. `/health` returned `{"status":"ok"}`, the home route returned HTTP 200 with `lang="sv-SE"`, and `/build-metadata.json` reported the app and content revisions embedded in that artifact. This confirms the packaged app can report its release pair and answer a basic health check.

## Beebyte MSDeploy rollback

A live MSDeploy and rollback exercise was completed on 2026-11-01 from an authorized Windows machine using the same managed helper as the manual GitHub Actions workflow.

1. A publish artifact for app revision `bd9a3027cd66e567979ddaa9781a88dfe008ca17` and content revision `9e32d6e99aec9193977da885c05f44c43e0363e1` was deployed through WMSvc.
2. `/health` passed and `/build-metadata.json` matched that exact artifact.
3. The GitHub Release asset `cv-online-presenter-v1.0.8.zip` was downloaded and verified against its GitHub SHA-256 digest before rollback.
4. The immutable rollback artifact was deployed through the same MSDeploy path. Health passed and live metadata returned app `8aef6be8cd5ea3ef6cfb55029dbd212557f08cf2`, content `9e32d6e99aec9193977da885c05f44c43e0363e1`, and build `41249254314`.
5. A byte-identical timestamp-only probe forced one additional file update. A persistent HTTP monitor captured the branded maintenance HTML during the resulting 503 AppOffline window. The original digest-verified `v1.0.8` artifact was then redeployed to restore the release timestamp.
6. `/`, `/cv`, `/projects`, and `/health` returned HTTP 200 afterward. The active offline file was gone, the persistent template under `App_Data` returned 404 publicly, and temporary certificate trust was absent.

The exercise established that Beebyte's WMSvc `contentPath` is the IIS site name `hellmangroup.se`; the FTPS-only `httpdocs` path is not valid for Web Deploy. Production was intentionally left on `v1.0.8` after the exercise.

## Primary workflow promotion

After the live exercise, a second local cycle deployed app revision `765748441169aef8523496e6d7ec01bfe79c22f3`, captured the branded AppOffline response, verified health and exact metadata, and then restored the digest-verified `v1.0.8` package through the same helper. Health and metadata passed again after rollback.

Before promotion, destination cleanup was hardened so stale release files are deleted instead of preserved. A new remote `WhatIf` reported 106 updates and 12 deletions. The corresponding live synchronization completed with the same counts, exact current-artifact metadata passed, and the hardened rollback completed with 106 updates and 2 deletions. Final health and exact `v1.0.8` metadata passed, temporary certificate trust was absent, and production was again left on `v1.0.8`.

MSDeploy was then promoted to the tag-driven primary release workflow; the manual workflow remains the immutable-package rollback path and FTPS remains break-glass only.
