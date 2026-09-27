# Agent rules for caseload-select

## Production deploys: PR-merge only (issue #61)

Never run `vercel --prod`, `vercel deploy --prod`, `vercel promote`, `vercel alias set`, `vercel rollback`, or `vercel redeploy --target production` in this repository, from any tool, agent, or working tree state. Production deploys happen exactly one way: open a PR against `main`, wait for all required CI checks, merge; GitHub auto-deploys merged `main` to Vercel.

An agent may merge a PR only after all required checks pass and Adriano gives explicit approval to merge that specific PR, except under the standing prospect authorization below. Without either form of approval, leave the PR open and ask. Merge authorization concerns the GitHub merge only; it does not permit direct production deployment or bypass any required check.

### Standing prospect merge authorization

Adriano authorizes agents to merge PRs that implement his ongoing CaseLoad Select prospect research, qualification, and Admin reconciliation task without asking for approval after every PR. This authorization applies only while that task remains active and Adriano has not paused or revoked it. Before merging, the agent must verify all of the following against the PR's final head:

- The final diff is limited to prospect research and qualification, candidate-profile display, the protected review and intake path, reconciliation, and directly related scripts, tests, and documentation. It contains no unrelated product changes.
- The PR does not add or alter database migrations, production data or import operations, authentication or authorization, credentials or secret handling, GitHub workflow permissions, outreach or CRM actions, or billing. Those changes require their own explicit authorization and any applicable release gate.
- The branch is current with `main`; all required CI checks passed on the final head; there are no unresolved review threads or required human reviews; and the agent reviewed the diff again after any branch update.
- The PR description identifies the authorized prospect task, the changed behavior, the final diff scope, and the passing checks so the merge is auditable.

For an eligible PR, merge through GitHub after those conditions pass and continue the task through deployment and read-back. If any condition fails, seek approval for that specific PR. Do not use this standing authorization to bypass a GitHub protection rule or an automatic approval rejection. A merge never grants permission to run a production migration, import prospect records, clear a hold, or send outreach.

Two dirty-tree direct deploys reached production on 2026-07-22 and clobbered other sessions' shipped work. A webhook alarm now emails the operator on every production deployment that is dirty, untraceable, or CI-failed, so violations are visible within about a minute.

If you believe an emergency direct deploy is required, stop and ask the operator. Do not create `.allow-direct-deploy` yourself, that sentinel is for the operator's hands only.

## Worktrees

Never commit in `D:/00_Work/01_CaseLoad_Select/05_Product/caseload-select-app` (the main checkout) if it holds another branch's uncommitted work. Create a fresh worktree from `origin/main` on the D: drive under the CaseLoad Select worktree area instead. Do not clone or create a worktree for this repository on C:.

## Full-width component text

Text inside a UI component must use that component's full usable inner width and wrap only at the component padding or a real sibling layout boundary. Do not impose arbitrary reading measures on headings, paragraphs, list items, summaries, captions or other component copy with `max-w-*`, `maxWidth`, `maxInlineSize`, `ch` widths or legacy readable-measure classes and variables.

An action, link, icon, badge or control must not reserve a horizontal track that narrows supporting copy. Put governed supporting copy in its own full-width row. If a natural mobile or card track cannot do that, document the exact rendered exception and its reason rather than relying on source layout alone.

A rendered heading, paragraph or supporting-copy block that wraps to two or more lines must not finish with an avoidable single-word final line. Fix structure first, then use natural wrapping such as `text-pretty` when needed. Do not add manual line breaks, non-breaking spaces or copy-only width caps to hide an orphan.

Editorial and functional exceptions must be genuine, narrow and reviewable. Examples include long-form legal or article reading frames, structural page or form widths, modal geometry, tables, controls, chat bubbles and functional URL truncation. Record each exception by exact file and reason in the relevant scoped contract. Do not use directory-wide exclusions, and do not classify ordinary UI cards, panels or status copy as editorial content.

Run `npm run check:secure-import-width` and `npm run test:secure-import-rendered` after changing the Clients or Secure Import component text layout or shared selectors used by that entry path.
