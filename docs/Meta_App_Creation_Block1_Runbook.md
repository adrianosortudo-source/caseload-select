# Meta App Creation · Block 1 Runbook

**Purpose:** Stand up the CaseLoad Select Meta Business Manager and the CaseLoad Select Meta App at developers.facebook.com, configure the three products (WhatsApp Business Platform, Messenger, Instagram Graph API), and wire the webhook receivers (already live at `/api/messenger-intake` and `/api/instagram-intake`).

**Estimated duration:** 30-45 minutes.
**Pre-requisites:** Adriano must be logged into Facebook + have Vercel dashboard access for `caseload-select` project.

---

## Pre-flight (check before starting)

| Check | How |
|---|---|
| Logged into Facebook with the personal account that will own the CaseLoad Select MBM | facebook.com — see profile photo top-right |
| Vercel dashboard access for `caseload-select` project | vercel.com → adrianosortudo-7282s-projects → caseload-select |
| App icon available locally | `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-app\public\brand\logos\icon-light-bg.png` (1024×1024 PNG) |
| Business address, phone, contact email decided | Operator address (work-from-home or virtual office) |

---

## Pre-generated values (use these verbatim)

| Field | Value |
|---|---|
| App name | `CaseLoad Select` |
| Contact email | `adriano@caseloadselect.ca` |
| Privacy Policy URL | `https://app.caseloadselect.ca/privacy` |
| Terms of Service URL | `https://app.caseloadselect.ca/terms` |
| App Category | Business and pages |
| Messenger webhook callback URL | `https://app.caseloadselect.ca/api/messenger-intake` |
| Instagram webhook callback URL | `https://app.caseloadselect.ca/api/instagram-intake` |
| Messenger verify token | `cls_msgr_c61f210e5854376cedb6b3631d3ea836ebdc44ea2029e82f` |
| Instagram verify token | `cls_ig_dm_03c98e075a2236858856565edf4eb200ccbccfd8ca7762b3` |

Store the verify tokens — they go into both the Meta developer console AND Vercel env vars (must match exactly).

---

## Phase A — Create the CaseLoad Select Meta Business Manager (5 min)

1. Go to `https://business.facebook.com/`
2. If you do not already have a Business Manager, click **Create account**. If you have one for personal use but want a clean CaseLoad Select MBM, click your profile top-right → **Create new business**.
3. **Business name:** `CaseLoad Select`
4. **Your name:** Adriano Domingues
5. **Business email:** `adriano@caseloadselect.ca`
6. Continue. Confirm the verification email Meta sends to `adriano@caseloadselect.ca`.
7. Once inside the new Business Manager, go to **Business Settings** (gear icon top-right) → **Business info**.
8. Fill in:
   - Legal business name: `CaseLoad Select`
   - Business address: [your operator address]
   - Business phone: [your operator phone]
   - Business website: `https://app.caseloadselect.ca` (or `https://caseloadselect.ca` if the marketing site is live)
   - Vertical: `Professional services` → `Marketing services` (closest match)
9. Save. The MBM exists with a Business ID — note it for the App creation step.

---

## Phase B — Create the Meta App (5 min)

1. Go to `https://developers.facebook.com/apps/`
2. Click **Create App**.
3. **What do you want your app to do?** → select **Other**.
4. **What type of app?** → select **Business** (this gates the elevated permissions we need).
5. Continue.
6. **App name:** `CaseLoad Select`
7. **App contact email:** `adriano@caseloadselect.ca`
8. **Business Account:** select the CaseLoad Select MBM from Phase A (dropdown).
9. **Create app** → enter your Facebook password to confirm.

You land on the App Dashboard. Note the **App ID** at the top.

---

## Phase C — Configure App Settings + Grab App Secret (5 min)

1. Left sidebar: **App settings** → **Basic**.
2. Fill in:
   - **App icon:** click upload, select `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-app\public\brand\logos\icon-light-bg.png`.
   - **Privacy Policy URL:** `https://app.caseloadselect.ca/privacy`
   - **Terms of Service URL:** `https://app.caseloadselect.ca/terms`
   - **Category:** Business and pages
   - **Business use:** Support my own business
   - **Data Deletion Instructions URL:** `https://app.caseloadselect.ca/privacy` (acceptable per Meta; the privacy policy covers deletion)
3. **App Secret:** click **Show** next to App Secret, enter your Facebook password. Copy the value — this is **META_APP_SECRET** for Vercel.
4. **Save changes** at the bottom.

---

## Phase D — Set Vercel env vars + redeploy (5 min)

This must happen BEFORE Meta can verify the webhook URLs in Phases E and F.

1. Go to `https://vercel.com/adrianosortudo-7282s-projects/caseload-select/settings/environment-variables`
2. Add three new Production env vars:

| Key | Value | Environment |
|---|---|---|
| `META_APP_SECRET` | [the App Secret from Phase C, step 3] | Production |
| `META_MESSENGER_VERIFY_TOKEN` | `cls_msgr_c61f210e5854376cedb6b3631d3ea836ebdc44ea2029e82f` | Production |
| `META_INSTAGRAM_VERIFY_TOKEN` | `cls_ig_dm_03c98e075a2236858856565edf4eb200ccbccfd8ca7762b3` | Production |

3. Click **Save** for each.
4. Trigger a redeploy: Deployments tab → most recent deployment → **Redeploy** → **Redeploy** in the confirmation dialog. Takes ~2 minutes.
5. Wait for the redeploy to land before continuing to Phase E.

While waiting, you can start Phase E by adding the products (skip the webhook verification steps until the redeploy completes).

---

## Phase E — Add WhatsApp Business Platform product (3 min)

1. App Dashboard → **Add product** → find **WhatsApp** → **Set up**.
2. WhatsApp setup wizard opens. You will be prompted to:
   - Link a Meta Business Account → select the CaseLoad Select MBM
   - Create or select a WhatsApp Business Account (WABA) → skip for now if it offers; we configure the test WABA in Block 2
3. The WhatsApp product is now added to the app. The Cloud API webhook fields can be configured later when the test WABA exists.

---

## Phase F — Add Messenger product (5 min)

1. App Dashboard → **Add product** → find **Messenger** → **Set up**.
2. Messenger Settings page opens.
3. Scroll to **Webhooks** section → click **Add Callback URL**.
4. Fill in:
   - **Callback URL:** `https://app.caseloadselect.ca/api/messenger-intake`
   - **Verify Token:** `cls_msgr_c61f210e5854376cedb6b3631d3ea836ebdc44ea2029e82f`
5. Click **Verify and Save**.
   - If Meta returns "The URL couldn't be validated" → the Vercel redeploy from Phase D may not be complete yet. Wait 30 seconds and retry.
   - If verification still fails → check Vercel env vars are set on Production environment specifically (not just Preview).
6. After successful verification, in the **Webhook Fields** section subscribe to:
   - `messages`
   - `messaging_postbacks`
   - `message_deliveries` (optional but useful)
   - `message_reads` (optional but useful)

---

## Phase G — Add Instagram Graph API product (5 min)

1. App Dashboard → **Add product** → find **Instagram Graph API** (sometimes labeled **Instagram Basic Display** + **Instagram Graph API**; we want the Graph API for business messaging).
2. Open the product settings.
3. Find **Webhooks** section → click **Add Callback URL** (or **Subscriptions**).
4. Fill in:
   - **Callback URL:** `https://app.caseloadselect.ca/api/instagram-intake`
   - **Verify Token:** `cls_ig_dm_03c98e075a2236858856565edf4eb200ccbccfd8ca7762b3`
5. Click **Verify and Save**.
6. Subscribe to:
   - `messages`
   - `messaging_postbacks`

---

## Phase H — Block 1 done. Confirmation (2 min)

End state to verify:

- [ ] CaseLoad Select Meta Business Manager exists at business.facebook.com
- [ ] Meta App `CaseLoad Select` exists at developers.facebook.com with a valid App ID
- [ ] App Settings → Basic has: privacy URL, terms URL, app icon, category, App Secret recorded
- [ ] Vercel has: META_APP_SECRET, META_MESSENGER_VERIFY_TOKEN, META_INSTAGRAM_VERIFY_TOKEN in Production env
- [ ] Vercel redeploy completed (post-env-var change)
- [ ] WhatsApp Business Platform product added
- [ ] Messenger product added + webhook verified + subscribed to `messages`
- [ ] Instagram Graph API product added + webhook verified + subscribed to `messages`

When all eight boxes are ticked: Block 1 is done. Move to Block 2 (test asset creation: test Facebook Page, test Instagram Business account, test WhatsApp number on a test firm GHL sub-account).

---

## Watchpoints

- **Webhook verification fails:** Meta sends a GET request with `hub.mode=subscribe`, `hub.verify_token=...`, `hub.challenge=...`. Our `/api/messenger-intake` handler echoes back the challenge if the verify token matches the env var. If verification fails, check (in order): (1) Vercel env var spelled exactly `META_MESSENGER_VERIFY_TOKEN` or `META_INSTAGRAM_VERIFY_TOKEN`; (2) value matches the verify token entered in Meta exactly; (3) redeploy completed after env vars were added; (4) the webhook receivers (`/api/messenger-intake` and `/api/instagram-intake`) are responding 200 to GET requests with the right query params.
- **App secret rotation:** if you ever regenerate the App Secret in Meta, immediately update the Vercel env var or all webhook signature verification fails and Meta auto-disables the subscription.
- **Business verification:** Meta may eventually ask for business verification documents (Articles of Incorporation, utility bill, etc.) for the CaseLoad Select Business itself. This is a separate flow from the per-firm verification we handle through the firm onboarding form. It does not block App Review submission, but un-verified businesses face stricter rate limits.

---

## What comes after Block 1

Block 2 (next session, ~2-3 hours): create test assets — test Facebook Page, test Instagram Business account, test WhatsApp number on a test firm GHL sub-account. Then record demo screencasts. Then submit App Review.
