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

The optional browser experience is composed from separate `ParticleEngine`, `ThemeEngine`, `EasterEggEngine`, `CvTocEngine`, and `CvSearchEngine` contracts in `client/src/experience.ts`. A failed engine is logged and does not stop the others. `client/src/experience-manifest.ts` declares the hidden easter egg triggers (five clicks on the logo mark, or the key sequence K-O-D; see [easter-eggs.md](easter-eggs.md)) and local calendar rules for Christmas (24–26 December) and New Year (31 December–1 January). No birthday date has been approved, so no birthday rule is shipped. Calendar layers set only a decorative border token; content, links, and navigation do not depend on them.

The CV page (`/cv`) has a scroll-following table of contents built in the browser from the heading anchors that the Markdown pipeline generates (Markdig auto identifiers; the sanitizer allows `id`). Search is a floating panel on the CV page that calls `/api/search`; there is no standalone search page, and `/search` redirects permanently to `/cv`. Without JavaScript the CV stays fully readable; the table of contents, search panel, particles, and easter egg are progressive enhancements.

The design system uses Tailwind CSS v4 utilities built from `client/src/utilities.css`, semantic color tokens, custom Razor components, and separate Markdown typography in `site.css`. The dark, immersive direction uses system text fonts, heavy display-size headings, an orange accent, and a canvas particle network drawn by `ParticleEngine` (capped particle count and pixel ratio, paused when the tab is hidden, a single static frame under `prefers-reduced-motion`). Dark is the default theme; light is an alternative stored in `localStorage`. Tailwind output is compiled during `npm run build` and loaded as a versioned static asset. Theme and calendar layers preserve the same text and link tokens; reduced-motion CSS applies across all layers. This implements ADR-004 and ADR-006 (Immersive Dark, which replaces Scandinavian Editorial) without external font or image dependencies; the canvas is drawn from a same-origin script, so the CSP is unchanged.

`npm run check:architecture` checks the project-reference allowlist, cycles, and leftover `Class1` placeholders in CI. The Web host remains the only composition root. `Portfolio.Contracts` defines publication policy; `Portfolio.Publishing` implements it. `Portfolio.Experience` owns the core route map, and `Portfolio.Infrastructure` supplies the host clock adapter. Deeper experience composition and content-source adapters are deferred until the classified snapshot and discovery slices (#26–#27); these modules must not acquire outward dependencies in the meantime.
