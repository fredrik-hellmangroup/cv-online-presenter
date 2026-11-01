# Classified content snapshots and release selection

The app loads one content snapshot at startup. `ContentSnapshotLoader` parses Markdig sections deterministically, validates all pages before use, and builds an immutable snapshot with the site identity, sections, documents, and a content hash. Unknown section headings become `generic`; a document may set `sectionType` in front matter to override classification. `ContentSnapshotLoader.Compare` produces a structural document/section diff. No AI participates in validation or publishing.

## Where the content comes from

| Situation | Source |
| --- | --- |
| `Content:ReleasesRoot` is configured (default in Production) and `active-release.txt` names a valid release | `<ReleasesRoot>/<releaseId>/` (the real, private content) |
| `Content:ReleasesRoot` is not configured (for example in Development), or no release is active yet | The bundled public template in `content/` (synthetic demo data) |
| The active release is missing or invalid | The bundled template, with a warning in the log |

The startup log states which source was used.

## Release layout and activation

```text
<ReleasesRoot>/            e.g. <site root>/App_Data/content-releases (skipped by the app deploy)
  active-release.txt       single line: the active release id
  2026-11-01-ab12cd3/
    site.json
    pages/
```

A release id may contain letters, digits, `-` and `_` (max 100 characters). Releases are produced from a reviewed commit in the private content repository by its `Deploy content` workflow, see [repositories.md](repositories.md).

Runtime selection requires a releases root and an activation token (see the operational requirements below). Over HTTPS, with the header `X-Content-Activation-Token`:

- `POST /internal/content/preview/{releaseId}` validates the release and returns the diff against the active snapshot without switching.
- `POST /internal/content/activate/{releaseId}` validates, writes `active-release.txt` atomically, then switches the snapshot.

Invalid candidates leave the current snapshot and pointer unchanged. Because the pointer is persisted, the active release survives app restarts and app releases. **Rollback** is activating an earlier release id again.

## Operational requirements

- `ReleasesRoot` must not be wiped by the app deploy. On the shared Beebyte host, Web Deploy can only reach the site root, so use `<site root>/App_Data/content-releases` (Web Deploy path `<MSDEPLOY_CONTENT_PATH>/App_Data/content-releases`). IIS never serves `App_Data` over HTTP, and the app deploy explicitly skips the whole `App_Data` folder (`deploy-beebyte-iis.ps1`); the app ships nothing there, and deleting `App_Data` fails while it holds releases. Any other location inside the app folder is deleted on the next app deploy.
- The app pool identity needs modify rights on `ReleasesRoot` to write `active-release.txt`.
- On Production the app uses the relative `Content:ReleasesRoot` = `App_Data/content-releases` from `appsettings.Production.json` (resolved against the app folder), so no host-level environment variables are needed. `Content__ReleasesRoot` / `Content__ActivationToken` still work as overrides (environment variables, `web.config`).
- The activation token is read per request from `ReleasesRoot/activation-token.txt` (at least 32 characters) unless `Content:ActivationToken` is configured. Create that file once on the server (it sits in the folder the app deploy skips); no restart is needed. Without a token the endpoints return 404.
- Keep the token secret and restrict filesystem access to the releases folder.
- Draft content stays excluded from routes, indexing and search.

Each request pins one snapshot before routing, so page content, site identity, canonical/social metadata, and sitemap paths agree during activation. Structured data remains disabled pending owner approval. Styles and script entrypoints carry the content version; HTTP responses use `no-cache` so imported scripts and other static assets revalidate across app releases. The content release root is separate from the IIS application release directory; app rollback still follows the [IIS runbook](rollback-runbook.md).
