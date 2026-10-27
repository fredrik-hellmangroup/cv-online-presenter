# Owner decision register

This register maps the PRD's open questions to current safe template behavior. A safe default is not owner approval. Do not publish profile facts, contact details, images, or deployment settings until the owner confirms the corresponding decision.

| OQ | Current state | Owner input required to close |
| --- | --- | --- |
| 01 — Original ADR-001–010 and ADR-012 | Source text is absent from this repository and the implementation issue threads. No missing decision is inferred. | Provide the original ADR text and confirm its requirements and traceability. |
| 02 — App/content repositories | Resolved: public app repo `cv-online-presenter`; public content repo `cv-online-presenter-content`; content commit pinned as an app submodule. Both use MIT. | None for the current template boundary. |
| 03 — First-release languages | Template supports only `sv-SE`; there is no second translation. | Confirm Swedish-only as the first public language or provide approved translations. |
| 04 — Public facts, links, contact, images | No owner profile facts, project links, contact address, or portrait are populated. Demo profile is synthetic and draft-only. | Supply and approve the exact facts, contact details, links, and images/rights for publication. |
| 05 — Domain, TLS, IIS, deployment network | `siteUrl` is unset; the IIS deploy job is disabled unless an environment variable and self-hosted runner are configured. | Provide the domain, TLS termination/certificate approach, IIS version/site, deployment network, staging URL, and runner details. |
| 06 — Open-source license | Resolved as MIT for both repositories. | None for the current template. |
| 07 — Analytics | Disabled; no analytics script, vendor, or tracking requests are configured. | Confirm to keep off or specify provider, purpose, events, consent, and retention before implementation. |
| 08 — Visual identity and image rights | No owner-specific visual identity, portrait, or image is included. | Provide approved identity assets and usage rights, or confirm a text-only first release. |
| 09 — Contact flow | No email address or form is enabled; the contact page is a template placeholder. | Choose an approved email link or a form. A form requires a separate threat model and privacy decision. |
| 10 — IIS SLO, backup/retention, incident owner | No production SLO, backup/retention schedule, or incident owner is declared. | Specify each operational target and owner before production release. |

## Release impact

- #1 stays open until OQ-01 is verified against the original ADR source.
- #7 stays open until the IIS target and deployment network in OQ-05 are configured and staging health is verified.
- #8 stays open until a rollback is demonstrated on that staging target and the result is recorded.
- #12 and the implementation tracker stay open until owner decisions are recorded. Public release is not approved by this register.

## Tracking source

PRD version 1.0, 27 October 2026. The PRD source file referenced by the GitHub tracker is currently available only in the local workspace and is not committed to this public repository.
