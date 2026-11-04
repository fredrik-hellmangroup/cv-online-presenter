# Manual production recovery remediation plan

## Goal

Implement the four requested work items on an isolated worktree from `main` at
`c9f9767`, preserving existing release and rollback behavior and avoiding any
production dispatch, push, PR, tag, or deployment action.

## Completed work

1. Fixed manual runner argument binding with a hashtable splat and added a
   source-contract regression guard. Commit: `3388626`.
2. Removed the unused local-IIS scripts after a tracked repository-wide
   reference check, retained the Beebyte scripts, and updated the runbook.
   Commit: `a6a6375`.
3. Renamed the workflow and package/artifact identities, updated tests/docs,
   and neutralized shared helper output. Commit: `ea7070e`.
4. Corrected the documented deploy-job permissions and pending/LKG write
   sequence. Commit: `1d6541e`.

## Verification commands and constraints

- `pwsh -NoProfile -File .\scripts\test-production-state.ps1`
- `pwsh -NoProfile -File .\scripts\test-deploy-beebyte-iis.ps1`
- Run the commands actually configured by `.github/workflows/quality.yml`
  (including npm, .NET, content, architecture, and any workflow-defined tests).
- Parse `.github/workflows/manual-production-recovery.yml` using an available
  YAML parser.
- Search tracked files for the deleted script paths and retired workflow
  identity; expected no remaining references. Confirm required jobs/check
  names are unchanged.
- Never run a production deployment or workflow dispatch. The operator must
  cut a new release tag from fixed `main`; re-running `v1.0.12` uses pre-fix
  code.

## Risks to validate

- PowerShell named binding and conditional switch behavior.
- `PackagePath` remains passed on rollback-tag branch as before.
- Workflow display name is recorded as `GITHUB_WORKFLOW`; the state validator
  must remain compatible with existing LKG provenance.
- Artifact/package rename must keep upload, download, hash, and deploy paths
  consistent; immutable release-asset lookup remains unchanged.
- Remote branch-protection/ruleset state may not be inspectable locally; report
  any inability to verify it rather than inferring that checks are absent.

## Verification status

- Both requested PowerShell self-tests passed (`33/33` state cases and the
  Beebyte deployment helper contract tests).
- `quality.yml` restore, architecture, npm install/build/client tests/build
  metadata/content validation, .NET Release build/tests, npm audits, and
  vulnerability listing passed. .NET format verification also passed.
- All three browser-quality projects passed (Chromium: 37 passed / 1 skipped;
  Firefox and WebKit: 26 passed / 12 skipped each).
- YAML parsing, stale-reference checks, and `git diff --check` passed.
- Gitleaks could not run because Docker Desktop's Linux engine was unavailable.
- GitHub ruleset inspection confirmed the required check names are unchanged.
  Branch-protection API calls returned 404 for both `main` and
  `production-state`; the deploy-job token's repository-wide `contents: write`
  scope remains an operator/security-policy consideration and was not changed.
- No production workflow, deployment, release, or tag was triggered. Do not
  push; the operator must create a new release tag from fixed `main` because
  rerunning `v1.0.12` would still execute pre-fix code.
