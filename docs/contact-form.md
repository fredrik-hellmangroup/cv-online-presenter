# Contact form

The contact page (`/contact`) shows one of two things:

| State | What visitors see |
| --- | --- |
| Turnstile **and** SMTP configured, and `contactEmail` set | A contact form protected by Cloudflare Turnstile |
| Anything missing | A contact card with a `mailto:` link to `contactEmail` |

The form is never rendered half-configured. Without `contactEmail` neither is shown.

## Configuration

Set these as environment variables (double underscore as separator) or user secrets. Never commit them.

| Setting | Purpose |
| --- | --- |
| `Contact__Turnstile__SiteKey` | Public Turnstile site key, rendered on the page |
| `Contact__Turnstile__SecretKey` | Turnstile secret key, used only server-side to verify tokens |
| `Contact__Smtp__Host` | SMTP server |
| `Contact__Smtp__Port` | SMTP port, default `587` |
| `Contact__Smtp__EnableSsl` | STARTTLS/TLS, default `true` |
| `Contact__Smtp__UserName` / `Contact__Smtp__Password` | SMTP credentials (optional for relays without authentication) |
| `Contact__Smtp__From` | Sender address; must be allowed by the SMTP server |

The recipient is `contactEmail` in `content/site.json`. The visitor's address is set as `Reply-To`.

Create the site key and secret in the Cloudflare dashboard (Turnstile) and add the production hostname to the allowed domains. Cloudflare also publishes test keys for local development.

## How it works

- Static SSR form posted to `/contact` with an antiforgery token. Turnstile needs JavaScript; the `noscript` text points to the `mailto:` address.
- Server steps in order: honeypot (a filled hidden field pretends success and sends nothing), validation (name, email, message length), Turnstile verification against `siteverify`, then SMTP delivery. Verification fails closed.
- Rate limit: 5 submissions per client address per 10 minutes, then HTTP 429. Addresses are held in memory only.
- Name and email are stripped of control characters so they cannot inject mail headers.
- Success redirects to `/contact?sent=1` (post/redirect/get).

## Content Security Policy

The strict policy is unchanged everywhere else. Only `/contact`, and only when the form is enabled, additionally allows `https://challenges.cloudflare.com` in `script-src`, `frame-src` and `connect-src`. This is the one external runtime dependency in the site and is covered by the owner's decision on OQ-09.

## Privacy

Messages are only forwarded by email; nothing is stored in a database and message content, names, email addresses and client addresses are never logged (see [observability.md](observability.md)). Turnstile receives the visitor's browser signals and, when available, the client address for verification. Update the site's privacy wording before enabling the form.

## Local test

Use Cloudflare's test keys (`1x00000000000000000000AA` site key, `1x0000000000000000000000000000000AA` secret) and a local SMTP sink on port 2525 with `Contact__Smtp__EnableSsl=false`.
