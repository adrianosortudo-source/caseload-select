# Lawyer Triage Portal — Per-Firm Setup Checklist

**Audience:** Operator (Adriano) configuring a firm to use the Phase 1+2+3 lawyer triage portal.
**Effort:** ~10 minutes per firm once Supabase + Vercel access is set.
**Last revised:** 2026-05-05

> **Stay in sync.** Four docs share the operational contract and must be updated on the same pass when contract semantics change:
>
> | Doc | Audience | Path |
> |---|---|---|
> | This file (setup checklist) | Operator | `caseload-select-app/docs/lawyer-portal-firm-setup.md` |
> | Build prompt | Build agent (Claude Code, @dev) | `D:\00_Work\01_CaseLoad_Select\05_Product\LawyerPortal_BuildPrompt_v1.md` |
> | CRM Bible v5.1 | Strategic reference | `D:\00_Work\01_CaseLoad_Select\04_Playbooks\04_Screen\Strategy\CaseLoad_Select_CRM_Bible_v5.1.html` |
> | GBP Reviews playbook | Operator training and J8 reference | `D:\00_Work\01_CaseLoad_Select\04_Playbooks\01_Authority\PB_Auth_GBPReviews_v1.html` |
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

## 5. GBP Reviews setup (J8 asking system)

The lawyer triage portal handles the first 48 hours after a lead arrives. The GBP Reviews asking system handles the inverse: the moment a matter closes and the firm wants the satisfied client to leave a Google review. J8 in the CRM Bible specifies the cadence; this section is the operator checklist.

Full strategic and training reference: `D:\00_Work\01_CaseLoad_Select\04_Playbooks\01_Authority\PB_Auth_GBPReviews_v1.html` (in-person scripts, physical asset specs, reply templates, anti-pattern training).

### 5a. Verify the Google Business Profile

```sql
-- Confirm the firm has a verified GBP and the URL is captured
SELECT id, name,
  branding->>'gbp_review_url' AS gbp_review_url,
  branding->>'gbp_short_link' AS gbp_short_link
FROM intake_firms
WHERE id = 'FIRM_UUID_HERE';
```

If `gbp_review_url` is missing, generate it from the firm's GBP dashboard: GBP admin → "Get more reviews" → copy the URL. Then shorten via GHL's branded short-link tool (or any short-link tool the firm uses) and store both in `branding`:

```sql
UPDATE intake_firms
SET branding = branding
  || jsonb_build_object(
    'gbp_review_url', 'https://g.page/r/FIRM_GBP_ID/review',
    'gbp_short_link', 'https://firm.com/review'
  )
WHERE id = 'FIRM_UUID_HERE';
```

### 5b. Generate the QR code

The QR code points to `gbp_short_link` (not the full GBP URL; the short link is rebrandable later if the GBP URL changes). Generate via any QR tool that produces vector output. Store the SVG in the firm's brand assets folder.

### 5c. Order the physical asset kit

For each firm, order at minimum:

- One desk QR sticker for the signing area (2 inch x 2 inch, vinyl)
- Two NFC plaques or NFC business cards for reception and signing desk
- 250 business cards with the QR code on the reverse
- Updated invoice and receipt templates with the QR code and short link in the footer

The asset kit is a one-time onboarding cost charged to the firm or absorbed into the retainer; confirm with Adriano per firm.

### 5d. Configure J8 cadence in GHL

Build the asking system as a GHL workflow keyed on matter status changing to Closed. Specifications per the CRM Bible §9.8:

| Step | Channel | Timing | Conditional |
|---|---|---|---|
| 01 | SMS | T+2 hours | Standard cadence only (matter_emotion_class = standard) |
| 02 | Email | T+2 business days, 1-3 PM window | Standard cadence only |
| 03 | SMS reminder | T+3 days | If no review posted yet |
| 04 | Email reminder | T+5 days | If no review posted yet |
| 05 | Anniversary SMS | T+30 days | High-emotion variant only (matter_emotion_class = high) |

Copy templates: see CRM Bible §9.8 copy seeds, or pull from the playbook's full library. The SMS at T+2 hours has two variants based on `in_person_ask_outcome`: if the lawyer captured "asked_yes" during the close meeting, fire the "as we discussed" copy; otherwise fire the standard copy.

NPS gate: J8 only fires when `nps >= 7` from the J6 T+7 prompt or any subsequent NPS in J7. Configure the gate as the workflow's entry condition.

### 5e. Train the lawyer on in-person scripts

The in-person ask is the highest-converting channel (40 to 60 percent vs 8 to 15 percent for SMS). Train the lawyer and any client-facing staff on the five in-person scripts in the playbook (Section 04, page 5):

- Script 01: Gap-time ask while documents print
- Script 02: Direct hand-off to the desk QR sticker
- Script 03: Ask following a spontaneous compliment
- Script 04: "Is everything going well" trigger
- Script 05: Verbal commit, then hand the card

Walkthrough takes about 15 minutes. Schedule a 90-day re-training calendar reminder; in-person script delivery decays without practice.

### 5f. Configure the reply SLA

Every posted review gets a lawyer reply within 72 hours. Set this up as:

- A daily check on new reviews via BrightLocal (already in the firm's stack) or via direct GBP API polling
- A calendar block on the lawyer's schedule labeled "Review replies" at a fixed time three times a week
- Five reply scripts pre-loaded into the firm's email tool (5-star generic, 5-star with specifics, 3-4 stars constructive, 1-2 stars addressable, 1-2 stars no record). Templates: see playbook Section 09, page 10.

If the lawyer misses the 72-hour window twice in a quarter, that surfaces in the operator dashboard as a coaching item.

### 5g. Verify channel attribution is wired

Each review record should capture which channel triggered it. The five channel tags:

- `in_person`: review posted within 30 minutes of the in-person ask (inferred from timestamp + lack of any digital touch)
- `sms_link_click`: review posted within 24 hours of an SMS link click (tracked via short-link analytics)
- `email_link_click`: same for email
- `qr_scan`: review posted from a QR code scan event
- `anniversary_sms`: review posted within 24 hours of the 30-day SMS

The dashboard reads from this attribution. Without it, the firm cannot tell which channel is producing and where to reweight effort.

### 5h. Anti-pattern compliance check

Confirm the workflow does not include any of the following (per CRM Bible DR-020):

- [ ] No funnel gating (every NPS-positive client sees the same public review path)
- [ ] No incentive triggers (cash, gift cards, raffle entries tied to review submission)
- [ ] No bulk reactivation (any backlog of past clients drips over weeks, not days)
- [ ] No friends-and-family asks (shared surnames or addresses flag for review)
- [ ] No keyword-stuffed reply templates (replies are plain prose; no firm-name or city-name keyword stuffing)

These are Google ToS and LSO 4.2-1 compliance gates. Violating any of them risks profile suspension or LSO complaint.

### 5i. First-quarter targets

For a 1-to-2 lawyer firm, expect:

- Q1: 12 reviews
- Q2: 15-18 reviews
- Q3: 20-25 reviews
- Q4: 25-30 reviews

These are bounded by the firm's actual case-completion volume, not invented. The system's job is to convert close-out events into review events at high rate, not to manufacture reviews.

---

## 6. Operational notes

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
