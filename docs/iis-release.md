# IIS release pipeline

Pushing a protected version tag (`vMAJOR.MINOR.PATCH`) on a commit reachable from `main` validates the app, creates a framework-dependent IIS publish folder, embeds `build-metadata.json` with app/content commit IDs and the GitHub run ID, and packages it as `cv-online-presenter-<tag>.zip`. The workflow publishes that package in a GitHub Release and deploys the same validated artifact to the single Beebyte IIS environment.

## GitHub Environment

Create one GitHub Environment named `production`. Add protection rules or required reviewers there if deployment must be approved after a release tag is pushed.

Configure these **Environment variables**:

- `DEPLOY_SERVER_URL`: Beebyte Web Deploy hostname or HTTPS URL. The deployment uses HTTPS on port 8172 and the `msdeploy.axd` endpoint.
- `DEPLOY_SITE_NAME`: IIS site name supplied by Beebyte.
- `DEPLOY_CONTENT_PATH`: remote content path supplied by Beebyte.
- `DEPLOY_USERNAME`: Web Deploy user name.
- `DEPLOY_HEALTH_URL`: public HTTPS `/health` URL.

Configure this **Environment secret**:

- `DEPLOY_PASSWORD`: Web Deploy password.

No personal access token is required. GitHub supplies `GITHUB_TOKEN` for artifact and release operations. Store `DEPLOY_USERNAME` as an Environment secret instead if the account name is considered sensitive, and update the workflow reference from `vars` to `secrets`.

The hosted Windows runner installs Microsoft Web Deploy when needed, deploys with Basic authentication over HTTPS, enables the Web Deploy `AppOffline` rule, preserves `/.well-known`, and verifies that `/health` returns `{"status":"ok"}`. The Beebyte Web Deploy endpoint must present a certificate trusted by the hosted runner. Secret values are not included in the package or written by the deployment script.

The package targets .NET 10. Beebyte must have a compatible .NET 10 Hosting Bundle installed; it supplies the ASP.NET Core Module and runtime required by IIS. See Microsoft's [IIS publishing guide](https://learn.microsoft.com/en-us/aspnet/core/tutorials/publish-to-iis?view=aspnetcore-10.0).

Protect release tags and confirm the Beebyte endpoint, site name, content path, credentials, HTTPS URL, Web Deploy permissions, and .NET 10 runtime before pushing the first tag.
