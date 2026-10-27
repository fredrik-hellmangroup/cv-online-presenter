# Rollback exercise status

## Local artifact smoke check

The current versioned publish output was started from its published folder. `/health` returned `{"status":"ok"}`, the home route returned HTTP 200 with `lang="sv-SE"`, and `/build-metadata.json` reported the app and content revisions embedded in that artifact. This confirms the packaged app can report its release pair and answer a basic health check.

## IIS staging rollback

Not yet executed. The repository has no approved IIS host, deployment network, staging URL, site/app-pool names, or self-hosted IIS runner. The deploy and rollback scripts must be exercised against staging after OQ-05 is resolved; no IIS rollback result is claimed here.
