# Architecture

The application is a single deployable ASP.NET Core Blazor Web App using Static SSR for public pages, with explicit module projects. Browser behavior is progressive TypeScript built independently into static assets; no interactive Blazor render mode is enabled. Pages remain readable without JavaScript.

| Project | Responsibility | Allowed dependencies |
| --- | --- | --- |
| `Portfolio.Contracts` | Stable interfaces and cross-module value types | None |
| `Portfolio.Content` | Markdown loading, content schemas, and validation | Contracts |
| `Portfolio.Experience` | Visitor-facing use cases and presentation models | Contracts, Content |
| `Portfolio.Publishing` | Publication selection and release composition | Contracts, Content |
| `Portfolio.Infrastructure` | Host-specific adapters | Contracts |
| `Portfolio.Web` | HTTP composition, routes, and dependency injection | All modules |

Dependencies point inward to contracts and content capabilities. Module projects do not depend on Web or on each other in a cycle. The Web host is the composition root. The client build has no dependency on server modules.

The solution and client toolchain are pinned/documented so the same commands work locally and in CI.

`npm run check:architecture` checks the project-reference allowlist, cycles, and leftover `Class1` placeholders in CI. The Web host remains the only composition root. `Portfolio.Contracts` defines publication policy; `Portfolio.Publishing` implements it. `Portfolio.Experience` owns the core route map, and `Portfolio.Infrastructure` supplies the host clock adapter. Deeper experience composition and content-source adapters are deferred until the classified snapshot and discovery slices (#26–#27); these modules must not acquire outward dependencies in the meantime.
