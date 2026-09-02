# Meta App Review resubmission shot list, v2

These clips answer the reviewer's three requested beats literally:

1. the authoritative Meta asset identity is visible in Meta's own UI;
2. a live send action is performed in the CaseLoad Select portal;
3. the identical message appears in the native Messenger or Instagram conversation.

Record one continuous take per permission. Do not splice, pause, replace the cursor, or cover a failed attempt with a cut.

## Recording gate

Do not record until all of these are true:

- PR for Option B has been approved and merged.
- Required CI, including real-Postgres migration validation, has passed.
- GitHub/Vercel production deployment from merged `main` has completed.
- `20260901231830_channel_conversation_ledger.sql` is confirmed applied with the matching ledger version.
- The later channel-ledger ACL and default-off firm-gate migrations are confirmed applied and verified.
- Message retention and erasure controls are approved.
- `CHANNEL_CONVERSATION_LEDGER_ENABLED` is the exact literal `true`, and the approved test firm's `channel_conversation_ledger_enabled` flag is true.
- A fresh inbound message from the test user is visible and less than 24 hours old.
- The portal account has an attributable member UUID; a legacy generic session will be told to sign in again.
- The operator is not in support preview, which is intentionally read-only.

The portal shows the configured Meta asset ID, not an authoritative Page display name or Instagram handle. Therefore the identity beat must be filmed in Meta UI. Do not caption the portal's firm workspace name as if Meta supplied it.

## Shared recording setup

- Use English UI in Meta and CaseLoad Select.
- Use only the test Facebook Page `DRG Law Test` and test Instagram account `@drg_law_test`.
- Arrange the Meta identity view, portal brief, and native conversation as adjacent browser tabs or side-by-side windows before recording.
- Keep the same test conversation open throughout.
- Use a unique, visually unmistakable message for each take. Suggested format: `App Review Messenger proof 2026-09-01 8:41 PM ET.` Replace the time with the actual recording time.
- Keep the message plain text and under the portal limit. Instagram must also remain at or below 1,000 UTF-8 bytes.
- Show the cursor entering the message and clicking **Send reply**.
- Wait for **Reply sent.** in the portal, then reveal the native thread and the identical text. Do not stop recording while delivery is pending.
- If the portal says delivery is not verified, keep the draft unchanged and retry it. The app will reuse the same idempotency key. Do not edit the message or create a second message during that take.
- Capture at 1920 x 1080 or better, H.264 MP4, 30 fps, under three minutes and under 100 MB.
- Do not expose cookies, access tokens, API keys, personal inboxes, real client data, or unrelated production tenants.

## Clip 1: `caseload-select-messenger-resubmission-v2.mp4`

Target permission: `pages_messaging`.

| Time | On screen | Operator action | Required evidence |
|---|---|---|---|
| 0:00 | Meta Business Suite/Page selector or Messenger Page surface | Select or open `DRG Law Test`. Pause with the exact Page name visible. | Authoritative Page identity from Meta UI. |
| 0:10 | The same Messenger thread | Show the recent inbound message from the test user. | User-initiated conversation and open response window. |
| 0:20 | CaseLoad Select brief for that same Messenger lead | Show **Facebook Messenger conversation**, the configured Meta asset ID, the recent inbound ledger message, and the enabled composer. | App surface and server-resolved channel context. |
| 0:35 | Portal composer | Type the unique proof sentence in real time. | Live app-authored action, not an automatic webhook reply. |
| 0:45 | Portal composer | Click **Send reply** once. Keep recording until **Reply sent.** appears. | Literal send action from the app UI. |
| 0:55 | Native Messenger conversation | Switch without a cut and show the identical proof sentence delivered from `DRG Law Test`. | Same message in the native client. |
| 1:10 | Native conversation and Page header | Hold for at least five seconds with both message text and Page name readable. | Reviewer can compare identity and text. |

Suggested on-screen caption, visible during the portal send:

`CaseLoad Select sends this operator-authored reply through the Messenger Send API using the configured Page access token.`

## Clip 2: `caseload-select-instagram-resubmission-v2.mp4`

Target permission: `instagram_manage_messages` or the exact equivalent label displayed for this app.

| Time | On screen | Operator action | Required evidence |
|---|---|---|---|
| 0:00 | Instagram account switcher, profile header, or Meta Business Suite Instagram asset view | Select or open `@drg_law_test`. Pause with the exact handle visible. | Authoritative Instagram identity from Meta UI. |
| 0:10 | The same Instagram DM thread | Show the recent inbound message from the test user. | User-initiated conversation and open response window. |
| 0:20 | CaseLoad Select brief for that same Instagram lead | Show **Instagram conversation**, configured Meta asset ID, recent inbound ledger message, and enabled composer. | App surface and server-resolved channel context. |
| 0:35 | Portal composer | Type a unique proof sentence in real time. Keep the byte counter below 1,000. | Live app-authored action. |
| 0:45 | Portal composer | Click **Send reply** once. Keep recording until **Reply sent.** appears. | Literal send action from the app UI. |
| 0:55 | Native Instagram DM | Switch without a cut and show the identical proof sentence delivered from `@drg_law_test`. | Same message in the native client. |
| 1:10 | Native thread and profile header | Hold for at least five seconds with both handle and message readable. | Reviewer can compare identity and text. |

Suggested on-screen caption, visible during the portal send:

`CaseLoad Select sends this operator-authored reply through the Instagram Messaging API using the linked Page access token.`

## Do not record or attach

- Do not re-record or resubmit WhatsApp. Both WhatsApp permissions are already approved.
- Do not attach the old Business Manager configuration clip to justify `business_management` or `pages_manage_metadata`; this source does not exercise those permissions.
- Do not reuse the v1 Messenger or Instagram clips. They show inbound automation, not the required live portal send.

## Clip verification

- [ ] One continuous take; no cut between Meta identity, portal send and native receipt
- [ ] Exact Meta identity is readable in Meta UI
- [ ] Recent inbound message is visible
- [ ] Portal conversation matches the channel and test lead
- [ ] Unique proof text is readable before send
- [ ] Cursor click on **Send reply** is visible
- [ ] Portal reports **Reply sent.**
- [ ] Identical text is readable in the native thread
- [ ] No secrets, personal data or production-client material is exposed
- [ ] English UI, H.264 MP4, at least 1080p, under three minutes, under 100 MB
