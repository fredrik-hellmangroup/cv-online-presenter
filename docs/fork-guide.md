# Fork guide: keep code public and content private

Last updated: 2026-11-06

## 1. Fork the app without adding personal data

Use the public fork for application code, schemas, tests, and synthetic demo
content. Keep `content/` fictional. Do not put real CV facts, names, email
addresses, employer/client names, project details, source documents, or
generated provenance in the fork, a public issue, or a public pull request.

## 2. Create a separate private content repository

**Automated:** from a checkout of your fork, run

```powershell
.\scripts\New-ContentRepository.ps1 -Path D:\work\my-portfolio-content -CreateGitHubRepository -ProtectAppTags
```

It resolves your fork's latest release tag (`-AppVersion` takes `latest`, `v1.*` or
an exact tag; your fork needs at least one release), copies the synthetic content
template, writes caller workflows pinned to that tag, generates provenance with it,
makes the first commit, and optionally creates the private GitHub repository
(`-CreateGitHubRepository`, needs `gh`) and protects the fork's `v*` tags
(`-ProtectAppTags`). Add `-WhatIf` to preview. You still replace the synthetic
content with your own and configure the environment secrets. The manual steps
below describe the same setup and remain valid.

Keep the real content in a separate private repository with its own
`content/` tree. Use the public template and
[`source-map.example.json`](source-map.example.json) only as format references.
The example's zero bootstrap hashes and fictional text must be replaced before
execution; service group/item lines and optional hero labels must be adapted
to visible evidence in the private canonical source or omitted. Project
`presentation` facts are also optional and must match labeled source evidence.
Keep the source map and `master-cv.md` private along with the generated
provenance.

Before the first write:

1. Replace the synthetic source, source map, CV section rules, site settings,
   and page metadata in the private tree.
2. Ensure every path in `generatedPages` has a seed Markdown file.
3. Calculate a normalized SHA-256 for each seed and update the exact
   `bootstrapOutputSha256` path set.
4. Put each project under the configured project-history H2, with a unique
   project H3 and the configured result/keyword H4s. Ensure source-map
   `sourceSection` names both parent and child headings. Include visible
   `Period:` and `Roll:` lines before the result H4; add `Bransch:` if you
   select the `industry` fact.
5. For services, choose exactly one mapping: backward-compatible flat
   `competenceBlocks` or nested `competenceGroups`. In the grouped form, source
   H3s under the configured competence-area H2 are groups; H4s beneath each
   group are items. Map each group's and item's direct visible source lines.
   `kicker`, `panelEyebrow`, and `panelTitle` are optional services
   front-matter fields; each supplied value must be a non-empty single line
   evidenced in visible text somewhere in the canonical source. The home
   `heroTagline` remains required and must be evidenced under the overview H2.
6. Optionally add project `presentation` with `order`, `facts`, or both (not
   an empty object). `order` is an integer from `0` through `2147483646`;
   `2147483647` (`Int32.MaxValue`) is reserved by the app as the unordered
   sentinel and must not be assigned. `facts` is a non-empty unique selection
   of `period`, `role`, and/or `industry`. Each selected fact is extracted from
   the visible `Period:`, `Roll:`, or `Bransch:` line before the result H4 and
   emitted as top-level front matter. Selected fact lines are omitted from the
   body; omitting `presentation` preserves legacy generated output.
7. Run the pinned generator and both content validators; review the private
   workflow checks before merging or deploying.

The complete field rules, service/project heading hierarchies, evidence
checks, and safe command examples are in [source-map.md](source-map.md).

## 3. Pin the shared content tooling

The reusable workflows require `app_repository`, which must be a valid
`owner/repository` value identifying the repository that supplied the reusable
workflow. The release is chosen by the caller's `uses` reference, which must be
an exact release tag such as `@v1.0.15`; there is no SHA input. Before checkout,
each workflow compares `app_repository` with `job.workflow_repository`, takes
the commit from `job.workflow_sha` and the version from `job.workflow_ref`;
missing context values or mismatches fail closed. Content validation also
requires the same version in `--app-version` and generated `appVersion` and
`appCommitSha` provenance.

The workflow then checks out the source repository at that commit, verifies the
commit is reachable from that repository's `main`, verifies checkout `HEAD`,
that the tag resolves to the commit, and that `VERSION` matches the tag. Tags
matching `v*` should be protected by a repository ruleset that forbids updates
and deletion, so a version is an immutable pin. These `job.workflow_*` contexts
are GitHub.com-only, so GHES is unsupported and fails closed.

**For a fork:** forks are supported when the caller uses the reusable workflow
from the fork itself at one of its release tags and passes that fork's
owner/repository. Passing an unrelated repository to a workflow loaded from another
repository will fail the identity check. Review the fork's workflow and
deployment code, protect its `main` and its `v*` tags, and verify its GitHub environment
settings and secrets before production use; the identity and reachability
checks do not establish that the fork's code or settings are trustworthy.

The current private caller validates pull requests and pushes to `main`, and
deploys qualifying content changes on `main`. For your own fork, configure
your caller separately: pin each reusable-workflow reference to a release tag
and keep the generator release and generated provenance aligned. See the
[shared workflow contract](repositories.md#shared-content-workflow-pin);
public workflow definitions do not provide or publish private content.

## 4. Validate and publish

From the app repository root, with the checkout at the release tag your content
is pinned to, run:

```powershell
.\scripts\validate-content.ps1 -ContentRoot 'D:\work\private-portfolio-content' -Generate
```

`-AppVersion` defaults to the exact release tag at `HEAD`. Replace the path
first. To validate without an app checkout at the right tag, run
`.\scripts\Invoke-PinnedContentCheck.ps1 -ContentRoot <path> [-Generate]`: it
clones the release the callers are pinned to into a temporary folder. To move
the content repository to another release, run
`.\scripts\Update-AppPin.ps1 -ContentRoot <path> -To latest` (or `v1.*`, or an
exact tag; `-WhatIf` previews). Never run this against
private files from a public CI job unless that job is explicitly designed to
protect and scan the private data. The content deploy workflow packages only
`site.json` and generated `pages/`, uploads to a new release folder, previews
it, activates only after a valid preview, and verifies active ID/version and
health. See [content-releases.md](content-releases.md) for the workflow
inputs, environment requirements, token provisioning, and rollback contract.

## 5. Keep deployment settings out of source

Configure required deployment variables and secrets in the private
repository's protected GitHub environment. Do not commit credentials, token
values, private host details, or real content into the fork. The workflows
require explicit repository/SHA checks and use content-only additive uploads;
verify environment protection and the current workflow run before any
production operation.

Related references: [public content template](../content/README.md),
[repository boundaries](repositories.md), [Markdown format](content.md), and
[quality gates](quality-gates.md).
