# Agency CRM live follow-up execution

Status: implementation in progress. Production delivery is disabled until a separately approved release/test packet authorizes each external action.

## Source and safety boundary

- Worktree: `D:\00_Work\01_CaseLoad_Select\.worktrees\crm-live-followup-20261019`
- Branch: `codex/crm-live-followup-20261019`
- Current refreshed baseline: `5f96d8162550585a53c813de094163365d51ec2c`
- Canonical repo: `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-app`
- Preserve `crm-followup-acceptance-20261014`; do not reset, recreate, or modify it.
- Resend mode defaults to `off`. Never put provider or Supabase secrets in this file, source, logs, screenshots, or run manifests.
- Do not send email, configure production secrets, apply a production migration, create production records, activate a campaign, or merge without action-specific authority.
- Resend requires verified explicit opt-in. The current Agency prospect model stores eligibility evidence references and operational contactability, but that does not establish opt-in. Keep the live cohort gate closed until exact evidence is reviewed.
- Migrations must be committed and pushed before applying them to the disposable database. Verify the exact migration ledger version and hash first.

## Implementation sequence

1. Separate the reusable Agency repository/dispatcher from the fake adapter without changing current claim, lease, identity, approval, suppression, spacing, retry, and UNKNOWN behavior.
2. Implement a dedicated Resend adapter. Require verified sender, monitored reply address, explicit send mode and exact allowlists. Use the stable logical idempotency key. Missing or invalid provider configuration blocks delivery.
3. Persist provider message IDs and accepted time atomically with durable logical-message uniqueness. Preserve UNKNOWN quarantine on ambiguous handoff or post-acceptance persistence failure.
4. Add an authenticated cron dispatch route. Disabled mode returns before any claim. Bound batch size and sanitize responses.
5. Add signed Resend webhook reconciliation using the raw request body. Enforce unique provider event identity, exact provider-message/recipient fingerprint mapping, duplicate/out-of-order safety, and shared bounce/complaint/unsubscribe suppression.
   - An early `unmatched_message` event is stored without PII and returns 503 so the provider retries. After acceptance is persisted, an identical signed replay may create one append-only application row and apply side effects transactionally. The inbox row retains its original first-receipt result; the application row is the authoritative resolved message/source binding.
   - `unmatched_recipient`, `unmatched_source`, and `ambiguous_source` remain quarantined with no delivery or suppression side effect. They require an authorized operator database review; never rewrite an event or attach it to a guessed contact.
6. Verify reply and booking stop behavior. If automatic ingestion is absent, document operator reconciliation and require a fresh check before every pilot dispatch.
7. Update only the Agency Follow-up operator UI/API with accurate configured/mode/outcome status. Keep technical settings and secrets out of user-facing copy.
8. Add adapter, dispatch, persistence, webhook and rendered acceptance coverage. Keep synthetic provider calls network-mocked.

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
