# Public privacy and deletion copy reconciliation — 2026-09-04

**Status:** Published and verified. Adriano approved the reconciled wording as owner and explicitly approved PR #223, which merged on 2026-09-04. External privacy-counsel review was waived. Signed-out HTTP and key-copy checks of the canonical public pages passed after release.

Read-only checks on 2026-09-04 returned HTTP 200 for:

- `https://caseloadselect.ca/privacy`
- `https://caseloadselect.ca/terms`
- `https://caseloadselect.ca/data-deletion`

HTTP availability does not prove legal sufficiency. The production source basis audited before this candidate is merge commit `93d276606174bd20b358dffa95884c290bf96f47`. The owner's decision and residual-risk acceptance are recorded in `../privacy/OWNER_PRIVACY_AND_META_DATA_HANDLING_DECISION_2026-09-04.md`; no independent legal opinion was obtained.

| Candidate source statement | Engineering evidence | Owner decision and remaining boundary |
|---|---|---|
| `/privacy` and `/data-deletion` limit irreversible removal to message content and direct identifiers in operational copies CaseLoad Select controls. | Controlled redaction is deployed for the tested CaseLoad Select operational copies. The two Meta-derived test records remain redacted locally. | The owner accepted the tested-store boundary. The copy must not imply deletion from a law firm's files or from Meta-controlled products. |
| Both pages describe a limited audit record that excludes names, contact details, message content, platform sender IDs, and platform message IDs. They apply a three-year retention period only to retained channel audit events. | Expiry eligibility and invocation are implemented for channel audit events. Exact timestamps, UUID joins, tombstones, and salted suppression hashes can still permit singling out; the tombstone and suppression records do not yet have a three-year expiry. | The owner accepted the classification, retained fields, known join risk, channel-event period, and separate record-class treatment. The candidate does not call the remaining records legally de-identified or non-identifying. External legal review was waived. |
| The self-contradictory statement that approval must occur “before this revised commitment is released” is removed. | The provisional wording was already live, so describing its own release as future was inaccurate. | The owner approved the correction. PR #223 merge approval and release verification are complete. |
| Both pages state that application-level recovery uses encrypted deletion instructions and blocks normal use until replay is verified after a restore. They identify PR #219's evidence boundary as a fictional transactional logical-restore simulation, not a managed Supabase backup or PITR rehearsal. | PR #219 passed that simulation. The production external registry, replay, current-registry audit, and activation/open postflight completed. No account-specific managed-backup/PITR expiry evidence was proved. | The owner accepted the qualified provider-dependent backup wording and fail-closed application-level control. Do not describe PR #219 as a managed backup restore or provider-expiry proof. |
| `/data-deletion` says older records clear linked sessions, queued payloads, and attachment folders. | The fictional deletion exercises cover the tested linked stores and attachment path. | Keep a failure-aware tested-workflow boundary; do not imply universal historical coverage beyond verified stores. |
| `/data-deletion` says `completed` or `not_applicable` is an operator attestation, while `provider_managed` cannot close cleanup. | The contract is implemented and production provider rows remain pending. | Keep this distinction. Do not mark Meta cleanup complete without an applicable checked disposition. |
| `/data-deletion` says restored data cannot return to use until deletion replay is complete. | The service-only circuit, external encrypted registry, backfill, controlled replay, current-registry audit, CI restore simulation, and final locked-to-open postflight support the fail-closed design. Production opened only after exact reconciliation and activation-marker verification. | The owner accepted this application-level promise and the managed-backup qualification. No managed-backup/PITR proof is claimed. |
| Both pages distinguish firm-controlled and Meta/platform-controlled copies. | CaseLoad Select does not control a law firm's legal file or copies inside Messenger/Instagram. | Preserve this boundary. Never state or imply that CaseLoad Select deletes Meta's own copy. |

## Publication record

1. [x] The dated owner approval and counsel waiver are preserved in `../privacy/OWNER_PRIVACY_AND_META_DATA_HANDLING_DECISION_2026-09-04.md`.
2. [x] PR #223 merged with Adriano's explicit approval through the Git release path.
3. [x] `/privacy`, `/terms`, and `/data-deletion` returned HTTP 200 signed out at `caseloadselect.ca` on 2026-09-04, and the released HTML contained the approved audit-record, recovery-control, controlled-redaction, and provider-boundary statements.
4. [ ] Update the final Meta draft using only the canonical public URLs above.
