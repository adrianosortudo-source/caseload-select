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

## Related Files (outside this repo)

- CRM Bible v2: `04_Playbooks/01_Filter/Strategy/CaseLoad_Select_CRM_Bible_v2.html`
- Product Doc v2: `05_Product/CaseLoad_Select_Product_Doc_v2.html`
- CaseLoad Screen spec: `05_Product/CaseLoad_Screen_ProductSpec_v1.html`
- Brand Book v2: `01_Brand/BrandBook/CaseLoad_Select_BrandBook_v2.html`
- Scoring config (per-client): `04_Playbooks/01_Filter/ClientDeployments/example_law/CRM_Deployment/03_Scoring_Config.md`
- Nurture sequences: `04_Playbooks/01_Filter/ClientDeployments/example_law/CRM_Deployment/08_Nurture_Sequences.md`
- AI intake strategy: `05_Product/AI_Intake/CaseLoad_Select_AI_Intake_v2_Strategy.md`
- ROI Scorecard spec: `08_Reporting/CaseLoad_Select_ROI_Scorecard_Spec.md`
- Weekly reporting spec: `08_Reporting/CaseLoad_Select_Weekly_Reporting_System_Spec_v1.md`
