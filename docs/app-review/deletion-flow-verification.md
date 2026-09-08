# Data deletion flow: verification record

> SCOPE NOTICE: This May 2026 exercise predates `channel_conversation_events`. It verifies the fields and tables named below only. It does not establish that append-only channel conversation ledger content is erased or anonymized, and it must not be used to make that claim in the v2 reviewer package.

> CURRENT RELEASE STATUS: The post-ledger fictional rehearsal and final rollback-only production verification passed the tested CaseLoad Select controls, strict completion semantics, and Meta-derived operational-copy checks. The encrypted-registry and restore/replay controls are complete within the documented application-level and transactional logical-restore boundaries. Adriano approved the public copy and accepted the documented privacy risks as owner while waiving external counsel review. PR #223 merged that copy, and the canonical public pages passed signed-out verification. The live Meta gates and action-time submission approval remain open, so this record does not authorize Meta submission.

This file records the timestamped, end-to-end deletion exercise run before App Review submission. Required by `Phase11_Submission_Package.md` Section 6.3 so the deletion claim on the App Review form rests on a real recent exercise.

Meta's reviewer can request a re-run; the operator can repeat the procedure live in a screen-share if needed.

---

## Verification run

**Date:** `2026-05-24T22:08:17Z`
**Operator:** Adriano Domingues
**Reason for run:** Pre-App-Review verification of the data-deletion procedure documented at `/data-deletion` and `/privacy`.

---

## Step 1 · Lead identified for deletion

**Channel:** `whatsapp`
**Test firm:** `DRG Law Professional Corporation` (firm_id `eec1d25e-a047-4827-8e4a-6eb96becca2b`)
**Lead UUID:** `a3aa297e-a07d-4f79-bd32-15edf92c232c`
**Lead text ID:** `L-2026-05-14-5EQ`
**Created at:** `2026-05-14 22:51:03 UTC`
**Brief snapshot (first 80 chars of `matter_snapshot`, before purge):** `Matter type not classified.`

---

## Step 2 · Deletion request received (simulated)

For the verification run, the deletion request was self-initiated by the operator standing in for a data subject who messaged the firm's WhatsApp test number during pre-App-Review smoke tests.

**Sender:** Operator-simulated
**Received at:** `2026-05-24T22:07Z` (within the same minute as the purge)
**Subject:** `Data deletion request: lead ID L-2026-05-14-5EQ`
**Body:** `Please delete the personal information associated with this lead.`

---

## Step 3 · Acknowledgment

Skipped for this verification run; in a real subject-initiated flow, the operator sends an acknowledgment from `privacy@caseloadselect.ca` within 5 business days per the public `/data-deletion` policy.

---

## Step 4 · Purge executed

**API call:**
```
POST https://app.caseloadselect.ca/api/admin/leads/L-2026-05-14-5EQ/purge
Authorization: Bearer $CRON_SECRET
```

**Note on the identifier:** the route's `purgeLeadPii` matches `screened_leads.lead_id` (text format `L-YYYY-MM-DD-XXX`), not the table's UUID `id`. The verification run first attempted with the UUID; the route returned `ok:true` but the row was unchanged (enumeration-defence no-op). Re-running with the text `lead_id` produced the expected anonymization.

**Response:**
```json
{
  "ok": true,
  "lead_id": "L-2026-05-14-5EQ",
  "purged_at": "2026-05-24T22:08:17.983Z",
  "note": "PII anonymized per PIPEDA s. 4.5.3. Scoring data retained for aggregate reporting."
}
```
HTTP 200.

**Completed at:** `2026-05-24T22:08:17Z`

---

## Step 5 · State verification

Query against `screened_leads` after the purge:

```sql
SELECT
  id, lead_id, contact_name, contact_email, contact_phone,
  raw_transcript IS NULL AS raw_cleared,
  brief_html LIKE '%anonymized%' AS html_anonymized,
  brief_json->>'anonymized' AS json_marker,
  slot_answers->>'anonymized' AS slot_marker,
  updated_at
FROM screened_leads
WHERE id = 'a3aa297e-a07d-4f79-bd32-15edf92c232c';
```

| Column | Value before | Value after |
|---|---|---|
| `contact_name` | `A D` | `[anonymized]` |
| `contact_email` | NULL | NULL |
| `contact_phone` | `+16475492106` | NULL |
| `raw_transcript` cleared | false | true |
| `brief_html` anonymized | (real content) | `<p>[anonymized]</p>` |
| `brief_json.anonymized` | (real report) | `true` |
| `slot_answers.anonymized` | (real slots) | `true` |
| `updated_at` | 2026-05-16 23:07:00 UTC | 2026-05-24 22:08:17 UTC |

All five anonymization targets cleared as the `SCREENED_PII_REPLACEMENT` payload in `lib/data-retention.ts` specifies. Band, score, and lifecycle metadata are intentionally preserved so aggregate reporting still reflects the historical lead.

---

## Step 6 · Completion notice

Skipped for this internal verification run. In a real subject-initiated flow, the operator emails the requester confirming the purge is complete and provides a 30-day complaint window to the Office of the Privacy Commissioner of Canada if dissatisfied.

---

## Historical sign-off

The flow produced the expected end state for the pre-ledger fields listed above. It does not verify current conversation-ledger redaction, secondary-store coverage, backup replay, or the current public commitment.

**Operator signature:** Adriano Domingues
**Date of sign-off:** `2026-05-24`

---

## Notes

- The implementation anonymises rather than deletes the row (per `lib/data-retention.ts` `purgeLeadPii`). Meta accepts this approach when the policy discloses it, which `/data-deletion` does.
- `brief_html` and `brief_json` are replaced with sentinel placeholders, not nulled. Historical reporting (counts, timing, conversion) remains correct without retaining personal information.
- Meta's own copy of any Messenger / IG / WhatsApp conversation stays on Meta's servers under Meta's retention rules; that disclosure is in `/data-deletion` under "Messages received through Meta channels". The platform's deletion procedure has no control over Meta's retention.
- The `webhook_outbox` `sanitizeOutboxPayload` helper also strips contact + brief from any delivered/queued GHL outbox rows for the same `lead_id`; that path runs in the same purge call.
- Identifier note for future runs: the purge route accepts EITHER a uuid (matched against legacy `leads.id`) OR a text `lead_id` (matched against `screened_leads.lead_id`). For Screen 2.0 / Meta-channel rows, use the text `L-YYYY-MM-DD-XXX` value.
- If the reviewer asks for proof beyond this file, the operator can re-run the flow with the reviewer observing in real time over Loom or Zoom.

---

## Required post-ledger rehearsal

Do not replace the historical evidence above. Append a new timestamped section after the privacy-redaction release is deployed and use the approved operator procedure in `docs/privacy/DELETION_OPERATIONS.md`.

The new rehearsal must use one fresh fictional Meta conversation and prove:

- message content, names, contact details, sender IDs, Meta message IDs, transcripts, attachments, and free-text failure details are absent from every in-scope store;
- every in-scope attachment location was inventoried; an empty manifest is not accepted as proof that no attachment exists;
- the retained audit envelope contains no direct identifier or message content and has the expected redaction marker;
- retained keys and active views cannot join the audit envelope to an identifying firm matter or another personal record;
- the operation is idempotent and tenant-scoped;
- unauthorized roles cannot invoke redaction;
- normal conversation-ledger updates and deletes remain blocked;
- pending delivery work cannot reintroduce the removed data;
- the deployed application removes Meta-derived direct identifiers and message content from its controlled operational copies, and `provider_managed` alone cannot mark cleanup complete; and
- a backup-restore rehearsal proves deleted data cannot return to operational use without replaying the deletion request.

Record the production commit, migration ledger version, execution time, fictional lead ID, sanitized before-and-after field inventory, and operator sign-off. Keep the Meta submission blocker open if any check is incomplete.

---

## Post-ledger production rehearsal: 2026-09-03

**Status:** Database, application, Storage, authorization, idempotency, tenant-isolation, append-only, and pending-message checks passed. Deployment of the later completion-semantics correction, backup-restore, and privacy-counsel gates remain open; this rehearsal does not authorize Meta submission. Multi-provider support responses are tracked separately and are not Meta submission gates.

**Production commit:** `fde4f307f34eb12a74f06a57d2af9c6fdc9611eb` (PR #199 merge commit)

**Production migration ledger version:** `20260902210124` (`privacy_screened_lead_redaction`)

**Execution time:** `2026-09-03T00:27:14.224Z`

**Operator:** Codex, under Adriano Domingues's explicit release authorization

**Channel and fixture:** Fresh fictional Facebook Messenger data, created directly in the production database only for this controlled rehearsal. It was not sent to a real person or external messaging provider.

- Screened-lead UUID: `f8f27434-6572-4d8c-8549-801680e6f65d`
- Original fictional lead reference: `L-S1-963449d3-b679-4556-9a4a-8c62c8f5ccee`
- Deletion-request UUID: `77fcb0b5-0b28-4dfa-b711-00cea41577fc`
- Reason: `internal_test_record`

### Before inventory

The atomic seed transaction established the following fictional personal-data surfaces before deletion:

- one unredacted screened lead with a fictional name, email, phone number, transcript, IP address, user agent, brief, and slot answer;
- two conversation-ledger events containing fictional message bodies and direct Meta-style identifiers;
- one linked channel intake session and one processed-message deduplication row;
- five linked secondary-store categories across unconfirmed inquiry, webhook outbox, consent, attribution, and conflict-check storage; and
- one real object in the private `intake-attachments` bucket under the fixture's exact firm/session prefix.

No production client or prospect data was used.

### Authorized operation

The request was executed through the same production operator endpoint intended for a real verified request:

`POST /api/admin/leads/L-S1-963449d3-b679-4556-9a4a-8c62c8f5ccee/purge`

The endpoint returned HTTP `200`, the expected deletion-request UUID, `external_cleanup_status: complete`, and the irreversible-redaction confirmation. The Storage coordinator reported one deleted attachment object. The fictional data never entered GHL, Meta, or Resend, so GHL was recorded `not_applicable`; the database contract recorded the Meta and Resend locations as `provider_managed`, which prompted the later PR #202 completion-semantics correction described below.

### Sanitized after-state

Production verification found:

- the screened lead archived and terminally marked `internal_test_record`;
- name replaced with the fixed anonymization sentinel;
- email, phone, transcript, IP address, user agent, free-text status/error fields, UTM/referrer values, and advertising identifier removed;
- brief and answer payloads replaced with fixed anonymization sentinels;
- every conversation body replaced by `[redacted]`;
- Meta message IDs, actor/sender IDs, authoritative-inbound flags, and free-text failure details removed or neutralized;
- the channel session sender replaced by a non-identifying redaction key and its engine state replaced by the fixed anonymization marker;
- the legacy intake conversation, contact, entities, summary, memo, and OTP fields cleared;
- the unconfirmed inquiry identifiers, sender metadata, and transcript cleared;
- the processed-message deduplication row removed;
- webhook payload, destination URL, idempotency key, and pending delivery state neutralized;
- consent and attribution payloads replaced by fixed redaction markers, with notes, IP address, and user agent removed;
- conflict notes removed and party names replaced by `[redacted]`;
- the attachment-prefix object count reduced from one to zero; and
- the transitional cleanup manifest cleared after the application completed Storage cleanup.

An exact-marker scan across the seeded lead, conversation, session, intake, outbox, consent, and attribution fields returned zero matches for the fictional name, contact details, message fragments, Meta-style IDs, IP address, or user agent.

The retained deletion tombstone contains the firm and screened-lead coordinator keys, timestamps, fixed reason, completion state, and the closed count/status summary. The reidentification assessment for those retained keys remains subject to privacy-counsel approval and is therefore still a release gate.

### Control verification

- **Service-only access:** `anon` and `authenticated` cannot execute the five public privacy RPC wrappers; `service_role` can. Direct table access to the deletion-request ledger remains revoked.
- **RLS:** `privacy_deletion_requests` has RLS enabled and forced, with no browser-access policy.
- **Unauthorized endpoint call:** the production purge endpoint returned HTTP `401` without its operator credential.
- **Idempotency:** replaying the same request returned HTTP `200` and the unchanged completed request.
- **Tenant isolation:** the original lead reference under a different firm scope returned the enumeration-safe no-op and did not alter the redacted record.
- **Ledger immutability:** ordinary `UPDATE` and `DELETE` attempts were rejected as append-only.
- **Suppression:** a new processed-message claim and a new inbound event for the redacted subject were rejected.
- **Pending-message race:** a late terminal outbound event correlated to the pre-redaction pending request was accepted only as a redacted envelope; its body was `[redacted]`, identifiers were `NULL`, and the deletion-request marker was preserved.
- **Retention expiry:** the service-only three-year expiry RPC was invoked in production. It returned `ok: true`, `has_more: false`, and zero currently eligible envelopes.
- **Migration backfill:** the pre-existing sentinel-anonymized row was converted to the controlled redaction state; zero legacy sentinel rows remain outside that state.

Supabase's post-DDL security advisor reported no new warning tied to the privacy migration. Its `RLS enabled, no policy` information messages for the locked ledgers are expected deny-by-default behavior. Existing unrelated warnings remain outside this release.

## Final rollback-only production verification: 2026-09-03

**Status:** Strict completion semantics and redaction of the tested Meta-derived CaseLoad Select operational copies passed. The execution window ended by 2026-09-03 12:42 UTC. The database transaction was rolled back, leaving no persistent fictional fixture. This verification did not call Meta, another external provider, or Storage, and it is not evidence that data was deleted from Meta's systems.

**Production commit:** `a05520e3b9d08d82bd81c42779907cbd2c807757`

**Production migration ledger version:** `20260903011450` (`privacy_provider_evidence_required`)

**Channel and fixture:** A fictional Facebook Messenger and Meta-derived operational-copy fixture exercised the deployed CaseLoad Select deletion path without sending data to a real person or external provider.

### Passed checks

- A wrong-tenant invocation was a no-op.
- The lead, channel intake session, unconfirmed inquiry, and channel conversation event were redacted in the transaction; the matching processed-message claim was deleted.
- The event body became `[redacted]`; the Meta message ID and actor or sender ID became `NULL`.
- A `provider_managed` cleanup result was rejected. The request remained pending, and no completion summary was recorded.
- Submitting `meta_status: provider_managed` through the authenticated production application path returned HTTP `400` with `{"error":"meta_status has an invalid status"}`.
- A truthful all-`not_applicable` acknowledgement completed the uncommitted fixture only after every provider disposition passed the strict summary check.
- Idempotent replay, tenant isolation, suppression, and reintroduction guards passed.
- The exact fictional PII marker scan returned zero matches after redaction.
- The transaction rollback left zero fixture residue in every checked table.

This closes the strict completion-semantics and Meta-derived CaseLoad Select operational-copy gates only. It does not close backup and restore replay, privacy-counsel review, public-copy reconciliation, provider-account follow-up, or final Meta submission controls.

### Meta-relevant gate status recorded on 2026-09-03

This snapshot is preserved as historical evidence and is superseded by the
2026-09-04 sections below.

1. **Completion semantics, passed:** production commit `a05520e3b9d08d82bd81c42779907cbd2c807757` and migration `20260903011450` were verified. A `provider_managed` marker alone cannot complete external cleanup or produce a successful completion summary.
2. **Meta-derived operational copies, passed:** the final rollback-only fictional verification proved that the deployed path removes the tested direct identifiers and message content from CaseLoad Select operational copies derived from Facebook Messenger intake. This does not claim deletion from Meta's systems.
3. **Backup expiry and restore replay, open:** account-level verification confirmed that the production Supabase organization is on the Free plan. The Supabase CLI reported WAL-G enabled, PITR disabled, no enumerated backup snapshots, and no physical-backup metadata. There is therefore no account-visible production restore point or provider-backed expiry schedule to rehearse. A fictional local logical-restore rehearsal proved that the redaction RPC can reapply an externally retained request, but also proved that restoring a pre-deletion snapshot removes the in-database request tombstone and leaves the database recovery list empty. An external durable deletion registry and a restore procedure that replays it before restored data returns to use remain required. No production restore was attempted.
4. **Privacy counsel, open:** counsel has not yet approved the provisional three-year audit-envelope period or confirmed that the retained keys and joins do not reasonably reidentify a person.

### Separate privacy-compliance follow-up, not a Meta gate

- One migration-created legacy request remains pending with a non-personal HighLevel lead-reference selector. Resolve it through the controlled workflow when separately authorized.
- Preserve the Resend, HighLevel, and Supabase retention and deletion questions in the provider evidence record. Do not send support drafts without provider-specific approval.
- Provider support responses from Resend, HighLevel, or Supabase are not required for this Meta submission.

### Provider-document review: observed 2026-09-03

This review records public provider statements for the broader privacy program. It does not substitute for account-specific confirmation or execution evidence, and responses from Resend, HighLevel, or Supabase are not Meta submission gates.

- [Supabase database backups](https://supabase.com/docs/guides/platform/backups) states that Pro, Team, and Enterprise projects receive daily database backups, retained for 7 days on Pro, 14 days on Team, and up to 30 days on Enterprise. It also states that database backups do not include Storage objects, so restoring a database backup does not restore a deleted Storage object. Account verification on 2026-09-03 identified the production organization as Free, while `supabase backups list --project-ref ssxryjxifwiivghglqer --output json` returned `walg_enabled: true`, `pitr_enabled: false`, `backups: []`, and an empty `physical_backup_data` object. WAL-G enablement alone is not evidence of a retained, restorable backup.
- [Resend's GDPR page](https://resend.com/security/gdpr) states that email and log data is retained for 30 days on Free, Pro, and Scale plans, backups persist for 7 days, and a customer can contact Resend when a specific message must be removed sooner. No request-specific Resend confirmation has been obtained for this release.
- [HighLevel's contact-deletion guidance](https://help.gohighlevel.com/support/solutions/articles/155000000583) states that a deleted contact can be restored for 60 days, while associated conversations, notes, tasks, and activity history are not restored. The pending legacy selector must be searched and, if matched, deleted through the account before the migration-created request is closed.
- Meta's account-specific retention/deletion evidence remains unverified. The release record must not infer it from the local `provider_managed` marker.

### Fictional local restore/replay rehearsal: 2026-09-03

This rehearsal used an ephemeral local Supabase/Postgres database containing only fictional data. Repository migrations were applied through `20260902210124`; production was not changed and no paid Supabase resource was created.

1. A fictional firm, screened lead, channel session, and inbound conversation event were inserted. Before the snapshot, the lead and event contained fictional direct identifiers and message content, and deletion request `d1111111-1111-4111-8111-111111111111` did not exist.
2. A custom-format logical snapshot was captured before deletion. The original local database then ran `redact_screened_lead_subject` as `service_role`. It returned `redacted_count: 1`; the lead and event passed the redacted-state checks; and the request tombstone existed.
3. The pre-deletion snapshot was restored into a separate local database. Application-schema verification showed the fictional identifiers and message content had returned, while the deletion request was absent. Restored ACL checks still allowed the public wrapper only for `service_role`, denied `anon`, and denied direct `service_role` reads of `privacy_deletion_requests`.
4. `list_pending_screened_lead_privacy_cleanups(100)` returned `requests: []` in the restored database. This is the expected negative proof: an in-database recovery worker cannot discover a deletion request created after the restored snapshot.
5. The same request ID was then supplied from an external fictional fixture to `redact_screened_lead_subject`. The RPC returned `redacted_count: 1` and the same request ID; the lead and event again passed the redacted-state checks; and the request tombstone was recreated. A second identical replay returned `redacted_count: 0` with the same request ID.

The logical restore emitted warnings for Supabase-managed `pg_cron`, Realtime, and Vault objects that cannot be recreated in a second database inside the same local container. Those warnings were outside the application schemas; the application function, fixture state, request state, and ACL assertions above were queried directly after restore. This is safe engineering evidence for manual replay semantics, not evidence of a managed Supabase backup restore or automatic replay.

**Rehearsal conclusion:** replay is idempotent and effective when an outstanding request is supplied from outside the restored database. Automatic replay is not implemented because the only current tombstone is part of the database being restored. Before release, completed and pending deletion request identifiers must be durably retained outside the database backup boundary, and the production restore runbook must block operational access until that external registry has been replayed and verified.

**2026-09-03 engineering sign-off:** The then-shipped implementation and fictional production deletion path passed the controls listed above, including strict completion semantics and the tested Meta-derived CaseLoad Select operational copies. The registry/restore statement here is historical and is superseded by the 2026-09-04 evidence below. Privacy-counsel and public-copy gates remain open.

### Candidate automated restore/replay simulation: 2026-09-04

**Status:** Passed and merged. The code/test candidate head was
`b5976a7097b421866a2be9d52aa6966af22d4a0b`; the final reviewed documentation
head was `1ea08ac607c4ad9ee42de219df46ff3f68829177`. The authoritative final-head
GitHub real-Postgres job `101090234475` passed 33 tests, including the dedicated
transactional restore/replay rehearsal; the full Vitest suite, typecheck,
ESLint, remaining required checks, and both Vercel previews also passed. PR
#219 merged as `6f6c59330d94d84b1fc3bc63fb76d8830d3c8644`, and both Git-integrated
production deployments for that exact merge completed successfully.

The rehearsal ran only against the fresh local Supabase/Postgres Docker stack
created by GitHub CI. It proved the connection was numeric-loopback and
correlated the published port and SQL server address to the one expected local
database container. No cloud database credential or cloud-capable Supabase
command was available to the test.

The fictional sequence proved:

1. A legitimate operational state was established, an encrypted external
   intent and applied receipt were written, and the initial database redaction
   removed the fictional identifiers and message content.
2. Both recovery circuits were locked before the database transaction was
   rolled back to its pre-deletion savepoint. The database snapshot restored
   the fictional identifiers and Meta-style message ID and removed its local
   deletion tombstone, while the external encrypted intent, receipt, and
   activation marker survived.
3. The restored database was re-locked as the first database action. A normal
   operational deletion failed closed; actual `anon` and `authenticated` RPC
   calls were denied.
4. The production replay coordinator consumed the surviving encrypted intent,
   completed one applied replay with zero failures, recreated the redacted
   database state and tombstone, and then completed a second fresh replay as an
   idempotent skip.
5. Late inbound content was rejected, a pending outbound terminal event was
   coerced to the redacted envelope, processed message coordinates were absent,
   provider cleanup remained pending, and neither Storage nor provider
   completion was invoked.
6. Persistent subject and operation records used authenticated encrypted
   envelopes; their stored values contained none of the fictional names,
   email, phone, message body, sender/message IDs, or stable fixture UUIDs.
   The outer transaction rolled back and CI stopped the local stack in an
   unconditional teardown step.

The first CI execution exposed a real receipt-idempotency defect: replay after
restore generated a later database redaction timestamp than the surviving
immutable applied receipt. The candidate fix preserves the original receipt
and timestamp when the deletion request and terminal redaction count match,
while a conflicting terminal count still fails closed. Focused unit tests and
the repeated real-Postgres rehearsal passed after the correction.

**Evidence boundary:** This is an application-level **transactional logical
restore simulation**. It is not a managed Supabase backup or PITR restore, does
not prove provider backup expiry or cloud disaster recovery, and does not
represent the in-memory test adapter as externally durable. Production data
and provider cleanup state were not touched.

### Post-PR #219 production closeout state

Read-only aggregate verification after deployment shows the production database
locked and current, with the 222-entry migration ledger unchanged at tip
`20260903183915`. The controlled replay reconciliation remains linked and
complete; the two tested records remain redacted in CaseLoad Select. Meta
provider disposition remains pending for both records, with zero complete and
zero completion timestamps.

The earlier initial-backfill registry-audit action now fails closed at bounded
stage `key_shape` because it recognizes only the initial-backfill namespaces and
the completed replay added further legitimate registry namespaces. This is not
evidence of plaintext exposure or a redaction reversal, but it prevents final
registry attestation. The remaining technical gate is a narrow current-registry
audit followed by final fictional end-to-end verification and controlled
production activation/open postflight. No Meta submission or provider-completion
claim is authorized while that gate remains open.

### Final registry audit and production activation: 2026-09-04

PR #221 merged as `e9e50f28fd266ed28e54893ce793771348e252ad`
and deployed through both Git-integrated production projects. One authenticated,
service-only current-registry audit ran while both recovery circuits were
locked. It returned `200`, `valid`, and no failed stage. Its bounded aggregate
inventory contained 15 records across one firm: two intents, two applied
receipts, one backfill seal, one replay run, three operation states, and six
progress records. The fixed checks for bounds, recognized key shapes,
authenticated encryption, absence of plaintext direct identifiers, terminal
backfill and replay, exact cycle linkage, evidence linkage, and accounting all
passed. Provider status and the database migration ledger were unchanged.

The first activation-only attempt then failed safely because the database open
function accepted only `replaying`, while the verified procedure deliberately
re-locked both circuits after replay and audit. Its automatic fallback lock
returned `200`/`locked`; the database remained locked on the exact reconciled
cycle and operation. No worker, deletion, provider, or Storage action ran.

PR #222 corrected only that contract. Its exact reviewed head
`205b3fe4c7b888cfe2e8886e0c2ec3b9e9ed38ad` merged as
`fbb6aac6712b28191de5aee79d0d4511aaaf4b59`, and both Git-integrated
production deployments succeeded for that merge. The pushed migration blob
`20260904125000_privacy_recovery_open_from_locked.sql` had SHA-256
`0722F4A64E2584180B6A7D1A35EA3B7F02231D5AA35349F8CCA436FDD7438310`.
The production dry run listed only that migration; it was applied once. The
linked ledger then contained 223 matching local/remote entries with tip
`20260904125000`.

One authenticated open call returned `200` with the exact `open` outcome. The
route required the encrypted replay checkpoint to be global, terminal,
scan-exhausted, unbuffered, and free of pending intents or failures; the
database required the exact schema contract, cycle, replay requirement,
reconciliation operation, and non-null completion proof. The route persisted
and verified the permanent external activation marker before opening the
external circuit. A read-only request to a protected nonexistent API path then
returned the normal `404` pass-through rather than the recovery `503`.

Final aggregate postflight found the database open on registry schema contract
`20260903183915`, with the exact replay reconciliation still linked and
complete. Both in-scope CaseLoad Select records remained redacted. Meta provider
state remained two pending, zero complete, zero completion timestamps, and two
manifests. No worker, deletion, provider, or Storage call ran during activation,
and no fresh persistent production fixture was created. PR #219 remains the
final fictional end-to-end restore/replay exercise within its documented
transactional logical-restore boundary.

**Technical closeout conclusion:** the encrypted registry, recovery replay,
current-registry audit, and controlled activation gates are complete for the
tested CaseLoad Select copies. This does not prove deletion inside Meta, managed
backup/PITR expiry, or legal sufficiency of the retained audit envelope. Those
evidence boundaries remain expressly open.

### Owner decision supersession: 2026-09-04

After the technical closeout above, Adriano approved PR #223's public wording,
which merged on 2026-09-04. He accepted the documented retained-envelope, join, retention,
and managed-backup evidence limits as owner. He waived external privacy-counsel
review for this release. This closes the internal counsel-decision gate by owner
risk acceptance; it does not convert the engineering evidence into a legal
opinion or prove deletion inside Meta or managed-backup/PITR expiry.

The exact owner decision and Meta Data Handling attestations are recorded in
`../privacy/OWNER_PRIVACY_AND_META_DATA_HANDLING_DECISION_2026-09-04.md`.
Signed-out checks of the canonical public pages returned HTTP 200 and confirmed
the key approved wording. The live Meta changes, upload checks, and final
action-time submission approval remain open.
