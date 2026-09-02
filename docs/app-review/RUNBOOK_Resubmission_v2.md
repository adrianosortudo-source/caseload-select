# Meta App Review resubmission operator runbook, v2

Owner: Adriano Domingues. Submission ID: `1016624077686960`. App ID: `1007304805285554`.

This is an operator runbook. It does not authorize an agent to merge, deploy, record, upload, or submit.

## Stop gate: the feature is not live merely because these files exist

Option B source exists, but `20260901231830_channel_conversation_ledger.sql` is deferred under `supabase/migrations-draft/`. It is not part of the active migration chain and has not been approved or applied. Privacy, deletion, retention and access-control review must be completed in a separate PR before the channel feature can be released.

Do not record or edit the Meta submission until all boxes below are confirmed:

- [ ] The Option B PR has explicit approval for that PR.
- [ ] The branch is pushed and CI is green, including the real-Postgres migration job.
- [ ] The PR is merged to `main`.
- [ ] GitHub's production deployment completes; no direct CLI production deploy is used.
- [ ] A separately reviewed replacement or remediated channel-ledger migration is approved, promoted to `supabase/migrations/` and shown as applied in the Supabase migration ledger.
- [ ] Production portal loads a new channel conversation and the reply API works on the test tenant.
- [ ] The signed-in portal member has a UUID actor identity; if the UI asks for sign-in again, do that before recording.
- [ ] Support preview is off. Preview is intentionally read-only.

## 1. Confirm the permission set before touching the draft

Open `PERMISSION_CODE_PATH_EVIDENCE_v2.md` and use this exact decision:

Re-request:

- `pages_messaging`
- `instagram_manage_messages`, or the exact equivalent label Meta displays for this app

Do not re-request:

- `pages_show_list`
- `pages_manage_metadata`
- `business_management`
- `instagram_basic`
- `pages_read_engagement`

Do not resubmit these approved permissions:

- `whatsapp_business_messaging`
- `whatsapp_business_management`
- `public_profile`

If Meta makes one of the two retained messaging permissions depend on another scope, stop and capture the exact form text. Do not invent a supporting code path or silently widen the submission.

## 2. Clean the existing draft carefully

There is no discard-draft or discard-all button.

1. Open the existing App Review submission draft.
2. Inventory every permission currently in the draft.
3. Use the trash icon on each unwanted permission row, one at a time.
4. Remove the three approved permissions if the draft contains them. Approval already exists; resubmitting them creates needless risk.
5. Remove all five unsupported rejected permissions listed above.
6. Confirm that only the two retained messaging permissions remain.
7. Save the draft and reload the page to verify the list persisted.

Do not delete the submission itself. Do not assume there is a hidden global reset.

## 3. Prepare a fresh test conversation

Repeat separately for Messenger and Instagram:

1. Use the authorized test user and test asset only.
2. Send a fresh inbound test message to `DRG Law Test` or `@drg_law_test`.
3. Complete enough intake turns for a brief to appear in the DRG test portal.
4. Open that exact brief and confirm the conversation panel shows the recent inbound event.
5. Confirm the configured asset ID matches the intended test asset.
6. Confirm the composer is enabled and shows an open reply window.
7. If the composer says no authoritative inbound exists, do not improvise a database edit. Start a fresh signed inbound flow after verifying deployment and webhook health.
8. If the composer says the 24-hour window is closed, send a new inbound from the test user and use the resulting lead/conversation.

## 4. Record the two v2 clips

Follow `screencasts/SHOTLIST_v2.md` exactly.

- Messenger filename: `caseload-select-messenger-resubmission-v2.mp4`
- Instagram filename: `caseload-select-instagram-resubmission-v2.mp4`

For each clip:

1. Start with authoritative identity in Meta UI.
2. Show the recent inbound in the native thread.
3. Move to the corresponding CaseLoad Select brief without stopping recording.
4. Type a unique proof message on camera.
5. Click **Send reply** once.
6. Wait for **Reply sent.**
7. Move to the native client without a cut.
8. Hold on the identical delivered message and exact Page name or Instagram handle.

If delivery is not verified, keep the draft unchanged and retry it. Do not edit the text, because changing the draft intentionally creates a new idempotency request.

## 5. Validate and compress

Check each file:

- [ ] H.264 MP4
- [ ] 1920 x 1080 or better
- [ ] 30 fps
- [ ] Under three minutes
- [ ] Under 100 MB
- [ ] English UI
- [ ] No cuts between identity, send and receipt
- [ ] No secrets, real-client data, personal inboxes or unrelated tenants
- [ ] Identical proof message in portal and native client

If compression is required, preserve the original and create a separate upload copy:

```powershell
ffmpeg -i .\input.mp4 -c:v libx264 -preset medium -crf 24 -c:a aac -b:a 128k .\upload.mp4
```

Watch the complete compressed copy before upload. Compression must not make the Meta identity, cursor action, portal status, or delivered text unreadable.

## 6. Fill the two permission entries

For each retained permission:

1. Use the corresponding row in `PERMISSION_CODE_PATH_EVIDENCE_v2.md` for the factual justification.
2. Paste `Reviewer_Instructions_Paste_v2.md` into the reviewer-instructions field.
3. Attach the matching v2 clip only.
4. Confirm the clip preview plays from beginning to end.
5. Confirm the permission name in the written text matches the form's exact label.
6. Save before moving to the next permission.

Do not attach:

- the old v1 Messenger or Instagram clip;
- the WhatsApp clip;
- the Business Manager configuration clip as evidence for a dropped permission.

## 7. Final pre-submit audit

- [ ] Draft contains only the two retained messaging permissions
- [ ] No approved permission is present
- [ ] Every permission has a direct runtime code path
- [ ] Messenger entry has the Messenger v2 clip
- [ ] Instagram entry has the Instagram v2 clip
- [ ] Reviewer instructions disclose server-to-server architecture and no Facebook Login
- [ ] The Page/account identity is visible in Meta UI in each clip
- [ ] The live portal send and native receipt are one continuous take
- [ ] Privacy, terms and deletion URLs open publicly
- [ ] Operator contact is `adriano@caseloadselect.ca`
- [ ] No test data from a production firm is visible

## 8. Submit and preserve evidence

Submission is Adriano's action.

Immediately before clicking **Request again** or the equivalent final submission button:

1. Recheck the permission list one last time.
2. Confirm the three approved permissions are absent.
3. Confirm there are no unsupported permissions left behind.
4. Capture screenshots of the final permission list, each attachment, and reviewer instructions.
5. Click the final submission control.
6. Capture the confirmation and new status.
7. Record the submission time and any new submission identifier in the system register.

If Meta rejects or blocks the form, capture the exact label and full error text before changing OAuth settings, permissions, or assets. A field identifier such as `fblogin-web-1` names a form section, not necessarily a product configuration problem.
