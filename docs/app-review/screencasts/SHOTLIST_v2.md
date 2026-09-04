# Meta App Review resubmission shot list, v2

Record one continuous take per permission. Each clip must show:

1. authoritative asset identity in Meta UI;
2. a live send from the CaseLoad Select portal;
3. the identical delivered message in the native client.

Do not splice, pause, or cover a failed attempt with a cut.

## Recording gate

The deployment prerequisites for recording and send are complete at production merge `6f6c59330d94d84b1fc3bc63fb76d8830d3c8644`. Both local v2 clips passed these checks and remain byte-identical to the documented files. Reapply the per-session checks below only if either clip must be recorded again. Separate Meta submission privacy gates remain open in `../META_READINESS_CLOSEOUT_2026-09-04.md` and `../RUNBOOK_Resubmission_v2.md`.

Before each take, confirm:

- a fresh fictional inbound message is visible and less than 24 hours old;
- the portal member has a stable UUID actor identity;
- support preview is off;
- the portal frame contains only the test brief and no unrelated lead data;
- the intended native thread and authoritative Meta identity view are ready.

The portal's `Firm workspace:` and `Configured Meta asset ID:` rows are context only. The numeric ID is not identity proof. Show the exact Page name or Instagram handle in Meta UI.

## Shared setup

- Use English UI.
- Use the authorized test Facebook Page `DRG Law Test` and Instagram account `@drg_law_test`.
- The test assets are associated with the DRG production workspace row. Use fictional facts only and isolate the recording frame from all unrelated leads.
- Arrange Meta identity, the portal brief, and the native conversation before recording.
- Keep the same test conversation open throughout.
- Use these distinct proof formats and replace each placeholder with the actual recording time:
  - Messenger: `App Review Messenger proof [YYYY-MM-DD HH:MM ET].`
  - Instagram: `App Review Instagram proof [YYYY-MM-DD HH:MM ET].`
- Type the proof text on camera. Do not prefill it.
- Instagram text must remain at or below 1,000 UTF-8 bytes.
- If delivery is not verified or is still pending, keep the draft unchanged and retry it. Do not edit the text or create a second message.
- App-specific reviewer feedback requires readable on-screen captions for this resubmission.
- Follow Meta's recording guidance: omit audio and capture at 1920 x 1080 or better, H.264, 30 fps, under three minutes, and under 100 MB.
- Do not expose cookies, tokens, secrets, personal inboxes, real client data, or unrelated leads.

## Messenger clip

Filename: `caseload-select-messenger-resubmission-v2.mp4`

Permission: `pages_messaging`

| Sequence | On screen and action | Required evidence |
|---|---|---|
| 1 | In Meta UI, select or open `DRG Law Test`. Hold the exact Page name. | Authoritative Page identity. |
| 2 | Show the recent fictional inbound message in the same Messenger thread. | User-initiated conversation and open response window. |
| 3 | Open the matching CaseLoad Select brief. Show `Message thread`, `Channel: Facebook Messenger`, the recent inbound, and the enabled composer. | Correct app surface and channel context. |
| 4 | Type the Messenger proof string. | Live operator-authored action. |
| 5 | Click `Send reply` once and wait for `Reply sent.`. | Verified send from the app UI. |
| 6 | Without a cut, show the identical delivered text in the native Messenger thread. | Native receipt. |
| 7 | Hold the Page name and delivered text long enough to read. | Readable identity and message comparison. |

Required on-screen caption:

`CaseLoad Select sends this operator-authored reply through the Messenger Send API using the configured Page access token.`

## Instagram clip

Filename: `caseload-select-instagram-resubmission-v2.mp4`

Permission: exact live Meta label for Instagram messaging

| Sequence | On screen and action | Required evidence |
|---|---|---|
| 1 | In Meta or Instagram UI, select or open `@drg_law_test`. Hold the exact handle. | Authoritative Instagram identity. |
| 2 | Show the recent fictional inbound message in the same DM thread. | User-initiated conversation and open response window. |
| 3 | Open the matching CaseLoad Select brief. Show `Message thread`, `Channel: Instagram`, the recent inbound, and the enabled composer. | Correct app surface and channel context. |
| 4 | Type the Instagram proof string and keep the byte counter at or below 1,000. | Live operator-authored action. |
| 5 | Click `Send reply` once and wait for `Reply sent.`. | Verified send from the app UI. |
| 6 | Without a cut, show the identical delivered text in the native Instagram DM. | Native receipt. |
| 7 | Hold the handle and delivered text long enough to read. | Readable identity and message comparison. |

Required on-screen caption:

`CaseLoad Select sends this operator-authored reply through the Instagram Messaging API using the linked Page access token.`

## Do not record or attach

- Do not re-record or resubmit WhatsApp.
- Do not attach Business Manager configuration as proof of a dropped permission.
- Do not reuse v1 Messenger or Instagram clips. They show inbound automation rather than the required portal send.

## Clip verification

- [ ] One continuous take from Meta identity through native receipt.
- [ ] Exact Meta identity is readable in Meta UI.
- [ ] Recent fictional inbound is visible.
- [ ] Portal shows `Message thread` and the correct `Channel:` row.
- [ ] Unique proof text is typed on camera.
- [ ] Click on `Send reply` is visible.
- [ ] Portal reports `Reply sent.`.
- [ ] Identical text is readable in the native thread.
- [ ] The required on-screen caption is readable.
- [ ] No secret, personal data, or unrelated production material is visible.
- [ ] H.264 video only, no audio stream, 30 fps, at least 1080p, under three minutes, under 100 MB.

If compression is required, use the active runbook's CRF 24 command and watch the complete upload copy.
