# Search and sharing metadata

Public pages derive a unique HTML title and description from validated page front matter. A title that already contains `siteName` (the home page) is used as is; other titles get ` · {siteName}` appended, so the name appears once per title. Open Graph title and description use the same reviewed values. Canonical and Open Graph URLs are emitted only when `siteUrl` is configured as an absolute HTTP or HTTPS origin in `content/site.json`.

The person's name is shown once as the `h1` of the home and CV pages, together with the role (`# Name – tagline`). The header brand is a monogram with an `aria-label` carrying the full name, and the footer shows `© year` and the optional `companyName` from `site.json`.

`/sitemap.xml` lists published pages and projects only. Until `siteUrl` is set, it returns unavailable rather than publish incorrect canonical URLs. Production `robots.txt` references the sitemap; development and other staging environments disallow crawling and return `X-Robots-Tag: noindex, nofollow`.

Unknown URLs return a noindex 404 with a link to the home page. Analytics and structured data remain disabled until their owner decisions are recorded in [analytics.md](./analytics.md).
