# Data deletion flow — verification record

This file records the timestamped, end-to-end deletion exercise run before App Review submission. Required by `Phase11_Submission_Package.md` Section 6.3 so the deletion claim on the App Review form rests on a real recent exercise.

The operator runs the flow once, fills in this template, and the file ships in-repo as proof of operation. If Meta's reviewer follows up on the deletion claim, the operator points here.

---

## Verification run

**Date:** _________________________ (UTC ISO 8601, e.g. `2026-05-25T14:32:11Z`)
**Operator:** Adriano Domingues
**Reason for run:** Pre-App-Review verification of the data-deletion procedure documented at `/data-deletion` and `/privacy`.

---

## Step 1 · Lead created

**Channel:** `messenger | instagram | whatsapp | web` (pick one)
**Test firm:** `CaseLoad Select Test Firm` (firm_id `_________________________`)
**Lead ID:** `_________________________` (UUID from `screened_leads.id` after intake landed)
**Created at:** `_________________________`
**Brief snapshot (first 80 chars of `matter_snapshot`):** `_________________________`

---

## Step 2 · Deletion request received

**Sender email:** `_________________________` (the test gmail used to send the request)
**Received at:** `_________________________`
**Subject:** `Data deletion request — lead ID <lead_id>`
**Body:** `Please delete the personal information associated with this lead.`

---

## Step 3 · Acknowledgment sent

**Sent at:** `_________________________` (must be within 5 business days of Step 2)
**From:** `privacy@caseloadselect.ca`
**Body summary:** Acknowledged receipt; will complete within 30 days.

---

## Step 4 · Purge executed

**API call:**
```bash
curl -X POST "https://app.caseloadselect.ca/api/admin/leads/<lead_id>/purge" \
  -H "Authorization: Bearer $CRON_SECRET"
```

**Response:** `_________________________` (paste the JSON response)
**Completed at:** `_________________________`

---

## Step 5 · State verification

Run in Supabase SQL Editor:

```sql
SELECT
  id, contact_name, contact_email, contact_phone,
  raw_transcript IS NULL AS raw_cleared,
  brief_json->>'matter_snapshot' AS snapshot_after,
  updated_at
FROM screened_leads
WHERE id = '<lead_id>';
```

**Expected state after purge:**

| Column | Expected |
|---|---|
| `contact_name` | `[anonymized]` |
| `contact_email` | NULL |
| `contact_phone` | NULL |
| `raw_cleared` | `true` |
| `brief_json->>'matter_snapshot'` | sentinel placeholder (varies by `purgeLeadPii` implementation) |

**Actual values captured:**

| Column | Value before | Value after |
|---|---|---|
| `contact_name` | `_________________________` | `_________________________` |
| `contact_email` | `_________________________` | `_________________________` |
| `contact_phone` | `_________________________` | `_________________________` |
| `raw_transcript` (NULL or value) | `_________________________` | `_________________________` |
| `updated_at` | (pre-purge timestamp) | `_________________________` |

---

## Step 6 · Completion notice sent to requester

**Sent at:** `_________________________`
**Body summary:** Confirmed deletion completed; reference number `<lead_id>` matches request; provided 30-day complaint window to OPC if dissatisfied.

---

## Sign-off

The flow above produced the expected end state. The deletion claim in the App Review submission package (`Phase11_Submission_Package.md` Section 6) rests on this exercise.

**Operator signature:** Adriano Domingues
**Date of sign-off:** `_________________________`

---

## Notes

- The implementation anonymises rather than deletes the row (per `lib/data-retention.ts` `purgeLeadPii`). Meta accepts this approach when the policy discloses it, which `/data-deletion` does.
- `brief_html` and `brief_json` are replaced with sentinel placeholders, not nulled — historical reporting (counts, timing, conversion) remains correct without retaining personal information.
- Meta's own copy of any Messenger / IG / WhatsApp conversation stays on Meta's servers under Meta's retention rules; that disclosure is in `/data-deletion` under "Messages received through Meta channels". The platform's deletion procedure has no control over Meta's retention.
- If the reviewer asks for proof beyond this file, the operator can re-run the flow with the reviewer observing in real time over a Loom or Zoom call.
