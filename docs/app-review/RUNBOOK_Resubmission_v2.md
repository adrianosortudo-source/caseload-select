# Meta App Review resubmission operator runbook, v2

Owner: Adriano Domingues

Submission ID: `1016624077686960`

App ID: `1007304805285554`

This runbook does not authorize an agent to access Meta, record, upload, submit, merge, deploy, change production configuration, or delete production data.

## 1. Confirm the shipped baseline

The shipped messaging and privacy-redaction baseline is complete:

- [x] PRs #191, #193, and #195 merged.
- [x] Required CI passed.
- [x] PR #198 merged the controlled-redaction implementation, PR #199 corrected the migration runtime failure, and PR #202 corrected the provider-cleanup completion semantics.
- [x] PR #204 updated the release-target public wording and active Meta evidence package for the corrected implementation. Adriano approved PR #223 as owner, and it merged on 2026-09-04. Signed-out checks of the released canonical policy pages passed.
- [x] Production merge `fbb6aac6712b28191de5aee79d0d4511aaaf4b59` is deployed to both production projects.
- [x] Migration `20260901231830_channel_conversation_ledger` is applied and verified.
- [x] Migration `20260902102620_restrict_screen_funnel_service_role_acl` is applied and verified.
- [x] Migration `20260902111504_harden_channel_conversation_acl` is applied and verified.
- [x] Migration `20260902210124_privacy_screened_lead_redaction` is applied and verified.
- [x] Migration `20260903011450_privacy_provider_evidence_required` is applied and verified.
- [x] Migrations `20260903140551_privacy_external_deletion_registry_recovery_control`, `20260903144312_privacy_deletion_registry_saga_hardening`, and `20260903183915_privacy_deletion_registry_operational_completeness` are applied in order and verified.
- [x] Migration `20260904125000_privacy_recovery_open_from_locked` is applied and verified; the production ledger has 223 entries with that migration as its tip.
- [x] The fictional post-ledger production deletion rehearsal is recorded in `deletion-flow-verification.md`.
- [x] The final rollback-only production verification of strict completion semantics and Meta-derived CaseLoad Select operational copies is recorded in `deletion-flow-verification.md`.
- [x] The initial encrypted-registry backfill and controlled global replay completed with reconciliation linked, all two intents accounted for, zero failures, and both recovery circuits re-locked before the later audit and activation.
- [x] PR #219's fictional real-Postgres transactional logical-restore simulation passed. It is not evidence of a managed Supabase backup/PITR restore or provider backup expiry.
- [x] PR #221's bounded current-registry audit passed in production with fixed aggregate evidence only.
- [x] PR #222's controlled activation opened only after exact reconciliation and activation-marker verification; a protected nonexistent path returned the normal `404` pass-through afterward.
- [x] PR #223's owner-approved public copy is released at `https://caseloadselect.ca/privacy`, `https://caseloadselect.ca/terms`, and `https://caseloadselect.ca/data-deletion`; signed-out HTTP and key-copy checks passed on 2026-09-04.
- [x] `META_MESSENGER_VERIFY_TOKEN`, `META_INSTAGRAM_VERIFY_TOKEN`, and `META_WHATSAPP_VERIFY_TOKEN` were independently rotated as sensitive Production variables in Vercel on 2026-09-04 at 23:35 UTC. The recovery copy is outside every repository with inheritance disabled and access limited to the local owner account.
- [ ] Merge the dedicated token-rotation redeployment PR and confirm the resulting production deployment is READY before changing the three callback verification values in Meta.

The following operator gates passed for both verified local v2 clips. Reconfirm them only if either clip must be recorded again:

- [x] Production portal member has a stable UUID actor identity.
- [x] Support preview is off.
- [x] Fresh fictional Messenger and Instagram inbound events were visible and less than 24 hours old.
- [x] A live rehearsal confirmed portal send and native receipt for each channel.
- [x] No unrelated lead data is visible in either recording frame.

On the test brief, confirm there is no support-preview banner or read-only notice. Confirm `Send reply` is enabled after a non-empty valid draft is entered. If the panel asks the member to sign in again, the session lacks a stable UUID actor identity. Sign in again and reopen the brief before rehearsal.

## 2. Lock the permission set

The two business capabilities under review are:

- `pages_messaging`;
- the exact Instagram messaging permission label shown in the live Meta draft. The source-supported name in this package is `instagram_manage_messages`.

Include the technical dependency permissions that Meta's current Permissions Reference lists across the two messaging capabilities:

- `instagram_basic`;
- `pages_read_engagement`;
- `pages_show_list`; and
- `pages_manage_metadata`.

`instagram_basic`, `pages_read_engagement`, and `pages_show_list` support legacy `instagram_manage_messages`; `pages_manage_metadata` and `pages_show_list` support `pages_messaging`. Request the four unique scopes only as technical dependencies. Do not describe them as standalone CaseLoad Select identity, engagement-reading, Page-listing, or Page-management features. Do not re-request `business_management` unless the live form identifies another mandatory dependency and that change is separately reviewed.

Never resubmit `whatsapp_business_messaging`, `whatsapp_business_management`, or `public_profile`. Those three scopes are already approved.

If Meta requires another dependency or shows an unclear Instagram label, capture the exact form text and stop.

## 3. Prepare one fresh fictional conversation per channel

The configured test assets use the DRG production workspace row. This is not a segregated test tenant.

For Messenger and then Instagram:

1. Use the authorized test user and the intended test asset.
2. Send a fresh inbound message containing fictional names and facts only.
3. Complete enough intake turns for a new brief to appear.
4. Open that exact brief directly. Avoid showing the broader triage queue.
5. Confirm the panel heading is `Message thread`.
6. Confirm the separate `Channel:` row names the expected channel.
7. Confirm the recent inbound message is visible.
8. Treat `Firm workspace:` and `Configured Meta asset ID:` as configuration context only. Neither proves the Page name or Instagram handle.
9. Confirm the composer is enabled and the 24-hour window is open.

If no authoritative inbound exists or the window is closed, start another fresh signed inbound flow. Do not edit the database or delete production rows to reset a take.

## 4. Rehearse before recording

For each channel, complete the full sequence once with a unique rehearsal message:

1. Show the authoritative Page name or Instagram handle in Meta UI.
2. Show the recent inbound in the native thread.
3. Move to the matching CaseLoad Select brief.
4. Type the rehearsal message.
5. Click `Send reply` once.
6. Wait for `Reply sent.`.
7. Return to the native thread and confirm the identical message arrived.

If the portal says delivery is not verified or the request is still in progress:

1. Do not edit the draft, refresh the page, close the tab, or navigate away. Those actions can discard the in-memory request ID.
2. Check the native thread once for the proof text.
3. Return to the same portal tab and wait until `Send reply` is enabled.
4. Click `Send reply` once with the unchanged draft. The app reuses the same idempotency request ID and does not call Graph twice for the same pending claim.
5. If the outcome is still non-terminal, stop that take and capture the exact portal text. Do not loop or create another message.

## 5. Record the two v2 clips

Follow `screencasts/SHOTLIST_v2.md` exactly.

- Messenger: `caseload-select-messenger-resubmission-v2.mp4`
- Instagram: `caseload-select-instagram-resubmission-v2.mp4`

Each clip must be one continuous take from authoritative Meta identity, through the portal send, to the identical native receipt. Use a fresh proof string that includes the actual recording date and time.

## 6. Validate and compress

- [ ] H.264 MP4
- [ ] 1920 x 1080 or better
- [ ] 30 fps
- [ ] Video only, with no audio stream
- [ ] Required on-screen caption is readable
- [ ] Under three minutes
- [ ] Under 100 MB
- [ ] English UI
- [ ] No cuts between identity, send, and receipt
- [ ] No secrets, real-client data, personal inboxes, or unrelated leads
- [ ] Identical proof message in the portal and native client

If compression is needed, preserve the original and make a separate upload copy:

```powershell
ffmpeg -i .\input.mp4 -c:v libx264 -preset medium -crf 24 -an -movflags +faststart .\upload.mp4
```

Watch the full upload copy before attaching it.

## 7. Pre-submission blocker: deletion promise and conversation ledger

Adriano selected controlled, irreversible redaction as the resolution. The deployed service-only workflow, production migrations through `20260904125000`, external encrypted registry, historical backfill, controlled global replay, bounded current-registry audit, and activation/open postflight passed the aggregate checks recorded in `deletion-flow-verification.md` and `META_READINESS_CLOSEOUT_2026-09-04.md`.

The earlier rehearsal identified a completion-semantics defect: the application and database could mark external cleanup complete when a provider was recorded only as `provider_managed`. PR #202 corrected that contract. Production evidence continues to show two Meta provider dispositions pending, zero complete, and zero completion timestamps while the tested Meta-derived CaseLoad Select operational copies remain redacted.

Treat `completed` and `not_applicable` as privileged-operator attestations, not provider-issued evidence. Record either status only after the operator checks the applicable disposition. Treat `provider_managed` only as a routing marker; it cannot close external cleanup by itself.

The technical privacy closeout no longer blocks rehearsal or recording. The owner's privacy decision and counsel waiver are recorded, and the public-copy merge and canonical signed-out verification gate is closed. The live Meta draft and Data Handling changes, upload checks, and Adriano's action-time approval still block final Meta submission.

Do not submit the Meta draft until all of these checks pass:

- [x] The redaction migration and application path are reviewed, merged, and deployed.
- [x] The scheduled three-year audit-envelope expiry is deployed and its production invocation is verified.
- [x] Every in-scope attachment location and retained audit ledger in the fictional fixture is included in deletion and expiry verification.
- [x] A fresh fictional post-ledger deletion rehearsal is appended to `deletion-flow-verification.md`.
- [x] Production merge `fbb6aac6712b28191de5aee79d0d4511aaaf4b59` and migrations through `20260904125000` are deployed and verified: `provider_managed` alone cannot produce `external_cleanup_status: complete` or a successful completion notice.
- [x] The final rollback-only fictional production verification proves that the deployed deletion path removes the tested direct identifiers and message content from Meta-derived CaseLoad Select operational copies. It does not claim deletion from Meta's systems.
- [x] The encrypted external registry, historical backfill, controlled production replay, and PR #219 fictional transactional logical-restore simulation are complete within their documented evidence boundaries.
- [x] The bounded current-registry audit and controlled production activation/open postflight passed. PR #219 remains the final fictional end-to-end exercise; no fresh persistent production fixture was added.
- [x] Adriano accepted the documented audit-envelope, retained-key, join, and three-year-period risks as owner and waived external privacy-counsel review. This is not counsel approval or legal advice.
- [x] Adriano approved PR #223's public copy as owner.
- [x] PR #223 merged with Adriano's explicit approval; `/privacy`, `/terms`, and `/data-deletion` passed signed-out HTTP and key-copy verification at `caseloadselect.ca` on 2026-09-04.
- [x] Record the owner-approved Meta Data Handling answers: `No` for national-security disclosures in the 12 months ending 2026-09-04, `None of the above` for the currently undocumented public-authority processes, and acceptance of the current controller wording.
- [ ] Apply those exact answers in the live Meta Data Handling step and confirm `Needs your review` clears. The current four pre-filled positive process selections must not be submitted.

The legacy HighLevel disposition and any Resend, HighLevel, or Supabase support requests are separate privacy-compliance follow-up work. They do not block this Meta submission. Do not send a provider support draft without separate provider-specific approval.

## 8. Clean the live Meta draft

There is no discard-all control. Use each permission row's trash icon.

1. Inventory the live draft before changing it.
2. Remove every unsupported permission.
3. Remove the three already-approved scopes if they appear.
4. Confirm the draft contains the two messaging capabilities and exactly the four unique required technical dependencies, with no unrelated permission.
5. Save and reload the draft to confirm the list persisted.

Do not delete the submission itself.

## 9. Complete the two capability entries and four dependency entries

For each business-capability permission:

1. Use `PERMISSION_CODE_PATH_EVIDENCE_v2.md` for the factual justification.
2. Paste the fenced block from `Reviewer_Instructions_Paste_v2.md`.
3. Attach only the matching v2 clip.
4. Play the uploaded clip from beginning to end.
5. Confirm the written Instagram permission label exactly matches the live form.
6. Save before moving to the other permission.

For `instagram_basic`, `pages_read_engagement`, `pages_show_list`, and `pages_manage_metadata`:

1. Explain which messaging capability lists the permission as a dependency in Meta's current Permissions Reference.
2. State that it supports the recorded Messenger or Instagram messaging flow and is not a separate product capability.
3. If the form requires a recording for the dependency row, use the reviewed clip for the related messaging capability and do not invent an unsupported identity, engagement, Page-listing, or Page-management workflow.
4. Save and reload the draft to confirm all six entries persist.

Do not use `Phase11_Submission_Package.md`, `Reviewer_Instructions_Paste.md`, `screencasts/README.md`, the v1 clips, the WhatsApp clip, or the Business Manager configuration clip.

## 10. Final audit and approval stop

- [ ] Draft contains the two retained messaging capabilities and exactly the four unique required technical dependencies.
- [x] The owner-approved Meta Data Handling decisions are recorded without implying counsel approval.
- [ ] Meta Data Handling no longer shows `Needs your review` and the live values match the owner decision.
- [ ] No approved scope is present.
- [ ] Messenger has the Messenger v2 clip.
- [ ] Instagram has the Instagram v2 clip.
- [ ] Reviewer instructions disclose the server-to-server architecture and absence of Facebook Login.
- [ ] Meta identity is visible in Meta UI in each clip.
- [ ] Each clip shows `Message thread`, the correct `Channel:` row, `Send reply`, `Reply sent.`, and the identical native receipt.
- [ ] No real or unrelated lead data is visible.
- [x] The controlled-redaction resolution is shipped and the post-ledger fictional deletion rehearsal is recorded as passed for the tested CaseLoad Select stores and controls.
- [x] The PR #202 completion-semantics correction and Meta-derived CaseLoad Select operational-copy gates in Section 7 are closed.
- [x] The public-copy merge and signed-out verification gates in Section 7 are closed. The owner privacy decision, counsel waiver, current-registry audit, and activation gates are complete.
- [x] Privacy, terms, and deletion URLs open publicly at the canonical `caseloadselect.ca` origin.
- [ ] Operator contact is `adriano@caseloadselect.ca`.

Stop here. Final submission is Adriano's action and requires action-time approval.

After approval, Adriano should capture the final permission list, attachments, and reviewer instructions before clicking the final submission control. Capture the confirmation, time, and any new submission identifier afterward.
