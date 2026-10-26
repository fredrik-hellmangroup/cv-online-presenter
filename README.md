# CV Online Presenter

A .NET modular monolith and TypeScript client build for a content-driven consultant portfolio. The repository currently contains the product foundation; no personal profile facts are published by the starter.

## Requirements

- .NET SDK 10.0.401 (pinned in `global.json`)
- Node.js 24 and npm

## Build

```powershell
dotnet restore CvOnlinePresenter.sln
npm ci --prefix client
npm run build
npm run build:dotnet
```

Run the web host with `dotnet run --project src/Portfolio.Web`.

## Modules

See [docs/architecture.md](docs/architecture.md) for project responsibilities and the allowed dependency direction. Architecture decisions available to this baseline are recorded in [docs/adr](docs/adr/README.md).

## Content, deployment, and licensing

Content schemas and publishing rules will be introduced in subsequent slices. Deployment requires an approved environment configuration; no domain, credentials, or production endpoint is included in this repository. The repository license is MIT.
