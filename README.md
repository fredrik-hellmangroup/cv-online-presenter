# CV Online Presenter

Last updated: 2026-11-06

A .NET modular monolith and TypeScript client build for a content-driven consultant portfolio. The public [`content/`](content/README.md) folder is a synthetic template showing the structure, schemas, and page types; it contains no real profile facts. The real CV and source data belong in a separate **private** content repository. The app includes source-map generation and validation tooling under `scripts/content/`, plus reusable content workflows. See the [fork guide](docs/fork-guide.md) before adapting the template, and [source-map.md](docs/source-map.md) for generator behavior. The current page policy keeps non-CV Markdown pages on `ContentPage` (with the generator supplying their H1) and keeps `/cv` on `CvPresenter`/`CvHero`; see [architecture.md](docs/architecture.md).

## Requirements

- .NET SDK 10.0.401 (pinned in `global.json`)
- Node.js 24 and npm

Clone and build. The repositories are not joined by a Git submodule or pinned content pointer, so no submodule checkout or content-pointer PR is part of a content-only update. See [repositories.md](docs/repositories.md) for the actual release boundary and routine workflows:

```powershell
git clone https://github.com/fredrik-hellmangroup/cv-online-presenter.git
```

## Build

```powershell
dotnet restore CvOnlinePresenter.sln
npm ci --prefix client
npm run build
npm run build:dotnet
```

Run the web host with `dotnet run --project src/Portfolio.Web`.

Run accessibility and responsive checks with `npm ci --prefix tools/a11y` followed by `npm run test:a11y`. The command also builds the client bundle. See [docs/accessibility.md](docs/accessibility.md) for the manual release checklist and security checks.

The content-tooling tests use synthetic fixtures: `npm run test:content`. The public app's normal CI does not check out private CV material.

## Modules

See [docs/architecture.md](docs/architecture.md) for project responsibilities and the allowed dependency direction. Architecture decisions available to this baseline are recorded in [docs/adr](docs/adr/README.md).

## Separate app and content releases

Real content is edited only in the private content repository. The public app defines reusable validation, deployment, and token-provisioning workflows; callers must pin the reusable workflow to a full commit SHA and pass its source repository and SHA as `app_repository` and `app_sha`. Each workflow compares those inputs with GitHub's `job.workflow_repository` and `job.workflow_sha` before checkout and fails closed on missing or mismatched values. These contexts are unavailable on GHES, so the workflows require GitHub.com. Content generation and provenance must use the same `app_sha`. A validated content release contains only `site.json` and `pages/`, is uploaded to a new release folder, previewed, then activated as a runtime snapshot; a CV-only update does not require an app deployment. The app is released separately from a `vMAJOR.MINOR.PATCH` tag on `main`. Content rollback reactivates an existing release; app rollback redeploys an immutable package. The content caller's SHA-pinning migration was still in progress at the last inspection; see [repositories.md](docs/repositories.md) before treating the end-to-end content workflow as current. Operational details are in [content-releases.md](docs/content-releases.md), [iis-release.md](docs/iis-release.md), and [rollback-runbook.md](docs/rollback-runbook.md).

The app's integration tests can point at generated content outside this repository without copying it: set `EDITORIAL_CONTENT_PAGES` to the generated `content/pages` directory and run the editorial test class. Browser tests can use the same directory through `Content__PagesRoot`; see [repositories.md](docs/repositories.md#generated-content-validation) for exact commands. This repository's normal CI deliberately uses only synthetic fixtures.

## Documentation

| Read | To learn |
| --- | --- |
| [content/README.md](content/README.md) | The public content template and how to create your own |
| [fork-guide.md](docs/fork-guide.md) | Safe app fork and private-content setup |
| [repositories.md](docs/repositories.md) | Repository boundaries, update/release/rollback flows, and generated-content test hooks |
| [iis-release.md](docs/iis-release.md) | How a release reaches the IIS site |
| [rollback-runbook.md](docs/rollback-runbook.md) | How to roll back to an earlier release |
| [quality-gates.md](docs/quality-gates.md) | Which checks run before merge and release |
| [content.md](docs/content.md) | Markdown format for content pages |
| [source-map.md](docs/source-map.md) | Source-map fields, evidence rules, generation, and provenance |
| [cv-structure.md](docs/cv-structure.md) | How the CV page is structured |
| [content-releases.md](docs/content-releases.md) | Runtime content snapshots and activation |
| [contact-form.md](docs/contact-form.md) | Contact form setup and privacy |
| [accessibility.md](docs/accessibility.md) | Accessibility and responsive checks |
| [architecture.md](docs/architecture.md) | Module layout and dependency rules |
| [decision-register.md](docs/decision-register.md) | Open owner decisions |
| [adr](docs/adr/README.md) | Architecture decision records |

This repository is MIT licensed. The private content repository holds personal data and is not published.
