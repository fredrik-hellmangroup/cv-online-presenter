## Release

<!-- Merging this PR creates the tag for the version below and deploys to production. -->

**New version:** `X.Y.Z` (was `A.B.C`)

**Why now / what is in this release:**

<!-- Summarize or link the merged PRs since the previous release. -->

## Checklist

- [ ] This PR changes **only** the `VERSION` file (the *Version guard* check enforces this)
- [ ] `VERSION` contains exactly `MAJOR.MINOR.PATCH` and is a patch, minor or major bump of the latest `vX.Y.Z` tag
- [ ] *Quality gates* are green on `main` for everything going out
- [ ] No pending deployment is blocking releases (`pending-v1.json` absent on `production-state`)
- [ ] I know how to roll back: revert on `main`, then release a new version (see `docs/rollback-runbook.md`)
