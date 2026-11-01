# Classified content snapshots and release selection

The app loads one content snapshot at startup. `ContentSnapshotLoader` parses Markdig sections deterministically, validates all pages before use, and builds an immutable snapshot with the site identity, sections, documents, and a content hash. Unknown section headings become `generic`; a document may set `sectionType` in front matter to override classification. `ContentSnapshotLoader.Compare` produces a structural document/section diff. No AI participates in validation or publishing.

## Where the content comes from

| Situation | Source |
| --- | --- |
| `Content__ReleasesRoot` is set and `active-release.txt` names a valid release | `<ReleasesRoot>/<releaseId>/` (the real, private content) |
| `Content__ReleasesRoot` is not set, or no release is active yet | The bundled public template in `content/` (synthetic demo data) |
| The active release is missing or invalid | The bundled template, with a warning in the log |

The startup log states which source was used.

## Release layout and activation

```text
<ReleasesRoot>/            outside the IIS app folder
  active-release.txt       single line: the active release id
  2026-11-01-ab12cd3/
    site.json
    pages/
```

A release id may contain letters, digits, `-` and `_` (max 100 characters). Releases are produced from a reviewed commit in the private content repository by its `Deploy content` workflow, see [repositories.md](repositories.md).

Runtime selection requires both `Content__ReleasesRoot` and `Content__ActivationToken`. Over HTTPS, with the header `X-Content-Activation-Token`:

- `POST /internal/content/preview/{releaseId}` validates the release and returns the diff against the active snapshot without switching.
- `POST /internal/content/activate/{releaseId}` validates, writes `active-release.txt` atomically, then switches the snapshot.

Invalid candidates leave the current snapshot and pointer unchanged. Because the pointer is persisted, the active release survives app restarts and app releases. **Rollback** is activating an earlier release id again.

## Operational requirements

- `ReleasesRoot` must be outside the IIS application folder. The app deploy removes extra files there.
- The app pool identity needs modify rights on `ReleasesRoot` to write `active-release.txt`.
- Set the two environment variables at IIS or host level, not only in `web.config`, because publishing overwrites it.
- Keep the token secret and restrict filesystem access to the releases folder.
- Draft content stays excluded from routes, indexing and search.

Each request pins one snapshot before routing, so page content, site identity, canonical/social metadata, and sitemap paths agree during activation. Structured data remains disabled pending owner approval. Styles and script entrypoints carry the content version; HTTP responses use `no-cache` so imported scripts and other static assets revalidate across app releases. The content release root is separate from the IIS application release directory; app rollback still follows the [IIS runbook](rollback-runbook.md).
