# Accessibility and responsive quality checks

`npm --prefix tools/a11y test` checks the published page templates in Chromium, Firefox, and WebKit. It checks for horizontal overflow at 320, 360, 768, and 1440 CSS pixels, then at 720 CSS pixels to cover the content width produced by 200% zoom on a 1440-pixel desktop viewport. Chromium runs axe-core against WCAG 2.0, 2.1, and 2.2 A/AA rules and fails for critical or serious violations.

## Manual release checklist

- Navigate every page with Tab, Shift+Tab, Enter, and Space; confirm the skip link appears first, focus remains visible, and there is no trap.
- Check the primary flow with NVDA + Firefox or VoiceOver + Safari, including headings, navigation landmark, page language, link names, and contact path.
- Check current stable Chrome, Firefox, Edge, Safari, mobile Chrome, and mobile Safari at 320, 360, 768, and 1440 CSS pixels and 200% zoom. Record browser versions and results in release notes.
- Check color contrast in each theme and confirm reduced-motion preferences are respected after themes are enabled.
- Review lab performance measurements for each release. Record LCP, CLS, and INP when field data is available.
- Verify TLS and security headers in the deployed environment; these depend on the approved IIS/reverse-proxy configuration.

The CI workflow also audits npm and NuGet dependencies and scans repository files for secrets. Production security headers and TLS are deployment checks because the deployment environment is not yet configured.

The web host sends a restrictive Content Security Policy, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy`. It suppresses the Kestrel server header. HSTS is sent only when the application is in Production, the approved `siteUrl` uses HTTPS, and the incoming request is HTTPS. TLS termination and trusted proxy configuration must be verified in IIS before release.
