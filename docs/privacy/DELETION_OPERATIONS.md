# Personal-information deletion operations

Status: technical controls implemented; candidate public wording pending counsel and merge

Owner: CaseLoad Select operator

This procedure covers verified requests to remove personal information from CaseLoad Select operational systems. It does not authorize deletion of production data by itself. Production execution requires the approved operator path, a recorded request, and verification of the result.

## Release-candidate public commitment

This section defines the outcome supported by the shipped application-level controls. It is not evidence of deletion inside provider-controlled products or of managed-backup expiry.

After a verified request, CaseLoad Select irreversibly removes message content and direct identifiers from the operational copies it controls. The service may retain a limited audit record for system security, delivery-integrity checks, proof that deletion was completed, and aggregate reporting.

The audit envelope must not contain message content, names, email addresses, phone numbers, channel-scoped sender identifiers, external message identifiers, free-text failure details, transcripts, attachments, or another value that can reasonably reconnect the event to a person.

The candidate public copy applies a three-year retention period to each retained channel audit event, measured from its original event time. The deletion tombstone and anti-recontact suppression record are separate classes without that expiry in the present implementation. Privacy counsel must approve or revise the classification, periods, retained fields, and join controls before the candidate is merged.

## Record boundaries

| Record location | CaseLoad Select action | Owner or follow-up |
|---|---|---|
| Active lead and conversation records | Remove direct identifiers and message content through the approved service-only operation | CaseLoad Select operator |
| Message delivery ledger | Preserve only the non-identifying event envelope and an irreversible redaction marker | CaseLoad Select operator |
| Intake sessions, transcripts, attachments, and queued payloads | Remove or redact the subject content and identifiers | CaseLoad Select operator |
| Firm case-management, accounting, email, and document systems | Do not represent these copies as controlled by CaseLoad Select | Law firm |
| CaseLoad Select processors | Complete the available provider-specific deletion or escalation step and retain evidence; `provider_managed` alone is not deletion proof | CaseLoad Select operator and processor |
| Meta, Google, and other platform-controlled products | Direct the requester to the platform's controls; do not claim CaseLoad Select can erase these copies | Requester and platform |
| Encrypted backups | Application-level recovery retains encrypted deletion instructions and blocks normal use until replay is verified after a restore | Transactional logical-restore simulation passed; managed-backup/PITR expiry remains unproved |

## Operator workflow

1. Record the request time, contact route, claimed identity, firm, channel, approximate inquiry date, and any supplied lead identifier.
2. Acknowledge receipt without repeating sensitive matter details.
3. Verify the requester with the minimum information needed. Do not request identity documents unless the risk assessment requires them.
4. Locate candidate records by tenant and subject identifiers. Treat ambiguous or cross-firm matches as a stop condition.
5. Record any firm-controlled or external-platform copies that require separate instructions.
6. For a screened lead, execute the approved service-only database transition once. For a legacy lead, use the dedicated recovery-aware workflow. Do not update tables manually or bypass the ledger guard.
7. Verify every in-scope store listed in the implementation inventory. Search for the original name, contact details, sender ID, message ID, body, transcript fragments, attachment keys, and linked identifiers.
8. Confirm the retained audit envelope has no direct identifier or message content and cannot be joined back to the person through an active application path.
9. Record the completion time, affected stores, verification result, and non-personal deletion request reference.
10. Notify the requester of completion, any firm or platform records outside CaseLoad Select control, and any item retained because a documented obligation applies.

## Required controls

- The screened-lead database transition is service-only, tenant-scoped, atomic, and idempotent.
- The legacy lead workflow is exact-record scoped and recovery-aware. Its separate database and Storage steps must not be described as one atomic transaction.
- Public, anonymous, authenticated browser, lawyer, and client roles cannot invoke it directly.
- Normal ledger updates and deletes remain blocked.
- The redaction transition cannot be reversed through the application or database function.
- A scheduled service-only expiry must drain every eligible retained audit record within the approved maximum. It cannot delete an unredacted event.
- Pending outbound work cannot write personal information back after redaction starts.
- A completed request must be replayed after any restoration before the restored data becomes operational. The application-level control and transactional logical-restore simulation are implemented and recorded; this is not managed-backup/PITR expiry evidence.
- Logs and error messages generated by the operation do not repeat the deleted values.

## Verification evidence

A release candidate is not complete until a fresh fictional Messenger or Instagram conversation has been deleted through the same path intended for real requests. The evidence record must show:

- the seeded identifiers and content before deletion;
- the authorized operation and tenant scope;
- removal of direct identifiers and message content across every in-scope store;
- the non-identifying audit envelope and redaction marker that remain;
- idempotent replay;
- rejection for unauthorized roles;
- a cross-firm isolation check;
- rejection of ordinary ledger update and delete attempts;
- a pending-message race check; and
- the backup-restoration replay procedure and rehearsal evidence supporting it.

Use fictional data only. Do not place secrets, access tokens, real client details, or raw production query output in the evidence file.

## Release gates

The following decisions remain open for the privacy release and public deletion wording. Apply them to the Meta submission only where they directly affect the deployed handling of Meta-derived data:

- Privacy counsel approves the three-year provisional audit-envelope limit or supplies a replacement period.
- Privacy counsel confirms that the retained fields and available joins do not create a reasonable reidentification path.
- Engineering disconnects or otherwise proves safe every retained screened-lead key that can join to a firm-controlled matter or another identifying record.
- The operator confirms the actual backup-expiry schedules for every processor and documents how deletion requests are replayed after restoration.
- The operator confirms the deletion or escalation procedure for each downstream processor and records evidence beyond a `provider_managed` status. This is broader privacy-compliance follow-up; support responses from Resend, HighLevel, and Supabase do not block Meta App Review.
- Engineering inventories every in-scope attachment location and proves that the matched deletion workflow removes it or records a recoverable failure.
- Engineering applies the approved expiry boundary to every retained audit ledger in scope, including consent and attribution evidence where applicable.
- Engineering ships the database and application changes through an approved pull request and production migration.
- Engineering verifies that the scheduled expiry drains boundary and backlog cases within the approved maximum and records production invocation evidence.
- The post-ledger fictional deletion rehearsal passes in production and is recorded in `docs/app-review/deletion-flow-verification.md`.

For Meta submission, verify the deployed deletion/redaction path for the operational copies created from Messenger and Instagram intake, the public privacy and deletion URLs, and the Meta-specific reviewer evidence. A provider support response is optional and should be pursued only when a Meta-specific question cannot otherwise be resolved. The drafts in `PROVIDER_SUPPORT_REQUEST_DRAFTS.md` remain unsent follow-up material.

Until every Meta-relevant gate is complete, the Meta draft may be prepared but must not be submitted. Separate downstream-provider support work does not control that determination.
