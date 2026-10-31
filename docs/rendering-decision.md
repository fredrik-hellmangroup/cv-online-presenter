# Rendering decision for issue #25

The implementation follows ADR-003: public routes render with Blazor Web App Static SSR. No owner-approved ADR/PRD exception is needed. The existing minimal-API HTML-string renderer was an interim implementation and has been replaced for page routes. Minimal endpoints remain for health, robots and sitemap, which return data rather than pages.

The server renders approved, validated Markdown into HTML before sending a response. TypeScript supplies optional theme, particle, table-of-contents, search, and hidden easter-egg behavior; it is not required for reading or navigation. Interactive Blazor is not enabled. The publication policy still excludes draft and unsupported-locale documents, while the 404 page remains non-indexable. The app tests assert page content in the HTTP response and the 404 behavior; browser accessibility tests remain the CI-level rendering check.
