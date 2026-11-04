# CV Online Presenter

A .NET modular monolith and TypeScript client build for a content-driven consultant portfolio. The public [`content/`](content/README.md) folder is a template with synthetic demo data that shows the structure, schema and page types. The real CV content lives in a separate **private** content repository and is deployed to the live site as a content release, without an app release. This repository publishes no personal profile facts. The current page policy keeps non-CV Markdown pages on `ContentPage` (with the generator supplying their H1) and keeps `/cv` on `CvPresenter`/`CvHero`; see [architecture.md](docs/architecture.md).

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

## Modules

See [docs/architecture.md](docs/architecture.md) for project responsibilities and the allowed dependency direction. Architecture decisions available to this baseline are recorded in [docs/adr](docs/adr/README.md).

## Separate app and content releases

Real content is edited only in the private content repository. Its validated release is uploaded to an immutable folder, previewed, then activated as a runtime snapshot; a CV-only update does not require an app deployment. The public app is released separately from a protected `vMAJOR.MINOR.PATCH` tag on `main`. Content rollback reactivates a prior content release; app rollback redeploys a previously verified immutable package. The detailed architecture, Mermaid flows, and routine matrix live in [repositories.md](docs/repositories.md), with operational detail in [content-releases.md](docs/content-releases.md), [iis-release.md](docs/iis-release.md), and [rollback-runbook.md](docs/rollback-runbook.md).

The app's integration tests can point at generated content outside this repository without copying it: set `EDITORIAL_CONTENT_PAGES` to the generated `content/pages` directory and run the editorial test class. Browser tests can use the same directory through `Content__PagesRoot`; see [repositories.md](docs/repositories.md#generated-content-validation) for exact commands. This repository's normal CI deliberately uses only synthetic fixtures.

## Documentation

| Read | To learn |
| --- | --- |
| [content/README.md](content/README.md) | The public content template and how to create your own |
| [repositories.md](docs/repositories.md) | Repository boundaries, update/release/rollback flows, and generated-content test hooks |
| [iis-release.md](docs/iis-release.md) | How a release reaches the IIS site |
| [rollback-runbook.md](docs/rollback-runbook.md) | How to roll back to an earlier release |
| [quality-gates.md](docs/quality-gates.md) | Which checks run before merge and release |
| [content.md](docs/content.md) | Markdown format for content pages |
| [cv-structure.md](docs/cv-structure.md) | How the CV page is structured |
| [content-releases.md](docs/content-releases.md) | Runtime content snapshots and activation |
| [contact-form.md](docs/contact-form.md) | Contact form setup and privacy |
| [accessibility.md](docs/accessibility.md) | Accessibility and responsive checks |
| [architecture.md](docs/architecture.md) | Module layout and dependency rules |
| [decision-register.md](docs/decision-register.md) | Open owner decisions |
| [adr](docs/adr/README.md) | Architecture decision records |

This repository is MIT licensed. The private content repository holds personal data and is not published.
