# Agency CRM live follow-up execution

Status: implementation and synthetic acceptance are complete on the verified application-code head; PR #426 and production delivery gates remain pending.

## Source and safety boundary

- Worktree: D:\00_Work\01_CaseLoad_Select\.worktrees\crm-live-followup-pr426-harness-fix-20261024
- Local branch: codex/crm-live-followup-pr426-harness-fix-20261024; PR branch: codex/crm-live-followup-final-gates-20261024
- PR base: main at 1941cf69539b2914d7762d9146c4f50bb0b721df; tested application-code head: ad2810273542650556e3a4a74709d4224ab20383
- Canonical repo: D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-app
- Preserve crm-followup-acceptance-20261014 and every other worktree/container; never reset, recreate, delete, or prune them.
- PR #414 is complete. This is additive work on a fresh branch; its old approval does not authorize a new PR merge.
- Resend mode defaults to off. Never put provider or Supabase secrets in this file, source, logs, screenshots, or run manifests.
- No email, production secrets, production migration, production record, campaign activation, deployment, or merge without action-specific authority.
- Resend requires recorded, verified explicit opt-in. The owner specified that only contacts with explicit opt-in may be considered; this does not prove that any exact cohort has qualifying evidence.
- Migrations must be committed and pushed before application to the disposable database. Verify the exact migration ledger version and hash before applying.
- The handoff database gate authorizes a point-in-time provider request. Its database transaction ends before the separate Resend HTTP call; do not claim that a stop or consent update is serialized against delivery during that gap.

### Verified release checkpoint — 2026-10-24 23:11 America/Toronto

- PR #426 is open, draft, and unmerged. Its PR-specific review and merge authorization are still missing; prior PR approval does not transfer.
- Exact application-code head `ad2810273542650556e3a4a74709d4224ab20383` passed CI run 40155104689 (11/11 jobs) and dedicated Agency walkthrough run 40155101807. The walkthrough used a fresh disposable Supabase project, exact pushed migrations, fake network-free provider, actual browser interactions, and cleanup. Artifact 12583828909 digest: `sha256:8a56a08fb12c2b21bcb192cc8b49a644aa574c701ff1226eb7710d2c1b31a565`; all 26 image hashes matched.
- The dedicated walkthrough workflow for this release branch runs on every push. Any final PR head, including a documentation-only update, needs fresh CI and walkthrough evidence before merge; run IDs and hashes are kept in the internal execution ledger.
- Production Supabase project `caseload-select-ca` (`ssxryjxifwiivghglqer`) has latest ledger `20261023214500`; only two Agency versions are recorded. Fifteen source versions are missing remotely: eleven already on main and four from PR #426. The internal ledger records exact filenames and SHA-256 hashes.
- Production Vercel environment names show `RESEND_API_KEY` and `CRON_SECRET` present; all seven Agency mode/sender/reply-to/webhook/allowlist settings are absent. Secret values were not read.
- The last production operator-page readback at 2026-10-24 14:38 America/Toronto showed sending off, zero prospects/messages/drafts; provider configuration was not displayed. No production migration/configuration, send, deployment, merge, or cohort activation has occurred.
- Docker Desktop UI reports Engine running; this Codex session gets permission denied on the Linux-engine named pipe. Desktop Commander is offline and the Docker MCP Toolkit is not connected to an engine-control tool. The hosted walkthrough passed; no local Docker settings or data were changed.
- No exact owner-controlled inbox, test record, or eligible prospect has been approved for a real send. The owner specified explicit opt-in only; an exact qualifying prospect and consent evidence are not yet identified. Reply/booking reconciliation remains an operator task.

## Remaining release gates

1. Confirm fresh required CI and dedicated walkthrough have passed on the final pushed PR head after the current documentation update; keep PR #426 draft until review is resolved.
2. Obtain independent review and explicit owner approval to merge PR #426. Preserve actual branch-protection review requirements; do not reuse approval/waiver from PR #407 or #414.
3. Present the concrete production action packet and obtain separate approval for applying all 15 pushed migrations in order, configuring the seven missing Agency settings, creating the exact test record/template/journey, and sending the one approved owner-inbox test.
4. Before any send, bind the existing verified sender and monitored reply-to to the exact approved values; set test mode with exact recipient plus test-record allowlists and keep live mode off. Use the saved test subject/body with the recorded run ID.
5. After exact PR approval, merge through GitHub and verify automatic Vercel deployment at the merge SHA. Apply migrations only through the supported protected route and verify the production ledger; do not use direct Vercel deployment or migration repair.
6. Run exactly one authorized test send. Verify persisted provider ID, signed event, owner inbox receipt, and that a repeat dispatch makes no additional send; disable test mode afterward.
7. Identify one exact prospect only if its feature-specific evidence proves explicit opt-in, eligibility, current contactability, and no reply/booking/suppression. Otherwise obtain an explicit owner deferral. Keep the production goal open until the approved cohort is reconciled or the owner records a scope change.

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

- Push every commit to this branch. Open a new PR against current `main`; run all required checks on its final head and review the final diff.
- The new PR needs its own explicit approval to merge; PR #407 approval/waiver does not transfer. Do not direct-deploy Vercel; verify GitHub's automatic deployment after an authorized merge.
- Before requesting action-specific approval, prepare the exact PR/head, migration and rollback details, provider account/sender configuration names (never values), approved test recipient and exact rendered copy, record/enrollment IDs, allowlists, test effects, first business journey, and exact proposed cohort with source/consent/contactability evidence.
- Production mode remains off unless the approved release packet explicitly enables the narrow test or batch-one pilot. One approved test send requires provider acceptance ID, signed delivery event, observed owner-controlled inbox receipt, and a duplicate-dispatch check. A second call must not produce another send.
- After the test, disable test mode and retain its audit evidence. Real prospect enrollment remains pending until exact cohort, copy, schedule, consent, suppression history and provider suitability are approved.

## Evidence ledger

Maintain `D:\00_Work\01_CaseLoad_Select\09_Internal\CRM_Live_Followup_20261019\EXECUTION_STATUS.md` with current phase, source SHA, dirty status, exact command/results, run IDs, evidence paths and hashes, blocker, next action, and missing owner input. Store screenshots and run manifests under ignored `test-results/agency-followup-walkthrough` or another D: path, never in this C: chat workspace.
