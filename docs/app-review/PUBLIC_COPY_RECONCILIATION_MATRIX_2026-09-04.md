# Public privacy and deletion copy reconciliation — 2026-09-04

**Status:** Review matrix only. No public copy was changed. Technical closeout is complete; counsel approval and the resulting public-copy decision remain open.

Read-only checks on 2026-09-04 returned HTTP 200 for:

- `https://app.caseloadselect.ca/privacy`
- `https://app.caseloadselect.ca/terms`
- `https://app.caseloadselect.ca/data-deletion`

HTTP availability does not prove that the wording is approved or legally supportable. The current production source basis is merge commit `fbb6aac6712b28191de5aee79d0d4511aaaf4b59`.

| Current public statement | Engineering evidence | Decision or correction still required |
|---|---|---|
| `/privacy` says verified deletion irreversibly removes message content and direct identifiers from “active operational systems” and may retain a “de-identified row.” | Controlled redaction is deployed for the tested CaseLoad Select operational copies. It does not establish that every retained row is legally de-identified or that Meta-controlled copies are deleted. | Counsel should approve “minimal audit envelope” terminology and the tested-store boundary. Narrow “operational systems” to the copies CaseLoad Select controls if required. |
| `/privacy` and `/data-deletion` describe a minimal, non-identifying audit envelope and a three-year per-event removal target. | Expiry eligibility and invocation are implemented. The retained fields, exact timestamps, joins, tombstone, and suppression hash can still permit singling out. | Counsel must approve or revise the retained fields, join controls, clocks, and three-year maximum before these statements are treated as final assurances. |
| `/privacy` says counsel approval is required “before this revised commitment is released.” `/data-deletion` uses substantially the same formulation. | The language is already live. | Remove the self-contradictory release-gate wording after counsel decides; publish only the approved substantive promise. |
| `/privacy` says encrypted backups follow the provider's documented expiry schedule and that backup-expiry evidence plus a production rehearsal remain release gates. | PR #219 passed a fictional transactional logical-restore simulation. The production external registry, replay, current-registry audit, and activation/open postflight completed. No account-specific managed-backup/PITR expiry evidence was proved. | Counsel must decide whether qualified provider-dependent language plus the fail-closed replay control is sufficient. Do not describe PR #219 as a managed backup restore or provider-expiry proof. |
| `/data-deletion` says older records clear linked sessions, queued payloads, and attachment folders. | The fictional deletion exercises cover the tested linked stores and attachment path. | Keep a failure-aware tested-workflow boundary; do not imply universal historical coverage beyond verified stores. |
| `/data-deletion` says `completed` or `not_applicable` is an operator attestation, while `provider_managed` cannot close cleanup. | The contract is implemented and production provider rows remain pending. | Keep this distinction. Do not mark Meta cleanup complete without an applicable checked disposition. |
| `/data-deletion` says restored data cannot return to use until deletion replay is complete. | The service-only circuit, external encrypted registry, backfill, controlled replay, current-registry audit, CI restore simulation, and final locked-to-open postflight support the fail-closed design. Production opened only after exact reconciliation and activation-marker verification. | Counsel must decide whether this engineering evidence supports the final public promise and whether any managed-backup qualification is required. |
| Both pages distinguish firm-controlled and Meta/platform-controlled copies. | CaseLoad Select does not control a law firm's legal file or copies inside Messenger/Instagram. | Preserve this boundary. Never state or imply that CaseLoad Select deletes Meta's own copy. |

## Required publication sequence

1. Obtain the dated counsel decision requested in `../privacy/PRIVACY_COUNSEL_APPROVAL_REQUEST.md`.
2. Turn each matrix row into an approved keep, narrow, replace, or remove decision.
3. Implement source changes through a pushed PR and Git-integrated deployment; do not edit production directly.
4. Verify `/privacy`, `/terms`, and `/data-deletion` signed out and preserve the rendered text or screenshots.
5. Update the final Meta draft only after the published wording matches the evidence.
