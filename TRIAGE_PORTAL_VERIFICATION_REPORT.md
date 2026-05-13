# Triage Portal Verification Report

**Date:** 2026-05-12
**Method:** Code review (all source files), Supabase direct queries (schema, data, cron, RLS), local dev server attempt
**Target:** Lawyer Triage Portal — DRG go-live readiness
**Verdict:** **NOT READY FOR GO-LIVE** — 3 blockers require resolution before DRG onboarding

---

## Summary

| Area | Result | Notes |
|---|---|---|
| Schema | PASS | All columns present including multilingual fields |
| Cron jobs | PASS | Both pg_cron jobs active and correctly scheduled |
| Auth model | PASS | HMAC tokens, 30-day session, firm_lawyers path |
| Queue page | PASS | Sort, filter, language badge — code correct |
| Brief page | PASS | brief_html, DecisionTimer, language callout |
| Take action | PASS | Status flip, idempotency, race guard, outbox |
| Pass action | PASS | Three-layer decline, outbox, idempotency |
| OOS auto-fire | PASS | Status = declined at insert, webhook fires |
| Backstop cron | PASS | Race guard, batch 25, decline copy |
| Webhook outbox | PASS | Exponential backoff, max 5 attempts |
| Webhook retry | PASS | Sweeps pending rows, recordAttempt |
| Tenant isolation | PASS (app) / FAIL (DB) | App-layer checks correct; no RLS policies |
| Notification email | PASS | Fan-out, legacy fallback, language note |
| Compliance pages | PASS | /privacy and /terms exist, LSO calibrated |
| Multilingual fields | PASS | intake_language and raw_transcript in schema |
| DRG firm setup | **BLOCKER** | No DRG record in intake_firms |
| firm_lawyers setup | **BLOCKER** | No lawyer-role rows for any firm |
| Local dev server | **BLOCKER** | Turbopack junction-point failure on D: drive |
| RLS policies | **GAP** | Enabled but no policies; app-layer only |

---

## Blockers (must resolve before go-live)

### B-1 — No DRG firm record in the database

`intake_firms` contains two records: Sakuraba Law and Hartwell Law PC [DEMO]. There is no DRG (Damaris) firm row. The verification brief's Step 1 prerequisite cannot be met. All DRG-specific testing is blocked until this is created.

**Fix:** Adriano runs the onboarding checklist for DRG — creates the `intake_firms` row with `ghl_webhook_url`, `practice_areas`, `branding.firm_name`, `branding.lawyer_email` (or `firm_lawyers` row), `geo_config`.

### B-2 — No firm_lawyers row with role='lawyer' for any firm

`firm_lawyers` has one row: `adriano@caseloadselect.ca` with `role='operator'` on the Hartwell demo firm. There are no `lawyer` role rows.

Consequences:
- Magic link: `POST /api/portal/request-link` with Damaris's email returns `{ ok: true }` silently (no email sent, no match). She cannot log in.
- New-lead notification: `notifyLawyersOfNewLead()` finds zero recipients, falls through to legacy `branding.lawyer_email`. If DRG's `intake_firms.branding.lawyer_email` is also not set, no notification email fires.
- Both issues are setup gaps, not code bugs.

**Fix:** Insert a `firm_lawyers` row for Damaris:
```sql
INSERT INTO firm_lawyers (firm_id, email, role)
VALUES ('<DRG firm uuid>', 'damaris@drg-law.com', 'lawyer');
```
The `trg_firm_lawyers_invite` trigger fires a magic-link invitation email automatically on insert (if the Resend key is live).

### B-3 — Local dev server non-functional (Turbopack + D: drive)

Running `npm run dev` or `npm run build` fails with:
```
TurbopackInternalError: failed to create junction point at
".next/dev/node_modules/prettier-..."
Caused by: creation of a new symbolic link or junction point failed:
Incorrect function. (os error 1)
```

Turbopack (Next.js 16's default dev engine) requires NTFS reparse points (junctions) to symlink node modules inside `.next/`. The D: drive reports as a slow filesystem and does not support this operation — consistent with a network mount, OneDrive-backed folder, or exFAT volume.

**Production is unaffected.** Vercel runs on Linux (ext4); Turbopack junction creation is not needed there.

**Consequence for this verification:** End-to-end UI testing (queue rendering, brief view, Take/Pass button flow, magic link click, auto-refresh) could not be verified locally. All code-path review was done from source.

**Fix options (pick one):**
1. Move project to C: (fastest — NTFS, native symlinks work)
2. Enable Windows Developer Mode → Settings → For Developers → Developer Mode (allows non-admin symlink creation; only needed if drive is NTFS but symlinks are being blocked by policy)
3. Run `npm run dev` inside WSL2 (ext4, no junction issues; use VS Code WSL extension or Cursor Remote)
4. Verify using the Vercel Preview URL or production deployment

---

## Gaps (not blockers, fix before multi-firm scale)

### G-1 — No RLS policies on screened_leads, webhook_outbox, firm_decline_templates

RLS is enabled on all three tables but zero policies are defined. Current state:
- Service-role key (used by all API routes via `supabaseAdmin`) bypasses RLS entirely — works correctly.
- Anon and authenticated role queries return 0 rows — this is correct behavior from a security standpoint (deny by default) but the intended design is firm-scoped allow policies.

The Step 10 test in the brief (setting a JWT role and expecting only DRG rows) would return 0 rows rather than DRG-scoped rows, because there are no permissive policies matching the JWT claims.

**Risk:** Any future API route that uses `supabaseAdmin` without a `firm_id` WHERE clause exposes all firms' lead data. For legal intake data with confidentiality obligations this is a meaningful compliance risk at multi-firm scale.

**Recommended policies** (add via migration before onboarding a second firm):
```sql
-- Allow service role to bypass (already the case, but explicit is better)
-- Add firm-scoped policy for row-level reads via JWT
CREATE POLICY "firm_scoped_read" ON screened_leads
  FOR SELECT USING (
    firm_id = (current_setting('request.jwt.claims', true)::jsonb->>'firm_id')::uuid
  );
```

### G-2 — No firm_decline_templates rows

`firm_decline_templates` has 0 rows. All decline copy (Pass, OOS, backstop) resolves to system fallback:
- Subject: "Re: your inquiry"
- Body: generic neutral text

The system fallback copy is LSO Rule 4.2-1 clean (no outcome promises, no specialist language). It is acceptable as a go-live default. Per-firm and per-PA templates should be added during onboarding for better client experience.

### G-3 — Existing screened_leads rows have intake_language = NULL

Two rows from before the multilingual migration have `intake_language = NULL`. Both are `status = 'taken'` so they never appear in the triage queue. No action needed. New rows get `'en'` from the application code.

### G-4 — Hartwell demo firm missing branding.firm_name

The portal header for Hartwell shows "Client Portal" because `branding.firm_name` is null. This is a demo fixture issue, not a DRG issue.

---

## Verified PASS details

### Schema (Step 1 partial)

`screened_leads` has all 30 required columns including `intake_language TEXT` and `raw_transcript TEXT` added by migration `20260512_intake_language_and_raw_transcript`. The lifecycle CHECK constraint (`triaging / taken / passed / declined`) is present. All required indexes applied per `20260505_screened_leads_dashboard_indexes`.

`webhook_outbox` schema complete: `idempotency_key`, `status`, `attempts`, `max_attempts`, `next_attempt_at`, `sent_at`, `failed_at`, `last_error`, `last_http_status`.

`firm_decline_templates` schema present, zero rows (see G-2).

### pg_cron jobs (Step 8 partial)

Both cron jobs are active:
- `triage-backstop-hourly` — `7 * * * *` — calls `cron_internal.call_cron_route('/api/cron/triage-backstop')`
- `webhook-retry-5m` — `*/5 * * * *` — calls `cron_internal.call_cron_route('/api/cron/webhook-retry')`

`cron_internal.call_cron_route()` function exists. pg_net extension is present. Jobs fire automatically without Vercel Pro dependency.

**Note:** The `ghl-webhook-contract.md` says backstop cron runs "every 15 minutes" but the job runs hourly at minute 7 (`7 * * * *`). The spec says 48h decision window with the comment noting that a daily backstop introduces 24h of decline-latency. The hourly schedule is the right choice. The contract doc has a stale sentence.

### Auth model (Step 2 partial)

`portal-auth.ts` is correct:
- HMAC-SHA256, base64url encoding, `payload.sig` split on last dot
- Backward-compatible: missing `role` field defaults to `'lawyer'`
- Session cookie: `httpOnly: true`, `secure: true` in production, `sameSite: 'lax'`, `path: '/'` (the Phase 3 fix that corrected 401s on `/api/portal/*` fetches from client components)
- Link TTL: 48h; session TTL: 30 days (720h)
- `getFirmSession` rejects operator sessions (they use `/admin/*`)
- `getOperatorSession` available for admin routes

`request-link` route resolution:
1. Checks `firm_lawyers` (canonical, multi-lawyer, role-aware) first
2. Falls back to `intake_firms.branding.lawyer_email` (legacy)
3. Always returns `{ ok: true }` — enumeration-resistant

### Webhook outbox (Step 9 partial)

Backoff schedule (from `webhook-outbox-pure.ts`):
- Attempt 0→1: 30s
- Attempt 1→2: 2m
- Attempt 2→3: 8m
- Attempt 3→4: 32m
- Attempt 4→5: 2h8m (capped at 6h)
- After 5 attempts: `status = 'failed'`

`fireGhlWebhook()` is a deprecated alias for `deliverWebhook()` — all Take/Pass/backstop calls go through the outbox. Idempotency on `(lead_id, action)` unique key. Duplicate fire returns existing row, no re-attempt.

### Take / Pass actions (Steps 5-6 partial)

**Race condition guard:** Both routes use `.eq("status", "triaging")` on the UPDATE. If a concurrent action already moved the row, the update affects 0 rows and the webhook does not fire. The DB row is in the correct final state.

**Take idempotency:** Already-`taken` returns `{ ok: true, already: true, status: "taken" }`. Non-`triaging` states return 409.

**Pass three-layer resolution:** `loadDeclineCandidates` → `resolveDecline` → `buildPassedPayload`. `decline_template_source` field in webhook payload distinguishes resolution path.

**Missing `intake_language` in `take` route fetch:** The `take/route.ts` selects `contact_name, contact_email, contact_phone, brief_json` but does NOT select `intake_language`. The built payload calls `buildTakenPayload` which reads from `LeadFacts`. `LeadFacts` does not include `intake_language`. The GHL webhook envelope includes `intake_language` per contract v2 — but the `taken` webhook fires WITHOUT it (it won't be in the payload). This is a **small bug**.

### OOS auto-fire (Step 7 partial)

`computeInitialStatus('out_of_scope')` returns `{ status: 'declined', changedBy: 'system:oos' }`. The insert uses this directly. The OOS webhook fires via `waitUntil(fireGhlWebhook(...))` — async, non-blocking, goes through the outbox.

The notification email is correctly skipped: `if (inserted.status === "triaging")` guard means OOS leads (which insert as `declined`) never trigger `notifyLawyersOfNewLead`.

### Tenant isolation (Step 10 partial)

Application-layer:
- `take/route.ts`: loads row, checks `existing.firm_id !== firmId` → 404
- `pass/route.ts`: same
- `portal/[firmId]/triage/[leadId]/page.tsx`: `data.firm_id !== firmId` → `notFound()`
- `portal/[firmId]/layout.tsx`: `session.firm_id !== firmId` → redirect to login
- `portal/[firmId]/triage/page.tsx`: Supabase query uses `.eq("firm_id", firmId)` — correct

All application-layer paths correctly enforce firm isolation. DB-layer RLS is absent (see G-1).

### Compliance pages (Step 12)

- `/privacy` (src/app/privacy/page.tsx): PIPEDA, retention table matches `data-retention.ts` (A/B=1095d, C=365d, D=180d, E=30d, null=90d). No outcome promises. No banned vocabulary. Footer links to `/terms`.
- `/terms` (src/app/terms/page.tsx): LSO Rule 4.2-1 calibrated. Lawyer-client relationship framed between lead and engaged firm. No specialist language. No outcome promises.
- Portal footer (`portal/[firmId]/layout.tsx`): Links to `/privacy` and `/terms`.

### Multilingual fields (Step 13)

- `screened_leads.intake_language` and `.raw_transcript` columns exist (migration applied).
- Queue card (`triage/page.tsx`): calls `intakeLanguageLabel(row.intake_language)` — shows blue badge for non-English.
- Brief page: `langLabel && <LanguageCallout label={langLabel} />` — callout above brief for non-English.
- Brief page language callout text: "The brief is translated to English. Original-language text preserved in the raw transcript." — correct.
- `lead-notify.ts`: passes `intakeLanguage` to `buildNewLeadEmail` — notification email includes language note.
- GHL webhook `CommonEnvelope` includes `intake_language` per contract v2. BUT: the `buildTakenPayload` / `LeadFacts` do not include `intake_language` (the field is not fetched in the take/pass routes). The webhook fires with `intake_language` absent when intake_language is needed in the envelope. See small bug below.

---

## Small bug requiring a fix

### Bug: `intake_language` missing from webhook payloads for Take/Pass/Backstop

**Where:** `src/app/api/portal/[firmId]/triage/[leadId]/take/route.ts`, `pass/route.ts`, `src/app/api/cron/triage-backstop/route.ts`, and `src/lib/ghl-webhook-pure.ts`.

**What:** The webhook contract v2 requires `intake_language` in every common envelope payload. The `LeadFacts` interface and all payload builders (`buildTakenPayload`, `buildPassedPayload`, `buildDeclinedBackstopPayload`) do not include `intake_language`. The three action routes do not select `intake_language` from `screened_leads` when loading the lead. Only `buildDeclinedOosPayload` may or may not include it (not read).

The OOS path in `intake-v2/route.ts` has `body.intake_language` available but `buildDeclinedOosPayload` does not receive it either.

**Impact:** GHL workflows that branch on `intake_language` for language-capable routing (a documented use case in `ghl-webhook-contract.md`) will not work for Take, Pass, or backstop actions. They will always see `undefined`/missing rather than the ISO 639-1 code. For a multilingual intake system serving Toronto's 250+ mother-tongue market, this breaks the cadence routing for non-English leads.

**Fix:** See fix section below.

---

## Fix applied: intake_language in webhook payloads

`ghl-webhook-pure.ts` already had `intake_language?: string | null` in `LeadFacts` and `intake_language: facts.intake_language ?? 'en'` in `buildEnvelope`. The bug was that four callers never populated the field.

Changes applied (all 1534 unit tests pass after):

**`src/app/api/portal/[firmId]/triage/[leadId]/take/route.ts`**
- Added `intake_language: string | null` to `LeadRow` interface
- Added `intake_language` to the `.select(...)` query
- Added `intake_language: lead.intake_language` to `facts`

**`src/app/api/portal/[firmId]/triage/[leadId]/pass/route.ts`**
- Same three changes as take route

**`src/app/api/cron/triage-backstop/route.ts`**
- Added `intake_language: string | null` to `TriagingRow` interface
- Added `intake_language` to the `.select(...)` query
- Added `intake_language: row.intake_language` to `facts`

**`src/app/api/intake-v2/route.ts`**
- Added `intake_language: body.intake_language ?? 'en'` to the OOS `facts` object

**`docs/ghl-webhook-contract.md`**
- Corrected "runs every 15 minutes" → "runs hourly at minute 7" (pg_cron `7 * * * *`)

---

## Definition of done — status

| Criterion | Status |
|---|---|
| Step 1 (env + fixtures) | BLOCKED — no DRG firm |
| Step 2 (magic link flow) | BLOCKED — no firm_lawyers lawyer row |
| Step 3 (queue renders) | CODE PASS — untested in browser (local dev broken) |
| Step 4 (brief page) | CODE PASS — untested in browser |
| Step 5 (Take action) | CODE PASS — untested end-to-end |
| Step 6 (Pass action) | CODE PASS — untested end-to-end |
| Step 7 (OOS auto-fire) | CODE PASS |
| Step 8 (backstop cron) | CODE PASS — pg_cron active |
| Step 9 (webhook retry) | CODE PASS — pg_cron active |
| Step 10 (tenant isolation) | APP LAYER PASS / DB LAYER GAP |
| Step 11 (notification email) | CODE PASS — no recipients configured for DRG |
| Step 12 (compliance pages) | PASS |
| Step 13 (multilingual) | SCHEMA PASS — bug fixed in webhook payloads |
| Step 14 (cleanup) | N/A — no test fixtures inserted |

---

## Recommendations for operator (priority order)

1. **[Blocking]** Create DRG firm record in `intake_firms` with `ghl_webhook_url`, `branding.firm_name`, `practice_areas`, `geo_config`.
2. **[Blocking]** Insert `firm_lawyers` row for Damaris (role='lawyer'). Invite trigger fires automatically.
3. **[Blocking]** Fix local dev environment (move project to C: drive, enable Developer Mode, or use WSL2) to enable end-to-end browser testing before go-live.
4. **[High]** Add RLS policies on `screened_leads`, `webhook_outbox`, `firm_decline_templates` before onboarding a second firm.
5. **[Medium]** Add per-firm and per-PA decline templates to `firm_decline_templates` for DRG during onboarding.
6. **[Low]** Correct the stale sentence in `ghl-webhook-contract.md` ("every 15 minutes" → "hourly at minute 7").
