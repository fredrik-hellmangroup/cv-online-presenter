# Beebyte rollback runbook

The Beebyte deployment synchronizes a versioned GitHub Release package to the remote IIS content path. It does not have the local filesystem and app-pool access required by the legacy `rollback-iis.ps1` script.

## Manual rollback

1. Download the previous `cv-online-presenter-<tag>.zip` from GitHub Releases.
2. Extract it to a clean local folder.
3. Use an authorized Windows machine with PowerShell and network access to Beebyte explicit FTPS.
4. Run `scripts/deploy-beebyte-ftp.ps1` with the same Beebyte FTP target values configured in the `production` GitHub Environment and the extracted folder as `SourcePath`.
5. Run `scripts/health-check.ps1` against the configured HTTPS `/health` URL.
6. Verify `build-metadata.json` reports the expected app/content revision pair.

Do not rebuild an old source tag for rollback when its immutable release package is available. The FTP script uses a temporary `app_offline.htm` during upload and preserves existing files outside the selected package, including `/.well-known`. FTP deployment is not atomic; verify `/health` after the upload and repeat the rollback if the site remains offline.

## Release notes

The tag workflow generates notes containing commit summaries, content revision, migration review status, build provenance, and the previous release rollback reference. Review content changes and migration details before deployment. The first live rollback must be exercised in an approved maintenance window before rollback readiness is claimed.
