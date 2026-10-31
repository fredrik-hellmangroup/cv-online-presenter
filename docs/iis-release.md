# Beebyte release pipeline

Pushing a protected version tag (`vMAJOR.MINOR.PATCH`) on a commit reachable from `main` validates the app, creates a framework-dependent publish folder, embeds `build-metadata.json` with app/content commit IDs and the GitHub run ID, and packages it as `cv-online-presenter-<tag>.zip`. The workflow publishes that package in a GitHub Release and uploads the same validated artifact to the single Beebyte site over explicit FTPS.

## GitHub Environment

Create one GitHub Environment named `production`. Add protection rules or required reviewers there if deployment must be approved after a release tag is pushed.

Configure these **Environment variables**:

- `DEPLOY_SERVER_URL`: FTP hostname only, currently `shww-0121.s.beebyte.se`. The workflow uses explicit FTPS on port 21.
- `DEPLOY_CONTENT_PATH`: FTP path relative to the account root, currently `httpdocs`.
- `DEPLOY_USERNAME`: FTP user name. The current Beebyte account is reused.
- `DEPLOY_HEALTH_URL`: public HTTPS `/health` URL.

Configure this **Environment secret**:

- `DEPLOY_PASSWORD`: FTP password. The current Beebyte password is reused.

No personal access token is required. GitHub supplies `GITHUB_TOKEN` for artifact and release operations. Store `DEPLOY_USERNAME` as an Environment secret instead if the account name is considered sensitive, and update the workflow reference from `vars` to `secrets`.

The hosted Windows runner uploads the package over explicit FTPS with normal certificate and hostname validation. The script uploads `app_offline.htm` first, creates required directories, uploads package files, removes `app_offline.htm`, preserves existing files such as `/.well-known`, and verifies that `/health` returns `{"status":"ok"}`. FTP deployment is not atomic; if an upload fails, the site may remain offline and the previous immutable GitHub Release package should be redeployed.

The package targets .NET 10. Beebyte must have a compatible .NET 10 Hosting Bundle installed; it supplies the ASP.NET Core Module and runtime required by IIS. See Microsoft's [IIS publishing guide](https://learn.microsoft.com/en-us/aspnet/core/tutorials/publish-to-iis?view=aspnetcore-10.0).

Protect release tags and confirm the Beebyte FTP hostname, FTPS access, content path, credentials, HTTPS URL, and .NET 10 runtime before pushing a release tag.
