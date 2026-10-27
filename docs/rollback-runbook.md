# IIS rollback runbook

Rollback selects an already published release folder. It does not restore source code, rebuild the app, or resolve a new content revision. Each folder retains the exact `wwwroot/build-metadata.json` generated for its app/content pair.

## Manual rollback

Run this on the configured self-hosted IIS runner or IIS host from an elevated PowerShell session. Replace the example values with the approved `staging` Environment settings and a release ID already present under `IIS_STAGING_ROOT\releases`:

```powershell
./scripts/rollback-iis.ps1 `
  -DeploymentRoot 'D:\sites\cv-online-presenter' `
  -SiteName 'cv-online-presenter-staging' `
  -AppPoolName 'cv-online-presenter-staging' `
  -HealthUrl 'https://staging.example.invalid/health' `
  -ReleaseId 'v1.0.0'
```

The script switches the IIS physical path to the selected existing release, restarts the app pool, and checks `/health`. If that check fails, it restores the path that was active before the rollback, restarts the pool, and checks health again. It prints only the release ID and app/content revisions; it does not log request data, personal data, or secrets.

## Release notes

The tag workflow generates notes containing commit summaries, content revision, migration review status, build provenance, and the previous release rollback reference. Review content changes and fill in migration details before production promotion. The staging pipeline is not enabled until the IIS environment is approved and configured.
