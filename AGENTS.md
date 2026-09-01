# Agent rules for caseload-select

## Production deploys: PR-merge only (issue #61)

Never run `vercel --prod`, `vercel deploy --prod`, `vercel promote`, `vercel alias set`, `vercel rollback`, or `vercel redeploy --target production` in this repository, from any tool, agent, or working tree state. Production deploys happen exactly one way: open a PR against `main`, wait for all required CI checks, merge; GitHub auto-deploys merged `main` to Vercel.

An agent may merge a PR only after all required checks pass and Adriano gives explicit approval to merge that specific PR. Without that explicit approval, leave the PR open and ask. This authorization concerns the GitHub merge only; it does not permit direct production deployment or bypass any required check.

Two dirty-tree direct deploys reached production on 2026-07-22 and clobbered other sessions' shipped work. A webhook alarm now emails the operator on every production deployment that is dirty, untraceable, or CI-failed, so violations are visible within about a minute.

If you believe an emergency direct deploy is required, stop and ask the operator. Do not create `.allow-direct-deploy` yourself, that sentinel is for the operator's hands only.

## Worktrees

Never commit in `D:/00_Work/01_CaseLoad_Select/05_Product/caseload-select-app` (the main checkout) if it holds another branch's uncommitted work. Create a fresh worktree from `origin/main` on the D: drive under the CaseLoad Select worktree area instead. Do not clone or create a worktree for this repository on C:.

## Full-width component text

Text inside a UI component must use that component's full usable inner width and wrap only at the component padding or a real sibling layout boundary. Do not impose arbitrary reading measures on headings, paragraphs, list items, summaries, captions or other component copy with `max-w-*`, `maxWidth`, `maxInlineSize`, `ch` widths or legacy readable-measure classes and variables.

Editorial and functional exceptions must be genuine, narrow and reviewable. Examples include long-form legal or article reading frames, structural page or form widths, modal geometry, tables, controls, chat bubbles and functional URL truncation. Record each exception by exact file and reason in the component-text width contract. Do not use directory-wide exclusions, and do not classify ordinary UI cards, panels, status copy or marketing sections as editorial content.

Run `npm run check:component-text-width` after changing UI copy layout, shared component styles or an approved exception.
