# Public privacy and deletion copy reconciliation — 2026-09-04

**Status:** Candidate source reconciliation prepared on `codex/privacy-public-copy-v1`. It is not merged, released, or approved by privacy counsel. Technical closeout is complete; counsel approval and the final publication decision remain open.

Read-only checks on 2026-09-04 returned HTTP 200 for:

- `https://app.caseloadselect.ca/privacy`
- `https://app.caseloadselect.ca/terms`
- `https://app.caseloadselect.ca/data-deletion`

HTTP availability does not prove that the wording is approved or legally supportable. The production source basis audited before this candidate is merge commit `93d276606174bd20b358dffa95884c290bf96f47`.

| Candidate source statement | Engineering evidence | Decision or correction still required |
|---|---|---|
| `/privacy` and `/data-deletion` limit irreversible removal to message content and direct identifiers in operational copies CaseLoad Select controls. | Controlled redaction is deployed for the tested CaseLoad Select operational copies. The two Meta-derived test records remain redacted locally. | Counsel should approve or revise the tested-store boundary. The copy must not imply deletion from a law firm's files or from Meta-controlled products. |
| Both pages describe a limited audit record that excludes names, contact details, message content, platform sender IDs, and platform message IDs. They apply a three-year retention period only to retained channel audit events. | Expiry eligibility and invocation are implemented for channel audit events. Exact timestamps, UUID joins, tombstones, and salted suppression hashes can still permit singling out; the tombstone and suppression records do not yet have a three-year expiry. | Counsel must approve or revise the classification, retained fields, join controls, channel-event period, and separate retention limits for tombstones and suppression records. The candidate does not call the remaining records legally de-identified or non-identifying. |
| The self-contradictory statement that approval must occur “before this revised commitment is released” is removed. | The provisional wording was already live, so describing its own release as future was inaccurate. | Counsel approval is still an internal Meta submission and merge gate. Its absence is not represented as approval in the public source. |
| Both pages state that application-level recovery uses encrypted deletion instructions and blocks normal use until replay is verified after a restore. They identify PR #219's evidence boundary as a fictional transactional logical-restore simulation, not a managed Supabase backup or PITR rehearsal. | PR #219 passed that simulation. The production external registry, replay, current-registry audit, and activation/open postflight completed. No account-specific managed-backup/PITR expiry evidence was proved. | Counsel must decide whether the qualified provider-dependent backup language plus the fail-closed replay control is sufficient. Do not describe PR #219 as a managed backup restore or provider-expiry proof. |
| `/data-deletion` says older records clear linked sessions, queued payloads, and attachment folders. | The fictional deletion exercises cover the tested linked stores and attachment path. | Keep a failure-aware tested-workflow boundary; do not imply universal historical coverage beyond verified stores. |
| `/data-deletion` says `completed` or `not_applicable` is an operator attestation, while `provider_managed` cannot close cleanup. | The contract is implemented and production provider rows remain pending. | Keep this distinction. Do not mark Meta cleanup complete without an applicable checked disposition. |
| `/data-deletion` says restored data cannot return to use until deletion replay is complete. | The service-only circuit, external encrypted registry, backfill, controlled replay, current-registry audit, CI restore simulation, and final locked-to-open postflight support the fail-closed design. Production opened only after exact reconciliation and activation-marker verification. | Counsel must decide whether this engineering evidence supports the final public promise and whether any managed-backup qualification is required. |
| Both pages distinguish firm-controlled and Meta/platform-controlled copies. | CaseLoad Select does not control a law firm's legal file or copies inside Messenger/Instagram. | Preserve this boundary. Never state or imply that CaseLoad Select deletes Meta's own copy. |

## Required publication sequence

1. Obtain the dated counsel decision requested in `../privacy/PRIVACY_COUNSEL_APPROVAL_REQUEST.md`.
2. Apply any counsel-required revision to this candidate and record each final keep, narrow, replace, or remove decision.
3. Merge only with Adriano's explicit approval for the exact PR; deploy through Git integration and do not edit production directly.
4. Verify `/privacy`, `/terms`, and `/data-deletion` signed out and preserve the rendered text or screenshots.
5. Update the final Meta draft only after the published wording matches the evidence.
