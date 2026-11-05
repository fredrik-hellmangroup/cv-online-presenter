# Content releases and activation

Last updated: 2026-11-06

This page describes the checked-in runtime and reusable workflow contracts.
It contains no live release IDs or personal content, and it makes no claim
that a production environment is currently configured or that a recent
production run succeeded.

## Data boundary and release layout

The public app's bundled `content/` tree is synthetic fallback content. A
private content release contains only `site.json` and `pages/`; the private
canonical source, source map, CV section rules, and generated provenance are
not copied into the release package.

```text
<ReleasesRoot>/
  active-release.txt
  activation-token.txt
  <yyyyMMdd-HHmmss>-<7-lowercase-hex>/
    site.json
    pages/
```

In the production app configuration,
[`src/Portfolio.Web/appsettings.Production.json`](../src/Portfolio.Web/appsettings.Production.json)
sets `Content:ReleasesRoot` to `App_Data/content-releases`, resolved relative
to the app directory. The app deployment script skips `App_Data`; content
uploads use the same site-root-relative releases folder. The release root must
be outside the app directory except for this documented `App_Data` location,
and the app-pool identity needs permission to write `active-release.txt`.

## Runtime selection and endpoints

At startup, when a release root is configured, the app reads
`active-release.txt`. If it names a release that loads and validates, the
runtime serves that release as an immutable snapshot. If there is no active
pointer, the bundled synthetic content is used. If the active release cannot
be loaded, the app falls back to the bundled content and logs a warning.
`site.json` and every page are validated before the snapshot is accepted.

The runtime accepts release IDs containing ASCII letters, digits, `-`, or
`_`, up to 100 characters. The stricter timestamp/commit format is used for
workflow-generated release IDs and retention eligibility; it is not the only
runtime-valid ID shape.

When a releases root is configured, the app exposes these endpoints only over
HTTPS with the `X-Content-Activation-Token` header:

- `GET /internal/content/active` returns
  `{"contentReleaseId":"<id-or-null>","contentVersion":"<snapshot-hash>"}`.
  The response describes the snapshot captured for that request.
- `POST /internal/content/preview/{releaseId}` loads and validates a candidate
  and returns a structural diff (`added`, `removed`, and `changed`) without
  switching the active snapshot.
- `POST /internal/content/activate/{releaseId}` loads and validates the
  candidate, atomically persists `active-release.txt`, swaps the in-memory
  snapshot, then attempts retention cleanup. A validation or pointer-write
  failure leaves the prior snapshot active.

The token is resolved per request. A non-whitespace configured
`Content:ActivationToken` takes precedence and is not trimmed; if it is under
32 characters, authorization fails without falling back to the file. If the
setting is unset or whitespace-only, the app reads
`<ReleasesRoot>/activation-token.txt`, trims it, and requires at least 32
characters. An invalid or missing token, non-HTTPS request, or failed
authorization returns 404. Provisioning the file therefore needs no app
restart unless a configured token override takes precedence.

## Reusable workflow contract

The public app's `validate-content.yml`, `deploy-content.yml`, and
`provision-activation-token.yml` are reusable `workflow_call` definitions; a
private content repository must provide the caller-side trigger. The
validation and deployment workflows require:

- `app_repository`, an `owner/repository` value matching
  `^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$` and identifying the repository that
  supplied the reusable workflow;
- `app_sha`, a full 40-character lowercase commit SHA identifying the
  reusable-workflow source commit and, for content validation, the private
  tree's generated `appCommitSha` provenance.

Before any app checkout, each workflow compares the inputs with
`job.workflow_repository` and `job.workflow_sha`; missing values or mismatches
fail closed. This supports a fork when its caller uses workflows from that
fork and supplies the same repository and commit. The contexts are
GitHub.com-only, so GHES is unsupported and fails closed. The caller should
still pin its `uses` reference to the same full SHA; the guard compares the
resolved workflow source identity, not the caller's ref text. The workflows
then check out the source repository at that SHA, verify it is reachable from
that repository's `main`, and verify checkout `HEAD`. Content validation
passes the SHA to source validation and generated-output checking, where
provenance is verified. The deployment workflow invokes validation as a local
nested reusable workflow from the same source commit.

Content validation installs and audits the app's tooling, runs synthetic
tooling tests, scans the caller repository with Gitleaks, validates source and
provenance with the pinned SHA, then runs the Node.js and .NET validators.
The source map, generator, and first-write rules are described in
[source-map.md](source-map.md).

The deploy job is serialized, uses the `production-content` environment, and
runs only for a caller ref of `main`. For a normal upload it validates
configuration, requires the releases destination to equal
`<site-name>/App_Data/content-releases`, and packages only `content/site.json`
and `content/pages/`. The release ID is the UTC timestamp
`yyyyMMdd-HHmmss`, a hyphen, and the first seven lowercase characters of the
content commit SHA. `scripts/deploy-beebyte-iis.ps1 -ContentRelease` performs
an additive Web Deploy sync into a new release folder; it does not deploy the
app, write `web.config`, take the site offline, or delete existing releases.
The script pins the Web Deploy server certificate using
`MSDEPLOY_CERTIFICATE_SHA256`.

After upload, the workflow:

1. calls `preview` over HTTPS with redirects disabled and a bounded timeout;
2. requires the response to contain `added`, `removed`, and `changed` arrays;
3. activates only after the preview response passes those checks;
4. requires a non-empty activation `toVersion`;
5. polls the protected active-release endpoint until release ID and content
   version match; and
6. requires `/health` to return HTTP 200.

For rollback, the caller may pass `activate_release_id`. The workflow skips
content validation and upload, but the deploy job still compares the app
repository/SHA with its workflow-source contexts before checkout and checks
required secrets, the activation URL, and release ID. It previews the existing
release, activates it only after a valid preview, and runs the same
active-release and health checks. The workflow input permits only 1–100 ASCII
letters, digits, `_`, or `-`; the runtime still validates the selected release
when previewing it. Use only a known existing release and stop if preview
fails or its diff is unexpected.

**Caller migration note (last inspected 2026-11-05):** the private-content
caller inspected for this documentation used the legacy `APP_REPO_REF=main`
deploy contract and did not invoke these reusable workflows with one SHA
shared across the caller reference, generator, and provenance. This is a
dated observation, not confirmation of the current private caller state. The
public reusable contract alone does not establish end-to-end caller pinning.
See [repositories.md](repositories.md#shared-content-workflow-pin).

## Token provisioning

The reusable provisioning workflow also runs only from `main`, uses the
`production-content` environment, checks the workflow-source identity before
checkout, and checks out that exact source commit. By default it selects the
`CONTENT_ACTIVATION_TOKEN_NEXT` secret; the explicit
`use_primary_secret` recovery input selects the existing primary
`CONTENT_ACTIVATION_TOKEN`. The selected token must be at least 32 characters
and have no leading or trailing whitespace. The workflow writes only
`activation-token.txt` to the exact site-root-relative releases root using
`-ActivationTokenOnly`; that mode is additive and never deletes releases.
Temporary token files and secret environment variables are removed in the
workflow's cleanup block. Provisioning does not upload content, preview a
release, or activate one.

Required environment variables and secrets are configured in GitHub and are
not documented with values:

| Workflow path | Variables in `production-content` | Secrets in `production-content` |
|---|---|---|
| Normal content upload | `MSDEPLOY_SERVER_URL`, `MSDEPLOY_SITE_NAME`, `MSDEPLOY_CERTIFICATE_SHA256`, `MSDEPLOY_CONTENT_RELEASES_PATH`, `DEPLOY_USERNAME`, `CONTENT_ACTIVATION_URL` | `DEPLOY_PASSWORD`, `CONTENT_ACTIVATION_TOKEN` |
| Existing-release rollback | `CONTENT_ACTIVATION_URL`; Web Deploy variables are not used | `DEPLOY_PASSWORD`, `CONTENT_ACTIVATION_TOKEN` |
| Token provisioning | `MSDEPLOY_SERVER_URL`, `MSDEPLOY_SITE_NAME`, `MSDEPLOY_CERTIFICATE_SHA256`, `DEPLOY_USERNAME` | `DEPLOY_PASSWORD`, `CONTENT_ACTIVATION_TOKEN`, and `CONTENT_ACTIVATION_TOKEN_NEXT` unless `use_primary_secret` selects the primary token |

For normal uploads,
`MSDEPLOY_CONTENT_RELEASES_PATH` must be exactly
`<MSDEPLOY_SITE_NAME>/App_Data/content-releases`. The activation URL must use
HTTPS. The provisioning workflow validates the Web Deploy URL and certificate
fingerprint and derives the destination rather than accepting an arbitrary
path. Environment protection and secret values are repository settings and
must be verified in GitHub.

## Retention and deletion

After activation, cleanup is post-commit, best-effort maintenance. It does not
reverse a successful activation if cleanup fails. An eligible directory must
be a direct child of the releases root, have a valid UTC timestamp and a
workflow ID matching `yyyyMMdd-HHmmss-<7 lowercase hex>`, contain exactly
`site.json` and `pages/`, contain no reparse points or unexpected files, and
fully pass the current content loader.

The active release is retained. Eligible inactive releases are ordered by
timestamp descending and then release ID using ordinal ascending order; the
first 10 are retained. The app rechecks the active pointer before cleanup and
before each deletion and never deletes the active release. Invalid,
incomplete, unreadable, unexpected-layout, or unrecognized directories are
preserved and logged, so the on-disk total can exceed 11. Eligible releases
outside the retention window are permanently deleted; this behavior is not a
backup guarantee.

Cleanup uses path-based checks and assumes the documented single app worker
and serialized, additive release writer. Revisit activation/cleanup
coordination before changing the host to a web garden, enabling overlapping
workers, or adding another release-root writer.

## Operational status

This document records implementation and workflow contracts, not live
production evidence. Before an operation, verify the current
`production-content` environment settings, caller workflow revision and SHA,
latest validation/deployment run, preview result, active-release diagnostics,
and health response. Do not infer production readiness from a local build or
from the existence of a reusable workflow file.

Related references: [repository boundaries](repositories.md),
[fork guide](fork-guide.md), [app release](iis-release.md), and
[app rollback](rollback-runbook.md).
