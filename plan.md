# Manual production recovery remediation plan

## Goal

Implement the four requested work items on an isolated worktree from `main` at
`c9f9767`, preserving existing release and rollback behavior and avoiding any
production dispatch, push, PR, tag, or deployment action.

## Execution sequence

1. **Fix manual runner binding** in the renamed manual workflow using a
   hashtable splat. Continue passing `PackagePath` unconditionally, including
   rollback-tag runs; add `ManualMain` and `AllowPendingRecovery` only when
   their existing conditions are true. Add a source-contract regression
   assertion in `test-deploy-beebyte-iis.ps1`.
2. **Remove legacy local-IIS scripts** only after a tracked repository-wide
   reference check. Update rollback runbook wording, delete the two unused
   local-IIS scripts, and retain all listed Beebyte and
   production-state scripts.
3. **Rename the manual workflow** to
   `.github/workflows/manual-production-recovery.yml`. Update workflow/run
   names, step labels, errors, ZIP/artifact names, tests, helper output wording,
   and all documentation references, including `rollback-exercise.md`.
   Preserve job IDs/matrix names and immutable release-asset naming. Check
   workflow dispatch/run and required-check references without triggering any
   workflow.
4. **Correct deployment documentation** to describe `contents: write` on the
   deploy job and the durable pending-state commit before first sync, followed
   by same-job verification, LKG update, and pending clear.
5. **Verify and review:** run both requested PowerShell self-tests; execute
   actual `quality.yml` local-equivalent gates; parse the renamed YAML; confirm
   no old script/workflow references remain; obtain read-only correctness,
   security, conventions, and applicable PowerShell/workflow review. Address
   blockers and rerun affected checks.
6. **Commit per logical step** after checks: argument-binding regression fix;
   legacy-script retirement; workflow rename and dependent references; state
   permissions documentation. Do not push.

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
