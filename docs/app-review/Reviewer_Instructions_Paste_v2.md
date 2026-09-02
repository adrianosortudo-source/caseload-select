# Reviewer instructions, v2, paste-ready

Use this version only after the production rehearsal passes and both v2 clips pass `screencasts/SHOTLIST_v2.md`. Confirm the live Instagram permission label before pasting.

Release basis: PRs #191, #193, and #195 are merged; production commit `fa3e092983b274c96fd1d22b8fa0091988baeb25` is READY; migrations `20260901231830`, `20260902102620`, and `20260902111504` are applied and verified.

Paste only the text between the fences:

```
CaseLoad Select is a multi-tenant case-acquisition system for Canadian law firms. This resubmission is limited to the two messaging permissions the application exercises: pages_messaging and instagram_manage_messages, or the exact equivalent Instagram messaging label shown for this app. The approved WhatsApp permissions and public_profile are not being resubmitted. We are not requesting pages_show_list, pages_manage_metadata, business_management, instagram_basic, or pages_read_engagement because the application does not contain a runtime operation that requires them.

ARCHITECTURE DISCLOSURE: CaseLoad Select is server-to-server. It does not implement Facebook Login or show a Meta login dialog. Signed webhook endpoints receive inbound messages. The server maps the Page or Instagram Business Account identifier to a configured firm workspace. It sends replies through the Messenger or Instagram Send API with a Page access token stored server-side. The browser submits only the reply text and an idempotency UUID. The server resolves and checks the channel, asset, recipient, firm ownership, actor identity, and 24-hour reply-window evidence.

TEST ASSETS AND WORKSPACE: The recordings use authorized test assets and a fresh fictional conversation in the DRG firm workspace. This is not a segregated test tenant. The authoritative identities are Facebook Page "DRG Law Test" and Instagram account "@drg_law_test". The portal shows "Firm workspace:" and "Configured Meta asset ID:" as configuration context. The numeric ID is not a Page-name or Instagram-handle read from Meta. Each recording shows the authoritative identity in Meta UI.

MESSENGER REVIEW PATH:
1. Open the attached Messenger v2 recording.
2. Confirm Meta UI identifies the selected Page as "DRG Law Test".
3. Confirm the portal shows "Message thread", "Channel: Facebook Messenger", and a recent inbound message.
4. Watch the operator type a unique plain-text reply and click "Send reply".
5. Confirm the portal reports "Reply sent."
6. Without a cut, confirm the identical message appears in the native Messenger thread from the DRG Law Test Page.

INSTAGRAM REVIEW PATH:
1. Open the attached Instagram v2 recording.
2. Confirm Meta or Instagram UI identifies the account as "@drg_law_test".
3. Confirm the portal shows "Message thread", "Channel: Instagram", and a recent inbound message.
4. Watch the operator type a unique plain-text reply and click "Send reply".
5. Confirm the portal reports "Reply sent."
6. Without a cut, confirm the identical message appears in the native Instagram DM from @drg_law_test.

MESSAGING SAFEGUARDS: Free-form replies require an authoritative inbound webhook timestamp and are blocked at or after 24 hours. Missing, malformed, or unreasonable future timestamps fail closed. The server rechecks the window immediately before the external send. Messenger and Instagram outbound echoes cannot reopen the window. Requests are firm-scoped, client sessions are excluded, support preview is read-only, and a stable UUID member identity is required. The append-only server-side ledger records inbound evidence and outbound claims, with at most one terminal result per request. Delivery-unknown and request-in-progress outcomes remain non-terminal for reconciliation. The portal preserves the unchanged draft and idempotency key and warns the operator not to create a second message.

LIVE ACCESS: If live testing is required, coordinate through the App Review thread or adriano@caseloadselect.ca. Access and timing must be arranged with the operator. Do not enter real client information. Use fictional test facts only.

OPERATOR CONTACT: adriano@caseloadselect.ca. Privacy and data-deletion questions: privacy@caseloadselect.ca. Privacy policy: https://app.caseloadselect.ca/privacy. Terms: https://app.caseloadselect.ca/terms. Data-deletion instructions: https://app.caseloadselect.ca/data-deletion.

TEST DATA SCOPE: The public deletion process applies to reviewer requests. The May 2026 exercised verification predates the channel conversation ledger. We do not claim that append-only channel ledger content is erased or anonymized by that prior procedure. The review recordings therefore use fictional data only.
```

Change only the Instagram permission label if the live form uses a different label. Do not add a login flow, segregated-tenant claim, deletion promise, or permission that the source does not support.
