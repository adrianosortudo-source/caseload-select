# Meta App Review readiness closeout — 2026-09-04

**Status:** Preparation only. Do not upload, contact Meta or counsel, change production, or submit from this document.

This is the current Meta-only gate ledger. It supersedes older readiness statements in the v2 package where those statements describe the external deletion registry or restore/replay control as unimplemented.

## Current production evidence

- Production is deployed from merge commit `6f6c59330d94d84b1fc3bc63fb76d8830d3c8644`.
- The production migration ledger contains `20260903140551_privacy_external_deletion_registry_recovery_control`, `20260903144312_privacy_deletion_registry_saga_hardening`, and `20260903183915_privacy_deletion_registry_operational_completeness`, in that order, with live tip `20260903183915`.
- The external encrypted registry, service-only recovery controls, strict `provider_managed` semantics, initial historical backfill, and controlled global replay have been exercised in production using aggregate-only evidence.
- The production replay completed on a fresh operation for the audited cycle with two intents accounted for, zero failures, and an idempotent outcome. Database reconciliation is linked and complete. Both recovery circuits were re-locked after the operation.
- The two in-scope records remain redacted in CaseLoad Select. Their Meta provider dispositions remain pending: two pending, zero complete, zero completion timestamps, and two manifests. Nothing in this evidence claims deletion from Meta.
- PR #219 added and passed a fresh, fictional, real-Postgres transactional logical-restore simulation. It proved immediate relock, denied anonymous/authenticated recovery access, encrypted external intent survival, one applied replay, one idempotent skipped replay, pending provider state, and no Storage or provider-completion calls. It is not a managed Supabase backup or PITR rehearsal and does not prove provider backup expiry.
- The production migration ledger remains 222 entries with tip `20260903183915`.

## Technical closeout still open

- [ ] Deploy and pass a bounded, service-only current-registry audit that understands the completed replay namespaces. The earlier backfill-only audit now fails closed at fixed stage `key_shape` after replay because it intentionally recognizes only the initial-backfill key shapes.
- [ ] After that audit passes, run the final fictional end-to-end production verification and record only aggregate evidence.
- [ ] Complete the controlled production activation/open postflight. Until then, the recovery circuits remain locked and normal activation is intentionally withheld.
- [ ] Confirm the final production SHA, locked-to-open transition, authorization boundary, redaction invariants, registry reconciliation, provider-pending state, and unchanged migration ledger in `deletion-flow-verification.md`.

## Counsel and public-copy gates

- [ ] Obtain a dated written privacy-counsel decision covering retained identifiers and joins, exact timestamps, `client_request_id`, salted suppression hashes, deletion tombstones, the proposed three-year per-event period, and the public wording.
- [ ] Resolve the contradictions recorded in `PUBLIC_COPY_RECONCILIATION_MATRIX_2026-09-04.md` through a pushed PR after counsel decides. The current public pages already contain provisional language that says approval must occur “before this revised commitment is released.”
- [ ] Recheck the three public URLs signed out after any copy release and preserve rendered evidence.

## Meta-controlled-copy evidence

CaseLoad Select can prove redaction only for the Meta-derived operational copies it controls. Meta controls copies created in Messenger and Instagram before the webhook reaches CaseLoad Select.

Meta support evidence is **conditional**, not automatically a release gate. If counsel or the live App Review form requires app-specific proof of Meta-side disposition, preserve a request-specific, non-personal record showing the applicable Meta action or documented not-applicable basis, time, app/asset context, provider case or action reference if available, and outcome. Do not retain raw sender IDs, message IDs, message bodies, access tokens, or other direct identifiers in that evidence. A local `provider_managed` marker never proves completion.

No Meta deletion/not-found evidence has been obtained. The two production provider dispositions remain pending and must not be marked complete merely to satisfy App Review.

## Submission-material gates

- [x] The two v2 local videos exist, match the documented SHA-256 values, decode fully, and remain unuploaded.
- [ ] Inventory the live Meta draft without submitting it.
- [ ] Confirm the live draft contains only `pages_messaging` and the exact displayed Instagram messaging permission label.
- [ ] Recompute both video hashes immediately before upload, attach each file to the matching permission, and watch each Meta preview completely.
- [ ] Paste the final reviewed instructions, verify the signed-out public URLs, and capture the full draft with app identity and draft identifier.
- [ ] Stop for Adriano's explicit action-time approval before selecting **Submit for review**.

## Explicitly outside this Meta gate

Resend, HighLevel, and Supabase support responses and the legacy HighLevel cleanup are separate privacy-program work. They must not be added back to the Meta submission gate.
