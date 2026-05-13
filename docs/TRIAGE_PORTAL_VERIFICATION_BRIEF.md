# Lawyer Triage Portal · Verification Brief

**Audience:** Next Claude session in the `caseload-select-app` codebase.
**Drafted:** 2026-05-12
**Estimated effort:** 3-4 hours autonomous verification + small fixes
**Status:** Ready to execute. Triage portal was built per CRM Bible v5 era and marked DONE; this brief verifies it actually works end-to-end before DRG go-live.

---

## Mission

The Lawyer Triage Portal is Damaris's daily-driver tool at DRG. She uses it hourly: review incoming briefs, decide Take or Pass per lead. CLAUDE.md asserts it's built. This brief verifies it works end-to-end for a fresh firm setup (DRG) before go-live.

This is **verification + small fixes**, not new feature work. Identify what's broken; patch what's small; report what's bigger.

---

## Read these first

| File | Why |
|---|---|
| `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-app\CLAUDE.md` § Lawyer Triage Portal | The canonical spec for what should exist |
| `docs/ghl-webhook-contract.md` | The outbound webhook payload spec |
| `D:\00_Work\01_CaseLoad_Select\CLAUDE.md` § Language Position | Doctrine; the portal may need multilingual updates after the overnight screen build lands |
| `src/app/portal/[firmId]/triage/page.tsx` | Queue page |
| `src/app/portal/[firmId]/triage/[leadId]/page.tsx` | Brief view |
| `src/lib/portal-auth.ts` | HMAC magic link auth |
| `src/lib/decline-resolver-pure.ts` | Three-layer decline copy resolution |
| `src/lib/webhook-outbox-pure.ts` | At-least-once delivery + backoff |
| `src/lib/intake-v2-derive.ts` | Timer / whale / initial-status derivation |

---

## Goals (acceptance criteria)

Verification is complete when all of these hold:

1. **Magic link flow works end-to-end.** A fresh lawyer email at DRG receives a magic link via Resend, click lands them on the queue page, session persists 30 days.

2. **Queue renders correctly.** Briefs sort Band A → B → C with decision deadline tiebreaker. `?band=A|B|C` filter works. Cards show first name + last initial, practice area, CPI band badge, days in stage / decision deadline.

3. **Brief page renders correctly.** Single-lead view shows `brief_html` verbatim. DecisionTimer counts down. Sticky Take/Pass action bar visible.

4. **Take action fires the right webhook.** Pressing Take on a triaging brief: (a) flips status to `taken`, (b) inserts a `taken` action row into `webhook_outbox`, (c) delivers payload to the configured GHL webhook URL with correct envelope + action-specific fields.

5. **Pass action fires the right webhook.** Pressing Pass with a per-lead note: resolves decline copy with the note as override → fires `passed` webhook with `decline_subject` + `decline_body` populated.

6. **OOS auto-fire works.** A brief with `matter_type='out_of_scope'` lands in screened_leads with `status='declined'` (never enters triaging) and fires a `declined_oos` webhook.

7. **Backstop cron works.** A brief with `decision_deadline < now()` and `status='triaging'` gets flipped to `declined` by the hourly backstop cron and fires `declined_backstop` webhook.

8. **Webhook delivery survives transient failures.** Simulated 500 response from GHL endpoint triggers retry via `webhook_outbox` exponential backoff. Manual retry endpoint works.

9. **Tenant isolation enforced.** A lawyer-role token for DRG cannot access another firm's triage queue or brief. Verified via RLS test against a second test firm record.

10. **New-lead notification email fires.** Inserting a triaging row triggers the fan-out email to all `firm_lawyers` rows with `role='lawyer'` for the firm.

11. **Compliance pages render.** `/privacy` and `/terms` load with the correct content. Footer links from portal pages reach them.

12. **(Post-multilingual-build) Language fields surface.** Once `intake_language` exists on `screened_leads`, the brief view shows "Language of communication" and the queue card shows a language badge for non-English briefs.

---

## In scope / out of scope

**In scope:**
- End-to-end verification of every portal flow (magic link, queue, brief, take, pass, OOS, backstop, notification, compliance)
- Small fixes for defects found (typos, broken styling, missing fallbacks, bad copy)
- Tenant isolation testing
- Webhook delivery testing (against a mock GHL endpoint if DRG's P4 INBOUND isn't built yet)

**Out of scope:**
- Client Dashboard (`/portal/[firmId]/dashboard`, `/pipeline`, `/phases`) — covered separately in Path 2/3 doctrine work
- New features or KPIs
- Performance optimization
- Major refactors
- P4 INBOUND build itself (the webhook destination — separate session)

---

## Verification steps

### Step 1 · Environment + test setup

Confirm prerequisites:

- [ ] Local dev server runs (`npm run dev`)
- [ ] Supabase connection healthy (`supabase status`)
- [ ] Resend API key present in `.env.local`
- [ ] DRG firm record exists in `intake_firms` table
- [ ] DRG firm's `ghl_webhook_url` either points to a real GHL endpoint OR to a mock endpoint for this test (a webhook.site URL works for verification)

Create or confirm test fixtures in Supabase:

```sql
-- A firm_lawyers row for the test lawyer
INSERT INTO firm_lawyers (firm_id, email, role)
VALUES (
  '<DRG firm uuid>',
  'verify-test@example.com',  -- use your own test inbox here
  'lawyer'
);

-- Three triaging briefs in different bands
INSERT INTO screened_leads (firm_id, lead_id, status, band, matter_type, brief_html, decision_deadline, /* ... */)
VALUES
  ('<DRG firm uuid>', 'L-VERIFY-001', 'triaging', 'A', 'corporate', '<p>Test Band A brief</p>', now() + interval '12 hours'),
  ('<DRG firm uuid>', 'L-VERIFY-002', 'triaging', 'B', 'family',    '<p>Test Band B brief</p>', now() + interval '24 hours'),
  ('<DRG firm uuid>', 'L-VERIFY-003', 'triaging', 'C', 'real_estate', '<p>Test Band C brief</p>', now() + interval '48 hours');

-- One OOS brief (will fire declined_oos)
INSERT INTO screened_leads (firm_id, lead_id, status, band, matter_type, brief_html, /* ... */)
VALUES ('<DRG firm uuid>', 'L-VERIFY-OOS', 'declined', NULL, 'out_of_scope', '<p>Test OOS brief</p>');

-- One past-deadline triaging brief (for backstop test)
INSERT INTO screened_leads (firm_id, lead_id, status, band, matter_type, brief_html, decision_deadline, /* ... */)
VALUES ('<DRG firm uuid>', 'L-VERIFY-BACKSTOP', 'triaging', 'B', 'litigation', '<p>Past deadline</p>', now() - interval '1 hour');
```

### Step 2 · Magic link flow

- [ ] `POST /api/portal/request-link` with body `{"email": "verify-test@example.com"}` returns 200 (always 200 to prevent enumeration, per app CLAUDE.md)
- [ ] Resend dashboard shows the magic link email queued/sent within 60 seconds
- [ ] Email lands in test inbox (verify SPF/DKIM/DMARC pass; check Mail-Tester score if first time on this sender)
- [ ] Email subject and body match the canonical template (or document if drift)
- [ ] Magic link URL has correct structure: token + firm_id + role
- [ ] Click magic link → lands at `/portal/<DRG firm uuid>/triage`
- [ ] Session cookie set: httpOnly, path=/portal, 30-day expiry, secure flag in prod

**Expired link test:**
- [ ] Generate a token, wait 48h+ (or manually backdate the HMAC), click → expect graceful error page with re-request CTA

**Cross-firm test:**
- [ ] Generate a token for firm A, paste into URL with firm B's UUID → expect 403 or redirect to firm A

### Step 3 · Queue page

Navigate to `/portal/<DRG firm uuid>/triage`:

- [ ] Three triaging briefs visible (L-VERIFY-001, 002, 003)
- [ ] Sort order: Band A (001) first, Band B (002) second, Band C (003) third
- [ ] Each card shows: first name + last initial (e.g., "John D."), practice area, CPI band badge, days in stage OR decision deadline countdown
- [ ] Click into Band A card → navigates to `/portal/<firm>/triage/L-VERIFY-001`

**Filter test:**
- [ ] Navigate to `/portal/<firm>/triage?band=A` → only L-VERIFY-001 visible
- [ ] `?band=B` → only 002
- [ ] `?band=C` → only 003

**Auto-refresh test:**
- [ ] Insert a new triaging brief via SQL: `INSERT INTO screened_leads (...) VALUES (..., 'L-VERIFY-004', 'triaging', 'A', ...)`
- [ ] Switch tab away from the queue, then back → RefreshOnFocus should re-fetch and 004 appears

### Step 4 · Brief page

Navigate to `/portal/<firm>/triage/L-VERIFY-001`:

- [ ] `brief_html` renders verbatim in the brief pane
- [ ] DecisionTimer shows live countdown (e.g., "11h 47m remaining")
- [ ] Sticky TriageActionBar at bottom shows Take and Pass buttons
- [ ] Brief CSS scoped to the brief pane (no global style bleed)

**Operator view test:**
- [ ] Sign in as operator role (or impersonate via `/admin/triage`)
- [ ] Open `phase_c_test_j6` or any brief → "Operator view" banner visible at top

### Step 5 · Take action

On L-VERIFY-001 brief page:

- [ ] Click Take button
- [ ] UI shows success state (toast or page redirect)
- [ ] Supabase: `SELECT status FROM screened_leads WHERE lead_id = 'L-VERIFY-001'` returns `taken`
- [ ] Supabase: `SELECT * FROM webhook_outbox WHERE lead_id = 'L-VERIFY-001' AND action = 'taken'` returns one row
- [ ] Webhook payload (inspect `webhook_outbox.payload`) matches `docs/ghl-webhook-contract.md` taken-action schema
- [ ] Within 5 minutes (or after manual retry), `webhook_outbox.status` shows `delivered` (assumes mock endpoint returns 200)

**Idempotency test:**
- [ ] Try to Take a second time on the same lead → expect 409 or graceful "already taken" error
- [ ] `webhook_outbox` has one row for this `(lead_id, action)`, not two

### Step 6 · Pass action

On L-VERIFY-002 brief page:

- [ ] Click Pass
- [ ] UI prompts for optional note (per-lead override copy)
- [ ] Enter a test note: "Out of practice area focus; refer to family-law specialist"
- [ ] Submit
- [ ] Supabase: status = `passed`
- [ ] `webhook_outbox` row with `action='passed'`
- [ ] Webhook payload includes `decline_subject` and `decline_body`
- [ ] If the note was provided, body uses the per-lead override (not the per-PA fallback)

**Empty-note test (firm default fallback):**
- [ ] On L-VERIFY-003, click Pass, leave note empty, submit
- [ ] Webhook payload's `decline_body` matches the firm's default decline copy from `firm_decline_templates` for `firm_id='<DRG>'` and `practice_area='real_estate'`
- [ ] If no per-PA row, falls back to firm default (`practice_area=NULL` row)
- [ ] If no firm default, falls back to system default

### Step 7 · OOS auto-fire

Verify that OOS leads bypass triaging:

- [ ] `SELECT status FROM screened_leads WHERE lead_id = 'L-VERIFY-OOS'` should already be `declined` (set during Step 1 fixture insert)
- [ ] Check `webhook_outbox` for this lead_id with `action='declined_oos'`
- [ ] If the outbox row doesn't exist, simulate the full intake-v2 path:

```bash
curl -X POST http://localhost:3000/api/intake-v2 \
  -H 'Content-Type: application/json' \
  -d '{
    "firm_id": "<DRG firm uuid>",
    "lead_id": "L-VERIFY-OOS-2",
    "matter_type": "out_of_scope",
    "practice_area": "criminal",
    "brief_html": "<p>OOS test</p>"
  }'
```

- [ ] Verify the row is inserted with `status='declined'` directly (never `triaging`)
- [ ] `webhook_outbox` has a `declined_oos` action row
- [ ] Webhook body references the practice_area in the decline copy

### Step 8 · Backstop cron

- [ ] L-VERIFY-BACKSTOP fixture exists with `decision_deadline = now() - interval '1 hour'`
- [ ] Manually invoke the backstop cron: `GET http://localhost:3000/api/cron/triage-backstop` with the bearer token
  ```bash
  curl -X GET http://localhost:3000/api/cron/triage-backstop \
    -H "Authorization: Bearer <CRON_SECRET or PG_CRON_TOKEN>"
  ```
- [ ] Response status 200, body indicates 1+ rows processed
- [ ] Supabase: `SELECT status FROM screened_leads WHERE lead_id = 'L-VERIFY-BACKSTOP'` returns `declined`
- [ ] `webhook_outbox` has a `declined_backstop` action row
- [ ] If running locally, optionally verify the Supabase pg_cron job is scheduled (`SELECT * FROM cron.job WHERE jobname = 'triage-backstop-hourly'`)

### Step 9 · Webhook outbox retry behavior

Simulate transient failure:

- [ ] Set DRG's `ghl_webhook_url` to a URL that returns 500 (e.g., `https://httpstat.us/500`)
- [ ] Take action on a fresh brief → expect webhook row inserted, first attempt fails
- [ ] Wait 5+ minutes for retry cron, or invoke manually: `curl /api/cron/webhook-retry`
- [ ] Check `webhook_outbox.attempts` field increments
- [ ] Exponential backoff respected (see `webhook-outbox-pure.ts` for the schedule)
- [ ] After max attempts (5 per app CLAUDE.md), row status = `failed`
- [ ] Failed row visible in `/admin/webhook-outbox`
- [ ] Manual retry via `POST /api/admin/webhook-outbox/<outboxId>/retry` resets attempts to 0 and re-queues

### Step 10 · Tenant isolation

Create a second test firm:

```sql
INSERT INTO intake_firms (id, name, ...)
VALUES ('00000000-0000-0000-0000-000000000099', 'Test Firm B', ...);

INSERT INTO firm_lawyers (firm_id, email, role)
VALUES ('00000000-0000-0000-0000-000000000099', 'firm-b-lawyer@example.com', 'lawyer');

INSERT INTO screened_leads (firm_id, lead_id, status, ...)
VALUES ('00000000-0000-0000-0000-000000000099', 'L-VERIFY-FIRM-B', 'triaging', ...);
```

- [ ] Sign in as DRG lawyer (`verify-test@example.com`)
- [ ] Try to access `/portal/00000000-0000-0000-0000-000000000099/triage` → expect 403 or redirect to DRG
- [ ] Try to access `/portal/<DRG>/triage/L-VERIFY-FIRM-B` → expect 404 (lead not in DRG's firm scope)
- [ ] Verify via Supabase RLS test:
  ```sql
  SET request.jwt.claims = '{"firm_id": "<DRG firm uuid>", "role": "lawyer"}';
  SELECT * FROM screened_leads;  -- should only return DRG rows
  ```

**Operator cross-firm test:**
- [ ] Sign in as operator (cross-firm role)
- [ ] Access both `/portal/<DRG>/triage` and `/portal/<firm B>/triage` → both load
- [ ] "Operator view" banner visible on both

### Step 11 · New-lead notification email

- [ ] Insert a fresh triaging row:
  ```sql
  INSERT INTO screened_leads (firm_id, lead_id, status, band, matter_type, brief_html, ...)
  VALUES ('<DRG>', 'L-VERIFY-NOTIFY', 'triaging', 'A', 'corporate', '<p>Notification test</p>');
  ```
- [ ] Within 60 seconds, an email lands in `verify-test@example.com`'s inbox
- [ ] Email content references the lead's first name, band, matter type, and a link to the brief
- [ ] If `firm_lawyers` has multiple lawyers for the firm, all of them receive the email (fan-out)
- [ ] If `firm_lawyers` has zero rows for the firm but `intake_firms.branding.lawyer_email` is set, that legacy email receives the notification (fallback)

### Step 12 · Compliance pages

- [ ] Navigate to `/privacy` → page loads, PIPEDA-aware retention table renders
- [ ] Retention table values match `lib/data-retention.ts` (A/B = 1095d, C = 365d, D = 180d, E = 30d, null = 90d)
- [ ] Navigate to `/terms` → LSO Rule 4.2-1 calibrated copy renders
- [ ] No outcome promises in the terms copy
- [ ] No "specialist" or "expert" language
- [ ] Footer links from portal pages reach both `/privacy` and `/terms`

### Step 13 · (Conditional) Multilingual brief verification

**Only run this step if the overnight multilingual screen build has landed.**

- [ ] Insert a Portuguese brief:
  ```sql
  INSERT INTO screened_leads (firm_id, lead_id, status, intake_language, raw_transcript, brief_html, ...)
  VALUES (
    '<DRG>',
    'L-VERIFY-PT',
    'triaging',
    'pt',
    'quero abrir uma empresa no canada\n\nJust me',
    '<p>Wants to open a business in Canada. Lead is a single founder.</p>',
    ...
  );
  ```
- [ ] Queue page shows L-VERIFY-PT card with a language badge (e.g., "PT" or "Portuguese")
- [ ] Brief page renders "Language of communication: Portuguese" prominently near the lead identity block
- [ ] `brief_html` renders in English (not raw Portuguese)
- [ ] If a "view raw transcript" affordance exists, it shows the original Portuguese
- [ ] New-lead notification email for this lead includes "Language: Portuguese"

### Step 14 · Cleanup

- [ ] Delete all `L-VERIFY-*` test rows from `screened_leads`
- [ ] Delete `webhook_outbox` rows for those lead_ids
- [ ] Delete the test `firm_lawyers` row for `verify-test@example.com`
- [ ] Delete the second test firm `00000000-0000-0000-0000-000000000099`
- [ ] Restore DRG's `ghl_webhook_url` to its real value if you changed it for retry testing
- [ ] Clear test inbox

---

## Failure modes to watch for

| Symptom | Likely cause | Where to check |
|---|---|---|
| Magic link email never arrives | Resend API key invalid, sender domain not verified, recipient filtering as spam | Resend dashboard → Logs; Mail-Tester.com |
| Magic link 403 on click | Token expired, HMAC verification mismatch | `src/lib/portal-auth.ts` → verification logic; check token timestamp vs current |
| Queue is empty when briefs exist | RLS misconfigured, firm_id mismatch on session, status filter wrong | Supabase: `SELECT * FROM screened_leads WHERE firm_id = '<DRG>' AND status = 'triaging'` |
| Queue sort wrong | Comparator broken | `src/lib/triage-sort.ts` |
| Take/Pass button does nothing | API route error not surfaced to UI | Browser dev tools network tab; server logs |
| Take action succeeds but webhook never fires | `webhook_outbox` row missing OR retry cron not running | `SELECT * FROM webhook_outbox WHERE lead_id = ...`; check pg_cron with `SELECT * FROM cron.job` |
| Webhook fires but GHL doesn't receive | `intake_firms.ghl_webhook_url` empty or wrong | `SELECT ghl_webhook_url FROM intake_firms WHERE id = '<DRG>'` |
| Decline copy resolves to system default when per-PA exists | Resolver short-circuiting | `src/lib/decline-resolver-pure.ts`; trace through the three layers |
| Backstop cron never fires | Supabase pg_cron not scheduled, or token mismatch | `SELECT * FROM cron.job WHERE jobname = 'triage-backstop-hourly'`; check Vault for `pg_cron_token` |
| Lawyer A sees lawyer B's firm data | RLS not enabled or policy wrong | `SELECT * FROM pg_policies WHERE tablename = 'screened_leads'`; manually test as different roles |
| Notification email goes to wrong address | `firm_lawyers` empty AND `branding.lawyer_email` set wrong | Both tables; verify fallback chain in `lib/lead-notify.ts` |
| Mobile portal layout broken | Sticky action bar overflows, brief CSS doesn't scope properly | Browser dev tools mobile emulation; test 375px width |
| Multilingual badge missing | Overnight build hasn't landed yet, or queue card component not updated | Check `intake_language` column on screened_leads; check queue card component |

---

## Definition of done

- [ ] All 13 verification steps executed (step 13 may be N/A if multilingual build not yet landed)
- [ ] Every failure mode either confirmed working or has a specific fix applied
- [ ] Small fixes (typos, broken styling, fallback paths) committed with clear commit messages
- [ ] Bigger gaps (architectural issues, missing functionality) documented in `TRIAGE_PORTAL_VERIFICATION_GAPS.md` for the operator to triage
- [ ] Test fixtures cleaned up (Step 14)
- [ ] DRG `ghl_webhook_url` restored
- [ ] Verification result summary written to `TRIAGE_PORTAL_VERIFICATION_REPORT.md`:
  - What was verified PASS
  - What was verified FAIL with fix applied
  - What was verified FAIL with gap escalated
  - Recommendations for operator

---

## Operator notes (Adriano)

- This is verification, not new building. Don't extend features; just confirm what's there works
- DRG is the test target. If a real P4 INBOUND webhook endpoint isn't built yet at DRG's GHL, use webhook.site as the destination — verify the OUTBOUND payload is correct; the inbound side is a separate session
- The multilingual screen overnight build (`MULTILINGUAL_SCREEN_BUILD_PROMPT.md`) may run in parallel or before/after this. Step 13 of this brief is the multilingual-specific verification; skip if not yet built
- Resend deliverability: if the test email lands in spam, that's a real DRG go-live blocker. Note the issue but don't deep-dive into DNS — that's operator-side
- Tenant isolation is the most critical correctness test. RLS leakage = LSO compliance violation = client cancellation. Test thoroughly
- If anything looks majorly broken (e.g., the take action doesn't fire webhooks at all), stop and write to `TRIAGE_PORTAL_VERIFICATION_REPORT.md` with the symptom before deep-diving into a fix. Operator decides whether to fix or escalate

---

## Cross-references

- `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-app\CLAUDE.md` § Lawyer Triage Portal — the spec
- `docs/ghl-webhook-contract.md` — webhook payload contract being verified
- `docs/MULTILINGUAL_SCREEN_BUILD_PROMPT.md` — the parallel overnight build whose output Step 13 verifies
- `D:\00_Work\01_CaseLoad_Select\04_Playbooks\04_Screen\Playbooks\Phase_C_Master_Test_Runner_v1.md` — Phase C tests that run after this verification passes
- `D:\00_Work\01_CaseLoad_Select\04_Playbooks\04_Screen\Playbooks\Snapshot_Export_and_Multi_Firm_Rollout_v1.md` — the per-firm onboarding doc that depends on the triage portal working
