# Analytics and structured data

Analytics is off. The site loads no analytics vendor, sends no tracking events, and makes no analytics-related third-party request. Do not enable analytics until the owner decides the provider, purpose, event schema, consent approach, and retention period. Do not collect form values, fingerprint visitors, or add unnecessary identifiers.

Structured data is limited to JSON-LD of type `WebSite` and `WebPage`: configured site name, canonical URL from the validated `siteUrl`, published page title/description, and validated locale. Fields come from public metadata. Person, company, profile, contact, and other factual claims are not included. Serialization is HTML-safe; no CSP allowances were added.
