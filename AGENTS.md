# Agent rules for caseload-select

## Production deploys: PR-merge only (issue #61)

Never run `vercel --prod`, `vercel deploy --prod`, `vercel promote`, `vercel alias set`, `vercel rollback`, or `vercel redeploy --target production` in this repository, from any tool, agent, or working tree state. Production deploys happen exactly one way: open a PR against `main`, wait for all required CI checks, merge; GitHub auto-deploys merged `main` to Vercel.

An agent may merge a PR only after all required checks pass and Adriano gives explicit approval to merge that specific PR, except under the standing prospect authorization below. Without either form of approval, leave the PR open and ask. Merge authorization concerns the GitHub merge only; it does not permit direct production deployment or bypass any required check.

### Standing prospect completion authorization (updated 2026-09-27)

Adriano explicitly directed the agents to update push and merge rules, execute all task-related pushes and merges without repeated approval, and continue until the Admin research-enrichment task is finished. This standing authorization includes this governance PR and applies to Codex, Luna and their delegated agents while that task is active. It supersedes older per-PR approval wording for this scope. Follow `docs/runbooks/prospect-enrichment-finish-plan.md` through verified completion. Before merging, verify all of the following against the final head:

- The final diff is limited to prospect research and qualification, candidate-profile display, the protected review and intake path, reconciliation, and directly related scripts, tests, and documentation. It contains no unrelated product changes.
- Necessary additive migration source, reader/intake fixes, migration-runner repairs, tests and execution documentation are within scope. Changes must preserve existing authentication, authorization, source lineage, qualification decisions and review boundaries. Unrelated product work, billing, outreach, CRM activation and weakening access controls are outside scope.
- The branch is current with `main`; all required CI checks passed on the final head; there are no unresolved review threads or required human reviews; and the agent reviewed the diff again after any branch update.
- The PR description identifies the authorized prospect task, the changed behavior, the final diff scope, and the passing checks so the merge is auditable.

Commit coherent changes and push immediately to origin on a `codex/` branch. Reuse the existing task PR where appropriate. For an eligible PR, merge through GitHub after those conditions pass and immediately continue through deployment and read-back; do not ask again for a task-scoped push or merge. A failed test or review finding requires repair and re-verification, not a routine approval request. Never force-push shared work or push directly to main.

Operational authority comes from Adriano's task authorization, not from merging code. Within that authority, use the existing protected workflows and review/import sequence for the reviewed non-destructive release and research enrichment. Generate exact scope/hash/receipt records from real reviewed inputs; do not fabricate approval evidence. Preserve all provider-enforced environment/reviewer requirements. A mandatory independent human review or automatic approval rejection is an external gate, not something to bypass.

The earlier explicit token-replacement deferral remains in force until Adriano lifts it. Do not replace or retry that credential while deferred. Continue independent work and record its exact hold. No authority is granted to erase evidence, guess identity links, clear substantive qualification/policy holds, reset a shared database password, disable required checks, or send outreach. Broader unrelated changes retain the original specific-approval rule.

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
