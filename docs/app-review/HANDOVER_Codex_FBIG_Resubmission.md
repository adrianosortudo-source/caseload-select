# Handover: Meta App Review, Facebook and Instagram resubmission

Owner: Adriano Domingues

App ID: `1007304805285554`

Original submission ID: `1016624077686960`

Current production commit: `fde4f307f34eb12a74f06a57d2af9c6fdc9611eb`, READY

## Current decision and release state

Adriano selected Option B on 2026-09-01. The channel conversation panel and operator-authored reply path are shipped. Do not reopen Option A unless Adriano asks.

Release evidence:

- PR #191 merged the Option B conversation ledger, portal panel, reply route, and tests.
- PR #193 merged the rendered-copy QA harness and related copy correction.
- PR #195 merged the ledger ACL hardening.
- PR #198 merged the controlled-redaction application and migration. PR #199 corrected the migration runtime failure.
- Production is running commit `fde4f307f34eb12a74f06a57d2af9c6fdc9611eb` with READY status.
- Migrations `20260901231830_channel_conversation_ledger`, `20260902102620_restrict_screen_funnel_service_role_acl`, `20260902111504_harden_channel_conversation_acl`, and `20260902210124_privacy_screened_lead_redaction` are applied and verified in production.
- The conversation ledger is append-only. `service_role` has SELECT and INSERT only. Browser roles and PUBLIC have no table privileges. RLS is enabled and forced with no policies.
- The fresh fictional post-ledger deletion rehearsal passed the CaseLoad Select database, application, Storage, authorization, idempotency, tenant-isolation, append-only, pending-message, and expiry-invocation checks recorded in `deletion-flow-verification.md`.

For the messaging-send evidence, the remaining work is operational: a live production rehearsal, two continuous recordings, live Meta draft cleanup, and Adriano's approved submission action. Final submission remains blocked by the Meta-relevant privacy gates and deployment of the provider-managed completion-semantics correction described below.

## Authority and scope

These are the active files for the resubmission:

1. `PERMISSION_CODE_PATH_EVIDENCE_v2.md`: permission decision and source evidence.
2. `RUNBOOK_Resubmission_v2.md`: operator sequence and stop gates.
3. `screencasts/SHOTLIST_v2.md`: recording script and clip QA.
4. `Reviewer_Instructions_Paste_v2.md`: text for the reviewer-instructions field.

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

Re-request only:

- `pages_messaging`;
- the exact live Meta dashboard label for Instagram messaging. The source-supported capability is currently documented as `instagram_manage_messages`.

Do not re-request:

- `pages_show_list`;
- `pages_manage_metadata`;
- `business_management`;
- `instagram_basic`;
- `pages_read_engagement`.

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
- The May 2026 deletion verification remains historical and predates `channel_conversation_events`. Use the September 2026 post-ledger rehearsal for the tested controlled-redaction claims, while preserving its documented backup, counsel, and legacy-cleanup limits. Multi-provider support evidence is tracked separately and does not block Meta submission.
- Do not reset a recording with ad hoc DELETE statements. Start a fresh fictional inbound conversation instead.

## Pre-submission blocker: deletion promise and conversation ledger

Adriano selected controlled, irreversible redaction as the resolution. PRs #198 and #199 shipped the service-only operation and production migration. The September 2026 fictional production rehearsal verified the tested CaseLoad Select stores and controls. Whether the retained fields and available joins are non-identifying remains a counsel decision.

The blocker remains open for the Meta-relevant gates recorded in the runbook: deployment and verification of the PR #202 completion-semantics correction, Meta-specific verification that the deployed path removes direct identifiers and message content from CaseLoad Select operational copies created from Messenger and Instagram intake, backup expiry plus safe restore/replay controls, privacy-counsel approval of the retained audit envelope and three-year period, and accurate public deletion wording. The Messenger and Instagram flows may be rehearsed and recorded after the production send gates pass. The legacy HighLevel disposition and Resend, HighLevel, or Supabase support responses remain separate privacy-compliance follow-up work and do not block Meta submission.

## Remaining sequence

1. Adriano signs in to the production portal with a stable UUID member account and confirms support preview is off.
2. For each channel, create a fresh fictional inbound conversation and confirm the open 24-hour window.
3. Rehearse the full portal send and native receipt without recording.
4. Record and verify the Messenger v2 clip.
5. Record and verify the Instagram v2 clip.
6. Deploy and verify the provider-managed completion correction, then close the remaining Meta-relevant privacy gates recorded above.
7. Inventory the live Meta draft. Remove unsupported and approved permissions one row at a time.
8. Paste the then-current v2 reviewer instructions and attach only the matching v2 clips.
9. Stop for Adriano's action-time approval before the final submission control.
10. Adriano submits and preserves screenshots of the final draft and confirmation.

## Definition of ready to submit

- [ ] Live production rehearsal passed for Messenger and Instagram.
- [ ] Stable UUID actor confirmed.
- [ ] Support preview confirmed off.
- [ ] Both fresh inbound messages are within 24 hours.
- [ ] Both clips show Meta identity, portal send, `Reply sent.`, and the identical native receipt without a cut.
- [ ] No real client or unrelated lead data is visible.
- [x] The controlled-redaction resolution is shipped and the post-ledger fictional deletion rehearsal is recorded as passed for the tested CaseLoad Select stores and controls.
- [ ] `provider_managed` alone cannot mark external cleanup complete or produce a successful completion notice.
- [ ] The deployed deletion path removes direct identifiers and message content from the operational copies created from Meta Messenger and Instagram intake.
- [ ] Account-specific backup expiry and a safe restore/replay rehearsal are verified.
- [ ] Privacy counsel approves the retained audit envelope, available joins, and three-year period.
- [ ] Live draft contains only the two source-supported messaging permissions.
- [ ] The three approved scopes are absent.
- [ ] Reviewer instructions use the exact live Instagram permission label.
- [ ] Adriano has reviewed the final draft and explicitly approved submission.

Separate follow-up: resolve the pending legacy HighLevel disposition and pursue any Resend, HighLevel, or Supabase support questions only under separate provider-specific approval. Those responses are not part of the Meta readiness definition.
