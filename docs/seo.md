# Search and sharing metadata

Public pages derive their title, description, and language from validated page metadata. The home title is used as-is when it already contains `siteName`; other titles append ` · {siteName}`. Canonical and Open Graph URLs use only the validated HTTP(S) origin in `content/site.json`, never the incoming `Host` header.

Open Graph and Twitter tags use only the existing site name, page title, description, and locale. No verified social profile or share-image asset is available in public metadata/assets, so no social handles or images are emitted.

JSON-LD describes only `WebSite` and `WebPage`, using the site name, canonical URL, published page title and description, and validated locale. No `Person` or `Organization` claims are published. JSON is serialized with the default HTML-safe encoder before insertion into the JSON-LD script element.

`/sitemap.xml` and `/llms.txt` are generated from the same publication policy as page rendering. They include only published pages/projects and canonical URLs from `siteUrl`; drafts are excluded. Both are unavailable when `siteUrl` is missing. `/robots.txt` allows indexing only in production with a configured `siteUrl`; development/staging disallow crawling and return `X-Robots-Tag: noindex, nofollow`. Unknown URLs are noindex 404 pages.

HTML, sitemap, robots, llms.txt, and static URLs without a matching revision parameter use `no-cache`. Eligible CSS, JavaScript, font, and image assets receive a one-year immutable cache only when `v` exactly matches the complete app Git revision in release metadata. The release workflow generates that metadata before publishing. Missing, unknown, or mismatched revisions fail closed to `no-cache`.

Analytics remains off. Decisions about provider, purpose, event schema, consent, and retention are required before enabling it. Do not collect form values, fingerprint visitors, or add unnecessary identifiers.
