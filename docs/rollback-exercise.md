# Rollback exercise status

## Local artifact smoke check

The current versioned publish output was started from its published folder. `/health` returned `{"status":"ok"}`, the home route returned HTTP 200 with `lang="sv-SE"`, and `/build-metadata.json` reported the app and content revisions embedded in that artifact. This confirms the packaged app can report its release pair and answer a basic health check.

## Beebyte IIS rollback

Not yet executed. The remote Web Deploy target, production URL, credentials, and .NET 10 Hosting Bundle must be configured and verified first. The previous immutable GitHub Release package must then be redeployed and checked in an approved maintenance window; no live rollback result is claimed here.
