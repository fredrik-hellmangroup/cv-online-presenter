# Beebyte release pipeline

Pushing a protected version tag (`vMAJOR.MINOR.PATCH`) on a commit reachable from `main` validates the app, creates a framework-dependent publish folder, embeds `build-metadata.json` with app/content commit IDs and the GitHub run ID, and packages it as `cv-online-presenter-<tag>.zip`. The workflow publishes that package in a GitHub Release and deploys the same validated artifact to the single Beebyte IIS site through MSDeploy/WMSvc.

## GitHub Environment

The primary release and manual rollback workflows use the GitHub Environment named `production-msdeploy`. Its deployment branch policies allow `main` for manual rollback and protected `v*.*.*` tags for normal releases. Add required reviewers there if deployment must be approved.

Configure these **Environment variables**:

- `MSDEPLOY_SERVER_URL`: HTTPS WMSvc endpoint or hostname. Port 8172 is used when no port is specified.
- `MSDEPLOY_SITE_NAME`: IIS site name used in the `msdeploy.axd` query.
- `MSDEPLOY_CONTENT_PATH`: Web Deploy provider path. For Beebyte this is the IIS site name, `hellmangroup.se`, not the FTPS directory `httpdocs`.
- `MSDEPLOY_CERTIFICATE_SHA256`: SHA-256 fingerprint for the exact WMSvc certificate.
- `DEPLOY_USERNAME`: Beebyte deployment user name.
- `DEPLOY_HEALTH_URL`: canonical public HTTPS `/health` URL.

Configure this **Environment secret**:

- `DEPLOY_PASSWORD`: Beebyte deployment password.

No personal access token is required. GitHub supplies `GITHUB_TOKEN` for artifact and release operations. Store `DEPLOY_USERNAME` as an Environment secret instead if the account name is considered sensitive, and update the workflow reference from `vars` to `secrets`.

The package targets .NET 10. Beebyte must have a compatible .NET 10 Hosting Bundle installed; it supplies the ASP.NET Core Module and runtime required by IIS. See Microsoft's [IIS publishing guide](https://learn.microsoft.com/en-us/aspnet/core/tutorials/publish-to-iis?view=aspnetcore-10.0).

Protect release tags and confirm WMSvc access, IIS site/provider path, certificate pin, credentials, canonical HTTPS URL, and .NET 10 runtime before pushing a release tag.

## MSDeploy release and rollback

The tag-driven release is the primary production MSDeploy path. The separate **MSDeploy experiment** workflow remains available from `main` for an explicit redeployment or immutable-release rollback. It does not create a new GitHub Release, requires `confirm_production`, and uses the same `production-msdeploy` Environment and `production-deployment` concurrency group as normal releases. Neither workflow falls back to FTPS automatically.

Both workflows call the shared `scripts/ensure-webdeploy.ps1` helper. It uses the preinstalled Microsoft Web Deploy client when it matches the expected Microsoft-signed version. If it is absent, the helper downloads the official Microsoft MSI, verifies its pinned SHA-256 digest and Microsoft Authenticode signature, installs it, and then verifies the installed executable and assembly before the password is made available to the deployment step.

The runner verifies the remote certificate fingerprint before credentials are used and temporarily trusts only that pinned certificate in the runner's machine root store. Beebyte exposes WMSvc by IP while its self-signed certificate contains only an internal DNS name, so the actual MSDeploy session permits only that expected hostname mismatch. Certificate chain errors and every non-pinned certificate remain rejected. The deployment uses the `Microsoft.Web.Deployment` managed API so the password is not placed in process arguments; `-allowUntrusted` is not used.

Before the main synchronization, the helper bootstraps the self-contained branded `deployment/app_offline.htm` file to the non-public destination path `App_Data/app_offline.template.htm`. The AppOffline rule then uses that destination-relative template while the application is stopped and removes only the active root `app_offline.htm` when synchronization finishes. The template has inline styles and no application or third-party dependencies. The main sync deletes stale destination-only release files so rollback cannot leave newer binaries or endpoints behind; only `.well-known` is explicitly preserved. The non-public offline template is bootstrapped before every synchronization and may be removed with other destination-only files afterward. Temporary certificate trust and the process-wide pin callback are removed after the attempt.

After the site comes online, the workflow requires both `/health` and `/build-metadata.json` to match the exact deployed artifact. A failed verification is a failed deployment and must be followed by an explicit rollback; it never triggers FTPS automatically.

For rollback, set `rollback_release_tag` to an existing `vMAJOR.MINOR.PATCH` GitHub Release. The workflow requires the selected asset to expose a GitHub SHA-256 digest, verifies the downloaded bytes against it, and sends that immutable package through the same MSDeploy, offline, health, and metadata checks as a normal release. Leave `rollback_release_tag` empty only for an intentional manual redeployment of the selected `main` commit. The legacy FTPS helper remains a separately invoked break-glass recovery option if WMSvc itself is unavailable.
