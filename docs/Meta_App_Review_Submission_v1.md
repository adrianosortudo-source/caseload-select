# Meta App Review Submission — CaseLoad Select

**Version:** 1.0  
**Date:** 2026-05-13  
**App:** CaseLoad Select  
**Operator:** Adriano Domingues  
**Usage:** Copy each labelled section verbatim into the corresponding field in Meta's developer console. Replace all placeholder values in square brackets with actual test asset details before submission.

---

## 1. App Overview

### What CaseLoad Select Is

CaseLoad Select is a done-for-you case-acquisition and selection platform for Canadian law firms. The platform operates on behalf of sole practitioners and two-lawyer firms in Ontario, managing every inbound inquiry from first contact through qualification and delivery of a structured case brief to the lawyer. The problem it solves is filtration, not lead volume: a small Ontario law firm without dedicated intake staff cannot distinguish, at the door, between a $100,000 matter and a misdirected call. CaseLoad Select scores, qualifies, and routes inquiries automatically so the lawyer only reads briefs on cases worth evaluating.

CaseLoad Select is a managed service, not self-serve software. The operator, Adriano Domingues, configures and runs the system for a roster of Ontario client firms. When a prospective client reaches out to a law firm through any of the platform's seven intake channels, including Facebook Messenger, Instagram Direct, or WhatsApp, the CaseLoad Screen AI engine conducts a structured intake conversation, extracts case details, scores the matter on a 0-to-100 priority index, and delivers a consistent English-language brief to the lawyer's Triage Portal. The lawyer reads the brief, decides to take or pass the matter, and the platform sends the appropriate response to the prospective client.

The platform serves a regulated industry. Ontario law firms operate under Law Society of Ontario (LSO) Rule 4.2-1, which prohibits outcome promises, restricts advertising claims, and sets strict standards for how lawyers communicate with prospective clients. Every automated message, every piece of copy, and every system design decision in CaseLoad Select is built against those requirements. The platform also operates under Canada's PIPEDA privacy framework, with all lead data stored in Canadian-jurisdiction infrastructure, band-based retention schedules, and a documented right-to-deletion path for prospective clients. CASL (Canada's Anti-Spam Legislation) governs all outbound follow-up messaging.

---

## 2. Permissions

---

### 2.1 pages_messaging

#### What We Use This For

CaseLoad Select uses `pages_messaging` to receive and respond to messages sent to the Facebook Pages of connected Ontario law firms. When a prospective client sends a message to a firm's Page through Facebook Messenger, CaseLoad Select receives that inbound message via Meta's Webhooks for Business Messaging.

The platform then initiates the CaseLoad Screen intake conversation. The prospective client is invited to describe their legal matter in their own words, then guided through four to six follow-up questions that gather the information a lawyer needs to evaluate the inquiry: the nature of the matter, location, timeline, urgency, and contact details. The entire conversation runs on behalf of the law firm. The messaging reflects the firm's practice areas and geographic service area; there is no generic or off-brand copy. The first message in every conversation includes a plain-language disclosure that the prospective client is submitting information for a lawyer to review, not receiving legal advice.

When the intake conversation is complete, CaseLoad Select generates a structured case brief and delivers it to the lawyer's Triage Portal. The brief appears in a priority-sorted queue alongside a decision timer. The lawyer reviews the brief, clicks "Take" or "Pass," and the platform sends the appropriate response back to the prospective client through Messenger. The Facebook Messenger thread is used only for the initial intake phase; ongoing communication after a lawyer-client relationship is formed moves to the firm's standard legal practice channels.

#### Test Instructions

**Prerequisites:** Use the test Facebook account provided in the submission notes. Ensure you have been added as a tester on the app. The test law firm Page name and triage portal access link are provided separately.

1. Log into Facebook with the test account provided in the submission notes.
2. Navigate to the test law firm's Facebook Page: **[TEST PAGE NAME — from submission notes]**.
3. Click "Send Message."
4. Type: "Hi, I have a question about a legal matter I am dealing with."
5. Wait for the automated CaseLoad Screen response (typically within five seconds).
6. Continue the intake conversation, answering the follow-up questions as prompted by the system.
7. Complete the intake. You will receive a confirmation message stating that a lawyer will review the submission and reach out if the matter fits the firm's practice.
8. Open the test triage portal at **[TRIAGE PORTAL URL — from submission notes]** using the lawyer access link provided.
9. Confirm that a case brief appears in the triage queue, showing the information gathered in the Messenger conversation, a priority score (0-100), and a decision timer.
10. Click "Take" or "Pass" to confirm the action buttons are functional and that a corresponding reply is sent back to the Messenger thread.

#### Privacy Compliance

`pages_messaging` is used exclusively for inbound intake conversations that prospective clients initiate voluntarily by contacting a law firm's Page. CaseLoad Select does not send unsolicited outbound messages to Facebook users.

All message content is stored in Supabase, hosted in Canadian-jurisdiction infrastructure. Retention schedules follow PIPEDA requirements and are tied to the case priority band assigned to each lead. High-priority leads (bands A and B) are retained for up to 1,095 days; lower-priority leads are retained for progressively shorter periods, down to 30 days for the lowest band. Prospective clients may request deletion at any time through the operator.

The first message of every intake conversation discloses that the contact is submitting information for a lawyer's review and links to the privacy policy at https://app.caseloadselect.ca/privacy. The call-to-action presented to the prospective client is "Submit for review," which is an accurate description of the next step: a lawyer reviews the brief and decides whether to reach out. No legal advice is offered. LSO Rule 4.2-1 governs all copy: no outcome promises, no use of "specialist" or "expert," no unverifiable claims.

---

### 2.2 instagram_business_manage_messages

#### What We Use This For

`instagram_business_manage_messages` allows CaseLoad Select to read and respond to Direct Messages sent to the Instagram Business accounts of connected law firms. Instagram DM is an active first-contact channel for Toronto legal consumers, particularly prospective clients who discover a firm through organic content and prefer to reach out informally before committing to a phone call.

When a prospective client sends a DM to a firm's Instagram Business account, CaseLoad Select receives the message through Meta's Webhooks for Business Messaging. The CaseLoad Screen intake engine runs the same structured conversation as it does on other channels: the system greets the contact, collects details about the legal matter, scores the case, and delivers a brief to the lawyer's Triage Portal. The intake conversation is conducted entirely within the DM thread on behalf of the law firm.

The `instagram_business_manage_messages` permission scopes CaseLoad Select's access to the inbound message content and the ability to reply within the DM thread. The platform has no access to the firm's follower list, post content, story data, analytics, or any other Instagram data outside the direct messaging context. The permission is used only for intake triage.

#### Test Instructions

**Prerequisites:** Use the test reviewer Instagram account and the test law firm Instagram Business account provided in the submission notes. The triage portal access link is provided separately.

1. Log into Instagram with the test reviewer account provided in the submission notes.
2. Search for the test law firm Instagram Business account: **[TEST INSTAGRAM HANDLE — from submission notes]**.
3. Tap "Message" to open a Direct Message thread.
4. Type: "Hello, I am looking for a lawyer and wanted to ask about your services."
5. Wait for the automated CaseLoad Screen response (typically within five seconds).
6. Continue the intake conversation, answering the follow-up questions as prompted.
7. Complete the intake. You will receive a confirmation message.
8. Open the test triage portal at **[TRIAGE PORTAL URL — from submission notes]** using the lawyer access link provided.
9. Confirm that a case brief appears in the triage queue with the information gathered through Instagram DM, including a priority score and decision timer.
10. Click "Pass" and confirm that a respectful decline message is sent back to the Instagram DM thread.

#### Privacy Compliance

All Instagram DM content received by CaseLoad Select is stored in Canadian-jurisdiction infrastructure under PIPEDA. The same retention schedule and right-to-deletion framework that applies to other channels applies here.

The first message in every Instagram intake conversation includes a plain-language privacy disclosure linking to https://app.caseloadselect.ca/privacy. The conversation does not solicit sensitive personal information beyond what a prospective client volunteers to describe their legal situation. No legal advice is provided. LSO Rule 4.2-1 governs all message copy.

CaseLoad Select does not use Instagram DM data for any purpose other than intake triage. Message content is not used for advertising targeting, third-party data sharing, or any analytics beyond the case scoring that serves the law firm's intake process.

---

### 2.3 whatsapp_business_management

#### What We Use This For

`whatsapp_business_management` gives CaseLoad Select the ability to manage the WhatsApp Business accounts connected to client law firms. This covers reading the configuration of connected phone numbers, submitting message templates for Meta's review, and managing the overall setup of each firm's WhatsApp Business presence within Meta's platform.

This permission is used primarily during the onboarding of a new law firm client. When the operator connects a firm's WhatsApp Business number to CaseLoad Select, the platform uses this permission to verify the phone number, confirm its registration status, and configure the account to receive inbound messages. The permission is also required to register message templates with Meta, which governs what proactive outbound messages the platform may send. Because CaseLoad Select's WhatsApp channel is built around inbound intake, template use is limited: the platform relies on session messages (within the standard 24-hour window following user-initiated contact) for the intake conversation itself. Templates are registered only for specific follow-up scenarios where the window has closed and the firm has a documented legitimate reason to re-engage a prospective client who previously initiated contact.

The permission is exercised by the operator during onboarding and periodic maintenance, not by any automated intake process.

#### Test Instructions

**Prerequisites:** Access to the test Meta Business Manager account provided in the submission notes.

1. Log into the test Meta Business Manager account at business.facebook.com using the credentials provided.
2. Navigate to WhatsApp Manager in the left-hand menu.
3. Confirm that the test law firm's WhatsApp Business phone number appears as connected and active under "Phone Numbers."
4. Navigate to "Message Templates" and confirm that any registered templates are visible and display their current approval status.
5. To verify write access: open the "Create Template" flow and confirm the interface is accessible. No actual template submission is required; confirming that the create form loads demonstrates the permission scope.
6. Return to the WhatsApp Manager overview and confirm that phone number settings (display name, status, quality rating) are readable.

#### Privacy Compliance

`whatsapp_business_management` is used only for platform configuration. It does not involve reading or storing prospective client data. The permission is exercised by the operator, not by any automated system handling end-user messages.

Each law firm that connects their WhatsApp Business account to CaseLoad Select provides explicit written authorization for the operator to manage their WhatsApp Business configuration on their behalf. This authorization is documented in the service agreement between CaseLoad Select and each client firm.

---

### 2.4 whatsapp_business_messaging

#### What We Use This For

`whatsapp_business_messaging` allows CaseLoad Select to send and receive WhatsApp messages on behalf of connected law firms. WhatsApp is a primary contact channel for a substantial portion of Toronto's prospective legal clients, including many whose first language is not English. CaseLoad Select is designed to be language-agnostic at intake: the platform accepts inbound WhatsApp messages in any language and conducts the intake conversation in the language the prospective client initiates.

When a prospective client sends a WhatsApp message to the firm's business number, CaseLoad Select receives the message through Meta's Cloud API. The CaseLoad Screen engine conducts a structured intake conversation. The engine detects the language of the opening message automatically and continues the entire intake in that language. When the intake concludes, the engine generates a structured English-language case brief for the lawyer, regardless of the intake language. The prospective client's original-language messages are preserved separately as an audit record for LSO compliance and PIPEDA data-subject access purposes.

The lawyer reviews the English brief in the Triage Portal and makes a take-or-pass decision. The platform sends a confirmation or decline back to the prospective client through WhatsApp. If the lawyer takes the case, subsequent communication between the lawyer and client moves off the platform to standard legal channels. WhatsApp is used only for the initial intake triage phase; it is not used for ongoing case management after a lawyer-client relationship is established.

#### Test Instructions

**Prerequisites:** A WhatsApp-enabled mobile device with the test reviewer account. The test law firm's WhatsApp Business number and triage portal access link are provided in the submission notes.

1. Open WhatsApp on a mobile device.
2. Add the test law firm's business number to your contacts: **[TEST WHATSAPP NUMBER — from submission notes]**.
3. Send the message: "Hi, I am looking for a lawyer to help with a legal situation."
4. Wait for the automated CaseLoad Screen response (typically within five seconds).
5. Continue the intake conversation, answering the follow-up questions as prompted by the system.
6. Complete the intake. You will receive a confirmation message stating that a lawyer will review the submission.
7. Open the test triage portal at **[TRIAGE PORTAL URL — from submission notes]** using the lawyer access link provided.
8. Confirm that a case brief appears in the triage queue, with the information gathered from the WhatsApp conversation, a priority score, and a decision timer.
9. Click "Pass" in the triage portal and confirm that a decline message is sent back to the WhatsApp thread.
10. Optional — multilingual test: repeat steps 1 through 7 in French ("Bonjour, je cherche un avocat pour une situation juridique."). Confirm the intake conversation continues in French, and that the brief delivered to the triage portal is in English.

#### Privacy Compliance

`whatsapp_business_messaging` is used exclusively for inbound intake conversations that prospective clients initiate by contacting the law firm's WhatsApp number voluntarily. CaseLoad Select does not send unsolicited outbound WhatsApp messages to any contact.

The first message of every WhatsApp intake conversation includes a plain-language privacy notice and a link to the platform's privacy policy at https://app.caseloadselect.ca/privacy. All message content is stored in Supabase, hosted in Canadian-jurisdiction infrastructure under PIPEDA. Band-based retention schedules govern how long lead data is kept: bands A and B are retained for up to 1,095 days; lower-priority bands are retained for progressively shorter periods. Prospective clients may request immediate deletion of their data through the operator.

CASL governs outbound follow-up messaging. Implied consent under CASL applies for the six-month period following a user-initiated WhatsApp contact. CaseLoad Select tracks consent expiry and does not send messages beyond that window without refreshed consent.

LSO Rule 4.2-1 governs all message copy. The intake conversation makes no outcome promises, does not imply a lawyer-client relationship, and explicitly states that a lawyer will review the submission and decide whether to reach out.

---

### 2.5 business_management

#### What We Use This For

`business_management` gives CaseLoad Select the ability to read and manage the business assets connected to the platform through Meta Business Manager. The operator uses this permission to verify the configuration of connected law firm accounts, confirm that the correct Facebook Pages, Instagram Business accounts, and WhatsApp Business numbers are associated with each firm, and maintain the overall structure of the operator's Meta Business portfolio.

In the CaseLoad Select model, the operator manages a roster of Ontario law firms, each with its own Facebook Page and typically an Instagram Business and WhatsApp Business account. During onboarding, the operator uses this permission to confirm that each firm's Meta assets are properly linked, that the intake channels are ready to receive messages, and that the CaseLoad Select app has the correct access to each asset. Without this permission, the operator cannot verify multi-asset configurations or respond to changes a law firm makes to their own Meta presence, such as updating a Page name or connecting a new Instagram account.

`business_management` provides read and limited write access to the business structure. It does not grant access to end users' personal data, to the content of messages outside the `pages_messaging` and `instagram_business_manage_messages` permission scopes, or to any financial or ad account data.

#### Test Instructions

**Prerequisites:** Access to the test Meta Business Manager account provided in the submission notes.

1. Log into the test Meta Business Manager account at business.facebook.com using the credentials provided.
2. Navigate to Business Settings using the gear icon in the top navigation.
3. Under "Accounts," click "Pages" and confirm that the test law firm's Facebook Page appears as connected to the CaseLoad Select app.
4. Under "Accounts," click "Instagram Accounts" and confirm that the test Instagram Business account is connected.
5. Under "Accounts," click "WhatsApp Accounts" and confirm that the test WhatsApp Business number is listed.
6. Under "Apps," locate "CaseLoad Select" in the app list and confirm that the connected permissions are visible.
7. Navigate to "People" and confirm that the operator account (Adriano Domingues) has an admin role with appropriate access to the connected assets.
8. Navigate to "System Users" and confirm the system user assigned to CaseLoad Select API access is listed with the correct assets attached.

#### Privacy Compliance

`business_management` access is used only by the operator and the platform's configuration systems during onboarding and account maintenance. It does not involve access to prospective client personal data or message content.

Each law firm that connects their Meta business assets to CaseLoad Select does so through an explicit authorization process documented in the service agreement between CaseLoad Select and the firm. The operator does not access any business information beyond what is necessary to configure and maintain the intake channels.

All Meta API calls made under this permission are logged server-side and are available for audit by the operator. The platform does not store business configuration data beyond what is needed to maintain active channel connections.

---

## 3. Supporting References

**Privacy Policy:** https://app.caseloadselect.ca/privacy

**Terms of Service:** https://app.caseloadselect.ca/terms

**App Icon:** `/brand/logos/icon-light-bg.png` in the application's public folder. The file is a 1024x1024 PNG on a light background. It is the canonical CaseLoad Select icon for all platform-facing contexts, including Meta's app review submission form.

---

## 4. Submission Notes — Test Assets to Create Before Submitting

This section catalogs every placeholder in Section 2 and what must exist before App Review can submit. The seven placeholders all point to test assets — real Facebook Page, real Instagram Business account, real WhatsApp number, real Triage Portal access — that Meta reviewers will use to validate each permission end-to-end.

### Test firm setup (foundation for all three message permissions)

Create a dedicated test firm in CaseLoad Select isolated from real client traffic:

| Asset | What to create | Notes |
|---|---|---|
| Test firm row in `intake_firms` | New row, name "CaseLoad Select Test Firm" | Distinct from Hartwell (DRG-like demo) and any production client. Used only for Meta App Review. |
| Test firm GHL sub-account | New GHL sub-account "CaseLoad Select Test Firm" | Provides the GHL phone number used in the WhatsApp test, plus the messaging surface for review traffic. |
| Test Triage Portal access link | Magic-link login for the operator email | Generated via `/api/portal/request-link`. Send this link to Meta reviewers in the "submission notes" field on the developer console. |
| Triage portal URL | `https://app.caseloadselect.ca/portal/[testFirmId]/triage` | Used in test instructions for all three permissions. Replace `[testFirmId]` with the UUID of the new intake_firms row. |

### Placeholders by permission

#### 2.1 `pages_messaging` (Facebook Messenger)
- `[TEST PAGE NAME — from submission notes]` — Create a new Facebook Page named "CaseLoad Select Test Firm" or similar. The Page must be claimed in the CaseLoad Select Meta Business Manager and granted to the app via Settings → Pages.
- `[TRIAGE PORTAL URL — from submission notes]` — Triage portal URL pointing at the test firm.

#### 2.2 `instagram_business_manage_messages` (Instagram DM)
- `[TEST INSTAGRAM HANDLE — from submission notes]` — Create a new Instagram Business account (not personal). Connect it to the test Facebook Page from 2.1 via Meta Business Manager. Suggested handle: `@caseload_select_test`.
- `[TRIAGE PORTAL URL — from submission notes]` — Same triage portal URL as 2.1.

#### 2.4 `whatsapp_business_messaging` (WhatsApp Business)
- `[TEST WHATSAPP NUMBER — from submission notes]` — Provision a new GHL number on the test firm sub-account, register it as a WhatsApp Business number via the WABA setup flow. This number must be active and the WABA must be at least minimally configured (display name approved, at least one template approved) before Meta reviewers test.
- `[TRIAGE PORTAL URL — from submission notes]` — Same triage portal URL as 2.1.

#### 2.3 `whatsapp_business_management` and 2.5 `business_management`
No user-facing test assets required — these are admin-only permissions, demonstrated via screen recording of the operator-side Business Manager configuration, not via reviewer interaction.

### Test reviewer accounts

Meta reviewers use their own test Facebook accounts (provisioned by Meta) to interact with the app under review. We do NOT need to provide accounts; Meta reviewers will be added to the app as testers via the developer console once submission is opened. The reviewer accounts will be granted access to the test Page, test IG Business account, and test WhatsApp Business via the app's tester roster.

### Triage Portal access for reviewers

The Triage Portal is gated by magic-link auth. Meta reviewers will not be able to "click around" the portal without an active session. The operator must:

1. Send the test firm's magic link to Meta's review team via the submission notes field.
2. Confirm the link is fresh (under 48h old) when the submission opens — magic links expire.
3. If the review extends beyond 48h, regenerate the link via `/api/portal/request-link` and update the submission notes.

### Demo screencast outline (one per permission)

Each permission needs a screencast (typically 2-3 minutes) showing the test instructions in action. Suggested format:

1. Brief title card: "CaseLoad Select — [permission name] demo"
2. Show the inbound message being sent from the test reviewer account on the channel (Messenger, IG DM, or WhatsApp)
3. Show the CaseLoad Screen response within the channel thread
4. Show the intake conversation completing (3-5 message exchange)
5. Switch to the Triage Portal and show the resulting brief in the queue
6. Click Take or Pass and show the response landing back in the channel thread
7. Title card: "Configuration handled in Meta Business Manager — see Business Manager screencast"

The `whatsapp_business_management` and `business_management` permissions are demonstrated via a separate screencast showing the operator side of the Business Manager: navigating to the test firm's Business Manager, viewing the WABA, viewing the assigned roles, viewing the test Page and test IG account.

### Submission readiness gate

Do not submit App Review until every item in this section is complete:

- [ ] Test firm row exists in `intake_firms`
- [ ] Test firm GHL sub-account is configured
- [ ] Triage Portal magic link generated and tested
- [ ] Test Facebook Page exists and is claimed in the CaseLoad Select MBM
- [ ] Test Instagram Business account exists and is connected to the Page
- [ ] Test WhatsApp number is registered with the test WABA
- [ ] At least one WhatsApp template is approved (J1A acknowledgment is the obvious candidate)
- [ ] All five demo screencasts are recorded
- [ ] All seven placeholders in Section 2 are replaced with real values
- [ ] App icon (1024×1024 PNG) is uploaded to the Meta developer console
- [ ] Privacy and Terms URLs are reachable (verify with curl before submitting)
- [ ] Webhook URLs (`/api/messenger-intake`, `/api/instagram-intake`) are registered in the developer console and pass Meta's verification challenge

---

*End of submission package.*
