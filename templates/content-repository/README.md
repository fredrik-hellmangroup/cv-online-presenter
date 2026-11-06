# __CONTENT_NAME__

This **private repository** holds the real CV content. The app (`__APP_REPOSITORY__`) provides the generator, validators and the reusable GitHub workflows these callers use. It was created by `scripts/New-ContentRepository.ps1` from the app's synthetic template at release `__APP_VERSION__`.

## Before you publish anything

1. Replace the synthetic `content/sources/master-cv.md`, `content/source-map.json`, `content/cv-sections.json`, `content/site.json` and page metadata with your own. Follow the app's fork guide (`docs/fork-guide.md`) and `docs/source-map.md`.
2. Regenerate and validate (see below). Edit the source or source map, never generated pages.
3. Configure the private `production-content` environment: secrets `DEPLOY_PASSWORD`, `CONTENT_ACTIVATION_TOKEN`, `CONTENT_ACTIVATION_TOKEN_NEXT`; variables `MSDEPLOY_SERVER_URL`, `MSDEPLOY_SITE_NAME`, `MSDEPLOY_CERTIFICATE_SHA256`, `DEPLOY_USERNAME`, `MSDEPLOY_CONTENT_RELEASES_PATH`, `CONTENT_ACTIVATION_URL`. Details: `docs/content-releases.md` in the app.
4. In the app repository, protect `v*` tags with a ruleset that forbids updating and deleting them.

## Validate and update the pinned app release

The caller workflows in `.github/workflows` reference the app's reusable workflows by exact release tag (`@__APP_VERSION__`). The helper scripts live in the app repository; run them from an app checkout:

```powershell
# validate this repository with the pinned release (add -Generate to regenerate pages and provenance first)
.\scripts\Invoke-PinnedContentCheck.ps1 -ContentRoot <path-to-this-repository>

# move to another release: latest, v1.*, or an exact tag
.\scripts\Update-AppPin.ps1 -ContentRoot <path-to-this-repository> -To latest
```

Review the generated diff before opening a pull request. Never expose production secrets to pull-request jobs.
