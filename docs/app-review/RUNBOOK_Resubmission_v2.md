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
- [x] PR #204 updated the release-target public wording and active Meta evidence package for the corrected implementation; counsel-backed final public-copy reconciliation remains open.
- [x] Production commit `a05520e3b9d08d82bd81c42779907cbd2c807757` is READY.
- [x] Migration `20260901231830_channel_conversation_ledger` is applied and verified.
- [x] Migration `20260902102620_restrict_screen_funnel_service_role_acl` is applied and verified.
- [x] Migration `20260902111504_harden_channel_conversation_acl` is applied and verified.
- [x] Migration `20260902210124_privacy_screened_lead_redaction` is applied and verified.
- [x] Migration `20260903011450_privacy_provider_evidence_required` is applied and verified.
- [x] The fictional post-ledger production deletion rehearsal is recorded in `deletion-flow-verification.md`.
- [x] The final rollback-only production verification of strict completion semantics and Meta-derived CaseLoad Select operational copies is recorded in `deletion-flow-verification.md`.

The following operator gates passed for both verified local v2 clips. Reconfirm them only if either clip must be recorded again:

- [x] Production portal member has a stable UUID actor identity.
- [x] Support preview is off.
- [x] Fresh fictional Messenger and Instagram inbound events were visible and less than 24 hours old.
- [x] A live rehearsal confirmed portal send and native receipt for each channel.
- [x] No unrelated lead data is visible in either recording frame.

On the test brief, confirm there is no support-preview banner or read-only notice. Confirm `Send reply` is enabled after a non-empty valid draft is entered. If the panel asks the member to sign in again, the session lacks a stable UUID actor identity. Sign in again and reopen the brief before rehearsal.

## 2. Lock the permission set

Re-request only:

- `pages_messaging`;
- the exact Instagram messaging permission label shown in the live Meta draft. The source-supported name in this package is `instagram_manage_messages`.

Do not re-request `pages_show_list`, `pages_manage_metadata`, `business_management`, `instagram_basic`, or `pages_read_engagement`.

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

Adriano selected controlled, irreversible redaction as the resolution. PRs #198 and #199 shipped the service-only, tenant-scoped operation and migration. The fresh fictional production rehearsal passed the database, application, Storage, authorization, idempotency, tenant-isolation, append-only, pending-message, and expiry-invocation checks recorded in `deletion-flow-verification.md`.

That rehearsal identified a completion-semantics defect: the application and database could mark external cleanup complete when Meta or Resend was recorded only as `provider_managed`. PR #202 corrected that contract. Production commit `a05520e3b9d08d82bd81c42779907cbd2c807757` and migration `20260903011450` were then verified in a final rollback-only fictional production exercise. The exercise proved that `provider_managed` remains pending, cannot produce a completion summary, and that the tested Meta-derived CaseLoad Select operational copies are redacted.

Treat `completed` and `not_applicable` as privileged-operator attestations, not provider-issued evidence. Record either status only after the operator checks the applicable disposition. Treat `provider_managed` only as a routing marker; it cannot close external cleanup by itself.

This does not block rehearsal or recording after the production send gates pass. It does block final Meta submission.

Do not submit the Meta draft until all of these checks pass:

- [x] The redaction migration and application path are reviewed, merged, and deployed.
- [x] The scheduled three-year audit-envelope expiry is deployed and its production invocation is verified.
- [x] Every in-scope attachment location and retained audit ledger in the fictional fixture is included in deletion and expiry verification.
- [x] A fresh fictional post-ledger deletion rehearsal is appended to `deletion-flow-verification.md`.
- [x] Production commit `a05520e3b9d08d82bd81c42779907cbd2c807757` and migration `20260903011450` are deployed and verified: `provider_managed` alone cannot produce `external_cleanup_status: complete` or a successful completion notice.
- [x] The final rollback-only fictional production verification proves that the deployed deletion path removes the tested direct identifiers and message content from Meta-derived CaseLoad Select operational copies. It does not claim deletion from Meta's systems.
- [ ] Document account-specific backup-expiry schedules and complete a safe restore rehearsal proving completed deletions are reapplied before restored data returns to use.
- [ ] Obtain privacy-counsel approval of the audit envelope, retained-key reidentification assessment, and three-year retention period.
- [ ] Reconfirm that production `/privacy` and `/data-deletion` wording matches the verified end state after the completion-semantics correction and counsel review.

The legacy HighLevel disposition and any Resend, HighLevel, or Supabase support requests are separate privacy-compliance follow-up work. They do not block this Meta submission. Do not send a provider support draft without separate provider-specific approval.

## 8. Clean the live Meta draft

There is no discard-all control. Use each permission row's trash icon.

1. Inventory the live draft before changing it.
2. Remove every unsupported permission.
3. Remove the three already-approved scopes if they appear.
4. Confirm only the two retained messaging permissions remain.
5. Save and reload the draft to confirm the list persisted.

Do not delete the submission itself.

## 9. Complete the two permission entries

For each retained permission:

1. Use `PERMISSION_CODE_PATH_EVIDENCE_v2.md` for the factual justification.
2. Paste the fenced block from `Reviewer_Instructions_Paste_v2.md`.
3. Attach only the matching v2 clip.
4. Play the uploaded clip from beginning to end.
5. Confirm the written Instagram permission label exactly matches the live form.
6. Save before moving to the other permission.

Do not use `Phase11_Submission_Package.md`, `Reviewer_Instructions_Paste.md`, `screencasts/README.md`, the v1 clips, the WhatsApp clip, or the Business Manager configuration clip.

## 10. Final audit and approval stop

- [ ] Draft contains only the two retained messaging permissions.
- [ ] No approved scope is present.
- [ ] Messenger has the Messenger v2 clip.
- [ ] Instagram has the Instagram v2 clip.
- [ ] Reviewer instructions disclose the server-to-server architecture and absence of Facebook Login.
- [ ] Meta identity is visible in Meta UI in each clip.
- [ ] Each clip shows `Message thread`, the correct `Channel:` row, `Send reply`, `Reply sent.`, and the identical native receipt.
- [ ] No real or unrelated lead data is visible.
- [x] The controlled-redaction resolution is shipped and the post-ledger fictional deletion rehearsal is recorded as passed for the tested CaseLoad Select stores and controls.
- [x] The PR #202 completion-semantics correction and Meta-derived CaseLoad Select operational-copy gates in Section 7 are closed.
- [ ] The remaining backup and restore-replay, privacy-counsel, and public-copy reconciliation gates in Section 7 are closed.
- [ ] Privacy, terms, and deletion URLs open publicly.
- [ ] Operator contact is `adriano@caseloadselect.ca`.

Stop here. Final submission is Adriano's action and requires action-time approval.

After approval, Adriano should capture the final permission list, attachments, and reviewer instructions before clicking the final submission control. Capture the confirmation, time, and any new submission identifier afterward.
