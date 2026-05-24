# Meta App Review — Operator execution checklist

**Single source of truth for everything an operator clicks, types, or records to ship the Meta App Review submission.** Pure manual steps; everything the code can do is already shipped. Backend handshakes are green (Messenger HTTP 200, Instagram HTTP 200, WhatsApp HTTP 403 awaiting token).

Order matters. Each step depends on the previous one being complete.

---

## Block 2 — Test asset creation + verification

### Step 1 · Provision test firm row in Supabase (5 min)

Run in Supabase SQL Editor against project `ssxryjxifwiivghglqer` (Montreal):

```sql
INSERT INTO intake_firms (
  name,
  region,
  practice_areas,
  branding,
  active
) VALUES (
  'CaseLoad Select Test Firm',
  'on',
  '["immigration","employment"]'::jsonb,
  jsonb_build_object(
    'lawyer_email','adriano@caseloadselect.ca',
    'firm_display_name','CaseLoad Select Test Firm',
    'short_name','CaseLoad Test'
  ),
  true
) RETURNING id;
```

**Capture:** the returned UUID. This is `[testFirmId]` everywhere in the checklist.

---

### Step 2 · Create test Facebook Page (10 min)

1. Open `https://www.facebook.com/pages/creation/` logged in as the CaseLoad Select Business Portfolio owner.
2. Page name: `DRG Law Test`. Category: `Lawyer & Law Firm`. Bio: "Internal test page for CaseLoad Screen intake. Do not contact."
3. After creation: Settings → About → Page ID. **Capture the Page ID.**
4. Confirm the Page appears in the CaseLoad Select Business Portfolio (Business Settings → Accounts → Pages). Claim it manually if not auto-assigned.

---

### Step 3 · Create test Instagram Business account (10 min)

Path A (existing IG account, fastest):
1. From the Instagram app: Settings → Account → Switch to Professional Account → Business.
2. Category: `Lawyer & Law Firm`.
3. Link to Facebook: Settings → Linked accounts → Facebook → select `DRG Law Test`.

Path B (fresh account, cleaner):
1. Create new IG account with handle `drg_law_test` (or whatever is available).
2. Convert to Business (Path A steps 1-3).
3. Link to `DRG Law Test` Facebook Page.

**Capture:** the IG Business username (e.g. `@drg_law_test`).

---

### Step 4 · Connect test Page to Meta App's Messenger product (5 min)

1. Open `https://developers.facebook.com/apps/1007304805285554/use_cases/`
2. Click **Customize** on "Engage with customers on Messenger from Meta".
3. Left nav → **Messenger API Settings**.
4. Section 2 (Generate access tokens): click **Connect**, select `DRG Law Test`, grant requested permissions.
5. Click **Generate access token** beside the Page. **Capture the Page access token** to a secure note (you'll paste this into Supabase in Step 7).
6. Section 1 (Webhook): tick `messages` and `messaging_postbacks` for the connected Page. Save.

---

### Step 5 · Connect test IG Business to the Meta App (5 min)

1. Same Customize page → left nav → **Instagram settings**.
2. Webhooks section: click **Add or remove Pages** → select `DRG Law Test`.
3. Grant the IG permissions.
4. After connection, per-page IG subscription is active. The app-level `messages` + `messaging_postbacks` subscriptions saved in Block 1 now route the linked IG Business account's DMs to `/api/instagram-intake`.

---

### Step 6 · Provision WhatsApp test WABA + test phone (10 min)

1. App use-cases page → **Customize** on "Connect with customers through WhatsApp".
2. Quickstart: confirm Business Portfolio shows `CaseLoad Select`. Accept Facebook Terms for WhatsApp Business + Meta Hosting Terms.
3. Click **Continue**. Meta provisions:
   - Test WABA under the CaseLoad Select portfolio
   - Free Meta-issued test phone (sends to up to 5 verified recipients)
4. On the API Setup page, **capture:**
   - Phone number ID
   - WhatsApp Business Account ID (WABA ID)
   - Temporary 24-hour access token
5. Add up to 5 recipient phone numbers (your own + a colleague's). Each receives a verification code from Meta via WhatsApp; enter the code to authorize.
6. Use the curl example on API Setup to send the "Hello World" template message to your own phone. Confirm receipt.

---

### Step 7 · Configure WhatsApp webhook (5 min)

1. Generate a verify token. Suggested format: `cls_wa_` + 48 hex chars. Generate with:
   ```bash
   echo "cls_wa_$(openssl rand -hex 24)"
   ```
   **Capture the token.**
2. Add to Vercel Production env: `META_WHATSAPP_VERIFY_TOKEN=<your token>`. Redeploy.
3. Wait for deploy (~2 min). Verify the endpoint now accepts the token:
   ```bash
   curl -sw "\nHTTP %{http_code}\n" "https://app.caseloadselect.ca/api/whatsapp-intake?hub.mode=subscribe&hub.verify_token=<your-token>&hub.challenge=verify-test"
   ```
   Expect HTTP 200 + the challenge string echoed.
4. App use-cases page → WhatsApp → **Configuration** → Webhook section.
5. Callback URL: `https://app.caseloadselect.ca/api/whatsapp-intake`
6. Verify token: the value you just generated.
7. Click **Verify and Save**. Subscribe to `messages`.

---

### Step 8 · Populate Meta asset IDs + tokens in Supabase (5 min)

Replace `<...>` placeholders below with values captured above. Run in Supabase SQL Editor:

```sql
UPDATE intake_firms SET
  facebook_page_id = '<page-id-from-step-2>',
  instagram_business_account_id = '<ig-business-id-from-step-5>',
  whatsapp_phone_number_id = '<phone-number-id-from-step-6>',
  facebook_page_access_token = '<page-token-from-step-4>',
  whatsapp_cloud_api_access_token = '<wa-system-user-or-permanent-token-from-step-6>'
WHERE id = '<testFirmId>';
```

The Page access token from Step 4 is a long-lived token (60 days) tied to the operator's user. For production, swap for a System User token (does not expire). For App Review, the 60-day token is fine.

The 24-hour WhatsApp token from Step 6 is for live testing only. Before App Review submission, generate a permanent System User token in WhatsApp Business Manager and replace the value. The 24-hour token is enough to complete the end-to-end test in Step 9.

---

### Step 9 · End-to-end intake smoke test (15 min)

Open the triage portal in one browser tab:
`https://app.caseloadselect.ca/portal/<testFirmId>/triage` (request a magic link via `/api/portal/request-link` if not already authed).

**Messenger:**
1. From a personal Facebook account (NOT the test Page admin), search for `DRG Law Test` and message: "Hi, I just received a study permit refusal letter from IRCC. I need help filing an appeal before the deadline."
2. Wait 5-15 sec for the clarifying-question reply.
3. Reply: "Sarah Patel, sarah.patel.test@example.com"
4. Wait for the routing acknowledgment.
5. Refresh the triage portal. Verify the brief appears with channel chip "Facebook Messenger".

**Instagram:**
6. Repeat from a personal IG account, DM `@drg_law_test`. Verify channel chip "Instagram".

**WhatsApp:**
7. From one of the 5 allowlisted phones, message the Meta test number with the same inbound. Verify channel chip "WhatsApp".

If any channel fails to produce a brief: check Vercel function logs (`vercel logs --follow`), check Supabase `unconfirmed_inquiries` table (the row may have failed the contact-capture gate and landed there), check `webhook_outbox` for a failed delivery row.

---

### Step 10 · Record screencasts (45 min)

Follow the shot list in `screencasts/README.md`. Four clips:

1. `caseload-select-messenger-demo.mp4` (~90 sec)
2. `caseload-select-instagram-demo.mp4` (~80 sec)
3. `caseload-select-whatsapp-demo.mp4` (~80 sec)
4. `caseload-select-business-manager-config.mp4` (~90 sec)

Save all four into `docs/app-review/screencasts/`. Confirm each is under 100 MB and under 3 min before moving to Block 3.

---

### Step 11 · End-to-end data deletion verification (15 min)

Required by Section 6.3 of `Phase11_Submission_Package.md`. Lets the deletion claim in the App Review form rest on a real recent exercise.

1. Submit one test record via the test Page on Messenger (re-run Step 9 Messenger if needed, or use an existing brief from Step 9). Capture the resulting `lead_id` from the triage portal URL.
2. Send a manual deletion request from a test email account (e.g. your gmail) to `privacy@caseloadselect.ca`. Subject: "Data deletion request — lead ID `<lead_id>`". Body: "Please delete the personal information associated with this lead."
3. From the operator side, acknowledge the request to the sender within 5 business days (per the public policy timeline).
4. Run the purge:
   ```bash
   curl -X POST "https://app.caseloadselect.ca/api/admin/leads/<lead_id>/purge" \
     -H "Authorization: Bearer $CRON_SECRET"
   ```
   Expect `{"ok": true}`.
5. Verify in Supabase:
   ```sql
   SELECT id, contact_name, contact_email, contact_phone, raw_transcript
   FROM screened_leads WHERE id = '<lead_id>';
   ```
   Expect `contact_name='[anonymized]'`, the email/phone/raw_transcript fields all NULL.
6. Save a timestamped record to `docs/app-review/deletion-flow-verification.md` (template in this directory below).

---

## Block 3 — App Review submission

### Step 12 · Re-verify policy pages live (5 min)

```bash
curl -sI https://app.caseloadselect.ca/privacy | head -1
curl -sI https://app.caseloadselect.ca/terms | head -1
curl -sI https://app.caseloadselect.ca/data-deletion | head -1
```

All three must return `HTTP/2 200`. Privacy + Terms + Data Deletion pages already carry the 2026-05-24 update timestamp.

---

### Step 13 · Re-test the User Data Deletion URL validator (2 min)

The Meta validator rejected `/data-deletion` on 2026-05-13 with a stale "name_placeholder should represent a valid URL" error. Try again from a fresh hard-refresh of the dashboard at `https://developers.facebook.com/apps/1007304805285554/app-settings/basic/`.

If it still rejects: attach the curl 200 output and file a Meta developer-support ticket. The field is mandatory for App Review submission.

---

### Step 14 · App Settings → Basic page (5 min)

In the App dashboard at `https://developers.facebook.com/apps/1007304805285554/app-settings/basic/`, set each field:

| Field | Value |
|---|---|
| App display name | `CaseLoad Select` |
| App contact email | `hello@caseloadselect.ca` |
| Privacy Policy URL | `https://app.caseloadselect.ca/privacy` |
| Terms of Service URL | `https://app.caseloadselect.ca/terms` |
| User Data Deletion URL | `https://app.caseloadselect.ca/data-deletion` |
| Category | `Business` (sub-category: `Business and Pages` or `Productivity` if rejected) |
| App icon | Upload `public/brand/logos/icon-dark-bg-1024.png` |
| App Domain | `caseloadselect.ca` |
| Site URL (Website platform) | `https://app.caseloadselect.ca` |

Paste the long-form app description from `Phase11_Submission_Package.md` Section 1.2 into "Tell us about your app".

Save.

---

### Step 15 · Confirm Business verification status (varies)

In Meta Business Suite → Settings → Business Info → Verification. If unverified, expect Meta to ask for:
- Articles of incorporation or sole-proprietor registration
- Utility bill or bank statement matching the business address
- Second proof matching name + address

Verification can take 1-3 business days. WhatsApp Cloud API approval requires verified business; Messenger and Instagram approvals can proceed with a Business Portfolio that is not yet verified, but the App Review reviewer will check.

---

### Step 16 · Submit each permission for App Review (45 min)

In the App dashboard, navigate to App Review → Permissions and Features. For each permission below:

1. Click **Request advanced access**.
2. Paste the matching write-up sections from `Phase11_Submission_Package.md` Section 2.
3. Attach the matching screencast(s) per the table in `screencasts/README.md`.
4. For test instructions, paste the matching reviewer instructions block from Section 2.

Permissions to submit (8 total):

- [ ] `pages_messaging` (Section 2.1)
- [ ] `pages_show_list` (Section 2.2)
- [ ] `pages_manage_metadata` (Section 2.3)
- [ ] `business_management` (Section 2.4)
- [ ] `instagram_business_basic` (Section 2.5; verify name in dashboard, may be legacy `instagram_basic`)
- [ ] `instagram_business_manage_messages` (Section 2.6; may be legacy `instagram_manage_messages`)
- [ ] `whatsapp_business_messaging` (Section 2.7)
- [ ] `whatsapp_business_management` (Section 2.8)

---

### Step 17 · Reviewer credentials block (10 min)

In each permission's "Reviewer credentials" section, paste:

```
Test Facebook Page (Messenger): DRG Law Test
Test Instagram Business: @drg_law_test
Test WhatsApp number: <Meta test number from Step 6 — append the actual number when submitting>
Operator email (for portal-side verification on request): adriano@caseloadselect.ca

Note for WhatsApp testing: The Meta-provisioned test number on our test WABA is in
development mode and can only receive messages from numbers on the recipient allowlist.
Before testing, please share the reviewer phone number(s) in the App Review thread;
the operator will add them to the allowlist within 4 business hours.
```

---

### Step 18 · WhatsApp recipient allowlist add (5 min, after reviewer phones surface)

Meta surfaces reviewer phone numbers in the App Review form's "Required Items" panel once the WhatsApp use case is opened for submission.

1. Capture the reviewer phone(s) from that panel.
2. WhatsApp Manager → Phone numbers → Settings → Allowed recipient list.
3. Add each reviewer phone. Save.

The allowlist is the prerequisite for the reviewer's inbound test to reach `/api/whatsapp-intake`.

---

### Step 19 · Final pre-submit sanity (5 min)

- [ ] All 8 permissions have write-up, test instructions, and at least one screencast attached
- [ ] App Icon visible in the Basic settings page header
- [ ] Privacy, Terms, Data Deletion URLs all save without validator errors
- [ ] App Domain saves
- [ ] Category and sub-category select cleanly
- [ ] Business verification status is either "Verified" or in-progress (do not submit if rejected)
- [ ] All four screencasts under 100 MB and under 3 min

Click **Submit for review**. Expected turnaround: 3-7 business days. First-time submitters often see 7-14.

---

### Step 20 · Post-submission monitoring

Check the App Review status daily at `https://developers.facebook.com/apps/1007304805285554/app-review/`. If the reviewer raises a question, respond inside the App Review form's message thread (not via email). Quote the relevant Section number from `Phase11_Submission_Package.md` so context carries forward.

---

## State at hand-off back to operator (right now)

| Item | Status |
|---|---|
| Backend routes (`/api/{messenger,instagram,whatsapp}-intake`) | LIVE — handshakes green |
| Backend libs (firm-resolver, channel-intake-processor, send APIs) | LIVE |
| Privacy + Terms + Data Deletion pages | UPDATED 2026-05-24, all remediations from Phase11 Section 4.5 + 5.1/5.2/5.3 applied |
| `Phase11_Submission_Package.md` | COMPLETE — paste-ready for every permission slot |
| `screencasts/README.md` | COMPLETE — shot list per clip, naming, spec |
| `Operator_Execution_Checklist.md` (this file) | COMPLETE |
| `deletion-flow-verification.md` template | CREATED (below in this directory) |
| `META_MESSENGER_VERIFY_TOKEN` in Vercel | SET (Block 1) |
| `META_INSTAGRAM_VERIFY_TOKEN` in Vercel | SET (Block 1) |
| `META_WHATSAPP_VERIFY_TOKEN` in Vercel | NOT SET — operator generates in Step 7 |
| `META_APP_SECRET` in Vercel | SET (Block 1) |
| Test firm row in Supabase | NOT CREATED — operator runs INSERT in Step 1 |
| Test Facebook Page | NOT CREATED — Step 2 |
| Test IG Business | NOT CREATED — Step 3 |
| Test WhatsApp WABA + phone | NOT PROVISIONED — Step 6 |
| Screencasts (4 clips) | NOT RECORDED — Step 10 |
| Deletion flow verification | NOT RUN — Step 11 |
| App Review submission | NOT SUBMITTED — Step 16 onwards |

**Estimated operator time end-to-end:** 2-3 hours for Block 2 (Steps 1-11), 1-2 hours for Block 3 (Steps 12-20). Plus 3-7 business days waiting for Meta's review.
