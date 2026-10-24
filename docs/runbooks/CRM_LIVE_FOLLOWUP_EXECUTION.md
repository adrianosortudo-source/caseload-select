# Agency CRM live follow-up execution

Status: implementation in progress. Production delivery is disabled until a separately approved release/test packet authorizes each external action.

## Source and safety boundary

- Worktree: D:\00_Work\01_CaseLoad_Select\.worktrees\crm-live-followup-final-gates-20261024
- Branch: codex/crm-live-followup-final-gates-20261024
- Base and current HEAD before local changes: a7ed25c81aea7b04f9d88afd83c91c1e16d543b7
- Canonical repo: D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-app
- Preserve crm-followup-acceptance-20261014 and every other worktree/container; never reset, recreate, delete, or prune them.
- PR #414 is complete. This is additive work on a fresh branch; its old approval does not authorize a new PR merge.
- Resend mode defaults to off. Never put provider or Supabase secrets in this file, source, logs, screenshots, or run manifests.
- No email, production secrets, production migration, production record, campaign activation, deployment, or merge without action-specific authority.
- Resend requires recorded, verified explicit opt-in. The owner specified that only contacts with explicit opt-in may be considered; this does not prove that any exact cohort has qualifying evidence.
- Migrations must be committed and pushed before application to the disposable database. Verify the exact migration ledger version and hash before applying.
- The handoff database gate authorizes a point-in-time provider request. Its database transaction ends before the separate Resend HTTP call; do not claim that a stop or consent update is serialized against delivery during that gap.

### Current implementation state

- Migration 20261024171116_agency_followup_serialized_provider_handoff_gate.sql adds database-authoritative consent/contactability/approval/schedule/predecessor checks and catalog-before-identity-before-row locking. Its BEFORE STATEMENT catalog locks serialize mapping writers before row-level triggers.
- Migration 20261024175302_agency_followup_resend_unknown_reconciliation.sql records signed Agency message/enrollment tags and reconciles only exact tagged email.sent events to UNKNOWN messages. New signed tag pairs are immutable on the provider inbox row; first successful replay binding is stored in the separate append-only application row. Legacy unmatched_message rows can be enriched only when tag capture was unavailable and prior message/enrollment binding is null.
- Both migrations and the route/provider changes are uncommitted. The exact source hashes are recorded in docs/agency-followup-operations.md; neither migration has been applied.
- The single npm ci is still running. Tests, typecheck, lint, disposable database walkthrough, and headed browser acceptance have not passed or run on this source.
- Docker Desktop UI says engine running, but docker info currently returns HTTP 500 for API v1.56 and v1.52. No disposable stack is running. Do not reset/remove Docker data or existing stacks.
- Read-only production route readback in signed-in Chrome at 2026-10-24 14:38 America/Toronto showed sending off, zero prospects, zero messages, and no drafts. Provider configuration was not exposed and remains unverified.
- The previous PR #414 CI and walkthrough runs are baseline evidence only, not evidence for this branch.

## Implementation sequence

1. Baseline delivery was merged in PR #414. Do not reopen or amend that PR.
2. The fresh branch adds the transactional final handoff authorization, message/enrollment-tagged Resend sends, and signed tagged-event reconciliation for UNKNOWN outcomes. Independent review caught and corrected a legacy replay binding defect and a mapping-writer lock-order deadlock. The corresponding contract assertions and walkthrough fixtures are updated.
3. Complete the existing npm ci. Once it exits successfully, run the focused provider, webhook route, worker, migration-contract, and tagged replay tests, then typecheck and scoped lint. Rerun any failed command after making a scoped correction. Do not call a dependency/setup failure a passing test.
4. Fetch and compare current origin/main; review the full diff and hashes; commit and push every change before applying either migration. Create a new PR and require CI to validate the exact pushed head.
5. Verify Docker and the unique disposable project/ports. Apply only the pushed migration versions to a fresh synthetic database. Run database mutation/concurrency/replay walkthroughs, headed browser acceptance at every required viewport, and save exact command/exit/result plus screenshot hashes.
6. After acceptance evidence is complete, prepare the new PR and release packet. The new PR needs its own explicit merge approval. Do not direct-deploy; verify automatic deployment only after an authorized merge.
7. Keep provider mode off until the production provider/webhook configuration and owner-controlled test recipient/copy are explicitly approved. One controlled inbox test must prove provider acceptance, signed delivery receipt, inbox receipt, and duplicate-dispatch safety. Get explicit approval for any real prospect cohort; only contacts with recorded explicit opt-in are eligible.
8. Replies and bookings remain manually reconciled through the Agency CRM activity workflow until a verified automatic integration exists. Record this operational limitation and recheck stop history before any later dispatch.

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
