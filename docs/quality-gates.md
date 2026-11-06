# Quality gates and ownership

Last updated: 2026-11-06

The checked-in workflows define the gates below; a workflow file alone does
not prove that a particular run or external repository ruleset is green.

```mermaid
flowchart LR
    PR["App pull request"] --> AQ["Public quality.yml"]
    MAIN["App push to main"] --> AQ
    AQ --> C["Build, tests, security, synthetic content"]
    PR --> B["Browser matrix"]
    CP["Private content PR or push to main"] --> V["content.yml: validate"]
    CM["Main push: pages/** or site.json"] --> D["Deploy workflow"]
    D --> DV["Validate, upload, preview, activate"]
    DV --> R["Content runtime"]
```

## Public app workflow

`.github/workflows/quality.yml` runs on pull requests and pushes to `main`.
External Actions from GitHub (`actions/*`) use exact version tags (`vX.Y.Z`);
any other publisher must be pinned to a full commit SHA. Dependabot proposes
updates, and the workflow-contract tests enforce the rule.

| Job | When | Checks |
|---|---|---|
| `build-and-security` | Pull request and `main` push | .NET and Node setup/restore; module-boundary check; `npm run test:content`; workflow-contract tests; source-map validation, generated-output check, and Node content validation against the synthetic app tree; client build and tests; .NET build and tests; .NET content validation; npm audits; Gitleaks; vulnerable transitive package scan. |
| `deployment-safety-tests` | Pull request and `main` push | Windows tests for production-deployment state recovery and version-bump validation. |
| `browser-quality` | Pull request only | Playwright matrix for Chromium, Firefox, and WebKit on Windows; it depends on `build-and-security`. |

The content commands in this app workflow use the public synthetic tree. They
do not read a private CV repository. The public job IDs and browser matrix are
visible in YAML; which statuses are required by a GitHub branch ruleset and
which environments require approval are external repository settings and must
be checked there.

## Private content validation workflow

The private caller validates pull requests and pushes to `main`. Its deploy
workflow runs on `main` changes to `content/pages/**` or `content/site.json`
and validates again before packaging. The caller pins reusable-workflow
references to an exact release tag such as `@v1.0.15`; keep it aligned with the
app release used for generation and recorded in provenance. This caller
configuration is not stored in the public repository.

The reusable `.github/workflows/validate-content.yml` requires
`app_repository`. Before checkout, it compares it with
`job.workflow_repository`, and derives the commit and release tag from
`job.workflow_sha` and `job.workflow_ref`; missing contexts, a non-tag ref, or
mismatches fail closed. These contexts are GitHub.com-only, so the reusable
workflow does not run successfully on GHES. It checks out that exact commit,
verifies it is reachable from that repository's `main`, that the tag resolves
to it, and that `VERSION` matches, then passes the version to
source validation and generated-output checking; `content:check` verifies
generated provenance. It also runs content-tooling tests and npm audit, scans
the caller repository with Gitleaks, then validates private content using the
Node.js and .NET validators. The deploy workflow's exact behavior is in
[content-releases.md](content-releases.md); the shared identity contract is in
[repositories.md](repositories.md#shared-content-workflow-pin).

## App release and manual recovery

`release.yml` runs for version-shaped tags, rejects tags outside
`vMAJOR.MINOR.PATCH`, and requires the tagged commit to be reachable from
`main`. It builds the client, validates the app's bundled content, publishes
the app, records the package SHA-256, and deploys through
`production-msdeploy`. It does **not** rerun the full Node or .NET test suites.

`manual-production-recovery.yml` can run only from `main` and requires an
explicit `confirm_production` input. A rollback download must be an existing
eligible tag asset whose SHA-256 matches GitHub's recorded digest. Production
state, package identity, and health/build metadata are verified by the
deployment script before state is marked last-known-good. See
[rollback-runbook.md](rollback-runbook.md).

## Current verification status

On 2026-11-06, `npm run test:content` was run in this shared-tooling worktree
using synthetic fixtures. It exited successfully with **156 passing, 0
failing, and 4 skipped (160 total)**. The skipped tests require POSIX FIFO
behavior, which is unavailable on Windows. The source-map hierarchy and
structural-heading tests, approved-route checks, and filesystem/reparse-point
checks passed. The finalized workflow-contract suite also passed locally:
**4 passing, 0 failing**. GitHub Actions smoke PR #26 passed both direct and
nested reusable-workflow identity checks against the expected repository and
SHA.

Related references: [repository boundaries](repositories.md),
[source-map behavior](source-map.md), [Markdown content format](content.md),
and [content releases](content-releases.md).
