# Provider support request drafts

**UNSENT. Do not paste, upload, or send any draft without Adriano's action-time approval naming the provider, destination, and final text.**

These drafts request account-specific retention and deletion evidence. They do not authorize a provider to restore, delete, change, or disclose unrelated records. Replace bracketed placeholders only from the authenticated account immediately before approved transmission.

## Meta

**Destination:** Meta developer or privacy support for App ID `1007304805285554`, Business ID `2191422434947205`

**Subject:** Account-specific Messenger and Instagram data deletion evidence for App Review

**Draft:**

> We are preparing a privacy verification record for CaseLoad Select App ID 1007304805285554. The app processes user-initiated Facebook Messenger and Instagram messaging for a law-firm workspace.
>
> Please confirm the account-specific process available to remove or irreversibly de-identify message content, Meta message IDs, and Page-scoped or Instagram-scoped sender IDs handled through these messaging APIs after a verified deletion request. Please also confirm any retention period, backup-expiry period, or technical exception that applies after the available deletion step is completed.
>
> What request-specific evidence can Meta provide that the deletion or expiry obligation was accepted and completed? If Meta does not provide an app-level deletion operation for these records, please state the applicable provider-managed retention rule and the evidence we should retain.
>
> This is an evidence request only. Do not change the app, permissions, business assets, or messaging data in response without separate written authorization.

## Resend

**Destination:** Resend privacy or support for account `[confirm authenticated account identifier]`

**Subject:** Account-specific email and log deletion process and retention evidence

**Draft:**

> We are documenting the verified-deletion workflow for the CaseLoad Select production service on Resend account [confirmed account identifier].
>
> Please confirm the retention period that currently applies to message content, recipient identifiers, delivery logs, request metadata, and backups for this account. Please distinguish active operational data from backup copies.
>
> Please provide the exact account-specific procedure for requesting earlier deletion of one message or recipient's records, the selectors you require, and the completion evidence Resend supplies. Please also confirm whether deletion requests are replayed after a backup restore or whether expiry alone governs backup copies.
>
> This is an evidence request only. Do not delete messages, recipients, domains, API keys, or account data without separate written authorization.

## HighLevel

**Destination:** HighLevel privacy or support for DRG Law Professional Corporation, Location ID `KwpSaMUehIN25dMG4WZB`, Company ID `MfAMsSxFSKuPlSvURjk6`

**Subject:** Read-only identity confirmation for one legacy lead reference in completed delete jobs

**Draft:**

> We are reconciling one non-personal legacy lead reference, L-2026-05-14-5EQ, for the DRG Law Professional Corporation sub-account, Location ID KwpSaMUehIN25dMG4WZB.
>
> Authenticated current-contact, conversation, and opportunity searches return no match. Contacts > Bulk Actions shows completed Delete jobs dated August 20 and August 10, 2026. Each exposes View details and Restore, but the August 20 details show only the action ID, action type, and label, not the deleted-contact identities.
>
> Without restoring either job, can HighLevel confirm whether this exact lead reference is present in either recoverable delete job? If it is, please provide the matching HighLevel contact ID, deletion date, delete-job identifier, current recoverability state, and scheduled permanent-removal date. If it is not, please state the search scope used and whether any other account recovery surface can retain the record.
>
> This is a read-only evidence request. Do not restore or delete any contact, job, conversation, opportunity, or related record without separate written authorization.

## Supabase

**Destination:** Supabase support for production project `ssxryjxifwiivghglqer`

**Subject:** Free-plan backup state and deletion replay evidence

**Draft:**

> We are documenting backup treatment for CaseLoad Select production project ssxryjxifwiivghglqer. The authenticated account identifies the organization as Free. The project backup API/CLI reports walg_enabled=true, pitr_enabled=false, backups=[], and physical_backup_data={}. No account-visible restore point or expiry schedule is available.
>
> Please confirm whether Supabase retains any provider-restorable database snapshot, disaster-recovery copy, or other backup for this project that is not shown by that response. If so, please state its maximum retention period, restore availability, and process for ensuring a verified deletion request remains effective after restoration. Please distinguish database backups from Storage objects.
>
> A fictional local rehearsal proved that a pre-deletion database restore loses an in-database deletion tombstone unless the request is supplied from an external durable registry. Does Supabase offer an account feature or documented control that supports such external replay before a restored project returns to operational use?
>
> This is an evidence request only. Do not create a backup, restore the project, change the plan, or modify project data or settings without separate written authorization.

## Approval and evidence checklist

Before sending any draft:

- [ ] Adriano approves the named provider, authenticated destination, and exact final text at action time.
- [ ] Bracketed placeholders are replaced with verified account values.
- [ ] No secrets, tokens, personal data, real-client facts, or unrelated provider records are included.
- [ ] The request states that no provider mutation is authorized.
- [ ] The sent message, timestamp, provider case ID, response, and attachments are preserved in the privacy release record.
- [ ] A provider response is evaluated as evidence, not treated automatically as proof that a deletion occurred.
