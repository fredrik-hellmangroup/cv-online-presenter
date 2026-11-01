# Beebyte rollback runbook

The Beebyte deployment synchronizes a versioned GitHub Release package to the remote IIS content path. It does not have the local filesystem and app-pool access required by the legacy `rollback-iis.ps1` script.

## MSDeploy rollback

1. Choose the previous immutable `cv-online-presenter-<tag>.zip` from GitHub Releases.
2. Start the **MSDeploy experiment** workflow from `main`; the tag-driven release workflow already uses MSDeploy as its primary deployment transport.
3. Enable `confirm_production` and enter the existing semantic tag in `rollback_release_tag`.
4. The workflow confirms that the release tag resolves to a commit reachable from `main`, downloads the package without rebuilding it, verifies it against the asset's GitHub SHA-256 digest, and uses the same branded AppOffline and MSDeploy path as a current deployment. Stale destination-only release files are deleted; only `.well-known` is preserved. The offline template is bootstrapped before each synchronization.
5. The workflow must pass `/health` and compare live `/build-metadata.json` with the metadata inside the rollback artifact.
6. Record the successful rollback tag and metadata in the release incident or exercise log.

An authorized Windows machine can run the same flow locally by extracting the immutable package and invoking `scripts/deploy-beebyte-iis.ps1` with the `production-msdeploy` target values, `deployment/app_offline.htm`, and the extracted folder as `SourcePath`. Then run `scripts/health-check.ps1` and `scripts/verify-build-metadata.ps1`.

Do not rebuild an old source tag when its immutable release package is available. Never run FTPS automatically after an MSDeploy failure. The existing FTPS helper remains a separately invoked break-glass recovery path only if WMSvc itself is unavailable; document that exception and verify health and metadata afterward.

## Release notes

The tag workflow generates notes containing commit summaries, content revision, migration review status, build provenance, and the previous release rollback reference. Review content changes and migration details before deployment. The first live rollback must be exercised in an approved maintenance window before rollback readiness is claimed.
