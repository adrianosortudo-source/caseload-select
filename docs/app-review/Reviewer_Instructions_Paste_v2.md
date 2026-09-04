# Reviewer instructions, v2, paste-ready

Use this version only after the production rehearsal passes, both v2 clips pass `screencasts/SHOTLIST_v2.md`, and the pre-submission blocker below is cleared. Confirm the live Instagram permission label before pasting.

> PRE-SUBMISSION BLOCKER: Controlled, irreversible redaction, strict external-cleanup semantics, the external encrypted registry, historical backfill, and controlled replay are deployed. At production merge `6f6c59330d94d84b1fc3bc63fb76d8830d3c8644`, CaseLoad Select's tested operational copies remain redacted and `provider_managed` cannot mark cleanup complete. PR #219 also passed a fictional transactional logical-restore simulation; it is not a managed backup/PITR or provider-expiry rehearsal. This paste block remains unauthorized until the current-registry audit and production activation/open postflight pass, privacy counsel approves the retained envelope and retention boundary, the public privacy and data-deletion wording is reconciled with that decision, the live Meta draft and upload checks pass, and Adriano gives explicit action-time approval. Responses from Resend, HighLevel, or Supabase are separate follow-up work and are not required for this Meta submission. Final Meta submission may not proceed yet.

Release basis: production merge `6f6c59330d94d84b1fc3bc63fb76d8830d3c8644` is deployed; migrations through `20260903183915_privacy_deletion_registry_operational_completeness` are applied. Strict completion, tested Meta-derived CaseLoad Select operational-copy redaction, encrypted-registry backfill/replay, and the PR #219 fictional restore simulation passed within their recorded evidence boundaries.

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

MESSAGING SAFEGUARDS: Free-form replies require an authoritative inbound webhook timestamp and are blocked at or after 24 hours. Missing, malformed, or unreasonable future timestamps fail closed. The server rechecks the window immediately before the external send. Messenger and Instagram outbound echoes cannot reopen the window. Requests are firm-scoped, client sessions are excluded, support preview is read-only, and a stable UUID member identity is required. During normal operation, the server-side ledger is append-only and records inbound evidence and outbound claims, with at most one terminal result per request. A separate service-only deletion path can make one irreversible transition that removes message content and direct identifiers while preserving a minimal redacted audit envelope; whether its retained keys and available joins are non-identifying remains subject to privacy-counsel approval. Delivery-unknown and request-in-progress outcomes remain non-terminal for reconciliation. The portal preserves the unchanged draft and idempotency key and warns the operator not to create a second message.

LIVE ACCESS: If live testing is required, coordinate through the App Review thread or adriano@caseloadselect.ca. Access and timing must be arranged with the operator. Do not enter real client information. Use fictional test facts only.

OPERATOR CONTACT: adriano@caseloadselect.ca. Privacy and data-deletion questions: privacy@caseloadselect.ca. Privacy policy: https://app.caseloadselect.ca/privacy. Terms: https://app.caseloadselect.ca/terms. Data-deletion instructions: https://app.caseloadselect.ca/data-deletion.

TEST DATA SCOPE: The review recordings use fictional data only. The May 2026 deletion exercise is historical and predates the channel conversation ledger. Current evidence consists of the September 2026 post-ledger production exercises, encrypted-registry backfill/replay, and PR #219's fictional real-Postgres transactional restore simulation. These checks did not send to, delete from, or mark cleanup complete at Meta.
```

Change only the Instagram permission label if the live form uses a different label. Do not add a login flow, segregated-tenant claim, deletion promise, or permission that the source does not support. Re-review this paste block after the remaining current-registry audit/activation, counsel, public-copy, and live Meta gates close, then stop for Adriano's explicit action-time approval before submission.
