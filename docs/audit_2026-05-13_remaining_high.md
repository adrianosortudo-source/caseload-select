# Codex audit 2026-05-13 — remaining HIGH-severity items

**Context:** Codex ran two audits on 2026-05-13 (production app + sandbox, the second one ran against the production app because the auditor couldn't locate the sandbox repo). 16 of 25 actionable findings landed across four commits the same evening (9055052, 6217bb6, 0c5983c, eda35b3). This doc captures the four HIGH-severity items that were deliberately deferred because each requires careful, slightly larger work that should not be rushed at the end of a long day.

Pick these up first thing tomorrow morning before any other work. They unblock Block 2 (test asset creation + screencast demos) and tighten compliance posture for App Review submission.

---

## HIGH #1 — Widget cutover to /api/intake-v2

**File:** `src/components/intake-v2/IntakeControllerV2.tsx:296` (and adjacent fetches at lines 409, 452)

**Problem:** The production widget at `/widget/[firmId]` calls `/api/screen` for both conversation AND persistence. `/api/screen` writes to the legacy `leads` table only. The Screen 2.0 `screened_leads` invariant is never satisfied for web-channel intake. Triage portal (`/portal/[firmId]/triage`) shows nothing from the production web widget.

**Block 2 blocker:** Yes. Tomorrow's web-channel screencast requires a lead to appear in the triage portal after the widget runs. Cannot demo end-to-end until this lands.

**Two paths considered:**

1. **Server-side at /api/screen finalize (recommended, smaller blast radius):** When `/api/screen` returns `finalize: true`, also INSERT into `screened_leads` with the brief HTML rendered server-side from the existing situation_summary + slot data. No widget code change. Single endpoint, dual-write. Backwards-compatible with existing legacy-leads writes. Risk: server-side LawyerReport assembly differs from the sandbox-engine path; brief shape may drift from voice intake.

2. **Client-side via persist.ts call:** At the V2 widget's success state (right after OTP verification, before showing the band copy), call `persistScreenedLead()` from `src/lib/screen-engine/persist.ts`. This is the function the sandbox uses. Risk: the V2 widget doesn't run the sandbox engine; `EngineState` shape isn't naturally populated from `/api/screen` responses. Would need an adapter layer from ScreenResponse → EngineState.

**Recommended path:** option 1. Smaller, lower-risk, keeps `/api/screen` as the single conversational endpoint until the legacy v2.1 engine is fully retired.

**Implementation outline (option 1):**

- New helper `src/lib/screen-to-screened.ts`: `toScreenedLead(screenResponse, firmId, sessionMetadata): ScreenedLeadInsert` — maps `ScreenResponse.cpi` to four-axis scores, maps `situation_summary` + slot_answers to a minimal LawyerReport shape, renders a basic brief HTML (matches the triage portal's expected shape).
- In `/api/screen/route.ts`, at the finalize=true branch (search for where the legacy `leads` row gets written), additionally call `supabaseAdmin.from('screened_leads').upsert(...)` with the mapped row.
- Use `onConflict: 'lead_id'` so retries are idempotent.
- Fire the new-lead notification email after the screened_leads insert (existing `notifyNewLead()` already exists for /api/intake-v2 — reuse it).
- Fire the GHL "new_lead" webhook the same way /api/intake-v2 does.

**Acceptance:** After widget completes intake, a screened_leads row exists with status='triaging', brief_html rendered, contact details populated; the lead appears in `/portal/<firmId>/triage` within 5 seconds; the triage portal's brief detail page renders the brief without errors.

**Scope estimate:** 60-90 min focused work.

---

## HIGH #4 — Secure /api/intake-v2 write surface

**File:** `src/app/api/intake-v2/route.ts:111` (and surrounding CORS / handler)

**Problem:** Public CORS (`Access-Control-Allow-Origin: *`) + only firm UUID validation. Any origin can POST arbitrary `brief_html` and `brief_json` for any firm. The triage portal renders `brief_html` verbatim at `src/app/portal/[firmId]/triage/[leadId]/page.tsx:206`. An attacker can forge a brief, embed JavaScript or social-engineering text, and the lawyer sees it as if it came from a real intake.

**Block 2 blocker:** No, but App Review submission blocker — Meta will flag this on first review.

**Three layers needed:**

1. **Origin allow-list.** Read `NEXT_PUBLIC_APP_DOMAIN`, allow that domain plus any `intake_firms.custom_domain` value, plus `caseload-screen-v2.vercel.app` (the sandbox). All other origins get 403. Implement via a small `originAllowed(req, firmId)` helper that hits the same Supabase REST lookup the middleware already uses for custom domain resolution.

2. **Body schema validation (Zod).** Define `IntakeV2PayloadSchema` matching the persist.ts payload shape exactly: lead_id format, ISO timestamp, brief_json shape, brief_html length cap, contact fields, intake_language ISO-639-1, raw_transcript optional. Reject malformed bodies with 400 before any DB write.

3. **brief_html sanitize.** Use `isomorphic-dompurify` or `sanitize-html` to strip `<script>`, `on*=` handlers, `javascript:` URLs, iframe, object, embed. Allow the brief's known tags (h1-h4, p, ul, ol, li, strong, em, span with safe class attrs, div). Keep CSS class names from `brief.css` working. Sanitize at write time so the portal can keep rendering verbatim.

**Implementation outline:**
- New file `src/lib/intake-v2-security.ts` with `originAllowed()`, `IntakeV2PayloadSchema` (Zod), and `sanitizeBriefHtml()`.
- Update /api/intake-v2 POST handler: origin check → schema parse → sanitize brief_html → insert.
- Keep OPTIONS preflight permissive (returns 204 with the correct allow headers for the allowed origin).

**Acceptance:** Calls from `app.caseloadselect.ca` and from custom domains succeed. Calls from `evil.example.com` return 403. Calls with `<script>` in brief_html have the script stripped before DB write. Calls with malformed bodies return 400 with the Zod error.

**Scope estimate:** 90-120 min focused work.

---

## HIGH #7 — Authenticate /api/voice-intake

**File:** `src/app/api/voice-intake/route.ts:83`

**Problem:** Voice intake accepts unauthenticated public POSTs with `Access-Control-Allow-Origin: *`. Only firm UUID gating. Anyone with the firm's UUID (a non-secret value visible in widget embeds) can forge voice leads.

**Block 2 dependency:** GHL Voice AI sends the inbound call webhook. Adding auth requires coordinating a shared secret or signature scheme with GHL.

**Recommended approach:** HMAC-SHA256 over the request body with a per-firm shared secret stored in `intake_firms.voice_webhook_secret` (new column). GHL's webhook setting supports a custom `X-Signature` header (or similar — verify with GHL docs).

**Implementation outline:**

- New migration `20260514_voice_webhook_secret.sql`: `ALTER TABLE intake_firms ADD COLUMN voice_webhook_secret TEXT;`
- New helper `verifyVoiceWebhookSignature(rawBody, firmId, signatureHeader): Promise<boolean>` that loads the per-firm secret and checks `crypto.timingSafeEqual(expected, provided)`.
- Update /api/voice-intake POST handler: read raw body (not the parsed JSON), compute expected HMAC, compare. Reject 401 on mismatch.
- Opt-in via env: `VOICE_HMAC_REQUIRED=true` enables enforcement; default false during rollout. Once enabled per firm via the secret column, the route enforces.
- Tighten CORS: `Access-Control-Allow-Origin: <GHL origin>` (or strip entirely if GHL doesn't preflight).

**Coordinating with GHL:**
- Configure each firm's GHL sub-account "Voice webhook signature header" with the secret stored in `voice_webhook_secret`.
- Document in the per-firm onboarding playbook.

**Acceptance:** A POST with no `X-Signature` header is rejected 401 (when enabled). A POST with a valid HMAC is accepted. A POST with a stale or wrong HMAC is rejected 401. The /admin/health page surfaces the rejection count over the last 24h.

**Scope estimate:** 90-120 min focused work, plus 15-30 min GHL configuration per firm (one-time, in onboarding).

---

## HIGH #8 + #9 — Messenger + Instagram bidirectional engine wiring

**Files:** `src/app/api/messenger-intake/route.ts:145`, `src/app/api/instagram-intake/route.ts:163`

**Problem:** Both webhook receivers verify Meta signatures correctly, log the incoming message, and return 200. Neither runs the engine, generates a brief, or inserts into `screened_leads`. Inbound DMs are silently dropped.

**Block 2 dependency:** Yes. Tomorrow's Messenger + IG screencasts require an end-to-end flow that produces a screened_leads row. This finding is the largest of the four — it's not "wire the same path as voice" (the audit's recommendation) because Messenger and IG are BIDIRECTIONAL channels:

- Voice: GHL sends one webhook with the full transcript; the engine runs single-shot and writes one row.
- Messenger / IG: prospect sends DM #1 → webhook fires; we must reply asking follow-up questions → prospect sends DM #2 → another webhook fires → we accumulate state → eventually we have enough to generate a brief.

This requires:

1. Per-conversation session state (new table `messenger_sessions` or extend `screened_leads` with an `in_progress` status).
2. Outbound message sending via Meta Send API. Needs the page access token captured when the test FB Page is connected to the Meta App in Block 2 Phase 3.
3. Loop termination logic — when has the engine collected enough? Re-use the existing engine's finalize signal.
4. Idempotency on Meta's at-least-once webhook delivery (the same message can fire twice; dedupe by Meta's `mid`).

**Recommendation:** Defer to Block 2 itself rather than tonight. Block 2 Phase 5 in the runbook (`docs/Meta_App_Creation_Block2_Runbook.md`) already calls for "wire test assets into the app's intake plumbing" and assumes this work happens with the test FB Page in hand. Document the design ahead of time but build it in Block 2 with the test Page wired in so we can iterate against real Meta deliveries.

**Block 2 acceptance:** DM sent to the test FB Page → webhook fires → engine asks one follow-up question via Meta Send API → prospect replies → engine generates brief → screened_leads row appears in `/portal/<test-firm-id>/triage` with `channel='messenger'`. Same for Instagram with `channel='instagram'`.

**Scope estimate:** 4-6 hours, ideally split across two focused blocks (state + send API in one, brief generation + persistence in the other).

---

## Lower-priority remaining items

- Sandbox MEDIUM: Zod schema validation for /api/screen main LLM response + `slot_confidence` default to low. Belongs with HIGH #4's broader schema work — bundle together.
- Sandbox MEDIUM: SMS chunking + WhatsApp template/24h modeling in demo adapters. Polish for the sales demo; not production-blocking. Can wait until after Block 3 (App Review submission).
- Sandbox LOW: LawyerViewPanel static demo + emoji encoding. Cosmetic.
- LOW #1: Windows-compatible engine sync check. Add a PowerShell wrapper around `scripts/check-engine-sync.sh` so the script runs on Adriano's Windows workstation without WSL. ~30 min.
- LOW #2 + #3: Multilingual route-level persistence tests + Arabic end-to-end test. ~60 min. Real value but not urgent — the existing 1,534-test suite already covers the unit-level multilingual cases.

---

## Suggested order tomorrow morning

1. **HIGH #1 widget cutover** (60-90 min) — unblocks Block 2 web-channel screencast.
2. **HIGH #4 intake-v2 security** (90-120 min) — needed before App Review submission. Bundle the sandbox MEDIUM Zod work here.
3. **Block 2 Phase 1-4** (create test FB Page + test IG Business + provision WhatsApp test number) — runbook is ready.
4. **HIGH #8 + #9 Messenger + IG wiring** during Block 2 Phase 5 with the test Page in hand.
5. **HIGH #7 voice HMAC** — pair with GHL configuration during the test firm GHL sub-account setup (Block 2 Phase 8).

If steps 1 + 2 land before 11am Adriano-time, Block 2 has clean prerequisites and the rest of the day is the test-asset + screencast work that needs to happen for App Review.

---

## What landed tonight (for context when picking back up tomorrow)

| Commit | Scope |
|---|---|
| `9055052` | Compliance copy: V2 widget band/retainer copy removed, IdentityCard timing fixed, legacy widget band-A exposure stripped |
| `6217bb6` | Engine prompts: DR-036 English-at-lawyer enforced, role wording neutralized, persist.ts now carries intake_language + raw_transcript, voice OOS envelope includes language, language detector skip in slot merge, portal-auth uses timingSafeEqual |
| `0c5983c` | Retention + DSR: screened_leads anonymization on the daily 3am cron, purgeLeadPii covers both legacy uuid and screened_leads lead_id, outbox payloads anonymized too |
| `eda35b3` | Gemini retry + backoff (3 attempts, 400/1200ms gaps, transient-error classifier), legacy /api/screen caller telemetry, IntakeWidget per-tab localStorage nonce |
| `feb081f` | **HIGH #1 widget cutover** — server-side dual-write at /api/screen finalize creates screened_leads row for legacy widget traffic, neutral band CTAs replace LSO-violating timing/retainer promises. Plus /api/whatsapp-intake scaffold for Block 2. |
| `9932f78` | **HIGH #4 intake-v2 security** — origin allow-list + Zod-style body validator + brief_html sanitizer. POSTs from non-allow-listed origins now get 403; malformed bodies get 400 with issue list; brief_html stripped of <script>, on*=, javascript: schemes before insert. |
| `243ceaf` | Vercel build fix: TypeScript reconciliation on the CORS headers union and band-type narrowing. |
| `0e468e3` | LOW #1 PowerShell wrapper for scripts/check-engine-sync.ps1 (Windows-native engine-sync check) |
| `6fe18e1` | **84 unit tests** for screen-to-screened + intake-v2-security helpers + localhost-port bug fix surfaced by the tests |
| `2cb5b7e` | **HIGH #7 voice HMAC** — verifyVoiceWebhookSignature() helper + soft-enforce wiring in /api/voice-intake. Code is dormant until the migration applies + per-firm secret is set + VOICE_HMAC_REQUIRED=true. 17 unit tests cover the rollout matrix. |
| `326bd63` | Sandbox MEDIUM: slot_confidence defaults to "low" instead of "medium" on /api/screen so unconfirmed model guesses no longer auto-apply. |

**22 of 25 actionable findings closed tonight.**

### Updated remaining HIGH items

- **HIGH #1 widget cutover** — DONE in commit `feb081f`. Web-channel screencast tomorrow now produces a real screened_leads row.
- **HIGH #4 intake-v2 security** — DONE in commit `9932f78`. Verified live in production via curl: hostile origin → 403, legit origin → ACAO echoed.
- **HIGH #7 voice-intake HMAC** — Code DONE in commit `2cb5b7e` (soft-enforce). To activate per-firm tomorrow during Block 2 Phase 8 GHL sub-account setup:
  1. Apply migration `supabase/migrations/20260513_voice_webhook_secret.sql` via Supabase SQL editor.
  2. `UPDATE intake_firms SET voice_webhook_secret = '<base64-32-bytes>' WHERE id = '<test-firm-id>'`
  3. Configure that secret as the X-CLS-Voice-Signature header value in the firm's GHL voice webhook.
  4. After confirming a test call lands cleanly, set `VOICE_HMAC_REQUIRED=true` in Vercel Production.
- **HIGH #8 + #9 Messenger + IG bidirectional engine wiring** — STILL deferred to Block 2 Phase 5 (test FB Page required, 4-6 hr scope). Unchanged from the original plan.

### Remaining LOW / MEDIUM items

- Sandbox MEDIUM SMS chunking + WhatsApp template/24h modeling in demo adapters — demo polish, cosmetic
- Sandbox LOW LawyerViewPanel static demo + emoji encoding — cosmetic
- LOW #2 + #3 Route-level multilingual + Arabic E2E tests — covered partly by the 84 unit tests landed tonight, full route-level still queued

Tomorrow's clean prerequisite for Block 2: web + intake-v2 + voice channels are all locked down. Messenger + IG remain to wire during Block 2 itself with the test FB Page.
