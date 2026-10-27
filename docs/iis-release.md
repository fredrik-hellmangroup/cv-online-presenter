# IIS release pipeline

Pushing a protected version tag (`vMAJOR.MINOR.PATCH`) creates a self-contained publish folder, embeds `build-metadata.json` with app/content commit IDs and the GitHub run ID, packages it as `cv-online-presenter-<tag>.zip`, and attaches it to a GitHub Release. The package contains no deployment secrets.

## Staging activation

The staging deploy job runs only when repository variable `IIS_STAGING_ENABLED` is `true` and a self-hosted runner labeled `iis-staging` is available. Configure these variables in the `staging` GitHub Environment after the target IIS host, network, HTTPS URL, IIS site, and app pool are approved:

- `IIS_STAGING_ROOT`
- `IIS_STAGING_SITE`
- `IIS_STAGING_APP_POOL`
- `IIS_STAGING_HEALTH_URL` (HTTPS `/health` endpoint)

The runner needs only read access to the release artifact and local rights to switch the selected IIS site's physical path and restart its app pool. The deployment script retains the old physical path and restores it if the health check fails. `health-check.ps1` accepts only HTTPS and checks the minimal `{"status":"ok"}` response; it exposes no diagnostics.

The package is framework-dependent and targets .NET 10. The IIS host must have a compatible .NET 10 Hosting Bundle installed before deployment; the bundle supplies the ASP.NET Core Module and runtime required by IIS. See Microsoft's [IIS publishing guide](https://learn.microsoft.com/en-us/aspnet/core/tutorials/publish-to-iis?view=aspnetcore-10.0).

The app sends `noindex` for non-production environments. Protect `v*.*.*` release tags and configure the `staging` Environment before enabling the job. TLS termination, staging authentication, the production domain, and production deployment remain environment configuration and are not inferred by this workflow.
