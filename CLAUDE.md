# CaseLoad Select — App Context

## Product

**Name:** CaseLoad Select
**Tagline:** Sign Better Cases
**Domain:** caseloadselect.ca | app.caseloadselect.ca
**Operator:** Adriano Domingues (sole operator, senior communications strategist)
**ICP:** Sole practitioners and 2-lawyer Toronto firms, growing fast, no internal marketing staff

CaseLoad Select is a done-for-you case-acquisition and selection system for Canadian law firms. The core insight: the real pain is not lead volume, it is filtering. Every inquiry looks identical at the door. The $100k case and the tire-kicker arrive the same way. CaseLoad Select scores, filters, and routes leads automatically so lawyers only see cases worth their time.

This repo contains two products:
1. **CaseLoad Select App** — CRM, pipeline, sequences, dashboard, operator tools
2. **CaseLoad Screen Engine** — GPT-powered intake screening, scoring, embeddable widget

## Operator Model

Adriano operates the system for client firms. This is done-for-you, not self-serve SaaS. Firms never access admin panels. "Firm onboarding" means Adriano's setup checklist (Clio OAuth, practice areas, pipeline stages, Google review link, branding, intake form config). Build for operator efficiency, not firm self-service.

The Client Portal (S8) IS client-facing but configured and deployed by Adriano.

## Method: The FACT System

- **F — Filter (CaseLoad Screen):** Automated intake scoring and qualification before attorney contact
- **A — Authority:** Content and reputation system (long-term compounding)
- **C — Capture:** SEO, GBP, local visibility infrastructure
- **T — Target:** Precision Google Ads

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 13+ (App Router) + TypeScript + Tailwind CSS |
| Database | Supabase (PostgreSQL) |
| Email | Resend |
| Auth | Supabase Auth |
| AI Screening | OpenAI GPT-4o-mini |
| SMS/Phone | GoHighLevel (GHL) |
| Hosting | Vercel |
| Legal PMS | Clio Manage (API v4) |

Supabase URL: https://qpzopweonveumvuqkqgw.supabase.co

## Architecture

```
src/
├── app/
│   ├── api/
│   │   ├── screen/route.ts          # CaseLoad Screen AI endpoint
│   │   ├── leads/route.ts           # Leads CRUD
│   │   ├── sequences/route.ts       # Sequence management
│   │   ├── otp/send/route.ts        # OTP verification
│   │   └── cron/
│   │       ├── persistence/route.ts       # Lead persistence automation (WF-03)
│   │       ├── stalled-retainer/route.ts  # Stalled retainer detection (WF-06)
│   │       ├── no-show/route.ts           # No-show handling (WF-05)
│   │       └── incomplete-intake/route.ts # Incomplete intake nudge (v2.2)
│   ├── pipeline/Board.tsx           # Kanban pipeline view (7 stages)
│   ├── leads/new/Form.tsx           # Lead creation form
│   ├── widget/[firmId]/page.tsx     # Embeddable per-firm intake widget
│   └── sequences/[id]/SequenceEditor.tsx
├── components/
│   └── intake/IntakeWidget.tsx      # 5-step intake form (CaseLoad Screen)
└── lib/
    ├── scoring.ts         # Priority Scoring Engine v2.1 + Explainability v2.2
    ├── cpi.ts             # Legacy CPI calculator (backward compat)
    ├── score.ts           # Scoring utilities
    ├── screen-prompt.ts   # CaseLoad Screen AI prompt builder (per-firm config)
    ├── types.ts           # Core type definitions (Lead, LawFirm, EmailSequence, ReviewRequest)
    ├── state.ts           # Lead state machine (6 states: Unaware, Problem-Aware, Solution-Aware, Decision-Ready, Price-Sensitive, Delayed)
    ├── sequence-engine.ts # Nurture sequence automation
    ├── email.ts           # Resend integration
    ├── persistence.ts     # WF-03: Persistence Engine (11-day follow-up cadence)
    ├── stalled-retainer.ts # WF-06: Stalled retainer recovery
    ├── no-show.ts         # WF-05: No-show recovery
    ├── incomplete-intake.ts # Incomplete intake detection (v2.2)
    └── supabase.ts        # Supabase client
```

## Database Schema

```sql
law_firm_clients (id, name, location, status, created_at)

leads (
  id, name, email, phone,
  case_type,           -- practice-area agnostic, configured per firm
  estimated_value,
  description,
  stage,               -- new_lead / contacted / qualified / proposal_sent / consultation_scheduled / client_won / client_lost (7 current; CRM Bible targets 9)
  score,               -- legacy 1-100
  law_firm_id,

  -- CPI Scoring (Phase 2)
  cpi_score, band,
  fit_score, value_score,
  geo_score, contactability_score, legitimacy_score,
  complexity_score, urgency_score, strategic_score, fee_score,
  priority_index, priority_band,

  -- Explainability (v2.2)
  cpi_confidence,       -- high / medium / low
  cpi_explanation,      -- plain-English scoring summary
  cpi_missing_fields,   -- JSON array of missing field labels

  -- Intake fields
  referral_source, urgency, timeline, city, location,
  source, referral, multi_practice, lead_state,

  created_at, updated_at
)

email_sequences (id, lead_id, sequence_step_id, step_number, status, scheduled_at, sent_at)
sequence_templates (id, name, trigger_event, is_active)
sequence_steps (id, sequence_id, step_number, delay_hours, channels, is_active)
review_requests (id, lead_id, law_firm_id, status, sent_at)
lead_activities (id, lead_id, activity_type, metadata, created_at)
```

## Scoring Engine (scoring.ts)

The Priority Scoring Engine v2.1 computes a 0-100 priority index from two groups:

**Fit Score (max 30):** geo (0-10) + contactability (0-10) + legitimacy (0-10)
**Value Score (max 70):** complexity (0-25) + urgency (0-20) + strategic (0-15) + fee (0-10)

Bands: A >= 90 | B >= 75 | C >= 60 | D >= 45 | E < 45

### v2.2 Explainability (April 2026)

`computeScore()` now returns three additional fields:

- `confidence` (high/medium/low): Weighted data completeness ratio across 12 scorable fields. High = 75%+ weighted fill. Medium = 45-74%. Low = below 45%.
- `explanation` (string): 1-3 sentence plain-English summary ranking strongest/weakest scoring factors and flagging what missing data would improve accuracy.
- `missing_fields` (string[]): Human-readable labels for null/empty input fields.

### Incomplete Intake Nudge

When confidence = "low" and band is B or C, the system triggers an `incomplete_intake` sequence via the sequence engine. The cron at `/api/cron/incomplete-intake` runs hourly.

Sequence: 3 touches (email at 2h, SMS at 24h, email at 72h) asking for specific missing fields. Re-scores on data receipt. Exits if confidence improves, lead qualifies, or 7 days pass.

## CaseLoad Screen Engine

The GPT-powered intake screening product. How it works:

1. Firm config defines practice areas, geo boundaries, and preferences
2. `screen-prompt.ts` builds a dynamic GPT-4o-mini system prompt per firm
3. Prospect fills 5-step intake widget (IntakeWidget.tsx)
4. `/api/screen/route.ts` runs GPT screening against firm criteria
5. CPI score assigned automatically
6. Lead enters pipeline pre-qualified with confidence rating

CTA on all intake forms: **"Start Your Consultation"** (not "Submit" or "Get Started").
Product name: **CaseLoad Screen**. "Case Review" and "Intake OS" are deprecated names.

Embeddable at `/widget/[firmId]` as iframe on firm websites.

## Lawyer Triage Portal (CaseLoad Screen 2.0 / CRM Bible v5 era)

A NEW surface inside the existing portal, alongside the legacy Dashboard / Pipeline / Phases tabs, consuming output from CaseLoad Screen 2.0 (the Vite SPA at `https://caseload-screen-v2.vercel.app`). The lawyer's daily decision surface for inbound leads.

### Distinct from the legacy machinery

The legacy `leads` table, CPI v2.1 scoring engine, 5-band system (A through E), and 12-journey sequence engine are **untouched** by this work. The triage portal reads from a NEW table (`screened_leads`) populated by a NEW endpoint (`/api/intake-v2`). The two systems run side by side; the legacy CRM Bible v3 dashboard continues serving until the legacy data is migrated or aged out (separate decision).

### Tables

| Table | Purpose |
|---|---|
| `screened_leads` | Main store for Screen 2.0 output. Brief JSON + brief HTML + slot answers, four-axis scores, lifecycle status, decision deadline, derived flags (whale_nurture, band_c_subtrack). Migration: `20260505_screened_leads.sql`. Lifecycle enum hard-enforced: `triaging` / `taken` / `passed` / `declined`. |
| `firm_decline_templates` | Per-firm and per-practice-area decline copy. Three-layer resolver: `screened_leads.status_note` (per-lead override) → per-PA → firm default → system fallback in `lib/decline-resolver-pure`. Migration: `20260505_firm_decline_templates.sql`. |
| `webhook_outbox` | At-least-once delivery store for outbound GHL webhooks. Idempotency-keyed on `(lead_id, action)`. Migration: `20260505_webhook_outbox.sql`. |

### Routes

| Route | Purpose |
|---|---|
| `/portal/[firmId]/triage` | Triage queue page. Sorted Band A → B → C with deadline tiebreaker. `?band=A\|B\|C` filter. |
| `/portal/[firmId]/triage/[leadId]` | Single brief view. Renders `brief_html` verbatim, sticky Take/Pass action bar at bottom. |
| `POST /api/intake-v2` | Persistence endpoint — Screen 2.0 POSTs here. Demo skip on missing/invalid firmId. Fires `declined_oos` webhook for OOS leads. |
| `POST /api/portal/request-link` | Lawyer-initiated magic link. Resolves email via `intake_firms.branding.lawyer_email`. Always 200 to block enumeration. |
| `GET /api/portal/[firmId]/triage` | Queue API endpoint. Same data as the page. |
| `GET /api/portal/[firmId]/triage/[leadId]` | Brief API endpoint. |
| `POST /api/portal/[firmId]/triage/[leadId]/take` | Take action — flips status to `taken`, fires `taken` webhook. |
| `POST /api/portal/[firmId]/triage/[leadId]/pass` | Pass action — flips status to `passed`, body `{ note? }`, fires `passed` webhook with resolved decline copy. |
| `GET /api/cron/triage-backstop` | Backstop sweeper for expired triaging rows. Wired, not scheduled (Hobby plan caps daily). |
| `GET /api/cron/webhook-retry` | Outbox retry sweeper. Wired, not scheduled. |
| `GET /api/admin/webhook-outbox` | Operator-visible delivery log. Accepts CRON_SECRET / PG_CRON_TOKEN bearer or operator session. Filters: `firm_id`, `status`. |
| `POST /api/admin/webhook-outbox/[outboxId]/retry` | Operator manual retry. Resets attempts to 0. Same auth shape as the listing route. |
| `/admin/triage` | Operator-only cross-firm triage queue. Firm filter + band filter. Rows link to /portal/[firmId]/triage/[leadId]. |
| `/admin/webhook-outbox` | Operator-only delivery log UI with manual retry button. |

### Auth model

Same HMAC magic-link pattern as the legacy Client Portal (`portal-auth.ts`). 48h link, 30-day session cookie, root-scoped (path `/`). Two role tiers on the token:

- `lawyer` (default): firm-scoped. Token's `firm_id` must match the requested route's firmId. Lands at /portal/[firmId]/triage.
- `operator`: cross-firm. Bypasses the firm match. Lands at /admin/triage. Operators can also view any firm's portal pages with an "Operator view" banner.

`firm_lawyers` table holds the canonical mapping of email → firm + role. Multi-lawyer per firm supported. Legacy `intake_firms.branding.lawyer_email` remains as a fallback. Inserting a row into `firm_lawyers` automatically fires a magic-link invitation email via the `trg_firm_lawyers_invite` pg_net trigger.

### GHL webhook contract

Versioned artifact at `docs/ghl-webhook-contract.md`. Four actions (`taken`, `passed`, `declined_oos`, `declined_backstop`), one common envelope, action-specific extension keyed by action name. Idempotency: `<lead_id>:<action>`. Delivery: at-least-once via the outbox.

### Locked decisions (CRM Bible v5)

| Decision | Value |
|---|---|
| Whale nurture trigger | `value_score ≥ 7 AND readiness_score ≤ 4` |
| Decision-deadline tiers | 48h default; 24h at urgency ≥ 6; 12h at urgency ≥ 8 |
| Lifecycle states | `triaging` / `taken` / `passed` / `declined` (hard-enforced via DB CHECK constraint) |
| Decline copy resolution | per-lead override → per-PA → firm default → system fallback |
| Webhook delivery | At-least-once via `webhook_outbox`, exponential backoff, max 5 attempts |

### Source files (key map)

```
src/
├── app/
│   ├── api/
│   │   ├── intake-v2/route.ts                          # Screen 2.0 persistence
│   │   ├── portal/
│   │   │   ├── request-link/route.ts                   # Lawyer-initiated magic link
│   │   │   └── [firmId]/triage/
│   │   │       ├── route.ts                            # Queue API
│   │   │       └── [leadId]/
│   │   │           ├── route.ts                        # Brief API
│   │   │           ├── take/route.ts                   # Take action
│   │   │           └── pass/route.ts                   # Pass action
│   │   ├── cron/
│   │   │   ├── triage-backstop/route.ts                # Deadline-expiry sweeper
│   │   │   └── webhook-retry/route.ts                  # Outbox retry sweeper
│   │   └── admin/webhook-outbox/
│   │       ├── route.ts                                # Operator listing
│   │       └── [outboxId]/retry/route.ts               # Manual retry
│   └── portal/[firmId]/triage/
│       ├── page.tsx                                    # Queue page
│       └── [leadId]/
│           ├── page.tsx                                # Brief page
│           └── brief.css                               # Scoped brief styles
├── components/portal/
│   ├── DecisionTimer.tsx                               # Live countdown
│   ├── TriageActionBar.tsx                             # Sticky Take/Pass bar
│   ├── RefreshOnFocus.tsx                              # Queue auto-refresh
│   └── RequestLinkForm.tsx                             # Login email form
└── lib/
    ├── intake-v2-derive.ts                             # Pure: timer/whale/initial-status/clamp
    ├── decline-resolver.ts / -pure.ts                  # Three-layer decline copy resolution
    ├── ghl-webhook.ts / -pure.ts                       # Payload builders + delivery
    ├── webhook-outbox.ts / -pure.ts                    # At-least-once delivery + backoff
    ├── triage-sort.ts                                  # Pure queue comparator
    ├── decision-timer.ts                               # Pure timer math
    └── screened-leads-labels.ts                        # Display labels
```

### Cron scheduling — Supabase pg_cron + pg_net

Both crons are scheduled via Supabase pg_cron (no Vercel Pro dependency):

- `triage-backstop-hourly` — `7 * * * *`, calls `/api/cron/triage-backstop`
- `webhook-retry-5m` — `*/5 * * * *`, calls `/api/cron/webhook-retry`

Migration `20260506_pg_cron_pg_net_setup.sql` enables `pg_cron` and `pg_net`, stores the bearer token in Supabase Vault as `pg_cron_token`, defines `cron_internal.call_cron_route(path)` (reads token from Vault, posts to `https://app.caseloadselect.ca` via pg_net), and schedules the two jobs.

Auth: routes accept either `CRON_SECRET` or `PG_CRON_TOKEN` via Bearer token (`lib/cron-auth.ts`, constant-time compare). Both tokens are also accepted by `/api/admin/webhook-outbox/*` for ops scripts. The operator can rotate one without affecting the other.

Run history is visible via `cron.job_run_details` and pg_net responses via `net._http_response`.

### New-lead notification

`/api/intake-v2` fires a fan-out email to all `firm_lawyers` rows with `role='lawyer'` for the firm whenever it lands a row with `status='triaging'`. Builders are pure (`lib/lead-notify-pure.ts`); I/O wrapper (`lib/lead-notify.ts`) resolves recipients and dispatches via Resend. Best-effort — failure does not block intake. Falls back to legacy `branding.lawyer_email` when no firm_lawyers row exists.

### Compliance pages

- `/privacy` — PIPEDA-aware retention table tied to `lib/data-retention.ts`. Public.
- `/terms` — LSO Rule 4.2-1 calibrated. No outcome promises, lawyer-client relationship is between lead and engaged firm. Public.
- Footer links from portal, admin, login.

### Phase 4+ deferred

- Webhook delivery `vercel.json` cron (currently the Supabase pg_cron path; the Vercel slot remains unused)
- Supabase Realtime queue subscription (replace RefreshOnFocus)
- HMAC signature header on outbound webhooks (when GHL adds inbound shared-secret support)
- v5 operator dashboard reading from `screened_leads` (deferred until real lead flow accumulates)

## Sequence Engine (sequence-engine.ts + send-sequences.ts)

`triggerSequence(leadId, triggerEvent)` inserts scheduled rows into `email_sequences`. The generic processor `src/lib/send-sequences.ts` runs every 15 minutes via `/api/cron/send-sequences` and sends due rows. Exit conditions per trigger_event are enforced: if a lead has moved away from the expected stage, remaining scheduled steps are skipped.

All trigger events:
`new_lead` · `no_engagement` · `client_won` · `no_show` · `stalled_retainer` · `incomplete_intake` · `spoke_no_book` · `consulted_no_sign` · `retainer_awaiting` · `consultation_scheduled` · `review_request` · `matter_active` · `re_engagement` · `relationship_milestone` · `long_term_nurture`

## 12-Journey Architecture

All 12 journeys are built and seeded.

| Journey | Name | Trigger | Touches |
|---|---|---|---|
| J1 | New Lead Response | new_lead | WF-03 persistence engine |
| J2 | Consultation Reminders | consultation_scheduled | 3-touch (0h, 48h, 96h) |
| J3 | No-Show Recovery | no_show | WF-05 engine |
| J4 | Persistence Engine | new_lead | WF-03 11-day cadence |
| J5A | Recovery A: Spoke, No Book | spoke_no_book | 4-touch 14 days |
| J5B | Recovery B: Consulted, No Sign | consulted_no_sign | 5-touch 21 days |
| J6 | Retainer Awaiting Signature | retainer_awaiting | 4-touch 10 days |
| J7 | Welcome/Onboarding | client_won | 4-touch 7 days |
| J8 | Active Matter Update | matter_active | 3-touch (14d, 28d, 56d) |
| J9 | Google Review Request | review_request | 3-touch (0h, 72h, 168h) |
| J10 | Re-Engagement | re_engagement | 2-touch (90d, 180d) — fires on client_lost |
| J11 | Relationship/Milestone | relationship_milestone | 2-touch (6mo, 12mo) |
| J12 | Long-Term Nurture | long_term_nurture | 2-touch (18mo, 24mo) |

## Conflict Check System (BUILT)

Pipeline gate between Qualified → Consultation Scheduled. Blocks stage move with HTTP 422 if check has not passed.

**Files:** `src/lib/conflict-check.ts`, `/api/leads/[id]/conflict-check`, `/api/admin/conflict-register/import`

**Tables:** `conflict_register` (client history), `conflict_checks` (per-lead results)

**Two check paths:**
- Clio connected → queries Clio `/contacts` API (name fuzzy, email exact, phone exact)
- No Clio → queries `conflict_register` table (CSV import baseline + client_won auto-entries)

**Results:** `clear` · `potential_conflict` (name similarity — operator reviews) · `confirmed_conflict` (email/phone exact — hard block)

**Override:** POST `/api/leads/[id]/conflict-check` with `{ override_reason }` clears a `potential_conflict`.

**Auto-registration:** Every `client_won` stage change calls `registerWonClient()` to add the lead to `conflict_register` (source: `caseload_select`).

**CSV import:** POST `/api/admin/conflict-register/import` with `{ firm_id, rows[] }` — idempotent, batched.

## Pipeline Stages (9 total)

`new_lead` → `contacted` → `qualified` → `consultation_scheduled` → `consultation_held` → `no_show` → `proposal_sent` → `client_won` → `client_lost`

Conflict gate: `qualified` → `consultation_scheduled` (hard block until check passes).

## PIPEDA Compliance

`src/lib/data-retention.ts` — band-based retention (A/B=1095d, C=365d, D=180d, E=30d, null=90d). Anonymizes (replaces PII, keeps scoring) — never deletes rows. Runs daily at 3am via `/api/cron/data-retention`.

`/api/admin/leads/[id]/purge` — immediate right-to-deletion for written data subject requests.

## Client Portal (S8)

`/portal/[firmId]` — firm-facing dashboard. Magic link auth (HMAC-SHA256, 48h, no DB table). Session cookie: httpOnly, 30-day, `/portal` scoped.

Routes: `/api/portal/generate`, `/api/portal/login`, `/api/portal/[firmId]/leads`, `/api/portal/[firmId]/metrics`.

### Client Dashboard (3-Tier, inside portal)

Three tabs within the portal. Data from Supabase, polled on page load + every 5 minutes.

**Tier 1 — Partner Dashboard** (`/portal/[firmId]/dashboard`): Hero metrics row (3 tiles, 40pt, configured per firm via `intake_firms.hero_metrics` JSONB) + 7 standard KPI tiles (inquiries MTD, qualified leads, signed cases, CPSC, median response time, pipeline value, funnel conversion rate). Each tile: number + delta vs prior month + 6-week sparkline + benchmark indicator (green/amber/red dot). YoY sparkline comparison where 12+ months of data exist. Collapsible "Since Engagement Start" panel below tiles showing cumulative metrics (total leads, qualified, signed cases, pipeline value, response time improvement, CPSC trajectory). Reuses admin KPI tile component with benchmark extension.

**Tier 2 — Pipeline View** (`/portal/[firmId]/pipeline`): Funnel conversion bar at top showing stage-to-stage conversion rates (>40% drop-off = red flag). Read-only kanban below. Mirrors admin pipeline, strip drag-drop. Filterable by practice area and date range. Cards show first name + last initial, practice area, CPI band badge, days in stage.

**Tier 3 — FACT Phases** (`/portal/[firmId]/phases`): Four cards (Filter, Authority, Capture, Target). Filter card: band distribution bar + SLA gauge. Authority/Capture/Target: placeholder until BrightLocal/GA4/Google Ads API wired. Placeholder text: "Connecting [Phase] data. Your weekly report covers this phase until the live feed is active."

New API routes: `/api/portal/[firmId]/dashboard` (Tier 1 metrics + hero config + benchmarks + cumulative data), `/api/portal/[firmId]/pipeline` (Tier 2 pipeline state + conversion rates), `/api/portal/[firmId]/phases` (Tier 3 FACT metrics).

New schema columns: `intake_firms.hero_metrics` (JSONB, default `["signed_cases","cpsc","median_response_time"]`), `intake_firms.metric_definitions` (JSONB, client-agreed definitions from onboarding). New table: `industry_benchmarks` (static reference data for benchmark comparisons).

Access: firm_owner and firm_admin see all tiers. No client sees raw CPI scores or AI screening rationale (operator-only). Row-level security on Supabase enforces tenant isolation.

Full spec: CRM Bible v3.0, Section 9. Build prompt: `05_Product/prompts/PROMPT_Client_Dashboard_Build_v2.md`.

## Custom Domains (S9)

`src/middleware.ts` (edge runtime) — hostname detection, Supabase REST lookup, rewrites traffic to `/portal/[firmId]` or `/widget/[firmId]`.

`src/lib/vercel-domains.ts` — Vercel API integration. `/api/admin/domains` — manage custom domains.

## Analytics

`/analytics` — Filter Performance dashboard. 8 KPI cards, band distribution (all-time vs last month), channel mix, practice areas, filter activity grid.

## Onboarding Checklist

`/onboarding` — operator setup validator. 4 required + 5 optional checks per intake_firms record. Required: practice_areas, geo_config, branding, ghl_webhook. Optional: Clio OAuth, widget live, custom domain, scoring weights, conflict register loaded.

## Clio Manage Integration

- On `client_won`: auto-create Clio contact + matter via `src/lib/clio-conversion.ts`
- Conflict check queries Clio API v4 `/contacts` for firms with Clio connected (Path A)
- S8 Client Portal reads Clio matters for the portal dashboard
- Token storage: `intake_firms.clio_config` JSONB — auto-refreshes on expiry

## Key Workflows

**New Lead:**
Form submission → leads table → computeScore() → pipeline (new_lead stage)
→ if confidence low + band B/C: trigger incomplete_intake sequence
→ else: trigger new_lead sequence (step 1 immediate, step 2 at 24h, step 3 at 72h)

**Conflict Gate:**
Lead in qualified → operator runs check from pipeline card → result stored in conflict_checks
→ clear: lead may advance to consultation_scheduled
→ potential_conflict: operator adds override_reason, then may advance
→ confirmed_conflict: hard block, cannot advance

**Client Won:**
stage = client_won → review_requests insert (status: pending) → triggerSequence × 4
(J9 review_request, J8 matter_active, J11 relationship_milestone, J12 long_term_nurture)
→ createClioMatter (background, non-fatal) → registerWonClient (conflict register)

**send-sequences cron (every 15 min):**
email_sequences WHERE status=scheduled AND scheduled_at ≤ now()
→ batch-load steps + templates + leads → check exit condition → send → mark sent/skipped

## Constraints

- Ontario / LSO Rule 4.2-1 compliance is non-negotiable. No outcome promises, no "specialist" or "expert" language, no unverifiable superlatives.
- Practice-area agnostic. Do not default to immigration examples.
- CASL compliance: consent capture, 6-month implied consent expiry.
- PIPEDA: data residency, breach protocol, right to deletion — BUILT (data-retention.ts).
- All automation runs server-side (Next.js API routes).
- GHL handles SMS/phone. CaseLoad Select handles intake, scoring, pipeline, sequences, portal.

## Do Not

- Build firm-facing admin panels or self-serve configuration
- Add multilingual features (PT/FR is not a product feature)
- Default to immigration examples (practice-area agnostic)
- Use mock or seed data in any production-facing component
- Change the tech stack without explicit instruction
- Use em dashes anywhere in copy or UI text
- Use banned AI vocabulary (delve, tapestry, landscape, pivotal, testament, vibrant, intricate, meticulous, garner, interplay, underscore, bolstered, fostering, showcasing, highlighting, emphasizing, enhance, crucial, enduring, boasts, align with, valuable)
- Allow orphan words (single word alone on last line of any text block)

## Build Roadmap

| Session | Scope | Status |
|---|---|---|
| S1 | Foundation (Supabase, auth, base schema) | DONE |
| S2 | Pipeline + Intake (kanban, CaseLoad Screen widget) | DONE |
| S3 | Scoring + Sequences (CPI engine, email automation, Resend) | DONE |
| S4 | Review + Recovery (WF-05 no-show, WF-06 stalled retainer, review requests) | DONE |
| S5 | Persistence + Nurture (WF-03, 6 nurture tracks) | DONE |
| S6 | Retainer Automation | BUILT (DocuGenerate + DocuSeal, Band A/B OTP trigger) |
| S7 | Migration Lockdown + Cron (schema freeze, vercel.json crons) | DONE |
| S8 | Client Portal (Clio API v4, magic link auth, firm dashboard) | DONE |
| S9 | Custom Domains + White-Label (Vercel API, CNAME, middleware routing) | DONE |
| Ses.4 | J5A, J5B, J6, Clio matter creation — full conversion flow | DONE |
| Ses.5 | PIPEDA, analytics dashboard, onboarding checklist | DONE |
| Ses.6 | Conflict check system, J2, J8–J12, send-sequences processor | DONE |
| Ses.7 | CaseLoad Screen 35-area expansion (interfaces, complexity indicators, value tiers, inference rules, default-question-modules, onboarding seeder), J7 Welcome/Onboarding migration + stage trigger | DONE |

## Pending: Run in Supabase SQL Editor

All migrations idempotent. Run in order:
1. `20260414_portal_clio.sql` — adds clio_config to intake_firms
2. `20260414_custom_domain.sql` — adds custom_domain to intake_firms
3. `20260414_journey_sequences.sql` — seeds J5A, J5B, J6 templates
4. `20260414_conflict_check.sql` — creates conflict_register + conflict_checks tables
5. `20260414_j2_consultation_reminders.sql` — seeds J2 template
6. `20260414_j8_matter_active.sql` — seeds J8 template
7. `20260414_j9_review_request.sql` — seeds J9 3-touch template
8. `20260414_j10_re_engagement.sql` — seeds J10 template
9. `20260414_j11_j12_relationship_nurture.sql` — seeds J11 + J12 templates
10. `20260414_retainer_agreements.sql` — creates retainer_agreements table
11. `20260414_j7_welcome_onboarding.sql` — seeds J7 Welcome/Onboarding template (4-touch, client_won trigger)

## Retainer Agreement Automation (BUILT)

Triggered after OTP verification on Band A/B intake sessions.

**Files:**
- `src/lib/docugenerate.ts` — PDF generation client (fills template with client + case data)
- `src/lib/docuseal.ts` — e-signature client (creates submission, sends signing email, verifies webhooks)
- `src/lib/retainer.ts` — orchestration (idempotent, band guard, inserts retainer_agreements row)
- `/api/otp/verify` — wired: triggers retainer on verified A/B sessions (non-fatal, fire-and-forget)
- `/api/webhooks/docuseal` — receives form.viewed + form.completed events, updates status

**Table:** `retainer_agreements` (session_id, firm_id, contact snapshot, docugenerate_document_url, docuseal_submission_id, status lifecycle)

**Status lifecycle:** `generated` → `sent` → `viewed` → `signed` (or `voided`)

**DocuSeal one-time setup:** Create a template in the DocuSeal dashboard with a "Client" signer role and signature field. Save its ID as `DOCUSEAL_TEMPLATE_ID`. Configure webhook at `https://app.caseloadselect.ca/api/webhooks/docuseal` for `form.viewed` and `form.completed` events.

**DocuGenerate one-time setup:** Create a retainer template with merge fields matching `RetainerVariables` (client_name, client_email, client_phone, firm_name, firm_location, practice_area, agreement_date, estimated_fee). Save its ID as `DOCUGENERATE_TEMPLATE_ID`.

## Env Vars to Add in Vercel

`CLIO_CLIENT_ID` · `CLIO_CLIENT_SECRET` · `CLIO_REDIRECT_URI` · `VERCEL_API_TOKEN` · `VERCEL_PROJECT_ID` · `DOCUGENERATE_API_KEY` · `DOCUGENERATE_TEMPLATE_ID` · `DOCUSEAL_API_KEY` · `DOCUSEAL_TEMPLATE_ID` · `DOCUSEAL_WEBHOOK_SECRET`

## Brand Assets

All CaseLoad Select logo files are served from `/brand/logos/` (public folder). Use these — never recreate logos in code.

### Naming convention

`{variant}-{theme}-{background}.png`

| Segment | Options |
|---|---|
| variant | `icon`, `wordmark`, `wordmark-tagline`, `lockup-horizontal`, `lockup-horizontal-tagline`, `lockup-stacked` |
| theme | `light` (navy/gold on transparent or white bg), `dark` (white/gold on dark bg) |
| background | `transparent` (use on coloured backgrounds), `bg` (has its own white/dark background baked in) |

### Quick reference

| Use case | File |
|---|---|
| Dark header / navy background | `/brand/logos/lockup-horizontal-dark-transparent.png` |
| Light header / white or parchment background | `/brand/logos/lockup-horizontal-light-transparent.png` |
| With tagline "