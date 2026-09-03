# Data deletion flow: verification record

> SCOPE NOTICE: This May 2026 exercise predates `channel_conversation_events`. It verifies the fields and tables named below only. It does not establish that append-only channel conversation ledger content is erased or anonymized, and it must not be used to make that claim in the v2 reviewer package.

> CURRENT RELEASE GATE: A new post-ledger fictional deletion rehearsal is required after the redaction implementation is shipped. Until that rehearsal passes, this historical record does not clear the Meta submission blocker.

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
- processor action evidence is recorded; a `provider_managed` status alone is not deletion proof; and
- a backup-restore rehearsal proves deleted data cannot return to operational use without replaying the deletion request.

Record the production commit, migration ledger version, execution time, fictional lead ID, sanitized before-and-after field inventory, and operator sign-off. Keep the Meta submission blocker open if any check is incomplete.

---

## Post-ledger production rehearsal — 2026-09-03

**Status:** Database, application, Storage, authorization, idempotency, tenant-isolation, append-only, and pending-message checks passed. External-provider, backup-restore, and privacy-counsel gates remain open; this rehearsal does not authorize Meta submission.

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

The endpoint returned HTTP `200`, the expected deletion-request UUID, `external_cleanup_status: complete`, and the irreversible-redaction confirmation. The Storage coordinator reported one deleted attachment object. The fictional data never entered GHL, Meta, or Resend, so GHL was recorded `not_applicable`; the database contract recorded the Meta and Resend locations as `provider_managed` pending the separate provider-policy release gate described below.

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

### Open gates — Meta submission remains blocked

1. **Legacy backfill external cleanup:** one migration-created request remains pending. Its manifest has no Storage object, no Meta sender ID, and no email or phone selector, but it retains a non-personal lead-reference selector that requires an actual GHL disposition before the request can be closed.
2. **Provider evidence:** `provider_managed` is a location/disposition marker, not proof of provider deletion or an approved retention period. Current Meta, Resend, GHL, and Supabase evidence must be attached to the release record.
3. **Backup expiry and restore replay:** the Supabase CLI reported WAL-G enabled, PITR disabled, and no enumerated physical-backup snapshots. That output does not establish a backup-expiry schedule. No production restore was attempted because it would be destructive. A provider-confirmed expiry schedule and a safe restore/replay rehearsal remain required.
4. **Privacy counsel:** counsel has not yet approved the provisional three-year audit-envelope period or confirmed that the retained keys and joins do not reasonably reidentify a person.

### Provider-document review — observed 2026-09-03

This review records public provider statements; it does not substitute for account-specific confirmation or execution evidence.

- [Supabase database backups](https://supabase.com/docs/guides/platform/backups) states that paid projects receive daily database backups, retained for 7 days on Pro, 14 days on Team, and up to 30 days on Enterprise. It also states that database backups do not include Storage objects, so restoring a database backup does not restore a deleted Storage object. The production account's plan and available restore point still require account-specific confirmation.
- [Resend's GDPR page](https://resend.com/security/gdpr) states that email and log data is retained for 30 days on Free, Pro, and Scale plans, backups persist for 7 days, and a customer can contact Resend when a specific message must be removed sooner. No request-specific Resend confirmation has been obtained for this release.
- [HighLevel's contact-deletion guidance](https://help.gohighlevel.com/support/solutions/articles/155000000583) states that a deleted contact can be restored for 60 days, while associated conversations, notes, tasks, and activity history are not restored. The pending legacy selector must be searched and, if matched, deleted through the account before the migration-created request is closed.
- Meta's account-specific retention/deletion evidence remains unverified. The release record must not infer it from the local `provider_managed` marker.

**Engineering sign-off:** The shipped implementation and fictional production deletion path passed the controls listed above. Final privacy/release sign-off remains withheld until all four open gates are supported by evidence.
