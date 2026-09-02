# Reviewer instructions, v2, paste-ready

Use this version only after Option B is merged, the migration is applied, production deployment is verified, and the v2 clips pass the checklist in `screencasts/SHOTLIST_v2.md`.

Paste the text between the fences into the submission's reviewer-instructions field.

```
CaseLoad Select is a multi-tenant case-acquisition system for Canadian law firms. This resubmission is limited to the two rejected messaging permissions that the application demonstrably exercises: pages_messaging and instagram_manage_messages (or the exact equivalent Instagram permission label shown for this app). The previously approved WhatsApp permissions and public_profile are not being resubmitted. We are not re-requesting pages_show_list, pages_manage_metadata, business_management, instagram_basic, or pages_read_engagement because the current application does not contain a runtime operation that requires them.

ARCHITECTURE DISCLOSURE (SERVER-TO-SERVER): CaseLoad Select does not implement Facebook Login and does not present a Meta login dialog. Inbound messages arrive at signed webhook endpoints. The server maps the Page or Instagram Business Account identifier to one configured law-firm tenant. Outbound replies are issued server-side through the Messenger or Instagram Send API using a Page access token stored against that tenant. The browser sends only the reply text and an idempotency UUID; channel, asset, recipient, firm ownership, actor identity, and the 24-hour reply-window evidence are resolved and checked server-side.

TEST TENANT AND ASSETS: Use only the segregated DRG Law test path shown in the attached recordings. The authoritative Meta identities are Facebook Page "DRG Law Test" and Instagram account "@drg_law_test". The CaseLoad Select portal also displays the configured numeric Meta asset ID. It does not claim that the tenant workspace name is an identity read from Meta.

FACEBOOK MESSENGER REVIEW PATH:
1. Open the attached Messenger v2 recording.
2. Confirm that Meta UI visibly identifies the selected Page as "DRG Law Test" before the send.
3. Confirm that the CaseLoad Select portal displays the corresponding Facebook Messenger conversation and a recent inbound message.
4. Watch the operator type a unique plain-text reply and click "Send reply" in the CaseLoad Select UI.
5. Confirm that the portal reports "Reply sent."
6. Without a cut, confirm that the identical message appears in the native Messenger thread from the DRG Law Test Page.

INSTAGRAM REVIEW PATH:
1. Open the attached Instagram v2 recording.
2. Confirm that Meta or Instagram UI visibly identifies the account as "@drg_law_test" before the send.
3. Confirm that the CaseLoad Select portal displays the corresponding Instagram conversation and a recent inbound message.
4. Watch the operator type a unique plain-text reply and click "Send reply" in the CaseLoad Select UI.
5. Confirm that the portal reports "Reply sent."
6. Without a cut, confirm that the identical message appears in the native Instagram DM thread from @drg_law_test.

MESSAGING SAFEGUARDS: Free-form replies require an authoritative inbound webhook timestamp and are blocked at or after 24 hours. Missing, malformed, or unreasonable future timestamps fail closed. The server rechecks the window immediately before the external send. Messenger and Instagram outbound echoes are excluded from intake and cannot reopen the window. Requests are firm-scoped, client sessions are excluded, support preview is read-only, and an attributable member ID is required. An append-only server-side ledger records inbound evidence, the outbound claim, and one terminal sent or failed result. If delivery cannot be verified, the UI preserves the same idempotency key and tells the operator to retry the unchanged draft rather than create a second message.

PORTAL ACCESS IF LIVE TESTING IS REQUIRED: The operator can issue a time-limited portal login for a reviewer-supplied email. Coordinate through the App Review thread or adriano@caseloadselect.ca. Do not use a production-law-firm tenant or real client conversation.

OPERATOR CONTACT: adriano@caseloadselect.ca. Privacy and data-deletion questions: privacy@caseloadselect.ca. Privacy policy: https://app.caseloadselect.ca/privacy. Terms: https://app.caseloadselect.ca/terms. Data-deletion instructions: https://app.caseloadselect.ca/data-deletion.

DELETION OF REVIEWER TEST DATA: After review, reviewer-generated test leads can be permanently anonymized on request. Email privacy@caseloadselect.ca with the lead ID or test date. The operator will run the deletion procedure within five business days. The exercised verification record is documented at docs/app-review/deletion-flow-verification.md.
```

Before pasting, compare the Instagram permission label against the live App Review form. Change only the permission label if Meta displays a different legacy/current name; do not change the described endpoint or claim a login flow that does not exist.
