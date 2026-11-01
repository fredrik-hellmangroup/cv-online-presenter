# Quality gates and ownership

```mermaid
flowchart LR
    PR["Pull request"] --> Q["quality.yml<br/>architecture, tests, build, a11y"]
    PR --> CV["Content validation<br/>schema, audit, gitleaks"]
    Q --> M["Merge to main"]
    CV --> M
    M --> T["Tag vX.Y.Z"]
    T --> R["Release gates<br/>validate, tests, build, health"]
    R --> L(["Production"])
```

| Scope | Owner | Gate |
| --- | --- | --- |
| Application | App repository | `dotnet test tests/Portfolio.Tests/Portfolio.Tests.csproj`, `npm --prefix client test`, module-boundary check, build, browser accessibility and security scans in `quality.yml` |
| Content | Private content repository | Schema and content validation in the content repo, review of claim provenance before merge. App CI validates only the public `content/` template. |
| Deployment | Release workflow and staging owner | IIS environment and runner readiness, HTTPS health check, release artifact smoke test, live rollback rehearsal |

Both `dotnet test` and the client tests are required before release. A green build alone does not prove content provenance or staging readiness. Add focused tests to the owning suite when you change content classification, release selection, discovery, or the engines.
