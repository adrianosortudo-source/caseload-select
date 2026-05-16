# Meta App Creation · Block 2 Runbook

**Purpose:** Create the test assets needed to demonstrate the Meta App working end-to-end (test Facebook Page, test Instagram Business account, test WhatsApp number, test firm GHL sub-account), wire them through the app's existing intake plumbing, and record demo screencasts for the App Review submission.

**Prerequisite:** Block 1 closed 2026-05-13. Meta Business Portfolio, Meta App, Vercel env vars, Messenger + Instagram webhook verifications all live and verified.

**Estimated duration:** 2-3 hours.

**Pre-requisites checklist:**

- [ ] Logged into the Facebook account that owns the CaseLoad Select Business Portfolio
- [ ] Vercel dashboard access for `caseload-select` project
- [ ] GoHighLevel agency account access (for the test firm sub-account)
- [ ] Phone with a SIM (for the WhatsApp test number recipient list — up to 5 numbers can receive from the Meta test phone)
- [ ] Screen-recording tool ready (OBS, Loom, or QuickTime)

---

## Key values carried over from Block 1

| Field | Value |
|---|---|
| Meta App ID | `1007304805285554` |
| Meta Business Portfolio ID | `2191422434947205` |
| Messenger webhook URL | `https://app.caseloadselect.ca/api/messenger-intake` |
| Instagram webhook URL | `https://app.caseloadselect.ca/api/instagram-intake` |
| Messenger verify token | `cls_msgr_c61f210e5854376cedb6b3631d3ea836ebdc44ea2029e82f` |
| Instagram verify token | `cls_ig_dm_03c98e075a2236858856565edf4eb200ccbccfd8ca7762b3` |
| Meta App Secret | `66417396d1de2f4abcee5f67973617cd` (also in Vercel as `META_APP_SECRET`) |

All three secrets are already saved as Production env vars in Vercel and verified working via the webhook handshake test (both endpoints returned the challenge string with HTTP 200 on 2026-05-13).

---

## Phase 1 — Create test Facebook Page (10 min)

1. Go to `https://www.facebook.com/pages/creation/`
2. **Page name:** `DRG Law Test` (or `CaseLoad Select Test Firm`). Clearly mark this as a test page.
3. **Category:** `Lawyer & Law Firm` (closest match for the screencasts).
4. **Bio:** Single line, something like "Internal test page for CaseLoad Screen intake. Do not contact." This page is never public-facing; the bio is just to prevent confusion if anyone finds it.
5. Skip the profile photo and cover photo for now — they don't matter for the App Review screencast.
6. After creation, note the **Page ID** (Settings → About → Page ID, near the bottom).
7. Open the Page Settings → Linked accounts → look for Messenger integration confirmation.

The new Page automatically lives under the CaseLoad Select Business Portfolio (since you created it logged in as the portfolio owner). If it doesn't, manually claim it from Business Settings → Accounts → Pages → Add → Claim a Page.

---

## Phase 2 — Create test Instagram Business account (10 min)

Two paths depending on whether you have a personal IG account to convert or want to create fresh:

**Path A — Use existing IG account (faster):**
1. From the Instagram app, settings → Account → Switch to Professional Account → Business.
2. Pick `Lawyer & Law Firm` category.
3. Skip the bio updates for now.
4. Link the Business account to the test FB Page from Phase 1: IG settings → Linked accounts → Facebook → select the test Page.

**Path B — Create fresh IG account (cleaner):**
1. Create a new Instagram account with username like `drg_law_test` (or whatever's available).
2. Convert to Business immediately (as in Path A step 1-3).
3. Link to the test FB Page from Phase 1.

Either way, note the **Instagram Business account username** for the screencast.

---

## Phase 3 — Connect test Page to the Meta App's Messenger product (5 min)

This is the step that activates the webhook field subscriptions we couldn't configure in Block 1 (because no Page was connected).

1. Go to `https://developers.facebook.com/apps/1007304805285554/use_cases/`
2. Click **Customize** on the **Engage with customers on Messenger from Meta** row.
3. Click **Messenger API Settings** in the left sub-nav.
4. Scroll to **Section 2: Generate access tokens**.
5. Click **Connect** (the blue button under "No FB pages yet").
6. In the Page selection modal, select the test FB Page from Phase 1. Grant all requested permissions.
7. Once connected, the Page appears in Section 2 with a "Generate access token" link next to it. Click that, copy the token. Save somewhere temporary — you'll need it for the integration test in Phase 6.
8. Scroll back up to Section 1 (the webhook). Below the green-checked callback URL, find the **Webhook Fields** subscriptions for the connected Page. Tick:
   - `messages`
   - `messaging_postbacks`
   - `message_deliveries` (useful, optional)
   - `message_reads` (useful, optional)
9. Save.

---

## Phase 4 — Connect test Instagram Business account to the Meta App (5 min)

1. Same app, same Customize page. Click **Instagram settings** in the left sub-nav (still inside the Messenger use case — that's where the IG Business linked-via-Page config lives).
2. Scroll to the **Webhooks** section (we configured the callback in Block 1).
3. Below the Webhooks panel, find the "No page permissions granted" notice with the **Add or remove Pages** button.
4. Click **Add or remove Pages** → select the test FB Page (which has the test IG Business account linked).
5. Grant the requested IG permissions.
6. After connection, the per-page subscription is active. The `messages` + `messaging_postbacks` subscriptions we saved at the app level in Block 1 now apply to incoming DMs at the linked IG Business account.

---

## Phase 5 — Provision WhatsApp test WABA + test phone number (10 min)

1. Same app. Click **Use cases** in the main left sidebar to return to overview.
2. Click **Customize** on the **Connect with customers through WhatsApp** row.
3. You'll land on **Quickstart**. The Business Portfolio dropdown should already show "CaseLoad Select".
4. **Read the terms** (Facebook Terms for WhatsApp Business + Meta Hosting Terms for Cloud API). Confirm you accept.
5. Click **Continue**. Meta provisions:
   - A test WhatsApp Business Account (WABA) under the CaseLoad Select portfolio
   - A free Meta-issued test phone number (good for sending to up to 5 verified recipient numbers)
6. After provisioning, you land on the **API Setup** page. Note:
   - **Phone number ID** (Meta's internal ID for the test number)
   - **WhatsApp Business Account ID** (the WABA ID)
   - **Temporary access token** (24-hour token for quick testing)
7. Add up to 5 **recipient phone numbers** in the "To" field section — these are the numbers that can receive messages from the test number during development. Add your own phone, and optionally a colleague's.
8. The recipient phone receives a verification code via WhatsApp from Meta. Enter the code to authorize the number.
9. Use the curl example on the API Setup page to send a test "Hello World" template message to your phone. Confirm receipt.

---

## Phase 6 — Configure WhatsApp Cloud API webhook (5 min)

1. Same WhatsApp use case → **Configuration** in the left sub-nav.
2. Find the **Webhook** section.
3. **Callback URL:** `https://app.caseloadselect.ca/api/whatsapp-intake` (Note: this endpoint may not exist yet — see Phase 7).
4. **Verify token:** Generate a new token following the same pattern as Messenger/IG. Suggested: `cls_wa_` + 48 random hex chars. Save it; we'll add to Vercel.
5. Before clicking Verify and Save, finish Phase 7 first to make sure the endpoint exists and the env var is in Vercel.

---

## Phase 7 — Build `/api/whatsapp-intake` endpoint if needed (15 min)

Check the app repo:

```
ls D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-app\src\app\api\whatsapp-intake\
```

If it exists, skip to Phase 8. If not:

1. Use `/api/messenger-intake/route.ts` as the template — same HMAC verification pattern, same hub.challenge handshake.
2. The differences from Messenger:
   - WhatsApp webhook payload shape is different (look at Meta's Cloud API docs for the `messages` field structure)
   - The verify token env var is `META_WHATSAPP_VERIFY_TOKEN` (new) — add to Vercel Production.
   - Persists to `screened_leads` with `channel='whatsapp'`.
3. Commit + push. Vercel redeploys. Confirm 200 on the handshake:
```
curl -sw "\nHTTP %{http_code}\n" "https://app.caseloadselect.ca/api/whatsapp-intake?hub.mode=subscribe&hub.verify_token=<the-token>&hub.challenge=test"
```

Then go back to Phase 6 and click Verify and Save.

---

## Phase 8 — Set up test firm GHL sub-account (15 min)

1. Log into GHL agency account.
2. Sub-Accounts → Create → name it `DRG Law Test` (matching the test FB Page).
3. Provision the sub-account with the standard CaseLoad Select setup (SMS, voice AI, etc.). The full per-firm provisioning checklist lives in `D:\00_Work\01_CaseLoad_Select\04_Playbooks\05_Operations\` — follow that.
4. For the WhatsApp number, in Block 2 we use the **Meta test phone number** (Phase 5), NOT a production GHL-provisioned WhatsApp number. The test number is for App Review demonstration. Production WhatsApp numbers attach via GHL after App Review passes.

---

## Phase 9 — End-to-end intake test on each channel (15 min)

For each channel, send a DM to the test asset from a personal account, then check the lawyer triage portal.

**Messenger test:**
1. Open Facebook Messenger (logged in as a personal account NOT the page owner).
2. Search for the test FB Page (Phase 1) — message it.
3. Send: "Hi, I need help with an immigration matter. Just got my study permit denial letter."
4. Open `https://app.caseloadselect.ca/portal/<firm-id>/triage` for the test firm.
5. The lead should appear within seconds. Click into the brief. Confirm:
   - `channel='messenger'`
   - Brief HTML rendered
   - Lifecycle = `triaging`
   - Language detection worked (English here, English brief)

**Instagram test:**
1. From a personal IG account, DM the test IG Business account.
2. Same message body as Messenger.
3. Same verification in the triage portal — but `channel='instagram'`.

**WhatsApp test:**
1. From your phone (one of the 5 verified recipient numbers), send a message TO the test WhatsApp number. Wait — actually the test number can only SEND from Meta to your phone. To test the inbound webhook, your phone needs to message the test number, which Cloud API may not support for outbound-only test numbers. **Verify Meta's current restrictions on the test number** before assuming bidirectional flow.
2. If bidirectional is not supported on the test number, document this in the App Review screencast as a known limitation of the test phase; the production WABA-flow will be bidirectional.

---

## Phase 10 — Record demo screencasts (30 min)

One short clip per channel (60-90 sec each). Each clip shows:
1. Sender device with the message being composed
2. Send action
3. Cut to the triage portal showing the new lead arriving
4. Click into the brief
5. Show the take/pass action bar

Suggested clip names:
- `caseload-select-messenger-demo.mp4`
- `caseload-select-instagram-demo.mp4`
- `caseload-select-whatsapp-demo.mp4`

Save the clips to:
```
D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-app\docs\app-review\screencasts\
```

These clips go into the Meta App Review submission package (Block 3).

---

## Phase 11 — Block 2 confirmation checklist

End state to verify:

- [ ] Test Facebook Page exists under CaseLoad Select Business Portfolio
- [ ] Test Instagram Business account exists, linked to the test Page
- [ ] Test WhatsApp number provisioned, recipient list populated
- [ ] Test firm GHL sub-account exists
- [ ] Messenger webhook subscribed to `messages` + `messaging_postbacks` at the Page level
- [ ] Instagram webhook subscribed to `messages` + `messaging_postbacks` at the IG Business account level
- [ ] WhatsApp `/api/whatsapp-intake` endpoint exists, env var set, webhook verified
- [ ] End-to-end intake confirmed on Messenger (lead appears in triage portal)
- [ ] End-to-end intake confirmed on Instagram (lead appears in triage portal)
- [ ] End-to-end intake confirmed on WhatsApp (or documented limitation)
- [ ] Three demo screencasts recorded and saved to docs/app-review/screencasts/

When all eleven boxes are ticked: Block 2 is done. Move to Block 3 (App Review submission package + form completion + submit).

---

## Block 1 leftovers to retry today

- **Meta User Data Deletion URL validator bug:** The field rejected `https://app.caseloadselect.ca/data-deletion` with a stale "name_placeholder should represent a valid URL" error on 2026-05-13, even though the page is live and returns HTTP 200. Try again today from a fresh hard reload. If still rejected, file a support ticket with Meta — the page is correctly hosted, this is a validator bug on their side. The field is non-blocking for Block 1/2 but becomes mandatory at App Review submission in Block 3.

---

## What comes after Block 2

Block 3 (~2-4 hours): finalize the App Review submission package. Compose the use-case-by-use-case write-up, attach the screencasts, fill the App Review form per permission requested, submit. Then wait for Meta's review (typically 3-7 business days, longer for first-time submitters).

Permissions to request at App Review for Block 3 (per the master CLAUDE.md):

| Permission | For | Use case |
|---|---|---|
| `pages_messaging` | Messenger | Send/receive DMs through the test Page |
| `pages_manage_metadata` | Messenger | Subscribe the Page to webhooks |
| `pages_show_list` | Messenger | List Pages the firm owns |
| `instagram_business_basic` (or legacy `instagram_basic`) | Instagram | Read IG Business account info |
| `instagram_business_manage_messages` (or legacy `instagram_manage_messages`) | Instagram | Read/respond to IG DMs |
| `business_management` | Both | Access Business Portfolio data |
| `whatsapp_business_messaging` | WhatsApp | Send/receive WhatsApp messages |
| `whatsapp_business_management` | WhatsApp | Manage WABA settings |

`public_profile` is auto-granted; `email` is optional (we don't request user email through these channels in the intake flow).

**IG scope naming note (2026-05-15):** Meta renamed the Instagram-side scopes in 2024 as the API moved to Business Login. The current names are `instagram_business_basic` and `instagram_business_manage_messages`; the older names (`instagram_basic` / `instagram_manage_messages`) still appear on some legacy apps. Reconcile against the actual labels shown in the App Review dashboard for App ID `1007304805285554` at paste time. The operational use does not change between the two name sets.
