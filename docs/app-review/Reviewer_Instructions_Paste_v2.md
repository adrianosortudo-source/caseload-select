# Reviewer instructions, v2, paste-ready

Use this version only after the production rehearsal passes, both v2 clips pass `screencasts/SHOTLIST_v2.md`, and the pre-submission blocker below is cleared. Confirm the live Instagram permission label before pasting.

> PRE-SUBMISSION BLOCKER: Controlled, irreversible redaction, strict external-cleanup semantics, the external encrypted registry, historical backfill, controlled replay, bounded current-registry audit, and activation/open postflight are deployed and verified. At production merge `fbb6aac6712b28191de5aee79d0d4511aaaf4b59`, CaseLoad Select's tested operational copies remain redacted and `provider_managed` cannot mark cleanup complete. PR #219 also passed a fictional transactional logical-restore simulation; it is not a managed backup/PITR or provider-expiry rehearsal. Adriano approved the public copy and accepted the documented privacy risks as owner while waiving external counsel review. PR #223 merged that copy, and the canonical public pages passed signed-out verification. This paste block remains unauthorized until the live Meta Data Handling and permission draft values match the owner decision, the upload checks pass, and Adriano gives explicit action-time approval. Responses from Resend, HighLevel, or Supabase are separate follow-up work and are not required for this Meta submission. Final Meta submission may not proceed yet.

Release basis: production merge `fbb6aac6712b28191de5aee79d0d4511aaaf4b59` is deployed; migrations through `20260904125000_privacy_recovery_open_from_locked` are applied. Strict completion, tested Meta-derived CaseLoad Select operational-copy redaction, encrypted-registry backfill/replay, bounded current-registry audit, activation/open postflight, and the PR #219 fictional restore simulation passed within their recorded evidence boundaries.

Paste only the text between the fences:

```
CaseLoad Select is a multi-tenant case-acquisition system for Canadian law firms. The two business capabilities under review are pages_messaging and instagram_manage_messages, or the exact equivalent Instagram messaging label shown for this app. Meta's current Permissions Reference lists instagram_basic, pages_read_engagement, and pages_show_list as dependencies of legacy instagram_manage_messages, and pages_manage_metadata plus pages_show_list as dependencies of pages_messaging. The four unique dependency permissions are therefore also included in the draft. They are requested only to support the two messaging capabilities, not as separate identity, engagement-reading, Page-listing, or Page-management product features. The approved WhatsApp permissions and public_profile are not being resubmitted. We are not requesting business_management.

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

MESSAGING SAFEGUARDS: Free-form replies require an authoritative inbound webhook timestamp and are blocked at or after 24 hours. Missing, malformed, or unreasonable future timestamps fail closed. The server rechecks the window immediately before the external send. Messenger and Instagram outbound echoes cannot reopen the window. Requests are firm-scoped, client sessions are excluded, support preview is read-only, and a stable UUID member identity is required. During normal operation, the server-side ledger is append-only and records inbound evidence and outbound claims, with at most one terminal result per request. A separate service-only deletion path can make one irreversible transition that removes message content and direct identifiers while preserving a limited redacted audit record. The public wording does not describe that record as legally de-identified or claim deletion from Meta-controlled copies. Delivery-unknown and request-in-progress outcomes remain non-terminal for reconciliation. The portal preserves the unchanged draft and idempotency key and warns the operator not to create a second message.

LIVE ACCESS: If live testing is required, coordinate through the App Review thread or adriano@caseloadselect.ca. Access and timing must be arranged with the operator. Do not enter real client information. Use fictional test facts only.

OPERATOR CONTACT: adriano@caseloadselect.ca. Privacy and data-deletion questions: privacy@caseloadselect.ca. Privacy policy: https://caseloadselect.ca/privacy. Terms: https://caseloadselect.ca/terms. Data-deletion instructions: https://caseloadselect.ca/data-deletion.

TEST DATA SCOPE: The review recordings use fictional data only. The May 2026 deletion exercise is historical and predates the channel conversation ledger. Current evidence consists of the September 2026 post-ledger production exercises, encrypted-registry backfill/replay, and PR #219's fictional real-Postgres transactional restore simulation. These checks did not send to, delete from, or mark cleanup complete at Meta.
```

Change only the Instagram permission label if the live form uses a different label. Keep the four unique dependency permissions aligned with Meta's current Permissions Reference and do not describe them as standalone product features. Do not add a login flow, segregated-tenant claim, deletion promise, or unrelated permission that the source does not support. Re-review this paste block after the public-copy, Data Handling, and live Meta gates close, then stop for Adriano's explicit action-time approval before submission.
