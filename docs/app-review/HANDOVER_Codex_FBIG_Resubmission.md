# Handover: Meta App Review, Facebook and Instagram resubmission

Owner: Adriano Domingues

App ID: `1007304805285554`

Original submission ID: `1016624077686960`

Technical privacy activation baseline: `fbb6aac6712b28191de5aee79d0d4511aaaf4b59`, deployed to both production projects

Current Meta-only gate ledger: `META_READINESS_CLOSEOUT_2026-09-04.md`

## Current decision and release state

Adriano selected Option B on 2026-09-01. The channel conversation panel and operator-authored reply path are shipped. Do not reopen Option A unless Adriano asks.

Release evidence:

- PR #191 merged the Option B conversation ledger, portal panel, reply route, and tests.
- PR #193 merged the rendered-copy QA harness and related copy correction.
- PR #195 merged the ledger ACL hardening.
- PR #198 merged the controlled-redaction application and migration. PR #199 corrected the migration runtime failure.
- PR #202 merged the strict external-cleanup completion semantics: `provider_managed` is a location marker and cannot complete a deletion request. PRs through #219 implemented and tested the encrypted external registry, fail-closed recovery controls, backfill/replay flow, bounded diagnostics, and fictional transactional logical-restore simulation. PR #221 added the bounded current-registry audit, and PR #222 added the audited locked-to-open transition.
- The technical privacy activation baseline is merge `fbb6aac6712b28191de5aee79d0d4511aaaf4b59`; later documentation-only merges do not change that runtime evidence.
- Migrations through `20260904125000_privacy_recovery_open_from_locked` are applied in production; the ledger has 223 entries with that migration as its tip.
- The conversation ledger is append-only. `service_role` has SELECT and INSERT only. Browser roles and PUBLIC have no table privileges. RLS is enabled and forced with no policies.
- The fresh fictional post-ledger deletion rehearsal passed the CaseLoad Select database, application, Storage, authorization, idempotency, tenant-isolation, append-only, pending-message, and expiry-invocation checks recorded in `deletion-flow-verification.md`.
- After deployment of `20260903011450`, a second fictional production verification ran entirely inside one rollback-only transaction. It confirmed that `provider_managed` is rejected as completion evidence and leaves the request pending; a complete/not-applicable disposition closes the request idempotently; Messenger-style direct identifiers and content are removed from the screened lead, conversation event, channel session, unconfirmed inquiry, and processed-message claim; suppression prevents those Meta-derived operational copies from being recreated; and rollback left zero fixture rows. No external provider send or deletion was attempted.

The live Messenger and Instagram rehearsals passed, and both continuous local v2 clips passed content and technical verification. The current-registry audit and production activation closeout also passed. Adriano's owner approval, counsel waiver, and Meta Data Handling decisions are recorded in `../privacy/OWNER_PRIVACY_AND_META_DATA_HANDLING_DECISION_2026-09-04.md`. PR #223 merged the owner-approved public copy, and signed-out checks confirmed the canonical `caseloadselect.ca` policy URLs and key approved wording. Remaining work is limited to live Meta draft and Data Handling changes, immediate pre-upload hash and playback checks, final draft evidence, and Adriano's approved submission action.

## Authority and scope

These are the active files for the resubmission:

1. `PERMISSION_CODE_PATH_EVIDENCE_v2.md`: permission decision and source evidence.
2. `RUNBOOK_Resubmission_v2.md`: operator sequence and stop gates.
3. `screencasts/SHOTLIST_v2.md`: recording script and clip QA.
4. `Reviewer_Instructions_Paste_v2.md`: text for the reviewer-instructions field.
5. `FINAL_META_SUBMISSION_INVENTORY_v2.md`: final package and upload inventory.
6. `META_READINESS_CLOSEOUT_2026-09-04.md`: current Meta-only gate ledger.
7. `PUBLIC_COPY_RECONCILIATION_MATRIX_2026-09-04.md`: published owner-approved copy and verification record.
8. `deletion-flow-verification.md`: append-only engineering evidence.
9. `../privacy/OWNER_PRIVACY_AND_META_DATA_HANDLING_DECISION_2026-09-04.md`: owner decision, counsel waiver, and Meta Data Handling answers.
10. `../privacy/PRIVACY_COUNSEL_APPROVAL_REQUEST.md`: unsent historical counsel dossier; review was waived for this release.

`Phase11_Submission_Package.md`, `Reviewer_Instructions_Paste.md`, and `screencasts/README.md` are first-submission archives. Do not paste or execute them for this resubmission.

This handover does not authorize an agent to access Meta, record, upload, submit, merge, deploy, change production configuration, rotate credentials, or delete production data. Meta UI actions and final submission belong to Adriano.

## What changed from the first submission

The reviewer asked to see three beats:

1. the Meta asset identity;
2. a live send action from the app UI;
3. the same message delivered in the native client.

The first recordings showed an inbound flow and automatic replies. They did not show an operator send from the CaseLoad Select UI. Option B closes that evidence gap with a real portal compose surface.

On a channel-sourced brief, the production UI now shows:

- heading `Message thread`;
- a separate `Channel:` metadata row;
- `Firm workspace:` as CaseLoad Select workspace context;
- `Configured Meta asset ID:` as numeric configuration context;
- button `Send reply`;
- verified success text `Reply sent.`.

The workspace name and numeric asset ID are not authoritative Meta identity proof. Each recording must show the Page name or Instagram handle in Meta UI.

## Permission decision

The two business capabilities under review are:

- `pages_messaging`;
- the exact live Meta dashboard label for Instagram messaging. The source-supported capability is currently documented as `instagram_manage_messages`.

Also include the four unique Meta-declared technical dependencies: `instagram_basic`, `pages_read_engagement`, and `pages_show_list` for legacy `instagram_manage_messages`; and `pages_manage_metadata` plus `pages_show_list` for `pages_messaging`. Describe them only as dependencies of the related recorded messaging flow, not standalone product capabilities.

Do not re-request `business_management` unless the live form identifies another mandatory dependency and that change is separately reviewed.

Never resubmit the three approved scopes:

- `whatsapp_business_messaging`;
- `whatsapp_business_management`;
- `public_profile`.

If Meta displays a dependency or a different Instagram permission label, capture the exact form text and stop. Do not infer a code path or widen the request.

## Production controls that must appear in the rehearsal

- The signed-in operator or lawyer must have a stable UUID member identity. A missing or legacy identity returns `403` with `reauth_required`.
- Support preview must be off. It is read-only.
- A fresh, signed inbound webhook event must keep the strict 24-hour reply window open.
- The test must use a fresh fictional conversation and no real client data.
- The portal must display the recent inbound message before the operator sends.
- The operator must type the proof string and click `Send reply` once.
- Only a server-verified terminal sent event produces `Reply sent.`.
- `delivery_unknown`, `request_in_progress`, and a duplicate pending request are non-terminal. The draft and request ID remain unchanged. The operator retries the same draft and must not create a second message.

## Known boundaries

- The configured test assets are associated with the DRG production workspace row. This is not a segregated test tenant.
- Frame the portal tightly around a fresh fictional test brief. Do not expose the triage queue, unrelated lead names, personal inboxes, or other production data.
- The conversation timeline displays the newest 500 events. The reply-window check separately reads the latest authoritative inbound event.
- Portal replies are plain text. The shared limit is 2,000 characters; Instagram is also limited to 1,000 UTF-8 bytes.
- The May 2026 deletion verification remains historical and predates `channel_conversation_events`. Use the September 2026 post-ledger rehearsal for the tested controlled-redaction claims, while preserving its documented backup and legacy-cleanup limits. The owner accepted the documented privacy risk and waived external counsel review on 2026-09-04. Multi-provider support evidence is tracked separately and does not block Meta submission.
- Do not reset a recording with ad hoc DELETE statements. Start a fresh fictional inbound conversation instead.

## Pre-submission blocker: deletion promise and conversation ledger

Adriano selected controlled, irreversible redaction as the resolution. The production system now includes the service-only operation, strict completion semantics, encrypted external registry, historical backfill, controlled replay, and fail-closed recovery circuit. PR #219 added a passing fictional transactional logical-restore simulation. The retained fields and available joins carry documented residual risk; Adriano accepted that risk as owner and waived external privacy-counsel review. They are not described as legally de-identified or independently approved.

The strict-completion gate, tested Meta-derived CaseLoad Select operational-copy gate, current-registry audit, activation/open postflight, PR #223 public-copy merge, and signed-out canonical-URL verification are closed. PR #219 remains the final fictional end-to-end exercise; no fresh persistent production fixture was created for closeout. Meta support evidence is conditional only if the live review form requires Meta-side disposition proof. The legacy HighLevel work and Resend, HighLevel, or Supabase support responses remain separate and do not block Meta submission.

## Remaining sequence

1. Inventory the live Meta draft. Remove unsupported and approved permissions one row at a time.
2. Apply the recorded Meta Data Handling answers and confirm `Needs your review` clears.
3. Recheck the documented clip hashes, attach only the matching v2 clips, and play each completely in Meta's preview.
4. Re-review and paste the then-current v2 reviewer instructions, recheck the canonical public URLs signed out, and preserve a final draft screenshot.
5. Stop for Adriano's action-time approval before the final submission control.
6. Adriano submits and preserves screenshots of the submission confirmation.

## Definition of ready to submit

- [x] Live production rehearsal passed for Messenger and Instagram.
- [x] Stable UUID actor confirmed.
- [x] Support preview confirmed off.
- [x] Both fresh inbound messages were within 24 hours during recording.
- [x] Both clips show Meta identity, portal send, `Reply sent.`, and the identical native receipt without a cut.
- [x] No real client or unrelated lead data is visible.
- [x] The controlled-redaction resolution is shipped and the post-ledger fictional deletion rehearsal is recorded as passed for the tested CaseLoad Select stores and controls.
- [x] `provider_managed` alone cannot mark external cleanup complete or produce a successful completion notice.
- [x] The deployed deletion path removes direct identifiers and message content from the tested Meta-derived CaseLoad Select operational copies.
- [x] The external encrypted registry, backfill/replay flow, and fictional transactional logical-restore simulation are verified within their recorded boundaries.
- [x] The bounded current-registry audit and activation/open postflight are complete; PR #219 is the final fictional end-to-end exercise.
- [x] Adriano accepted the retained-envelope, join, and three-year-period risks as owner and waived external privacy-counsel review; no counsel approval is claimed.
- [x] Adriano approved the public deletion wording as owner.
- [x] PR #223 merged with Adriano's explicit approval, and the released canonical pages passed signed-out HTTP and key-copy verification on 2026-09-04.
- [ ] Live draft contains the two source-supported messaging capabilities and exactly the four unique Meta-required technical dependencies.
- [x] The owner-approved Meta Data Handling answers are recorded without implying counsel approval.
- [ ] The live Meta Data Handling step reflects those exact answers and no longer shows `Needs your review`.
- [ ] The three approved scopes are absent.
- [ ] Reviewer instructions use the exact live Instagram permission label.
- [ ] Adriano has reviewed the final draft and explicitly approved submission.

Separate follow-up: resolve the pending legacy HighLevel disposition and pursue any Resend, HighLevel, or Supabase support questions only under separate provider-specific approval. Those responses are not part of the Meta readiness definition.
