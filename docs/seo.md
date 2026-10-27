# Search and sharing metadata

Public pages derive a unique HTML title and description from validated page front matter. Open Graph title and description use the same reviewed values. Canonical and Open Graph URLs are emitted only when `siteUrl` is configured as an absolute HTTP or HTTPS origin in `content/site.json`.

`/sitemap.xml` lists published pages and projects only. Until `siteUrl` is set, it returns unavailable rather than publish incorrect canonical URLs. Production `robots.txt` references the sitemap; development and other staging environments disallow crawling and return `X-Robots-Tag: noindex, nofollow`.

Unknown URLs return a noindex 404 with a link to the home page. Analytics and structured data remain disabled until their owner decisions are recorded in [analytics.md](./analytics.md).
