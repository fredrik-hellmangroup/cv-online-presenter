# Architecture

The application is a single deployable ASP.NET Core application with explicit module projects. Client TypeScript is built independently into static assets.

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
