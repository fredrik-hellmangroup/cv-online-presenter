# Owner decision register

This register maps the PRD's open questions to current safe template behavior. A safe default is not owner approval. Do not publish profile facts, contact details, images, or deployment settings until the owner confirms the corresponding decision.

| OQ | Current state | Owner input required to close |
| --- | --- | --- |
| 01 — Original ADR-001–010 and ADR-012 | Owner-provided `ADR-001-018_Sammanstallning.md` restores the source for all 18 decisions. The full text is reproduced in `docs/PRD_konsultportfolio.md` Appendix B and mapped in sections 4 and Appendix A. | Source recovery is complete. Issue #1 remains open to compare the delivered base architecture with the recovered requirements and record any deviations. |
| 02 — App/content repositories | Resolved: public app repo `cv-online-presenter`; public content repo `cv-online-presenter-content`; content commit pinned as an app submodule. Both use MIT. | None for the current template boundary. |
| 03 — First-release languages | Owner confirmed Swedish only (`sv-SE`) for the first release; no other translation is approved. | None for the first-release language decision. |
| 04 — Public facts, links, contact, images | Owner approved all information in the current CV for public display on the website. This does not approve additional contact details or external links absent from that CV. Demo profile remains synthetic and draft-only. | None for the current CV. Confirm any additional contact details or external links before publishing them. |
| 05 — Domain, TLS, IIS, deployment network | Owner selected `https://hellmangroup.se` as the default canonical URL. `siteUrl` remains configurable in `content/site.json`. The hosting provider manages IIS and TLS/certificates; the site will be served over HTTPS. No app-side IIS or TLS decision is required. The optional IIS deploy job remains disabled until its staging environment is configured. | None for the current app/hosting decision. Staging URL, network access, site/app-pool values, and runner are deployment-time settings required only if the repository's optional IIS staging workflow is enabled. |
| 06 — Open-source license | Resolved as MIT for both repositories. | None for the current template. |
| 07 — Analytics | Disabled; no analytics script, vendor, or tracking requests are configured. | Confirm to keep off or specify provider, purpose, events, consent, and retention before implementation. |
| 08 — Visual identity and image rights | Owner selected a user-provided `logo.svg`, due no later than deployment. Colors and typography may start as a design draft informed by public consultant-site research, not as a final brand standard. Use the system font stack; no external font service. Additional photographs/illustrations are out of scope. Current palette (Immersive Dark, replaces the earlier off-white/teal draft): near-black `#0a0d16`, text `#f2f4fa`, muted `#aab3c8`, orange accent `#ff6b2c` with links `#ff9a5c`, focus `#7dd3fc`; light alternative `#f7f4ee`, ink `#14161f`, accent `#c2410c`. Benchmark references: [Kvadrat](https://www.kvadrat.se/om-kvadrat/aktuellt/kvadrat-far-ny-grafisk-identitet/), [Consid](https://www.consid.com/sv/), [Ework](https://www.eworkgroup.com/sv/), [Knowit](https://www.knowit.eu/). | Provide `logo.svg` before deployment and confirm that it may be used on the website. Revisit the draft colors/type if a formal brand guide is supplied. |
| 09 — Contact flow | Owner selected an email link (`mailto:`) at first and later approved a contact form protected by Cloudflare Turnstile. The form is built but stays hidden until Turnstile and SMTP are configured; until then the page shows a contact card with a `mailto:` link to `contactEmail` (`fredrik@hellmangroup.se` in `content/content/site.json`). See [contact-form.md](contact-form.md). | Owner creates the Turnstile site, supplies SMTP credentials as secrets, and approves the privacy wording before enabling. |
| 10 — IIS SLO, backup/retention, incident owner | Out of scope for the current delivery; no production SLO, backup/retention schedule, or incident owner is declared. This does not approve production operations. | Revisit if production operations become part of scope; define targets and ownership before then. |

## Release impact

- #1 stays open for the implementation conformance review against the recovered ADR source; source and PRD traceability are now recorded.
- #7 stays open until the IIS target and deployment network in OQ-05 are configured and staging health is verified.
- #8 stays open until a rollback is demonstrated on that staging target and the result is recorded.
- #12's OQ-04 and OQ-08 decisions are recorded. The user-provided `logo.svg` remains a deployment prerequisite. OQ-05 is resolved for the current app/hosting decision; optional staging-pipeline configuration remains a deployment gate tracked by #7. OQ-10 is deferred as out of scope for the current delivery. Public release is not approved by this register.

## Tracking source

PRD version 1.1, 28 October 2026. Canonical Markdown source: `docs/PRD_konsultportfolio.md` (root copy `PRD_konsultportfolio.md` synchronized). The recovered owner source is `ADR-001-018_Sammanstallning.md`; its text is reproduced in PRD Appendix B.
