# Meta App Review resubmission operator runbook, v2

Owner: Adriano Domingues

Submission ID: `1016624077686960`

App ID: `1007304805285554`

This runbook does not authorize an agent to access Meta, record, upload, submit, merge, deploy, change production configuration, or delete production data.

## 1. Confirm the shipped baseline

The release gates are complete:

- [x] PRs #191, #193, and #195 merged.
- [x] Required CI passed.
- [x] Production commit `fa3e092983b274c96fd1d22b8fa0091988baeb25` is READY.
- [x] Migration `20260901231830_channel_conversation_ledger` is applied and verified.
- [x] Migration `20260902102620_restrict_screen_funnel_service_role_acl` is applied and verified.
- [x] Migration `20260902111504_harden_channel_conversation_acl` is applied and verified.

The following operator gates remain open:

- [ ] Production portal member has a stable UUID actor identity.
- [ ] Support preview is off.
- [ ] Fresh fictional Messenger and Instagram inbound events are visible and less than 24 hours old.
- [ ] A live rehearsal confirms portal send and native receipt for each channel.
- [ ] No unrelated lead data is visible in the planned recording frame.

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
- [ ] Under three minutes
- [ ] Under 100 MB
- [ ] English UI
- [ ] No cuts between identity, send, and receipt
- [ ] No secrets, real-client data, personal inboxes, or unrelated leads
- [ ] Identical proof message in the portal and native client

If compression is needed, preserve the original and make a separate upload copy:

```powershell
ffmpeg -i .\input.mp4 -c:v libx264 -preset medium -crf 24 -c:a aac -b:a 128k -movflags +faststart .\upload.mp4
```

Watch the full upload copy before attaching it.

## 7. Pre-submission blocker: deletion promise and conversation ledger

The public `/data-deletion` page promises broader erasure or anonymization. The current `channel_conversation_events` table retains message `body` and `actor_id`, rejects UPDATE and DELETE, and prevents parent-lead deletion through `ON DELETE RESTRICT`. The May 2026 deletion exercise predates this ledger and does not verify its treatment.

This does not block rehearsal or recording after the production send gates pass. It does block final Meta submission.

Do not submit the Meta draft until Adriano chooses a resolution and a reviewed implementation or policy resolution is shipped and verified. This documentation PR does not choose or implement that resolution.

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
- [ ] The deletion-policy and conversation-ledger conflict has a reviewed resolution that is shipped and verified.
- [ ] Privacy, terms, and deletion URLs open publicly.
- [ ] Operator contact is `adriano@caseloadselect.ca`.

Stop here. Final submission is Adriano's action and requires action-time approval.

After approval, Adriano should capture the final permission list, attachments, and reviewer instructions before clicking the final submission control. Capture the confirmation, time, and any new submission identifier afterward.
