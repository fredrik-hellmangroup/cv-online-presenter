# Public content template

Last updated: 2026-11-06

This public folder contains **synthetic content only**. All people, organizations,
projects, and contact values in the template are fictional. Keep real CV facts,
contact details, canonical source material, and source maps in a separate
**private** content repository; never put them in this public app repository,
its issues, or its pull requests.

```text
content/
  cv-sections.json                 CV section publication rules
  generated-provenance.json        generated hashes and output manifest
  pages/                           generated Markdown and synthetic demo pages
  schema/                          front-matter and generator schemas
  site.json                        locale and site settings
  source-map.json                  synthetic mapping input
  sources/master-cv.md             synthetic canonical source
```

`content/source-map.json` is the generator input. The safe, invented example
is [`docs/source-map.example.json`](../docs/source-map.example.json); it is not
loaded by the runtime. Its zero-valued bootstrap hashes are placeholders, not
usable seed hashes. `content/generated-provenance.json` is generator output,
not an editorial input to hand-edit. See [docs/source-map.md](../docs/source-map.md)
for the exact field and bootstrap contracts.

## Keep real content private

Create a separate private content repository for your own material. Its
`content/` tree follows the same shape, but it must be populated and validated
privately. The content-release workflow packages only `content/site.json` and
`content/pages/`; source documents, the source map, CV section rules, and
generation provenance are not part of the production package. See
[docs/content-releases.md](../docs/content-releases.md) and
[docs/repositories.md](../docs/repositories.md).

## Validate and generate a private content tree

Run these commands from the **public app repository root**, with the private
content root kept outside the public checkout. Replace both placeholders before
execution. `AppSha` must be the full 40-character lowercase commit SHA of the
app checkout. In CI, the reusable workflow compares `app_repository` and
`app_sha` with `job.workflow_repository` and `job.workflow_sha` before
checkout; missing or mismatched contexts fail closed. Callers must pin the
workflow reference to that same repository and commit. The content checks also
verify that generated provenance carries the same `app_sha`. These contexts
are GitHub.com-only, so the workflows fail closed on GHES.

```powershell
$ContentRoot = 'D:\work\private-portfolio-content'
$AppSha = '<replace-with-the-full-lowercase-40-character-app-commit-sha>'

npm run content:source:validate -- --root $ContentRoot --app-commit-sha $AppSha
npm run content:generate -- --root $ContentRoot --app-commit-sha $AppSha
npm run content:check -- --root $ContentRoot --app-commit-sha $AppSha
npm run content:validate -- --root $ContentRoot
dotnet run --project tools/Portfolio.Content.Validator -- --content "$ContentRoot\content\pages"
```

Do not run `content:generate` until every mapped seed output exists and
`bootstrapOutputSha256` contains the matching normalized SHA-256 for each path.
When provenance is already pinned to an app commit, pass that same SHA to later
checks and writes. The generator and content-format references are in
[docs/source-map.md](../docs/source-map.md), [docs/content.md](../docs/content.md),
and the [fork guide](../docs/fork-guide.md).
