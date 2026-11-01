# Architecture decision records

## Confirmed for this baseline

- **Contact form (OQ-09):** owner-approved Cloudflare Turnstile contact form, hidden until Turnstile and SMTP are configured, with a `mailto:` contact card as the fallback. Details and the CSP exception are in [../contact-form.md](../contact-form.md).

- **ADR-001–010 and ADR-012:** original text recovered; see the PRD's section 4 and Appendix B for the decision summary, source text, and requirement mappings.
- **ADR-011 — Defense in Depth, Solo Maintainer:** apply layered security while keeping maintenance practical; isolate release inputs and production deployment. The later owner decision to keep the CV content private and deliver it as content releases is reconciled in PRD section 4.
- **ADR-013 — Automated validation and manual publishing:** deterministic validation and explicit release approval; no AI in the app, CI, review, or publishing flow.
- **ADR-014 — Multilingual-ready and accessible:** support Swedish and English when CV files exist; initial release is Swedish only; WCAG 2.2 AA is the target.
- **ADR-015 — Modular monolith:** separate Web, Content, Experience, Publishing, Infrastructure, and Contracts projects, with a separate TypeScript build.
- **ADR-016 — Developer-first open source:** reproducible setup, clearly marked demo content, documentation, and independent validation are product requirements.
- **ADR-017 — Personal open source showcase:** the product can showcase verified open source work.
- **ADR-018 — Vertical slices:** deliver working end-to-end capabilities incrementally.

## Traceability status

The owner-provided source is `ADR-001-018_Sammanstallning.md`; it is reproduced verbatim in Appendix B of the PRD. Section 4 records later owner-confirmed decisions that reconcile differences from the original ADRs. Issue #1 is closed; the follow-up gaps are tracked in issues #25–#32.
