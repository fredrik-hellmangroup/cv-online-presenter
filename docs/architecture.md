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

The optional browser experience is composed from separate `ThemeEngine` and `EasterEggEngine` contracts in `client/src/experience.ts`. A failed engine is logged and does not stop the other. `client/src/experience-manifest.ts` declares the permanent easter egg and local calendar rules for Christmas (24–26 December) and New Year (31 December–1 January). No birthday date has been approved, so no birthday rule is shipped. Calendar layers set only a decorative border token; content, links, and navigation do not depend on them.

The design system uses Tailwind CSS v4 utilities built from `client/src/utilities.css`, semantic color tokens, custom Razor components, and separate Markdown typography in `site.css`. The light, typography-led Scandinavian Editorial direction uses system text fonts and serif headings. Tailwind output is compiled during `npm run build` and loaded as a versioned static asset. Theme and calendar layers preserve the same text and link tokens; reduced-motion CSS applies across all layers. This implements ADR-004 and ADR-006 without external font or image dependencies.

`npm run check:architecture` checks the project-reference allowlist, cycles, and leftover `Class1` placeholders in CI. The Web host remains the only composition root. `Portfolio.Contracts` defines publication policy; `Portfolio.Publishing` implements it. `Portfolio.Experience` owns the core route map, and `Portfolio.Infrastructure` supplies the host clock adapter. Deeper experience composition and content-source adapters are deferred until the classified snapshot and discovery slices (#26–#27); these modules must not acquire outward dependencies in the meantime.
