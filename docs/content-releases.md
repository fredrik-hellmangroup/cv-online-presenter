# Classified content snapshots and release selection

Last updated: 2026-11-02

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
  20261101-210215-1a6df58/
    site.json
    pages/
```

A release id may contain letters, digits, `-` and `_` (max 100 characters). Releases are produced from a reviewed commit in the private content repository by its `Deploy content` workflow, see [repositories.md](repositories.md).

Runtime selection requires a releases root and an activation token (see the operational requirements below). Over HTTPS, with the header `X-Content-Activation-Token`:

- `POST /internal/content/preview/{releaseId}` validates the release and returns the diff against the active snapshot without switching.
- `POST /internal/content/activate/{releaseId}` validates, writes `active-release.txt` atomically, then switches the snapshot.

Invalid candidates leave the current snapshot and pointer unchanged. Because the pointer is persisted, the active release survives app releases. **Rollback** requires activating a distinct, confirmed existing release id; an upload or failed preview is not evidence that a usable prior release exists.

## Operational requirements

- `ReleasesRoot` must not be wiped by the app deploy. On the shared Beebyte host, Web Deploy can only reach the site root, so use `<site root>/App_Data/content-releases` (Web Deploy path `<MSDEPLOY_CONTENT_PATH>/App_Data/content-releases`). IIS never serves `App_Data` over HTTP, and the app deploy explicitly skips the whole `App_Data` folder (`deploy-beebyte-iis.ps1`); the app ships nothing there, and deleting `App_Data` fails while it holds releases. Any other location inside the app folder is deleted on the next app deploy.
- The app pool identity needs modify rights on `ReleasesRoot` to write `active-release.txt`.
- On Production the app uses the relative `Content:ReleasesRoot` = `App_Data/content-releases` from `appsettings.Production.json` (resolved against the app folder), so no host-level environment variables are needed. `Content__ReleasesRoot` / `Content__ActivationToken` still work as overrides (environment variables, `web.config`).
- The activation token is read per request from `ReleasesRoot/activation-token.txt` (at least 32 characters) unless `Content:ActivationToken` is configured. A configured runtime value takes precedence, so provisioning the file alone is insufficient until that override is removed or updated. The Production appsettings template sets only `Content:ReleasesRoot`; no activation-token override is configured in the app configuration templates inspected. Provision the file through the reviewed workflow described below; no restart is needed. Without a token the endpoints return 404.
- Provision or recover the root token only through the reviewed content repository's `Provision activation token` workflow. Its token-only Web Deploy mode accepts only `activation-token.txt`, derives the exact site-root-relative `MSDEPLOY_SITE_NAME/App_Data/content-releases` destination, rejects rooted or otherwise non-matching paths, and disables deletion. It rejects surrounding token whitespace and writes the selected token unchanged; recovery selects the existing primary secret to restore the prior value. This workflow never publishes content, previews a release, or activates one.
- The `Deploy content` workflow uploads a release before previewing it. Activation runs only after the preview request succeeds with the expected diff lists; a failed or malformed preview response stops the workflow before activation.
- The only trusted writer to release trees is the private content repository's `Deploy content` workflow. Its workflow-level concurrency serializes upload and activation; do not use alternate or manual concurrent filesystem writers.
- Keep the token secret and restrict filesystem access to the releases folder.
- Draft content stays excluded from routes, indexing and search.

## Release retention (issue #57)

After activation persists `active-release.txt` and swaps in the validated snapshot, the app attempts retention cleanup. Cleanup is post-commit, best-effort maintenance: failures are logged and do not change activation success. There is no separate cleanup endpoint.

A release is eligible only when it is a direct child of `ReleasesRoot`, its ID matches `yyyyMMdd-HHmmss-<7 lowercase hex characters>` (the UTC timestamp formatted with `ToString('yyyyMMdd-HHmmss')`, followed by a hyphen and the 7-character lowercase SHA; for example, `20261101-210215-1a6df58`) with a valid UTC timestamp, and its tree has exactly `site.json` and `pages/`. The release and its directories/files must be ordinary filesystem entries (no reparse points); `pages/` may contain only Markdown files, and the current content loader must fully load and validate the release. Malformed, incomplete, unreadable, invalid, unexpected-layout, unrecognized, or reparse-point release directories are preserved and logged.

The active release is retained. Eligible inactive releases are ordered by UTC timestamp descending, then release ID using ordinal ascending order; the first 10 are retained. There is no age/grace period. This is 11 eligible releases total (active plus 10 inactive), but preserved uncertain or unrecognized directories are outside that count and can make the on-disk total exceed 11. Before cleanup and before each deletion, the app verifies that `active-release.txt` still names the just-committed active release. The active release is never a deletion candidate; the pointer and `activation-token.txt` are not release-directory candidates.

Releases outside the retention window are permanently deleted. This approval is not a backup guarantee and does not promise recovery of deleted releases. Cleanup assumes one Plesk worker and no overlapping worker process during recycle. If hosting changes to a web-garden or otherwise allows overlapping processes, revisit cleanup/activation coordination before relying on this behavior.

Each request pins one snapshot before routing, so page content, site identity, canonical/social metadata, and sitemap paths agree during activation. Structured data remains disabled pending owner approval. Styles and script entrypoints carry the content version; HTTP responses use `no-cache` so imported scripts and other static assets revalidate across app releases. The content release root is separate from the IIS application release directory; app rollback still follows the [IIS runbook](rollback-runbook.md).

## Production verification and known gaps (2026-11-02)

**Verified:** The app main/release commit `fb858d63b25e98058b3bd538b11d755c41951e96` contains #61. Tag/release `v1.0.10` passed full deployment and health/metadata checks in run `41362144486`; production `/health` returned HTTP 200. Token-only provisioning run `41362063163` succeeded; the primary environment secret was set from that same in-memory token, and the staged `NEXT` secret was later removed. Current `APP_REPO_REF` is `main`. After the full app deploy, authenticated content run `41362455305` previewed 3 added, 1 removed, and 5 changed sections, then activated `20261101-210215-1a6df58`. This confirms the root token remained available and matched the primary secret after deployment; successful activation also confirms the app-pool identity could write the active pointer. Immutable-package redeploy run `41362579683` passed. Follow-up run `41362687186` previewed 0 added, 0 removed, and 0 changed, then reactivated the same release, confirming content persistence across an app redeploy.

**Production content deployment and rollback verified (2026-11-02):**

- **App-pool recycle after the 503 incident:** The operator confirmed the IIS app pool was restarted/recycled. Immediately afterward, at 2026-11-02 11:44 UTC, live `/health` returned HTTP 200; static build metadata reported appRevision `fb858d63b25e98058b3bd538b11d755c41951e96`, contentRevision `56fc7b90625f841785dc54fc39ee0ed9d345b23b`, and buildId `41362144486`. `scripts/write-build-metadata.mjs` sets `contentRevision` from `git rev-parse HEAD:content` and writes it to static `wwwroot/build-metadata.json`, which `PortfolioTelemetry.ReleaseIdentity.Load` reads. Thus the metadata identifies bundled template content, not the selected private runtime release. The health response and metadata verify app responsiveness and bundled build identity after recycle, but do not prove which private content release or pointer was active. **Active-content-pointer persistence across recycle remains unverified**, pending a post-recycle live-content or pointer-specific check.
- **Push deployment:** Normal push run `41439229423`, triggered by content PR #15 merge commit `70df2cfc1b52e87cd0869f3838745c18b670616a`, activated `20261102-114607-70df2cf`. Preview: 0 added, 0 removed, 1 changed. Workflow health succeeded; live `/health` returned 200. `/cv` showed the approved employment wording, and its H1 was confirmed after HTML entity decoding with separate name and tagline spans.
- **Rollback:** Run `41439769084` activated the confirmed prior release `20261101-210215-1a6df58`. Preview: 0/0/1. Workflow and live health returned 200. The prior release's content was confirmed live on `/cv`.
- **Restoration:** Run `41439874103` reactivated `20261102-114607-70df2cf`. Preview: 0/0/1; health returned 200. `/cv` again showed the approved employment wording, and its H1 was confirmed after HTML entity decoding with separate name and tagline spans.

**Remaining gap:** Although an operator-confirmed app-pool recycle was followed by HTTP 200 and bundled-build metadata at 11:44 UTC, active private release/pointer persistence across that recycle remains unverified. Verify with post-recycle live content or pointer-specific evidence.


## Provisioning incident runbook

The incident was a legacy Web Deploy `System.Web.HttpContext` load failure under PowerShell Core (`pwsh`).

1. **Stop and inspect:** Do not tag or change the primary secret after a failed provisioning run. Check whether the helper reached `SyncTo`; without the `MSDeploy synchronized ...` completion message, the server file is not confirmed. Even a successful sync confirms file transfer only, not app authentication or activation.
2. **Retry safely:** Use the protected provisioning workflow with Windows PowerShell (`shell: powershell`), not PowerShell Core (`pwsh`), for the legacy helper. Keep token values out of logs, arguments, and artifacts.
3. **Recover only if needed:** Use `use_primary_secret` only to restore a known current primary token. Update the primary secret only after staged provisioning succeeds, using the same staged value.
4. **Verify before release:** After the full app deploy, run the authenticated content workflow and inspect preview and activation results. That workflow activates immediately after a valid preview. Stop if preview fails or its diff is unexpected.
