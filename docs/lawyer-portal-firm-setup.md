# Lawyer Triage Portal — Per-Firm Setup Checklist

**Audience:** Operator (Adriano) configuring a firm to use the Phase 1+2+3 lawyer triage portal.
**Effort:** ~10 minutes per firm once Supabase + Vercel access is set.
**Last revised:** 2026-05-05

> **Stay in sync.** Three docs share the operational contract for the lawyer triage portal and must be updated on the same pass when contract semantics change:
>
> | Doc | Audience | Path |
> |---|---|---|
> | This file (setup checklist) | Operator | `caseload-select-app/docs/lawyer-portal-firm-setup.md` |
> | Build prompt | Build agent (Claude Code, @dev) | `D:\00_Work\01_CaseLoad_Select\05_Product\LawyerPortal_BuildPrompt_v1.md` |
> | CRM Bible | Strategic reference | `D:\00_Work\01_CaseLoad_Select\04_Playbooks\04_Screen\Strategy\CaseLoad_Select_CRM_Bible_v5.html` |
>
> Plus the GHL webhook contract at `caseload-select-app/docs/ghl-webhook-contract.md` whenever payload shapes or actions change.

---

## Prerequisites

Confirm before starting:

- [ ] The firm exists in `intake_firms` with a stable `id` (uuid).
- [ ] The Supabase migrations have been applied (the four `20260505_*.sql` migrations land the `screened_leads`, `firm_decline_templates`, and `webhook_outbox` tables; the dashboard-indexes migration is dependency-free).
- [ ] You have `app.caseloadselect.ca` access for production. Local dev works the same way against `localhost:3000`.

---

## 1. Set the lawyer email so the magic-link login works

The lawyer enters their email at `/portal/login`. The endpoint resolves the email to a firm via `intake_firms.branding.lawyer_email`. If unset, the email lookup fails silently and no link is sent.

```sql
UPDATE intake_firms
SET branding = jsonb_set(
  coalesce(branding, '{}'::jsonb),
  '{lawyer_email}',
  '"lawyer@firm.example.com"'
)
WHERE id = 'FIRM_UUID_HERE';
```

Verify:

```sql
SELECT id, name, branding->>'lawyer_email' AS lawyer_email
FROM intake_firms
WHERE id = 'FIRM_UUID_HERE';
```

The portal supports one lawyer email per firm in MVP. When 2-lawyer firms onboard, the field can widen to a `lawyer_emails text[]` column without a portal change (resolver iterates an array if present).

---

## 2. Set the GHL webhook URL so cadences fire

Take/Pass/decline-with-grace deliveries POST to this URL. Without it, the webhook skips silently and the operator must surface manually. The DB lifecycle still transitions correctly; the cadence just never engages.

```sql
UPDATE intake_firms
SET ghl_webhook_url = 'https://services.leadconnectorhq.com/hooks/.../inbound/...'
WHERE id = 'FIRM_UUID_HERE';
```

Get the URL from the firm's GHL account: workflow → trigger → "Inbound Webhook" → copy the unique URL.

The GHL workflow on the receiving end should:

1. Branch on the `action` field (`taken` / `passed` / `declined_oos` / `declined_backstop`).
2. For `taken`, branch on `taken.cadence_target` (`band_a` / `band_b` / `band_c`) to engage the right cadence.
3. For the three decline actions, send the email using `decline_subject` and `decline_body` to `contact.email`.
4. Dedupe on `idempotency_key` so retries don't double-send.

Full payload contract: `docs/ghl-webhook-contract.md`.

---

## 3. (Optional) Seed firm-specific decline copy

If left unset, the system fallback copy fires (brand-clean but generic). Most firms benefit from at least a default template; per-PA variants are optional.

### Firm default

```sql
INSERT INTO firm_decline_templates (firm_id, practice_area, subject, body)
VALUES (
  'FIRM_UUID_HERE',
  NULL,                          -- NULL = firm default (matches everything)
  'Re: your inquiry to Hartwell Law',
  'Thank you for reaching out about your matter. After reviewing the details you shared, this falls outside the work our firm is currently in a position to take on. We recommend the Law Society of Ontario referral service for help finding the right counsel for your situation. We appreciate the time you took to write to us.'
);
```

### Per-PA override (optional)

```sql
INSERT INTO firm_decline_templates (firm_id, practice_area, subject, body)
VALUES (
  'FIRM_UUID_HERE',
  'family',                      -- non-null = matches when practice_area equals this
  'Re: your family law inquiry',
  'Thank you for reaching out about your family situation. Family law sits outside the matters our firm currently handles. We recommend...'
);
```

### Resolution order at decline time

1. **Per-lead override** — `screened_leads.status_note` (the lawyer's custom note in the Pass modal)
2. **Per-PA template** — matches `(firm_id, practice_area)`
3. **Firm default template** — matches `(firm_id, NULL)`
4. **System fallback** — hard-coded brand-clean copy in `lib/decline-resolver-pure.ts`

The unique constraint on `(firm_id, practice_area)` enforces one default per firm and one variant per area pair. Trying to insert a second default for the same firm errors out cleanly.

---

## 4. Test the end-to-end flow

### 4a. Sign in via magic link

Visit `https://app.caseloadselect.ca/portal/login`. Enter the lawyer email you set in step 1. Click "Send sign-in link". Check the inbox for an email from `noreply@caseloadselect.ca`. Click the link; the portal lands on the firm's Triage tab.

If no email arrives within 30 seconds: check Resend's logs (`RESEND_API_KEY` in Vercel env), check Supabase logs for the request-link route, and confirm `branding->>lawyer_email` matches exactly (case-insensitive comparison; no trailing whitespace).

### 4b. Submit a screening

In a separate browser tab: `https://caseload-screen-v2.vercel.app/?firmId=FIRM_UUID_HERE`. Type a description, walk through the chip flow, capture contact details, submit. The screen POSTs to `/api/intake-v2` and the row lands in `screened_leads`.

### 4c. See the lead in the queue

Return to the portal Triage tab. The row appears (refresh-on-focus or refresh manually). Click into the brief.

### 4d. Press Take or Pass

Take fires the `taken` webhook with the band-driven `cadence_target`. Pass opens a modal with optional custom note; on confirm fires the `passed` webhook with the resolved decline copy.

### 4e. Verify the webhook fired

```sql
SELECT id, action, status, attempts, last_error, last_http_status, created_at, sent_at
FROM webhook_outbox
WHERE lead_id = 'L-...'
ORDER BY created_at DESC
LIMIT 5;
```

`status='sent'` and `sent_at IS NOT NULL` means GHL accepted it. `status='pending'` with `next_attempt_at` in the future means a retry is queued. `status='failed'` means max attempts exhausted; check `last_error`.

### 4f. (If needed) Manually retry a stuck delivery

```bash
curl -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://app.caseloadselect.ca/api/admin/webhook-outbox/OUTBOX_ID/retry
```

Or list the recent outbox state:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://app.caseloadselect.ca/api/admin/webhook-outbox?firm_id=FIRM_UUID_HERE&status=pending"
```

---

## 5. Operational notes

### Cron jobs (not yet scheduled)

Two crons are wired and ready but **not scheduled** while the Vercel account is on Hobby (caps at one daily run per cron path, which combined with the 48h decision window introduces unacceptable latency):

- `/api/cron/triage-backstop` — sweeps triaging rows past their `decision_deadline`, flips to declined, fires `declined_backstop` webhook. Recommended schedule: `7 * * * *` (every hour at :07).
- `/api/cron/webhook-retry` — sweeps pending outbox rows whose `next_attempt_at` has passed. Recommended schedule: `*/5 * * * *` (every 5 minutes — backoff math handles burst load).

To enable: upgrade Vercel project to Pro, add both entries to `vercel.json`, redeploy. Alternative: install `pg_cron` + `pg_net` in Supabase and call the routes from there with the CRON_SECRET as a header.

In the meantime, both routes are manually triggerable with `Authorization: Bearer $CRON_SECRET`.

### Operator visibility

| Need | Surface |
|---|---|
| What's in triage right now? | `SELECT * FROM screened_leads WHERE firm_id=... AND status='triaging'` or the portal Triage tab |
| Which webhooks fired / failed? | `SELECT * FROM webhook_outbox WHERE firm_id=... ORDER BY created_at DESC` or `GET /api/admin/webhook-outbox` |
| What did the lawyer take vs pass? | `SELECT lead_id, status, status_changed_at, status_note FROM screened_leads WHERE firm_id=... AND status IN ('taken','passed') ORDER BY status_changed_at DESC` |
| Whale-nurture pipeline | `SELECT * FROM screened_leads WHERE firm_id=... AND whale_nurture=true` |

### Lifecycle states (the contract — do not drift)

| State | Set by | Webhook fired |
|---|---|---|
| `triaging` | DB default at insert | none (nothing to decline yet) |
| `taken` | Take action | `taken` |
| `passed` | Pass action | `passed` |
| `declined` | OOS auto-fire OR backstop OR manual SQL | `declined_oos` or `declined_backstop` |

Hard-enforced via DB CHECK constraint. New states require a migration AND an update to `docs/ghl-webhook-contract.md`.
