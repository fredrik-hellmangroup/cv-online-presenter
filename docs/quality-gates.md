# Quality gates and ownership

| Scope | Owner | Gate |
| --- | --- | --- |
| Application | App repository | `dotnet test tests/Portfolio.Tests/Portfolio.Tests.csproj`, `npm --prefix client test`, module-boundary check, build, browser accessibility and security scans in `quality.yml` |
| Content | Public content repository | Schema/content validation and review of claim provenance before a content commit is selected; app CI also validates the pinned submodule |
| Deployment | Release workflow and staging owner | IIS environment/runner readiness, HTTPS health check, release artifact smoke test and live rollback rehearsal |

The .NET tests cover front-matter parsing, link validation, sanitization and HTTP behavior; the client tests cover theme state decisions. Playwright remains the cross-browser accessibility gate. Changes to content classification, release selection, discovery, or the engines should add focused tests to the owning suite. `dotnet test` and client tests are required before release; a green app build alone does not establish content provenance or staging readiness.
