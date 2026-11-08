# Public content template

Last updated: 2026-11-08

This public folder contains **synthetic content only**. All people, organizations,
projects, and contact values in the template are fictional. Keep real CV facts,
contact details, canonical source material, and source maps in a separate
**private** content repository; never put them in this public app repository,
its issues, or its pull requests.

## From source to release

```mermaid
flowchart LR
    S["Private Master CV"] --> M["Private source map"]
    C["Private CV section rules"] --> G["Generator in public app"]
    M --> G
    S --> G
    G --> P["Generated pages + provenance"]
    P --> V["Validation / CI"]
    V --> R["Release: site.json + pages/"]
```

| Public app repository | Private content repository |
|---|---|
| App, generator, schemas, validators, reusable workflows, synthetic fixtures | Master CV, real source map, section rules, generated pages, provenance, caller workflows |

The public template documents the structure; it is not the starting place for
real CV facts. See the [fork guide](../docs/fork-guide.md) for private setup,
and [source-map.md](../docs/source-map.md) for how source sections map to pages.

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

## Master CV mapping at a glance

| Master CV structure | Mapping file | Generated page |
|---|---|---|
| Source sections selected for publication | `content/cv-sections.json` | `content/pages/cv.md` |
| Overview section and mapped tagline | `content/source-map.json` | `content/pages/home.md` |
| Competence headings and evidence lines | `content/source-map.json` | `content/pages/services.md` |
| Project-history heading, project sections, results and keywords | `content/source-map.json` | `content/pages/projects.md` and `content/pages/projects/<slug>.md` |

Edit the master CV for source facts, the source map for page selection and
source references, and the CV section rules for publication choices. Generated
pages and provenance are outputs: regenerate them instead of editing them by hand.

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
generation provenance are not part of the production package. A private
repository created with `scripts\New-ContentRepository.ps1` gets caller
workflows that validate on every pull request and push, and deploy only when
`content/pages/**` or `content/site.json` changes on `main`. See
[docs/content-releases.md](../docs/content-releases.md) and
[docs/repositories.md](../docs/repositories.md).

## Validate and generate a private content tree

Run this from the **public app repository root**, with the private content root
kept outside the public checkout and this checkout at the release tag the content
is pinned to (`git checkout --detach v0.1.3`). In CI, the reusable workflow
requires the caller to reference an exact release tag, derives the commit from
`job.workflow_sha` and the version from `job.workflow_ref`, and verifies both
before checkout; missing or mismatched contexts fail closed. The content checks
also verify that generated provenance carries the same `appVersion` and
`appCommitSha`. These contexts are GitHub.com-only, so the workflows fail
closed on GHES.

```powershell
.\scripts\validate-content.ps1 -ContentRoot 'D:\work\private-portfolio-content'
```

`-AppVersion` defaults to the exact release tag at `HEAD`. Add `-Generate` to
regenerate mapped pages and provenance first, and `-TestTooling` to also run
the tooling tests. With no matching app checkout, use
`.\scripts\Invoke-PinnedContentCheck.ps1 -ContentRoot <path>`, which clones the
pinned release temporarily; `.\scripts\Update-AppPin.ps1 -ContentRoot <path> -To <latest|v0.*|vX.Y.Z>`
moves a content repository to another release and regenerates provenance.

Manual equivalent, from an app checkout at the release tag (`git checkout --detach v0.1.3`):

```powershell
$ContentRoot = 'D:\work\private-portfolio-content'
$AppVersion = 'v0.1.3'

npm run content:source:validate -- --root $ContentRoot --app-version $AppVersion
npm run content:generate -- --root $ContentRoot --app-version $AppVersion
npm run content:check -- --root $ContentRoot --app-version $AppVersion
npm run content:validate -- --root $ContentRoot
dotnet run --project tools/Portfolio.Content.Validator -- --content "$ContentRoot\content\pages"
```

Do not use `-Generate` until every mapped seed output exists and
`bootstrapOutputSha256` contains the matching normalized SHA-256 for each path.
When provenance is already pinned to an app release, later checks and writes
must use the same version (the script does this for you). The generator and
content-format references are in
[docs/source-map.md](../docs/source-map.md), [docs/content.md](../docs/content.md),
and the [fork guide](../docs/fork-guide.md).
