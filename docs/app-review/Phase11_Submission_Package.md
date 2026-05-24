# Meta App Review submission package: CaseLoad Select

**App:** CaseLoad Select
**App ID:** 1007304805285554
**Business Portfolio ID:** 2191422434947205
**Submitter:** Adriano Domingues (sole operator, sole admin)
**Operator email:** hello@caseloadselect.ca
**Submission target date:** _________________ (fill on submit day)

This document is the paste-ready package for the App Review form. Each section maps to a Meta dashboard field or modal. Section 2 has one paste-ready block per requested permission. Sections 4 and 5 list policy gaps the operator must close before submitting.

---

## 1. App-level metadata

### 1.1 App display name, category, sub-category

| Field | Value |
|---|---|
| App display name | `CaseLoad Select` |
| Category | `Business` |
| Sub-category | `Business and Pages` [VERIFY WITH ADRIANO: Meta's sub-category list updates without notice; pick the closest match for a B2B legal-services intake tool. `Productivity` is the fallback.] |

### 1.2 App description (paste-ready)

Field label in the dashboard: "Tell us about your app". Paste the block below verbatim.

```
CaseLoad Select is a case-acquisition and selection service for Canadian law firms operating in Ontario. The product receives inbound inquiries from prospective legal clients across six channels (web widget, Facebook Messenger, Instagram DM, WhatsApp, SMS, inbound phone call) and produces a structured brief for the firm's lawyer to review. An AI engine extracts case details, assigns a priority band (A, B, C, or D), and routes the inquiry to a lawyer-facing triage portal.

Each client firm operates inside its own tenant. The Meta-channel assets (Facebook Pages, Instagram Business accounts, WhatsApp Cloud API phone numbers) are connected to the platform by the firm that owns them. The service does not send unsolicited messages, does not aggregate data across firms, and does not use Meta data for advertising or any purpose unrelated to the firm's own intake decisions.

CaseLoad Select is operated by Adriano Domingues from Toronto, Ontario. The first production tenant is DRG Law, a Toronto firm practising immigration and civil litigation. The service is calibrated for the Law Society of Ontario's professional conduct rules; no automated communication promises legal outcomes or implies a lawyer-client relationship before a firm accepts a matter.
```

### 1.3 App icon

| Requirement | Status |
|---|---|
| Format | PNG |
| Size | 1024×1024 |
| Source file | `public/brand/logos/icon-dark-bg-1024.png` |
| Local path | `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-app\public\brand\logos\icon-dark-bg-1024.png` |
| Action | Upload via the Meta dashboard "App Icon" slot under Basic Settings. |

### 1.4 App platforms

| Platform | Status |
|---|---|
| Website | YES: primary surface at `https://app.caseloadselect.ca` |
| iOS | Not applicable |
| Android | Not applicable |
| Windows app | Not applicable |
| Page tab | Not applicable |
| Gaming | Not applicable |

In the platforms section, add **Website** only. App Domain: `caseloadselect.ca`. Site URL: `https://app.caseloadselect.ca`.

### 1.5 Business verification status

[VERIFY WITH ADRIANO: Block 1 set up the CaseLoad Select Business Portfolio (ID 2191422434947205). Business verification is a distinct flow from Business Portfolio creation. Confirm in Meta Business Suite → Settings → Business Info → Verification status. WhatsApp Cloud API submission requires verified business; Messenger and Instagram approvals can proceed with a Business Portfolio that is not yet verified, but the App Review reviewer will check.]

If unverified, expect to upload:
- Articles of incorporation or sole-proprietor business registration
- Utility bill or bank statement matching the registered business address
- A second proof matching name and address

### 1.6 Compliance URLs

Paste these into the Basic Settings page exactly as shown:

```
Privacy Policy URL:        https://app.caseloadselect.ca/privacy
Terms of Service URL:      https://app.caseloadselect.ca/terms
User Data Deletion URL:    https://app.caseloadselect.ca/data-deletion
```

**Block 1 leftover (2026-05-13):** the Meta validator rejected the data-deletion URL with a stale `name_placeholder should represent a valid URL` error even though the page returns HTTP 200. Today (2026-05-15) try a fresh hard reload of the dashboard. If the field still refuses to save, attach a screenshot of the page returning 200 (via `curl -sI https://app.caseloadselect.ca/data-deletion`) and open a Meta developer-support ticket before submitting; the URL must save before the form can be submitted.

---

## 2. Per-permission justifications

Each block below corresponds to one row in the App Review form. Three pastes per permission: the use-case justification, the reviewer test instructions, and the screencast annotation notes.

### 2.1 `pages_messaging` (Messenger)

**Use case justification (paste-ready):**

```
CaseLoad Select receives inbound Facebook Messenger conversations on Pages owned by the law firms that engage us. Each firm connects its own Page during setup; the firm consents in-flow via the standard Page-connection prompt. When a prospective legal client messages the connected Page, our webhook receives the inbound text, runs an AI screening engine that classifies the matter and extracts case details, and produces a structured brief for the firm's lawyer.

The pages_messaging permission is required for two operations. First, to receive the inbound message via the messages webhook subscription. Second, to send a clarifying response back to the prospect through the Page Send API. A typical conversation runs as follows: the prospect describes a legal matter in one or two sentences; the engine sends one short clarifying question asking for the prospect's name and an email or phone number where the firm can reach them; the prospect replies with their contact details; the engine sends a brief acknowledgment confirming that a lawyer will review the inquiry. The lawyer then receives an emailed notification with a link to the full brief in the triage portal.

A receive-only configuration is not viable. The platform's contact-capture rule requires both a name and a reachable email or phone before a lead is routed to the lawyer. Inbound messages that do not carry contact data must trigger a clarifying question on the same channel. Without send capability, the conversation breaks and the lawyer cannot reach the prospect.

Data captured through this channel (message text, sender Page-Scoped ID, sender profile name when available) is stored only within the firm's CaseLoad Select tenant, retained per the band-based schedule in our Privacy Policy, never sold, never used for advertising, and never aggregated across firms. The 24-hour standard messaging window is the only context in which the service sends; we do not send promotional content and do not use the Human Agent permission.
```

**Reviewer test instructions (paste-ready):**

```
Test Page: DRG Law Test (Page ID supplied separately in the Credentials section).

1. From a personal Facebook account that does not administer the test Page, open Facebook Messenger.
2. Search for the DRG Law Test Page and open a new conversation.
3. Send: "Hi, I just received a study permit refusal letter from IRCC. I need help filing an appeal before the deadline."
4. Wait 5 to 15 seconds. The Page will reply with a clarifying question similar to: "Thanks for reaching out. Before a lawyer reviews this, could you share your full name and an email or phone number where the firm can reach you?"
5. Reply with a name and a reachable email address.
6. The Page will send a brief acknowledgment confirming the matter has been routed to a lawyer.
7. The structured brief appears in the firm's private triage portal within 60 seconds; no portal access is required to verify the inbound and outbound message exchange on Messenger.

The test exercises both the receive path (webhook to /api/messenger-intake) and the send path (Messenger Send API). No reviewer message will be retained beyond what the demonstration requires; deletion of the test conversation can be requested per the User Data Deletion URL.
```

**Screencast annotation notes:**

```
(00:00) Reviewer opens Messenger, sends inbound intake message to DRG Law Test Page.
(00:05) Webhook arrives at /api/messenger-intake; engine runs; clarifying question sent back via Page Send API.
(00:20) Reviewer replies with name + email; Page acknowledges; brief appears in triage portal.
```

### 2.2 `pages_show_list` (Messenger)

**Use case justification (paste-ready):**

```
CaseLoad Select uses pages_show_list during the operator-driven onboarding flow for each new client firm. When a law firm engages our service, the operator logs into the firm's Facebook business account (with the firm's consent, in a screen-share session) and connects the firm's Facebook Page to CaseLoad Select. The Page-picker UI requires pages_show_list to enumerate the Pages the firm's Facebook user administers, so the operator can select the correct Page to wire into the firm's tenant.

This is a setup-time use case, not a runtime use case. Once the firm's Page is mapped to its CaseLoad Select tenant (stored as facebook_page_id on the intake_firms row), pages_show_list is not called again for that firm. New firms repeat the flow at onboarding.

We do not call pages_show_list to enumerate Pages for any purpose unrelated to selecting the specific Page the firm wants connected to its CaseLoad Select tenant. The result is not stored, displayed publicly, or shared.
```

**Reviewer test instructions (paste-ready):**

```
This permission is exercised during firm onboarding, not during a standalone end-user flow. To verify:

1. Sign into Facebook as the test admin user for DRG Law Test (credentials supplied separately).
2. Open the CaseLoad Select operator onboarding wizard at https://app.caseloadselect.ca/admin/firm-setup/meta (an operator-only path).
3. The wizard prompts for the firm name and then triggers the Meta Page-connection flow.
4. The Meta dialog asks the admin to grant pages_show_list along with pages_messaging and pages_manage_metadata.
5. After consent, the wizard displays the list of Pages the admin user manages (in this test, DRG Law Test should appear).
6. The admin selects DRG Law Test and saves; the wizard writes the selected Page ID to the firm's record.

Pages_show_list is used only to render the in-wizard Page picker. No Page-list data is stored.
```

**Screencast annotation notes:**

```
(00:00) Operator opens firm-setup wizard, clicks "Connect Facebook Page".
(00:04) Meta consent dialog appears requesting pages_show_list + companion scopes.
(00:08) On consent, wizard renders the Page list; operator selects DRG Law Test; Page ID is saved.
```

### 2.3 `pages_manage_metadata` (Messenger)

**Use case justification (paste-ready):**

```
CaseLoad Select uses pages_manage_metadata at onboarding to subscribe the firm's connected Facebook Page to the messages and messaging_postbacks webhook fields. Without this subscription, inbound Messenger conversations sent to the Page would not arrive at our /api/messenger-intake endpoint, and the screening engine would never run for the firm.

The subscription is set once per firm, at the time the Page is connected. We do not modify Page metadata for any other purpose. Specifically: we do not change the Page's public profile, business hours, settings, response time, or any of the fields a Page admin would expect to control directly through Facebook's UI. The permission is used narrowly to flip on webhook delivery for the conversation surface the firm has authorised the platform to read.

When a firm offboards (ends its engagement with CaseLoad Select), the subscription is removed via the same permission so inbound messages stop routing to our endpoint and the conversation surface returns fully to the firm's direct control.
```

**Reviewer test instructions (paste-ready):**

```
Same operator-driven setup flow as pages_show_list (see Section 2.2 reviewer instructions). After the operator selects the DRG Law Test Page:

1. The setup wizard programmatically subscribes the Page to messages + messaging_postbacks via the Page subscribed_apps endpoint.
2. The wizard confirms the subscription was created successfully and writes the firm's facebook_page_id to the intake_firms table.
3. To verify post-subscription: from a personal Facebook account, message the DRG Law Test Page (per the pages_messaging test in Section 2.1). The message arrives at our /api/messenger-intake endpoint within 1 to 2 seconds, confirming the webhook subscription is live.
```

**Screencast annotation notes:**

```
(00:00) Wizard fires Page-subscription call after Page selection.
(00:03) Subscription confirmation returned; intake_firms row updated.
(00:07) Reviewer sends test DM; webhook arrives at /api/messenger-intake within 2 seconds.
```

### 2.4 `business_management` (Messenger and Instagram)

**Use case justification (paste-ready):**

```
CaseLoad Select uses business_management at onboarding to confirm that the Page and Instagram Business account the operator is about to connect belong to the same Business Portfolio that the firm controls. This is a verification step: it prevents an operator from mistakenly wiring a Page or IG account that does not belong to the firm's Business Portfolio, which would route a stranger's inbound traffic into the firm's tenant.

After the verification check, no further business_management calls run for that firm during routine operation. The permission is not used to read other Business assets, modify the Business Portfolio, or enumerate assets the firm has not asked us to connect.

For the test firm DRG Law Test, the relevant Business Portfolio is CaseLoad Select (Portfolio ID 2191422434947205), the same portfolio that hosts this Meta App.
```

**Reviewer test instructions (paste-ready):**

```
Same operator-driven setup flow as Section 2.2. At Page-connect time:

1. The wizard calls the Business Portfolio endpoint to confirm the selected Page is owned by the same Business Portfolio that contains the firm's asset set.
2. The check returns a yes/no; on yes, the wizard proceeds to subscribe the Page (Section 2.3). On no, the wizard shows an error and refuses to connect.
3. No business asset data is displayed, stored, or shared beyond the boolean confirmation.
```

**Screencast annotation notes:**

```
(00:00) Wizard fires Business Portfolio ownership check on selected Page.
(00:02) Check returns positive; wizard proceeds to webhook subscription.
```

### 2.5 `instagram_business_basic` (Instagram)

[VERIFY WITH ADRIANO: Meta renamed the Instagram-side scopes in 2024 as the API moved to Business Login. The current names are `instagram_business_basic` (replacing the older `instagram_basic`) and `instagram_business_manage_messages` (replacing `instagram_manage_messages`). The runbook lists the older names; the App Review dashboard will reflect what is in the use case configuration on App ID 1007304805285554. Confirm which set the app is on before pasting. The justification text below works for both because the operational use does not change between the legacy and Business Login variants.]

**Use case justification (paste-ready):**

```
CaseLoad Select uses instagram_business_basic (formerly instagram_basic) to read the metadata of the Instagram Business Account that a firm wishes to connect to CaseLoad Select during onboarding. The metadata is the IG Business Account ID and the linked Facebook Page ID. These two identifiers let the platform map an inbound Instagram DM (which arrives identified only by an IG Business Account ID on the webhook) to the firm that owns the account.

The permission is read-only and used only at setup time, in the same wizard step that connects the firm's Facebook Page. It is not called during conversation processing; the IG Business Account ID is cached on the firm's intake_firms row at connection time and matched against incoming webhook payloads.
```

**Reviewer test instructions (paste-ready):**

```
Same operator-driven onboarding flow as Section 2.2, with the addition:

1. After the Facebook Page connection completes, the wizard offers an "Add Instagram Business" step.
2. The wizard reads the IG Business Accounts linked to the just-connected Page via the Page-edge query for instagram_business_account.
3. The DRG Law Test Page has the test Instagram Business account (@drg_law_test) linked at the Facebook side; the wizard displays it for selection.
4. The operator selects the IG account; the wizard writes instagram_business_account_id to the intake_firms row.
```

**Screencast annotation notes:**

```
(00:00) Wizard fires Page → IG Business Account edge query.
(00:03) Linked @drg_law_test account returned and rendered for selection.
(00:06) Operator selects; instagram_business_account_id saved on the firm record.
```

### 2.6 `instagram_business_manage_messages` (Instagram)

[VERIFY WITH ADRIANO: same renaming caveat as Section 2.5. If the app is on the legacy names, paste this as `instagram_manage_messages`.]

**Use case justification (paste-ready):**

```
CaseLoad Select uses instagram_business_manage_messages to receive inbound Instagram Direct Messages sent to the firm's connected IG Business Account and to send a clarifying reply back through the Instagram Send API. The conversational shape is identical to Messenger: the prospect describes a legal matter, the engine sends one short clarifying question asking for name and a reachable email or phone, the prospect replies, and the engine sends a brief acknowledgment confirming routing to a lawyer.

As with Messenger, send capability is required because the contact-capture rule cannot be satisfied with a receive-only configuration. A first message that lacks name plus email or phone triggers a follow-up question on the same channel; without send, that loop cannot run and the lawyer has no reachable contact to follow up on. We send only within the standard 24-hour Instagram messaging window and do not use Instagram Direct messaging for promotional content.

Per-firm scope is enforced at the asset level: only IG Business Accounts that a firm has explicitly connected to its CaseLoad Select tenant are read or written. Inbound DMs to other IG accounts the app may be connected to are ignored when the firm-resolver returns no match.
```

**Reviewer test instructions (paste-ready):**

```
Test IG Business account: @drg_law_test (username supplied separately).

1. From a personal Instagram account (the username does not matter; any account that can DM @drg_law_test will do), open the IG mobile app.
2. Navigate to @drg_law_test and open a new DM.
3. Send: "Hi, I just received a study permit refusal letter from IRCC. I need help filing an appeal before the deadline."
4. Wait 5 to 15 seconds. The account replies with a clarifying question similar to: "Thanks for reaching out. Could you share your full name and an email or phone number where the firm can reach you?"
5. Reply with a name and an email address.
6. The account sends a brief acknowledgment confirming the matter has been routed to a lawyer.

The test exercises both receive (/api/instagram-intake webhook) and send (Instagram Send API via the linked Page token) paths.
```

**Screencast annotation notes:**

```
(00:00) Reviewer opens Instagram, sends inbound intake DM to @drg_law_test.
(00:05) Webhook arrives at /api/instagram-intake; engine runs; clarifying question sent via Instagram Send API.
(00:20) Reviewer replies with name + email; account acknowledges; brief appears in triage portal.
```

### 2.7 `whatsapp_business_messaging` (WhatsApp)

**Use case justification (paste-ready):**

```
CaseLoad Select uses whatsapp_business_messaging to receive inbound WhatsApp Cloud API messages sent to a phone number the firm has connected to its tenant, and to send a clarifying reply back through the Cloud API messages endpoint. The conversational shape matches Messenger and Instagram: the prospect describes a legal matter, the engine sends one short clarifying question asking for name and a reachable email or phone, the prospect replies, the engine sends a brief acknowledgment confirming the matter has been routed.

The platform sends only in the 24-hour customer-service window opened by the prospect's inbound message. We do not send template messages for marketing, do not initiate outbound conversations to numbers that have not first messaged the firm, and do not bulk-send. The data flow ends at the firm's tenant: contact information is used by the firm's lawyer to decide whether to take the matter on, and is retained per the band-based schedule documented in the Privacy Policy.

For App Review, the demo runs against the Meta-provisioned test phone number on the test WABA. Production deployment will use a verified business phone number that each firm has registered to its own WABA and connected to its CaseLoad Select tenant. Firms control their own WABA-level settings; we read and write only the conversation surface they have authorised.
```

**Reviewer test instructions (paste-ready):**

```
Test phone number: +1 555 629 8048 (Meta-provisioned test number on the CaseLoad Select test WABA). The number is in development mode and can receive only from the recipient allowlist on the test WABA.

Before testing, the reviewer phone must be added to the allowlist:

1. Provide a phone number where the reviewer wishes to test. CaseLoad Select adds it to the recipient allowlist on the test WABA. (Coordinate via the operator email supplied in Credentials.)
2. After the number is allowlisted, the reviewer receives a WhatsApp verification code from Meta and confirms.

Once allowlisted:

3. From the allowlisted phone, save +1 555 629 8048 as a contact.
4. Open WhatsApp and start a new conversation with that number.
5. Send: "Hi, I just received a study permit refusal letter from IRCC. I need help filing an appeal before the deadline."
6. Wait 5 to 15 seconds. The number replies with a clarifying question asking for name and an email or phone.
7. Reply with name and an email address.
8. The number sends a brief acknowledgment confirming routing to a lawyer.

If Meta's test phone number remains outbound-only at the time of review and cannot accept the reviewer's inbound message, CaseLoad Select will provide a short pre-recorded screencast (saved to docs/app-review/screencasts/caseload-select-whatsapp-demo.mp4) that demonstrates the same end-to-end flow run against a non-test inbound while the production phone is provisioned. The production phone will be supplied for live testing if required.
```

**Screencast annotation notes:**

```
(00:00) Reviewer sends inbound WhatsApp message to test number.
(00:05) Webhook arrives at /api/whatsapp-intake; engine runs; clarifying question sent via Cloud API messages endpoint.
(00:20) Reviewer replies with name + email; number acknowledges; brief appears in triage portal.
```

### 2.8 `whatsapp_business_management` (WhatsApp)

**Use case justification (paste-ready):**

```
CaseLoad Select uses whatsapp_business_management at onboarding to read the phone numbers registered to each firm's WhatsApp Business Account and to confirm that the phone number the operator is connecting belongs to a WABA the firm controls. Without this read, the operator cannot verify which phone number to wire to the firm's tenant, and a typo on the connection wizard could route inbound conversations to the wrong firm.

The permission is read-only at runtime. The platform does not modify WABA-level metadata, does not change templates, does not adjust display names, does not provision or release phone numbers. Setup is the single use; once the firm's phone_number_id is saved on the intake_firms row, the permission is not invoked again for that firm.
```

**Reviewer test instructions (paste-ready):**

```
Same operator-driven setup flow as Section 2.2, with the WhatsApp-specific step:

1. The wizard prompts the operator for the firm's WABA ID and the phone-number ID the firm wishes to connect.
2. The wizard reads the phone numbers registered to that WABA via /<WABA_ID>/phone_numbers (read-only).
3. The wizard displays the readable phone numbers; the operator selects the one the firm wants to connect.
4. The wizard writes whatsapp_phone_number_id to the firm's intake_firms row. No WABA-level write happens.
```

**Screencast annotation notes:**

```
(00:00) Wizard fires WABA phone-number list query.
(00:03) Phone numbers returned; operator selects the firm's chosen number.
(00:06) whatsapp_phone_number_id saved on the firm record.
```

---

## 3. Reviewer credentials

The reviewer needs to message three test assets. The lawyer triage portal is operator-only and not part of the reviewer's path; the end-to-end flow can be observed entirely on the channel surface (the reviewer sees the platform reply on Messenger, IG, or WhatsApp).

| Surface | Credential to supply in the App Review form |
|---|---|
| Facebook Page (Messenger test) | Page handle: `DRG Law Test` (or whichever name was used at Page-create time). The reviewer messages this Page from any personal Facebook account. |
| Instagram Business account (DM test) | Username: `@drg_law_test`. The reviewer DMs from any personal IG account. |
| WhatsApp test number | `+1 555 629 8048` (Meta-provisioned test number on the test WABA). Note: development-mode WABA, recipient allowlist required. The reviewer phone must be allowlisted; coordinate via `hello@caseloadselect.ca` before testing. |
| Lawyer triage portal | Not required for App Review. The portal is operator-only and not user-data-bearing from Meta's perspective; the brief is the downstream artifact of the channel exchange, observable inside our internal system. |
| Operator login (for portal verification, if reviewer requests one) | Magic-link auth at `https://app.caseloadselect.ca/login`. If the reviewer wishes to see the brief side of the flow, request a one-time link be sent to a reviewer-supplied email; the operator will issue it. |

**WhatsApp allowlist note:** Before submission, Adriano must add Meta's app-review test phones to the test WABA recipient allowlist. The list is at WhatsApp Manager → Phone numbers → Settings → Allowed recipient list. Meta does not pre-publish the reviewer phones; they appear in the App Review form's "Required Items" panel when the WhatsApp use case is opened for submission. Add them, save, then submit.

---

## 4. Privacy policy compliance review

This section walks Meta's Platform Terms data-handling expectations against the live Privacy Policy at `https://app.caseloadselect.ca/privacy`. The policy's substantive content covers PIPEDA-grade obligations; the gaps below are about clarity for a Meta reviewer who is checking that the policy describes the Meta-specific data flow accurately.

### 4.1 Data collected

| Meta expectation | Policy coverage | Status |
|---|---|---|
| What user data is collected via Meta APIs | "What we collect" section lists contact details, matter description, technical metadata. | OK |
| Channel-specific data fields | "Channels we receive intake on" table lists each channel and what it captures. | GAP: see Section 4.5 |
| Sensitive data collection statement | Policy explicitly excludes bank-account, credit-card, government-issued ID, biometric data. | OK |

### 4.2 Retention

| Meta expectation | Policy coverage | Status |
|---|---|---|
| Retention period stated | Band-based table A/B 1095d, C 365d, D 180d, E 30d, unrated 90d. Tied to `lib/data-retention.ts`. | OK |
| Deletion versus anonymization | Policy states the engine anonymizes rather than deletes; data-deletion page repeats this. | OK: disclosure is sufficient |

### 4.3 Right to deletion

| Meta expectation | Policy coverage | Status |
|---|---|---|
| How users can request deletion | `/data-deletion` page provides email-based procedure to `privacy@caseloadselect.ca` with 5-day acknowledgment and 30-day completion. | OK |
| Distinct URL for Meta validator | `/data-deletion` is the URL configured in the App's User Data Deletion field. | OK once the validator bug is resolved (see Section 1.6) |

### 4.4 Third parties listed

| Third party | Listed in policy? | Status |
|---|---|---|
| Supabase (database) | Yes | OK |
| Vercel (hosting) | Yes | OK |
| Resend (email) | Yes | OK |
| Google LLC (Gemini 2.5 Flash) | Yes | OK |
| OpenAI (legacy widget) | Yes | OK |
| GoHighLevel (SMS, voice, GBP) | Yes | OK |
| Meta Platforms, Inc. | Yes, but framed as "intake that arrives via Instagram DM or Facebook Messenger" | GAP: does not list WhatsApp Cloud API as a Meta-processed channel; see 4.5 |

### 4.5 Gaps requiring remediation BEFORE submission

The Privacy Policy currently describes the Meta channels as "routed through GoHighLevel". The implementation as of 2026-05-15 routes the three Meta channels (Facebook Messenger, Instagram DM, WhatsApp Cloud API) directly to our `/api/{channel}-intake` webhooks; GoHighLevel does not mediate any of the three. The discrepancy will be visible to a Meta reviewer who reads the policy alongside the App Review form, and is grounds for rejection.

**Remediation 1: fix the "Channels we receive intake on" table.** Replace the WhatsApp, Facebook Messenger, and Instagram DM rows with the text below.

```
| Channel               | How intake is initiated                                                                          | Data captured                                              |
| WhatsApp              | Text conversation via the firm's WhatsApp Business Account on Meta's Cloud API                   | Message text, sender phone number, WhatsApp profile name   |
| Facebook Messenger    | Direct message on the firm's Facebook Page; received via the Meta Messenger webhook              | Message text, sender Page-Scoped ID                        |
| Instagram DM          | Direct message on the firm's Instagram Business account; received via the Meta Instagram webhook | Message text, sender Instagram-Scoped ID                   |
```

The platform does not currently capture the sender's Facebook profile name for Messenger inbound (`senderName: null` per `channel-intake-processor.ts:185`) and does not capture the Instagram handle as a stored field; reflect that change in the "Data captured" column above.

**Remediation 2: fix the "Who sees it" section.** The line that reads:

> "The firm's CRM and communication service provider (GoHighLevel) and transactional email provider (Resend), which deliver the firm's automated replies. GoHighLevel also handles WhatsApp, SMS, Voice, Instagram DM, Facebook Messenger, and Google Business Profile chat channels on the firm's behalf."

should be replaced with:

```
The firm's CRM and communication service provider (GoHighLevel) and transactional email provider (Resend), which deliver the firm's automated replies. GoHighLevel handles SMS, voice, and Google Business Profile chat channels on the firm's behalf. WhatsApp, Facebook Messenger, and Instagram DM intakes are received directly by CaseLoad Select from Meta's APIs; the platform does not route those channels through GoHighLevel.
```

**Remediation 3: call out the Meta channels explicitly in the data-processor list.** The current Meta Platforms entry conflates Messenger and Instagram; expand it:

```
Meta Platforms, Inc., for intake that arrives via Facebook Messenger, Instagram Direct, or WhatsApp Cloud API. Meta processes the conversation before it reaches our systems and stores its own copy under Meta's own retention rules. Our policy applies from the point of receipt into the CaseLoad Select webhook. We use Meta's Page Send API and Cloud API messages endpoint to reply within the standard 24-hour customer-service window only.
```

**Remediation 4: refresh the "Last updated" date.** Change `2026-05-13` to the date the above remediations are deployed.

These four changes can be made in one edit pass to `src/app/privacy/page.tsx`, deployed via Vercel, and verified live at `https://app.caseloadselect.ca/privacy` before the App Review form is submitted.

---

## 5. Terms of Service compliance review

The live Terms at `https://app.caseloadselect.ca/terms` are calibrated for LSO Rule 4.2-1 and substantively cover the right ground. Meta's reviewer cares less about regulatory calibration and more about whether the Terms describe how Meta data is treated and what users agree to when they message a Page or IG account that runs on CaseLoad Select. Two gaps and one optional addition.

### 5.1 Sub-processor disclosure

The current "Service availability" section names "Supabase, Vercel, Resend, OpenAI, GoHighLevel". Meta and Google are missing. Replace with:

```
CaseLoad Select runs on third-party infrastructure: Supabase (database), Vercel (application hosting), Resend (transactional email), Google LLC (Gemini 2.5 Flash for AI screening), OpenAI (legacy widget screening), GoHighLevel (CRM, SMS, voice, Google Business Profile chat), and Meta Platforms (Facebook Messenger, Instagram Direct, and WhatsApp Cloud API). The service inherits the availability of these providers. We do not promise specific uptime numbers and do not warrant that the service will be free of interruption or error. Maintenance windows and provider incidents may briefly affect intake form availability.
```

### 5.2 Meta-channel acceptable-use clause (new section)

Meta reviewers look for a statement that the platform is being used for legitimate person-to-business messaging and not for automated outbound, harvesting, or solicitation. Add a new section titled "Use of Meta channels" between "Your obligations" and "Lawyer and operator portal":

```
## Use of Meta channels

When you message a firm through Facebook Messenger, Instagram Direct, or WhatsApp using a number the firm has connected to CaseLoad Select, you initiate a conversation on a Meta surface. CaseLoad Select does not send unsolicited messages on Meta channels; the platform replies only inside the standard 24-hour customer-service window opened by your inbound message. Messages sent through Meta channels are received via Meta's webhooks under the firm's authorisation; data captured is described in the Privacy Policy and is governed by both Meta's own platform terms and our policy.

The platform does not use Meta channels to send promotional content, distribute bulk messages, or aggregate user data across firms. If you wish to stop receiving messages from a firm on a Meta channel, reply STOP, block the firm's account on the relevant Meta product, or contact privacy@caseloadselect.ca to request removal of your record from CaseLoad Select per the Data Deletion process.
```

### 5.3 Limitation of liability: Meta-as-infrastructure (optional but recommended)

The current limitation-of-liability clause covers indirect/incidental/consequential damages. Add a sentence acknowledging Meta's role as an upstream platform, so a Meta reviewer sees the platform is not over-promising on behalf of Meta:

```
Where Meta Platforms, Inc. provides the messaging infrastructure (Facebook Messenger, Instagram Direct, WhatsApp Cloud API), Meta's own terms govern the conversation surface and its availability. CaseLoad Select is not liable for outages, rate-limits, account-level restrictions, or message-delivery failures imposed by Meta on its platforms.
```

### 5.4 Termination (already covered; flag for awareness)

The current Terms cover lawyer/operator account termination indirectly through the "Lawyer and operator portal" section. If a Meta reviewer probes for offboarding behaviour, the operator should be ready to point to:

- Page-subscription removal via `pages_manage_metadata` at offboarding (the firm's Page returns to direct firm control)
- IG Business Account disconnect at offboarding
- WhatsApp `phone_number_id` clearing on intake_firms at offboarding

These three are operational steps in the offboarding runbook; not strictly Terms-of-Service content, but worth keeping consistent if the reviewer asks.

### 5.5 Last-updated date

Bump from `2026-05-06` to the date the Section 5.1 / 5.2 / 5.3 changes are deployed.

---

## 6. Data Deletion flow validation

### 6.1 The flow as it stands

| Step | Implementation | Source |
|---|---|---|
| Public-facing instructions | `/data-deletion` page describes the email-based request flow | `src/app/data-deletion/page.tsx` |
| Acknowledgment timeline | 5 business days for acknowledgment, 30 days for completion (matches PIPEDA standard) | `/data-deletion` |
| Internal deletion mechanism | `purgeLeadPii(id)` in `lib/data-retention.ts`, exposed via `POST /api/admin/leads/[id]/purge` (operator-only, CRON_SECRET bearer) | `src/app/api/admin/leads/[id]/purge/route.ts` |
| What "deletion" actually does | Anonymisation, not row deletion: `name` becomes `[anonymized]`, `email`, `phone`, `description`, `city`, `location` set to null; `brief_html`, `brief_json`, `slot_answers` replaced with sentinel placeholders; `raw_transcript` cleared to null | `lib/data-retention.ts:32-54` |
| Meta-channel records | Same anonymisation path applies to Meta-channel rows (they share the `screened_leads` table); Meta's own copy of the conversation remains on Meta's servers per Meta's policy | `/data-deletion` "Messages received through Meta channels" section |

### 6.2 Meta's expectations

Meta accepts an instructions-URL approach (a static page that tells users how to request deletion) as an alternative to the Data Deletion Callback URL (an automated endpoint that handles a `signed_request` from Meta when a user removes the app). The instructions-URL approach is what's wired today.

| Expectation | Coverage | Status |
|---|---|---|
| Page reachable at the configured URL | `/data-deletion` returns HTTP 200 at `https://app.caseloadselect.ca/data-deletion` | OK |
| Explicit deletion process | Page describes the email procedure step-by-step | OK |
| Realistic timeline | 5 days acknowledgment, 30 days completion | OK |
| Distinct from privacy policy | Has its own URL even though substance overlaps | OK |
| Disclosure that anonymisation is the mechanism | Yes, in the "What happens after we receive your request" section | OK |

### 6.3 Operational verification (must do before submission)

[VERIFY WITH ADRIANO: three checks to run end-to-end at least once before submitting the form, so the deletion claim is supported by a recent successful exercise]:

1. Submit a test record via the production widget (or a Meta channel test asset). Note the `lead_id`.
2. Send a manual deletion request from a test email to `privacy@caseloadselect.ca` referencing that lead.
3. Acknowledge from the operator side. Execute `POST /api/admin/leads/[id]/purge` against the `lead_id` with the `CRON_SECRET` bearer token. Confirm 200 + `ok: true` response.
4. Verify in Supabase that the row in `screened_leads` (or `leads`, depending on which table holds the test record) shows `[anonymized]` in `contact_name` and nulls in the contact fields.
5. Save the timestamped verification (timestamp + lead_id + before/after row state) as `docs/app-review/deletion-flow-verification.md` so the operator can reference it if the reviewer follows up.

### 6.4 Meta's User Data Deletion Callback URL (current status)

The Meta dashboard field name is "User Data Deletion Callback URL", which can accept either a callback endpoint (programmatic) or an instructions URL (static page). We use the instructions URL: `https://app.caseloadselect.ca/data-deletion`.

[VERIFY WITH ADRIANO: Block 2 runbook (line 232) flagged a stale validator error from 2026-05-13 that may still affect today's save. Try a fresh hard reload of the dashboard; if it still rejects, file a Meta developer-support ticket attaching `curl -sI https://app.caseloadselect.ca/data-deletion` output. The field is mandatory at App Review submission time and the form cannot submit if the URL slot is blank or showing an error.]

---

## 7. Submission checklist

Tick each box in order before clicking Submit.

### Pre-submission content

- [ ] App icon uploaded (`public/brand/logos/icon-dark-bg-1024.png`, 1024×1024 PNG)
- [ ] App description pasted (Section 1.2)
- [ ] Category and sub-category selected (Section 1.1)
- [ ] Platform set to Website only (Section 1.4)
- [ ] App Domain set to `caseloadselect.ca`
- [ ] Site URL set to `https://app.caseloadselect.ca`

### Compliance pages

- [ ] Privacy Policy URL saved: `https://app.caseloadselect.ca/privacy`
- [ ] Terms of Service URL saved: `https://app.caseloadselect.ca/terms`
- [ ] User Data Deletion URL saved: `https://app.caseloadselect.ca/data-deletion`
- [ ] Privacy Policy gaps remediated and deployed (Section 4.5, four changes)
- [ ] Terms of Service gaps remediated and deployed (Section 5.1 + 5.2 + 5.3)
- [ ] Both pages verified live at the saved URLs after deployment

### Business verification

- [ ] Business verification status confirmed (Section 1.5): if not yet verified, the operator should expect a 1-3 day verification pass before the App Review can clear

### Meta-channel assets

- [ ] DRG Law Test Page exists and is connected to the App
- [ ] @drg_law_test IG Business account exists and is connected to the App via the linked Page
- [ ] Test WhatsApp number +1 555 629 8048 provisioned on the test WABA
- [ ] Meta reviewer phone(s) added to the test WABA recipient allowlist (check the App Review form's "Required Items" panel for the phones to add)

### Per-permission paste-ready content (Section 2)

- [ ] `pages_messaging` justification + reviewer instructions + screencast notes pasted
- [ ] `pages_show_list` justification + reviewer instructions + screencast notes pasted
- [ ] `pages_manage_metadata` justification + reviewer instructions + screencast notes pasted
- [ ] `business_management` justification + reviewer instructions + screencast notes pasted
- [ ] `instagram_business_basic` (or `instagram_basic`) justification + reviewer instructions + screencast notes pasted
- [ ] `instagram_business_manage_messages` (or `instagram_manage_messages`) justification + reviewer instructions + screencast notes pasted
- [ ] `whatsapp_business_messaging` justification + reviewer instructions + screencast notes pasted
- [ ] `whatsapp_business_management` justification + reviewer instructions + screencast notes pasted

### Screencasts

- [ ] `caseload-select-messenger-demo.mp4` saved to `docs/app-review/screencasts/`
- [ ] `caseload-select-instagram-demo.mp4` saved to `docs/app-review/screencasts/`
- [ ] `caseload-select-whatsapp-demo.mp4` saved to `docs/app-review/screencasts/`
- [ ] All three uploaded to the relevant use-case slots in the App Review form
- [ ] Captions match the screencast annotation notes in Section 2

### Data deletion verification

- [ ] End-to-end deletion exercise run at least once (Section 6.3)
- [ ] Verification record saved to `docs/app-review/deletion-flow-verification.md`

### Final pre-submit sanity

- [ ] Open `https://app.caseloadselect.ca/privacy` in an incognito tab: confirm latest copy is live
- [ ] Open `https://app.caseloadselect.ca/terms` in an incognito tab: confirm latest copy is live
- [ ] Open `https://app.caseloadselect.ca/data-deletion` in an incognito tab: confirm HTTP 200
- [ ] Re-read every paste-ready block in Section 2 once, checking for any field that needs a project-specific value to be filled in (test asset names, phone numbers) before submit
- [ ] Click Submit on the App Review form

Expected reviewer turnaround: 3 to 7 business days. First-time submitters often see longer windows. If the reviewer requests additional information, respond inside the App Review form's message thread (not via email), and quote the relevant Section number from this document so context is preserved.

---

## Appendix: discrepancies surfaced during this audit

These are not blockers for submission; they are flags for follow-up cleanup work.

1. **Privacy Policy's "Channels" table is out of date.** The table claims WhatsApp, Facebook Messenger, and Instagram DM are "routed through GoHighLevel". The code routes all three directly to our own `/api/{channel}-intake` webhooks (see `src/app/api/messenger-intake/route.ts`, `instagram-intake/route.ts`, `whatsapp-intake/route.ts`). Remediation laid out in Section 4.5.

2. **Privacy Policy claims Facebook profile name is captured for Messenger.** The code sets `senderName: null` for Messenger inbound (`channel-intake-processor.ts:185` invocation site in `messenger-intake/route.ts:188`). The Messenger Send API does not return the sender's profile name on the webhook payload; a separate Graph call against the Page token would be required to fetch it. The current code does not make that call. Remediation in Section 4.5.

3. **App-level CLAUDE.md "Channels (seven canonical)" table lists `channel='facebook_messenger'` but the code persists `channel='facebook'`** for Messenger leads (see `channel-intake-processor.ts:50`). Cosmetic mismatch; the Privacy Policy edit in Section 4.5 should use the user-facing label "Facebook Messenger" regardless.

4. **Block 2 runbook (line 240-253) lists the legacy Instagram scope names** (`instagram_basic`, `instagram_manage_messages`). Meta's current names are likely `instagram_business_basic` and `instagram_business_manage_messages`, depending on which login flow the app's use case was set to. Reconcile against the App Review dashboard's actual labels at paste time.

5. **The Block 1 leftover validator bug on `/data-deletion`** (runbook line 232) was last seen on 2026-05-13. Re-test today before pasting the URL into the App Review form; if it still rejects, file a Meta developer-support ticket attaching a `curl -sI` showing the page returns HTTP 200.
