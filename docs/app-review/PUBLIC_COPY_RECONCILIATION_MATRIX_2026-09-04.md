# Public privacy and deletion copy reconciliation — 2026-09-04

**Status:** Candidate source reconciliation prepared on `codex/privacy-public-copy-v1` and approved by Adriano as owner on 2026-09-04. External privacy-counsel review was waived. The candidate is not merged or released; exact-PR merge approval and post-release verification remain open.

Read-only checks on 2026-09-04 returned HTTP 200 for:

- `https://app.caseloadselect.ca/privacy`
- `https://app.caseloadselect.ca/terms`
- `https://app.caseloadselect.ca/data-deletion`

HTTP availability does not prove legal sufficiency. The production source basis audited before this candidate is merge commit `93d276606174bd20b358dffa95884c290bf96f47`. The owner's decision and residual-risk acceptance are recorded in `../privacy/OWNER_PRIVACY_AND_META_DATA_HANDLING_DECISION_2026-09-04.md`; no independent legal opinion was obtained.

| Candidate source statement | Engineering evidence | Owner decision and remaining boundary |
|---|---|---|
| `/privacy` and `/data-deletion` limit irreversible removal to message content and direct identifiers in operational copies CaseLoad Select controls. | Controlled redaction is deployed for the tested CaseLoad Select operational copies. The two Meta-derived test records remain redacted locally. | The owner accepted the tested-store boundary. The copy must not imply deletion from a law firm's files or from Meta-controlled products. |
| Both pages describe a limited audit record that excludes names, contact details, message content, platform sender IDs, and platform message IDs. They apply a three-year retention period only to retained channel audit events. | Expiry eligibility and invocation are implemented for channel audit events. Exact timestamps, UUID joins, tombstones, and salted suppression hashes can still permit singling out; the tombstone and suppression records do not yet have a three-year expiry. | The owner accepted the classification, retained fields, known join risk, channel-event period, and separate record-class treatment. The candidate does not call the remaining records legally de-identified or non-identifying. External legal review was waived. |
| The self-contradictory statement that approval must occur “before this revised commitment is released” is removed. | The provisional wording was already live, so describing its own release as future was inaccurate. | The owner approved the correction. Exact-PR merge approval and release verification remain separate gates. |
| Both pages state that application-level recovery uses encrypted deletion instructions and blocks normal use until replay is verified after a restore. They identify PR #219's evidence boundary as a fictional transactional logical-restore simulation, not a managed Supabase backup or PITR rehearsal. | PR #219 passed that simulation. The production external registry, replay, current-registry audit, and activation/open postflight completed. No account-specific managed-backup/PITR expiry evidence was proved. | The owner accepted the qualified provider-dependent backup wording and fail-closed application-level control. Do not describe PR #219 as a managed backup restore or provider-expiry proof. |
| `/data-deletion` says older records clear linked sessions, queued payloads, and attachment folders. | The fictional deletion exercises cover the tested linked stores and attachment path. | Keep a failure-aware tested-workflow boundary; do not imply universal historical coverage beyond verified stores. |
| `/data-deletion` says `completed` or `not_applicable` is an operator attestation, while `provider_managed` cannot close cleanup. | The contract is implemented and production provider rows remain pending. | Keep this distinction. Do not mark Meta cleanup complete without an applicable checked disposition. |
| `/data-deletion` says restored data cannot return to use until deletion replay is complete. | The service-only circuit, external encrypted registry, backfill, controlled replay, current-registry audit, CI restore simulation, and final locked-to-open postflight support the fail-closed design. Production opened only after exact reconciliation and activation-marker verification. | The owner accepted this application-level promise and the managed-backup qualification. No managed-backup/PITR proof is claimed. |
| Both pages distinguish firm-controlled and Meta/platform-controlled copies. | CaseLoad Select does not control a law firm's legal file or copies inside Messenger/Instagram. | Preserve this boundary. Never state or imply that CaseLoad Select deletes Meta's own copy. |

## Required publication sequence

1. Preserve the dated owner approval and counsel waiver in `../privacy/OWNER_PRIVACY_AND_META_DATA_HANDLING_DECISION_2026-09-04.md`.
2. Merge only with Adriano's explicit approval for the exact PR; deploy through Git integration and do not edit production directly.
3. Verify `/privacy`, `/terms`, and `/data-deletion` signed out and preserve the rendered text or screenshots.
4. Update the final Meta draft only after the published wording matches the evidence.
