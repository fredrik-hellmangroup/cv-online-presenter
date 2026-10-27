# CV Online Presenter

A .NET modular monolith and TypeScript client build for a content-driven consultant portfolio. Content is maintained in the [`cv-online-presenter-content`](https://github.com/fredrik-hellmangroup/cv-online-presenter-content) repository and pinned here as a Git submodule revision. The template publishes no personal profile facts.

## Requirements

- .NET SDK 10.0.401 (pinned in `global.json`)
- Node.js 24 and npm

Clone with the pinned content revision:

```powershell
git clone --recurse-submodules https://github.com/fredrik-hellmangroup/cv-online-presenter.git
```

For an existing checkout, run `git submodule update --init --recursive` before building.

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

## Content, deployment, and licensing

Content schemas and templates live in the content repository, with its own validation workflow. Updating content means merging a content change, then updating this repository's submodule pointer in a separate app PR. The submodule commit records the exact content revision used by an app build. Deployment requires approved environment configuration; no domain, credentials, or production endpoint is included here. Both repositories use the MIT license.

Version tags create an IIS-ready package with app/content revisions and a health endpoint. See [docs/iis-release.md](docs/iis-release.md) for staging setup and the deployment gate.

Owner-provided release decisions and current safe defaults are tracked in [docs/decision-register.md](docs/decision-register.md).
