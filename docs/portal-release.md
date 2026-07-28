# Portal release gate

Production releases must use `scripts/portal-release.ps1`. Direct `vercel deploy --prod`, copied-file staging worktrees, and dirty worktrees are not release methods.

The script enforces one complete committed candidate, a preview deployment, an explicit database-migration confirmation when the candidate contains migrations, and an explicit visual-QA confirmation before promotion.

## Release sequence

1. Finish all intended portal work in one branch and commit it. Do not deploy selected files from another worktree.
2. Identify the current production commit SHA as `BASELINE_SHA`.
3. Run the preflight and preview:

```powershell
npm run release:portal:preflight -- -BaselineSha BASELINE_SHA
npm run release:portal:preview -- -BaselineSha BASELINE_SHA -DatabaseMigrationConfirmed
```

Only supply `-DatabaseMigrationConfirmed` when every migration in the release was applied and verified in the production database.

4. Check the preview in both roles:
   - client portal deliverables page;
   - operator portal deliverables page;
   - desktop and narrow/mobile width;
   - existing delivery actions, links, statuses, and approvals.
5. Promote that exact preview only after the checks pass:

```powershell
npm run release:portal:promote -- -PreviewUrl https://caseload-select-EXAMPLE.vercel.app -VisualQAConfirmed
```

## Non-negotiable rules

- A dirty worktree blocks all release actions.
- A preview is not production. Promotion is a separate action.
- A database migration must be applied before preview and confirmed to the script.
- If a production regression appears, promote the last known-good Vercel deployment; do not rebuild from a partial local snapshot.
