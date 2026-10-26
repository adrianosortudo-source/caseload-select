# Agency CRM live follow-up execution

Status: application work is on PR #426. The private execution ledger holds the exact current head, CI, acceptance evidence, production readbacks, and approval state. Refresh each before taking a release action.

## Source and safety boundary

- Worktree: D:\00_Work\01_CaseLoad_Select\.worktrees\crm-live-followup-pr426-harness-fix-20261024
- Local branch: codex/crm-live-followup-pr426-harness-fix-20261024; PR branch: codex/crm-live-followup-final-gates-20261024
- Canonical repo: D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-app
- Preserve crm-followup-acceptance-20261014 and every other worktree/container; never reset, recreate, delete, or prune them.
- PR #426 is additive to the completed prior work. Its own review and explicit merge authorization are required; approvals for earlier PRs do not transfer.
- Resend mode defaults to off. Never put provider or Supabase secret values in this file, source, logs, screenshots, or run manifests.
- No email, production secret, production migration, production record, campaign activation, deployment, or merge without action-specific authority.
- Only contacts with verified recorded explicit opt-in may be considered. This does not establish that a qualifying prospect exists.
- Migrations must be committed and pushed before application. PR #426 adds the Agency-specific protected workflow; production apply is blocked until the PR merges and its GitHub environment approval gate is verified. The workflow must stage and verify the full migration history, exclude the two preview-only QA files, match the exact statically reviewed pending set, and reject unexpected versions. Do not use migration repair or broad unfiltered db push.
- The handoff database gate authorizes a point-in-time provider request. Its transaction ends before the separate Resend HTTP call; do not claim that a stop or consent update is serialized against delivery during that gap.

### Last verified synthetic checkpoint

- Exact code head b6a2f9792b49cbacc11d6145caab4a741052fdc4 passed the local CRM test/typecheck/lint/diff checks, required CI run 40352911689 (11/11 jobs), and dedicated Agency database/browser walkthrough run 40352899937. The artifact was uploaded as 12665536251 with SHA-256 fc23ea3559126fba4d565e9adf1f9fbb58768bab56705116238739bd98f69bce.
- These results cover only that exact head and synthetic network-free provider. Any later source or documentation change requires fresh required CI and the exact-head Agency walkthrough. They do not prove production migration, configuration, delivery, inbox receipt, or cohort acceptance.
- The production release inventory and sensitive configuration names are maintained in the private release packet. No production migration/configuration, real send, merge, deployment, or cohort activation has occurred.

## Remaining release gates

1. Review the Agency-specific protected migration workflow and exact pending-set tests; verify the `Production prospect migrations` environment requires reviewer approval before apply. It must stage full migration history, exclude exactly the two preview-only QA files, require the pinned 18-file Agency set with no unexpected pending versions, recheck immediately before `supabase db push`, and verify the ledger delta plus empty pending plan.
2. Refresh the PR description without publishing private production inventory. Run fresh required CI and the dedicated database/browser walkthrough after all final code and documentation changes; inspect the final artifact and keep PR #426 open for review.
3. Obtain an independent review and explicit owner approval to merge PR #426. Preserve actual GitHub-required review rules; do not reuse approval or waiver from an earlier PR.
4. Prepare the exact migration, sender/reply-to, test recipient, copy, window, test record/enrollment, allowlists, side effects, and first business journey/cohort packet. Obtain separate action-specific approval before production migration, configuration, record creation, or send.
5. After approved merge, verify GitHub's automatic production deployment at the merge SHA. Do not deploy directly through Vercel. Apply migrations only after the workflow has merged, its environment reviewer gate is verified, and the owner separately approves the exact apply; then verify the production ledger and resulting grants.
6. Run exactly one authorized owner-inbox test. Verify rendered content, provider acceptance ID, signed event reconciliation, inbox receipt, and that repeat dispatch creates no second send; disable test mode afterward.
7. Select a prospect only with exact evidence of opt-in, eligibility, identity, contactability, and no reply/booking/suppression. Otherwise obtain an explicit owner deferral. Keep the persistent goal open until the approved cohort is reconciled or scope is explicitly changed.

## Acceptance commands

Run only after code is complete and on the exact pushed source SHA:

```powershell
npm test -- agency-followup
npx tsc --noEmit
npx eslint <scoped-Agency-files>
npm run agency-followup:walkthrough
npm run agency-followup:manual
```

Before the walkthrough, verify the documented disposable project ID, loopback ports, migration ledger, pushed migration hashes, service-role-only grants and Docker stack identity. Never point the synthetic runner at the linked project `ssxryjxifwiivghglqer` or any production/shared database. Record actual command lines and exit codes in the run manifest. Inspect screenshots at the plan's viewport widths; absence of a required control is a failure, not a skip.

## Release and live test gates

- Push every commit to PR #426's existing branch `codex/crm-live-followup-final-gates-20261024`; run all required checks on its final head and review the final diff.
- PR #426 needs its own explicit approval to merge; PR #407 approval/waiver does not transfer. Do not direct-deploy Vercel; verify GitHub's automatic deployment after an authorized merge.
- Before requesting action-specific approval, prepare the exact PR/head, migration and rollback details, provider account/sender configuration names (never values), approved test recipient and exact rendered copy, record/enrollment IDs, allowlists, test effects, first business journey, and exact proposed cohort with source/consent/contactability evidence.
- Production mode remains off unless the approved release packet explicitly enables the narrow test or batch-one pilot. One approved test send requires provider acceptance ID, signed delivery event, observed owner-controlled inbox receipt, and a duplicate-dispatch check. A second call must not produce another send.
- After the test, disable test mode and retain its audit evidence. Real prospect enrollment remains pending until exact cohort, copy, schedule, consent, suppression history and provider suitability are approved.

## Evidence ledger

Maintain `D:\00_Work\01_CaseLoad_Select\09_Internal\CRM_Live_Followup_20261019\EXECUTION_STATUS.md` with current phase, source SHA, dirty status, exact command/results, run IDs, evidence paths and hashes, blocker, next action, and missing owner input. Store screenshots and run manifests under ignored `test-results/agency-followup-walkthrough` or another D: path, never in this C: chat workspace.
