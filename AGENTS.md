# Agent rules for caseload-select

## Production deploys: PR-merge only (issue #61)

Never run `vercel --prod`, `vercel deploy --prod`, `vercel promote`, `vercel alias set`, `vercel rollback`, or `vercel redeploy --target production` in this repository, from any tool, agent, or working tree state. Production deploys happen exactly one way: open a PR against `main`, wait for all CI checks, merge; GitHub auto-deploys merged `main` to Vercel.

Two dirty-tree direct deploys reached production on 2026-07-22 and clobbered other sessions' shipped work. A webhook alarm now emails the operator on every production deployment that is dirty, untraceable, or CI-failed, so violations are visible within about a minute.

If you believe an emergency direct deploy is required, stop and ask the operator. Do not create `.allow-direct-deploy` yourself, that sentinel is for the operator's hands only.

## Worktrees

Never commit in `D:/00_Work/01_CaseLoad_Select/05_Product/caseload-select-app` (the main checkout) if it holds another branch's uncommitted work. Create a fresh worktree from `origin/main` on the C: drive instead.
