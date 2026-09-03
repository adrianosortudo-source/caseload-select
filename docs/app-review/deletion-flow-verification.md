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
