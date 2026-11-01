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

The hosted Windows runner uses `curl` to upload the package over explicit FTPS with normal certificate and hostname validation. The script uploads `app_offline.htm` first, creates required directories through `curl --ftp-create-dirs`, uploads package files, removes `app_offline.htm`, preserves existing files such as `/.well-known`, and verifies that `/health` returns `{"status":"ok"}`. FTP deployment is not atomic; if an upload fails, the site may remain offline and the previous immutable GitHub Release package should be redeployed.

The package targets .NET 10. Beebyte must have a compatible .NET 10 Hosting Bundle installed; it supplies the ASP.NET Core Module and runtime required by IIS. See Microsoft's [IIS publishing guide](https://learn.microsoft.com/en-us/aspnet/core/tutorials/publish-to-iis?view=aspnetcore-10.0).

Protect release tags and confirm the Beebyte FTP hostname, FTPS access, content path, credentials, HTTPS URL, and .NET 10 runtime before pushing a release tag.

## Manual MSDeploy experiment

The tag-driven FTPS release remains the normal production path until MSDeploy has passed a live deployment and rollback exercise. A separate **MSDeploy experiment** workflow can be started manually from `main`; it does not create a GitHub Release and never falls back to FTPS automatically. The workflow requires the `confirm_production` input, uses a dedicated `production-msdeploy` Environment restricted to `main`, and shares the `production-deployment` concurrency group with FTPS so the transports cannot run at the same time.

Copy `DEPLOY_CONTENT_PATH`, `DEPLOY_USERNAME`, `DEPLOY_PASSWORD`, and `DEPLOY_HEALTH_URL` from the FTPS production configuration into `production-msdeploy`. Configure these additional **Environment variables** there:

- `MSDEPLOY_SERVER_URL`: HTTPS WMSvc endpoint or hostname. Port 8172 is used when no port is specified.
- `MSDEPLOY_SITE_NAME`: IIS site name used in the `msdeploy.axd` query.
- `MSDEPLOY_CERTIFICATE_SHA256`: SHA-256 fingerprint for the exact WMSvc certificate.

The hosted runner uses the preinstalled Microsoft Web Deploy client when it matches the expected Microsoft-signed version. If it is absent, the runner downloads the official Microsoft MSI, verifies its pinned SHA-256 digest and Microsoft Authenticode signature, installs it, and then verifies the installed executable and assembly before the password is made available to the deployment step.

The runner verifies the remote certificate fingerprint before credentials are used, maps the certificate's internal DNS name to the verified endpoint address, and temporarily trusts only that pinned certificate in the runner's machine root store. The deployment uses the `Microsoft.Web.Deployment` managed API so the password is not placed in process arguments. MSDeploy then performs normal TLS validation; `-allowUntrusted` is not used.

Before synchronization, the AppOffline rule serves the self-contained branded `deployment/app_offline.htm` template. The template has inline styles and no application or third-party dependencies. MSDeploy removes it when synchronization finishes. Destination-only files are preserved with `DoNotDelete`, and `.well-known` is explicitly skipped. Temporary trust and hosts-file changes are removed after the attempt.

After the site comes online, the workflow requires both `/health` and `/build-metadata.json` to match the exact deployed artifact. A failed verification is a failed deployment and must be followed by an explicit rollback; it never triggers FTPS automatically.

For rollback, set `rollback_release_tag` to an existing `vMAJOR.MINOR.PATCH` GitHub Release. The workflow requires the selected asset to expose a GitHub SHA-256 digest, verifies the downloaded bytes against it, and sends that immutable package through the same MSDeploy, offline, health, and metadata checks as a current-`main` deployment. Leave `rollback_release_tag` empty to build and deploy the selected `main` commit. This remains an experimental path until both a live deployment and an immutable-package rollback have succeeded. Keep FTPS available as a separately invoked recovery path during the transition.
