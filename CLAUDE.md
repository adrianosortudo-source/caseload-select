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

## CRM Build Research (read before CRM-build work)

The in-house CRM (GHL replacement) has a research corpus. Read in this order before planning or building CRM features:

1. `D:\00_Work\01_CaseLoad_Select\05_Product\CRM_Research\SYNTHESIS-CRM-Build-Guidance-v1.md`. The 15-book synthesis: canonical data model, the four engines (state-machine, scoring/CPI, cadence/TCA, dashboard), failure modes, KPI set, LSO fence.
2. `D:\00_Work\01_CaseLoad_Select\05_Product\CaseLoad_CRM_Migration_Plan_v1.md`. Phases (0 to 4), two CRM layers (A client-firm, B agency), GHL exit, open decisions.
3. `docs/research/CRM_Build_Brief_v1.md`. The competitive/empirical delta. Key item: the scoring engine must add confidence + explainability + a missing-data re-score loop (what Lawmatics QualifyAI ships and the synthesis spec lacks).
4. Evidence: `05_Product/CRM_Research/CRM_Competitor_Teardown_v2.html` (15 CRMs scored, scoring landscape, build backlog) and `05_Product/CRM_Research/GHL_Audit_Baseline_v1.html` (live DRG GHL config, 91 fields as the migration data dictionary, J-cadence suite as cadence-engine seed).
5. Enrichment + compliance: `05_Product/CRM_Research/CRM_Enrichment_Research_v1.md` (Smokeball/MyCase, the structured-intake repeating-record primitive, the 8-point explainable-scoring design, the AI-intake bar, and build-ready `consent_log` + `conflict_checks` schemas from LSO Rule 4.2-1 / Rule 3.4 / By-Law 9 / PIPEDA / CASL, plus the hard exclusions).

## Operator Model

Adriano operates the system for client firms. This is done-for-you, not self-serve SaaS. Firms never access admin panels. "Firm onboarding" means Adriano's setup checklist (Clio OAuth, practice areas, pipeline stages, Google review link, branding, intake form config). Build for operator efficiency, not firm self-service.

The Client Portal (S8) IS client-facing but configured and deployed by Adriano.

## Method: The ACTS System

(FACT was the working framing through April 2026; ACTS supersedes it. The master `D:\00_Work\01_CaseLoad_Select\CLAUDE.md` is canonical. CaseLoad Screen sits in the **S** pillar; this app is the codified surface for it.)

- **A — Authority:** Content, reviews, brand trust (long-term compounding)
- **C — Capture:** SEO, GBP, local visibility infrastructure
- **T — Target:** Precision Google Ads
- **S — Screen (CaseLoad Screen):** Automated intake scoring, case qualification, priority routing across seven channels (Web, WhatsApp, SMS, Instagram, Facebook, Google Business Profile, Voice)

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 13+ (App Router) + TypeScript + Tailwind CSS |
| Database | Supabase (PostgreSQL) |
| Email | Resend |
| Auth | HMAC magic-link with custom session cookies (`portal-auth.ts`); Supabase Auth is NOT used |
| AI Screening | OpenAI GPT-4o-mini (legacy v2.1); Google Gemini 2.5 Flash (Screen 2.0 / voice-intake) |
| SMS/Phone | GoHighLevel (GHL) — SMS, Voice AI, conversation surfaces |
| Hosting | Vercel |
| Legal PMS | Clio Manage (API v4) |

Supabase URL: https://ssxryjxifwiivghglqer.supabase.co (region: ca-central-1, Montreal). Migrated from `qpzopweonveumvuqkqgw` (us-east-2, Ohio) on 2026-05-18 to unblock the "client lead data is stored in Canadian data centers" residency line. Migration runbook at `docs/runbooks/supabase-migration.md`. Future schema migrations apply via `supabase db push` (project linked in `supabase/config.toml`). Weekly backup discipline via `scripts/backup-supabase.sh`.

## Database Access Invariant (locked 2026-06-05)

Three rules. Non-negotiable. Treat any deviation as a security defect, not a feature.

1. **`anon` role is for host resolution only.** Middleware (`src/middleware.ts`, edge runtime) may query `intake_firms` for `(id, custom_domain, subdomain)` to map a hostname to a firm. Nothing else. Column-level GRANT plus an RLS policy at the database enforce this. Do not widen anon access to extra columns or tables to make a frontend feature easier — add a server API route instead.

2. **All CLS-sensitive data access is service-role only.** Every read or write to `intake_sessions`, `channel_intake_sessions`, `screened_leads`, `unconfirmed_inquiries`, `voice_callback_requests`, `client_matters`, `matter_messages` (and derivatives), `firm_lawyers`, `firm_files`, `notification_outbox`, `webhook_outbox`, `leads`, `intake_firms.*` (anything beyond the three host-lookup columns) goes through `supabaseAdmin` from `src/lib/supabase-admin.ts` inside a server route. The legacy `src/lib/supabase.ts` re-exports `supabaseAdmin` and carries `import 'server-only'` so accidental browser bundling fails at build.

3. **The `authenticated` PostgREST role is not part of the app auth model.** Auth is HMAC magic-link with custom session cookies (`portal-auth.ts`, three tiers: lawyer / operator / client). The app never calls Supabase Auth, never issues Supabase JWTs, never depends on the `authenticated` role. Its table and function grants are revoked across the public schema; do not re-grant.

**Why this matters.** `intake_firms` holds `voice_api_token`, `ghl_api_key`, `facebook_page_access_token`, `whatsapp_cloud_api_access_token`, `voice_webhook_secret`, `clio_config`. A row-level anon SELECT policy without column scoping leaks every token the moment any firm sets `custom_domain` or `subdomain`. Migration `20260605_security_lockdown_anon_authenticated.sql` closed that gap plus the related SECURITY DEFINER and grant-default gaps. Drift on rules 1-3 is launch-critical, not stylistic.

**Watch points.** `intake_firms` currently mixes public-resolution fields with high-sensitivity secrets — the column-level grant keeps it safe today, but if the public surface ever grows past `(id, custom_domain, subdomain)`, prefer splitting secrets into a narrower config table over widening the grant. Any future "just expose this from the widget directly" instinct: route it through a server API and keep the invariant intact.

## Public Marketing Site (2026-05-26; superseded 2026-07-02, see boundary note)

**Boundary note (2026-07-02).** The `(marketing)` route group described below is LEGACY, superseded by a fully separate project at `05_Product/caseloadselect-website/` (its own repo, its own Vercel project, no shared database or engine access, per `Version3_CaseLoadSelect/CaseLoadSelect_Website_Rebuild_Plan_v1.md`). A PreToolUse hook, `.claude/hooks/check-website-boundary.mjs`, blocks edits to `(marketing)/` outside a narrow Phase 0 exception list; do not edit these routes beyond that list without reading the Rebuild Plan first. The screen-demo subtree here stays live and is proxied from the new site rather than rebuilt, per the same plan; do not delete or relocate it as part of the new-site build. After the new site's domain cutover and a stable period, these routes are deleted in one reviewed commit; until then, treat this section as historical/frozen, not a place for new marketing feature work.

The public-facing marketing site at `caseloadselect.ca/home` and the interactive Screen demo at `caseloadselect.ca/screen-demo` both live inside this Next.js project, in the `(marketing)` route group. Independent layout, independent CSS scope, zero crosstalk with the operator-facing admin shell.

### Routes

| Route | Purpose |
|---|---|
| `/home` | Marketing homepage — Hero, Ticker, Problem, ACTS System, CPI Wham Moment, Client Result (Damaris testimonial + stat counters), Why, FAQ + JSON-LD, Final CTA |
| `/screen-demo` | Entry page — case picker (3 sample cases + "use your own") |
| `/screen-demo/quiz/[caseId]` | Five-question quiz flow → email gate → inline Sample Report |
| `POST /api/screen-demo/report` | Computes the score, renders the Sample Report PDF via @react-pdf/renderer, delivers via Resend with cover note |

### Architecture

```
src/app/(marketing)/
├── layout.tsx                  marketing scope, no AdminShell
├── home/page.tsx               homepage at /home (root SEO surface)
├── styles/
│   ├── tokens.css              12 brand color tokens, fluid type clamp(), spacing/motion scales
│   └── marketing.css           section variants, hero composite, buttons, reveal-on-scroll
├── components/
│   ├── RevealOnScroll.tsx      single IntersectionObserver for the whole page
│   ├── StatCounter.tsx         scroll-triggered count-up, prefers-reduced-motion aware
│   ├── MarketingNav.tsx        sticky nav, logo swap on scroll
│   ├── ActsIcons.tsx           four bespoke SVG icons (A/C/T/S)
│   ├── Hero.tsx                layered hero composite + choreographed entrance
│   ├── Ticker.tsx              auto-scrolling navy strip, hover-pauses
│   ├── ProblemSection.tsx      three problem cards
│   ├── ActsSystemSection.tsx   four ACTS phase cards
│   ├── CpiSection.tsx          five-band Wham Moment strip + interactive demo CTA
│   ├── ClientResultSection.tsx Damaris testimonial + three stat counters
│   ├── WhySection.tsx          four RTB cards
│   └── FaqSection.tsx          accordion + FAQPage JSON-LD
└── screen-demo/
    ├── page.tsx                entry + case picker
    ├── quiz/[caseId]/page.tsx  quiz mount per case
    ├── _data/
    │   ├── questions.ts        5 marketing-calibrated questions + ScoreDelta types
    │   └── cases.ts            4 case fixtures (Immigration A, Criminal B, Real Estate C, custom)
    ├── _lib/
    │   ├── scoring.ts          pure CPI scoring engine + narrative builder + a/an article picker
    │   └── report-pdf.tsx      @react-pdf/renderer template, Font.register for branded TTFs
    └── _components/
        ├── DemoNav.tsx         minimal brand-only nav (no distractions)
        ├── CasePicker.tsx      4 cards with Band-coloured chips
        ├── ScreenQuiz.tsx      quiz state machine + email gate + API submit
        └── ReportView.tsx      inline sample report + emailDelivered banner

src/app/api/screen-demo/report/route.ts   PDF render + Resend delivery
public/fonts/                              Manrope-VF.ttf, Oxanium-VF.ttf (variable fonts)
public/marketing/adriano-portrait.jpg     operator headshot for hero block
```

### Doctrine

- **CSS scope.** Marketing styles live under the `cls-marketing` class on the route-group layout. Admin Tailwind never bleeds in; marketing tokens never bleed out. `AdminShell` bypasses the operator sidebar for any path starting with `/home`, `/about`, `/pricing`, or `/screen-demo`.
- **Brand discipline.** No em dashes anywhere in marketing copy (zero-exception brand rule). No banned vocabulary. Sage operating register; Hero language ("Sign Better Cases") reserved for promise-level surfaces only. Terminal squares on section headlines only.
- **Demonstration footer band.** The Sample Screen Report PDF carries a "DEMONSTRATION REPORT — NOT FROM A REAL INQUIRY" band fixed at the top and bottom of every page. LSO Rule 4.2-1 compliance device. The inline ReportView mirrors the band top-and-bottom too. Do not strip or restyle the band; it is the artifact's compliance signature.
- **PDF fonts.** Local variable-font TTFs in `public/fonts/`. `Font.register` resolves them with an absolute `path.join(process.cwd(), "public", "fonts", ...)` so dev and Vercel both work. Never reach the Google Fonts CDN at runtime for PDF rendering; the 404s are reproducible.
- **Band model, corrected 2026-07-02.** This paragraph previously described the LEGACY CPI v2.1 five-band model (A through E, fixed numeric cutpoints) and said the marketing demo and homepage should match those thresholds. That was wrong: the live Screen 2.0 engine that real inquiries flow through (`src/lib/screen-engine/band.ts`) defines exactly four bands, no fixed numeric cutpoints. `type Band = 'A' | 'B' | 'C' | 'D'`. Labels from `bandLabel()`: A "High Priority, Call first"; B "Mid Priority, Standard callback"; C "Low Priority, Standard follow-up cadence"; D "Refer-eligible, Out of scope for this firm" (an inquiry outside the firm's configured practice areas, routed for the lawyer to Refer, Take if misclassified, or Pass; never framed as decline or lowest-priority). Bands come from a weighted four-axis model, not a percentile score: Value, Simplicity, Urgency, Readiness (DR-103, 2026-07-15; the engine's internal axis name is still `complexity`, a 0-10 subtractive drag, but every lawyer- and prospect-facing surface displays it inverted as Simplicity so all four axes read higher-is-better). The legacy `leads` table and CPI v2.1 engine (five bands, numeric cutpoints, its own unrelated `complexity_score` 0-25 sub-score) remain a separate, untouched system per the section above; do not let its thresholds or its axis name leak into anything that represents the live Screen 2.0 product, including the marketing demo and homepage CPI section.
- **PDF scoring drift is acceptable, band-model drift is not.** The marketing demo questions are not the Layer 2 production questions. The scoring math is purpose-built for the demo. But the banding model (four bands, correct labels) must match the live product so the artifact reads as an authentic product output.

### Dev script lock — webpack, not Turbopack (2026-05-26)

Turbopack on this project's D: drive cannot create junction-point symlinks for transitive dev dependencies (specifically `prettier`, brought in by `@react-pdf/renderer`). Symptom: `TurbopackInternalError: failed to create junction point at .next\dev\node_modules\prettier-<hash>` with `os error 1: Incorrect function`. Webpack does not have this issue.

`package.json` scripts:

```jsonc
{
  "dev": "next dev --webpack",     // canonical local dev — works on D:
  "dev:turbo": "next dev --turbopack"  // escape hatch, currently broken on D:
}
```

The project is not moving off D:. The lock is permanent until either (a) Turbopack drops the symlink approach or (b) the D: filesystem gains junction-point support. Vercel's prod build uses its own toolchain and is unaffected.

### Resend config for screen-demo emails

- `RESEND_FROM` (default: `CaseLoad Select <noreply@caseloadselect.ca>`) — sender address
- `RESEND_API_KEY` — required to actually deliver mail; if missing, the API still generates the PDF and returns it, just `emailed: false`
- Domain verification: `caseloadselect.ca` must be verified at resend.com/domains for production. Until verified, Resend test mode only delivers to the account-verified address.

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

-- S8 Phase 1 (added 2026-05-22, see migrations 20260520_s8p1_*.sql)

client_matters (
  id, firm_id,
  source_screened_lead_id,                    -- FK to screened_leads.id (Band A take origin)
  lead_id,                                    -- snapshot of firm_lawyers.id at take time
  assignee_ids JSONB,                         -- array of firm_lawyers.id (snapshot)
  matter_stage,                               -- intake | retainer_pending | active | closing | closed
  matter_stage_changed_at,
  matter_type, practice_area,                 -- snapshot from screened_leads
  primary_name, primary_email, primary_phone,
  welcome_draft_html, welcome_draft_plain_text,
  welcome_draft_edited_html, welcome_draft_sent_at, welcome_draft_sent_body,
  embed_url,                                  -- per-matter iframe slot (S16)
  closed_at, created_at, updated_at
)

matter_stage_events (
  id, matter_id, firm_id, from_stage, to_stage,
  actor_role,                                 -- admin | staff | operator | system
  actor_id,                                   -- firm_lawyers.id
  note, created_at
)

matter_messages (
  id, matter_id, firm_id,
  channel_type,                               -- client | internal
  recipient_scope,                            -- individual | group | company (Phase 1: individual only in UI)
  sender_role,                                -- admin | staff | client | system
  sender_lawyer_id, sender_client_email,
  body, attachments JSONB,
  broadcast_id,                               -- set on mass-message fan-out (S11)
  created_at
)

matter_message_recipients (
  id, message_id, matter_id, read_at, created_at  -- per-recipient state for fan-out
)

explainer_articles (
  id, slug, title, body_html,
  practice_area, matter_stage, ordering, published,
  created_at, updated_at
)

matter_explainer_assignments (
  id, matter_id, article_id, assigned_by_lawyer_id, assigned_at
)

notification_outbox (
  id, recipient_user_id, recipient_email, firm_id, matter_id,
  event_type,                                 -- message_new | message_internal_new | file_uploaded |
                                              -- matter_stage_changed | explainer_assigned | welcome_draft_ready | broadcast_received
  event_payload JSONB,
  status,                                     -- queued | sent | failed | dropped
  batch_id, attempts,
  created_at, sent_at, failed_at, last_error
)

-- intake_firms extensions (S8 Phase 1)
intake_firms.default_lead_by_practice_area JSONB  -- map practice_area → firm_lawyers.id
intake_firms.default_lead_id UUID                  -- fallback lead lawyer
intake_firms.default_assignees JSONB               -- array of firm_lawyers.id snapshotted onto each new matter
intake_firms.client_files_locked BOOLEAN           -- S10 folder-lock toggle
intake_firms.subdomain TEXT                        -- branded subdomain (S12)
intake_firms.embed_origins JSONB                   -- CSP allow-list for iframe embeds (S16)

-- firm_lawyers extensions (S8 Phase 1)
firm_lawyers.role                               -- extended: lawyer (legacy) | admin | staff | operator
firm_lawyers.display_name                       -- used by welcome-draft template
firm_lawyers.title                              -- e.g. "Principal", "Associate"
firm_lawyers.email_notifications_enabled        -- per-staff toggle for batched notification outbox

-- Voice channel (added 2026-05-21)
intake_firms.voice_api_token                    -- GHL Voice AI Private Integration Token (SECRET)
intake_firms.ghl_location_id                    -- GHL sub-account location ID (per-firm, not secret)
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

CTA on all intake forms: **"Submit for review"** (revised 2026-05-06; the previous CTA "Start Your Consultation" implied the AI provided legal advice, which it does not). Hero headline: **"Book a call with the firm▪"** (revised 2026-05-06; replaces the firm's standard "Contact Us" form — the screen IS the contact path). Hero sub: *"Describe your situation in your own words, then answer a few short follow-ups. A lawyer reviews what you share and reaches out directly if your matter fits the firm's practice."* (The earlier "Most replies within hours" closer was removed 2026-06-10: no time-relative reply promises on firm-voiced surfaces.)
Product name: **CaseLoad Screen**. "Case Review" and "Intake OS" are deprecated names.

Embeddable at `/widget/[firmId]` as iframe on firm websites.

## Embedded Widget: Voice, Embed Contract, Capability UX (2026-06-28)

Locked after the DRG voice-mic debugging cycle. Plan around these for every client; do not rediscover them on a live site.

**iOS voice reality.** Every iOS browser runs on WebKit (Chrome is `CriOS`, Firefox `FxiOS`, Edge `EdgiOS`, all shells over the same engine). `getUserMedia` inside a cross-origin iframe works in **iOS Safari only** (proven on a real device); the WebKit shells refuse it with no workaround, because it is an Apple platform limit. The intake widget is always embedded cross-origin on a firm site, so embedded voice records on iOS Safari and not on Chrome iOS. Desktop and Android record inline as normal. Full proven matrix: `memory/reference_widget_voice_ios_matrix.md`.

**The cross-origin mic embed contract.** Three conditions must all hold for the embedded widget to reach the mic:
1. The firm-site `<iframe>` carries `allow="microphone"`.
2. The widget route sends `Permissions-Policy: microphone=*`, NOT `microphone=(self)`. WebKit mishandles `self` in this context and blocks the mic even when it should allow it. Set in `next.config.ts` for `/widget*` and `/widget-public*`; the main app keeps `microphone=()`.
3. The route is excluded from the admin shell. Any NEW public or embedded route must be added to the AdminShell bypass AND given the correct Permissions-Policy, or it renders inside the operator console with the wrong headers (exactly how the since-deleted `/voice-handoff` route broke).

**Capability-gated UX rules.** Any feature that depends on a browser/OS capability follows four rules:
1. Detect capability on mount, before rendering a control. Never show a button already proven dead in this context (`VoiceInput.tsx` `getVoiceCapability`).
2. Keep the fallback (typing) available in every state.
3. When the capability is unavailable, render NOTHING. No apology sentence; the textarea already invites typing. A runtime denial after a deliberate tap still surfaces its own message.
4. An embedded surface never navigates the user off the firm's page. The new-tab voice handoff was built and rejected for this reason; voice must run in place.

**Reused-credential verification.** The original mic failure was a stale assumption: the transcribe route reused "the screening engine's OpenAI key" via a comment written before the engine moved to Gemini, and that key's project had no Whisper access (HTTP 403). When a feature borrows a shared credential, verify the credential's actual model and scope access at wire-up; do not trust a provenance comment. Prefer consolidating on the current vendor over leaving a one-feature legacy dependency. Transcription now runs on Gemini via `/api/transcribe`.

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
| `unconfirmed_inquiries` | Contact-capture doctrine reject store. Rows that fail the gate (missing name AND/OR reachability) land here, NEVER in `screened_leads`, NEVER in the triage portal. Ops visibility only. Reasons: `no_contact_provided` / `abandoned` / `engine_refused`. Migration: `20260516_unconfirmed_inquiries.sql`. |
| `channel_intake_sessions` | Multi-turn intake sessions for Meta channels (Messenger / Instagram / WhatsApp). Holds `engine_state` (serialized `EngineState`) for resume on next inbound from the same `(firm_id, channel, sender_id)`. Finalised once contact is captured (screened lead created) or `max_follow_ups=3` exhausted (moved to `unconfirmed_inquiries`). Migration: `20260516_channel_intake_sessions.sql`. **Correction (2026-07-02):** the prior note here claiming `public.intake_sessions` "powers the web widget" was stale; that table is the legacy v1 `/api/screen` product (OTP, round3, memo) and has nothing to do with Screen 2.0. The Screen 2.0 web widget's own drop-off tracking is `web_intake_sessions` (row below). |
| `web_intake_sessions` | Drop-off tracking for the Screen 2.0 web widget (qualification audit F2/F6/item 5, 2026-07-02). Widget POSTs a checkpoint after every answered turn (`POST /api/intake-v2/checkpoint`), keyed on `(firm_id, lead_id)`; a successful `/api/intake-v2` submit finalizes the row with `screened_lead_id` set. Purpose-built rather than a widened `channel_intake_sessions`, whose finalize path is coupled to Meta Send-API closing messages that do not exist for web. Hourly cron `/api/cron/expire-web-intake-sessions` sweeps expired rows: contact-complete sessions get a thin brief in `screened_leads` (same DR-038 doctrine as the Meta sweep), everything else moves to `unconfirmed_inquiries` with `reason='abandoned'`. Migration: `20260702170000_web_intake_sessions.sql`. |
| `intake_firms.facebook_page_access_token` | Meta Page access token used by Messenger Send + Instagram Send (IG inherits the linked Page's token). SECRET. service-role read only. Migration: `20260516_intake_firms_meta_access_tokens.sql`. |
| `intake_firms.whatsapp_cloud_api_access_token` | WhatsApp Cloud API access token. SECRET. service-role read only. Migration: `20260516_intake_firms_meta_access_tokens.sql`. |

### Routes

| Route | Purpose |
|---|---|
| `/portal/[firmId]/triage` | Triage queue page. Sorted Band A → B → C with deadline tiebreaker. `?band=A\|B\|C` filter. |
| `/portal/[firmId]/triage/[leadId]` | Single brief view. Splits `brief_html` on the `<!-- ACTION_RAIL_SLOT -->` marker (DR-057), renders top half as `<BriefFrame>`, `<TriageActionBar>` between, bottom half as a second `<BriefFrame>`. Action rail is inline (not fixed-bottom) so it does not slice mid-scroll. |
| `POST /api/intake-v2` | Persistence endpoint, Screen 2.0 POSTs here. Demo skip on missing/invalid firmId. Fires `declined_oos` webhook for OOS leads. Also best-effort finalizes any matching `web_intake_sessions` checkpoint row on success. |
| `POST /api/intake-v2/checkpoint` | Drop-off checkpoint (qualification audit item 5, 2026-07-02). Widget fires this after every answered turn; upserts `web_intake_sessions` keyed on `(firm_id, lead_id)`. Always 200, even on validation failure, this is telemetry, never the intake path. |
| `POST /api/voice-intake` | Voice channel persistence endpoint (DR-033). Receives the GHL Voice AI post-call webhook payload, runs the screen engine server-side on the transcript, inserts a `screened_leads` row with `channel='voice'`, fires the new-lead notification. Sibling to `/api/intake-v2`, not a modification of it. Requires `@google/generative-ai` and `GEMINI_API_KEY` for LLM extraction (best-effort; regex-only if the key is missing). **Live for DRG since 2026-05-21.** GHL workflow webhook body shape: `{ firmId, caller_phone, caller_name, transcript, call_id }`. Transcript field uses `{{contact.call_summary}}` (NOT `{{contact.notes}}` which silently fails GHL save validation per DR-042). Voice agent doctrine: CRM Bible DR-040 through DR-045. |
| `GET/POST /api/messenger-intake` | Meta Messenger webhook. GET is the hub.verify_token handshake; POST verifies HMAC, resolves firm by Page ID via `intake_firms.facebook_page_id`, runs the engine via `channel-intake-processor` in `waitUntil` so Meta gets a fast 200 ACK while engine + LLM work (5-15s) happen in the background. `screened_leads.slot_answers.channel='facebook'`. Wired to engine end-to-end as of Block 2 of Meta App Review prep. |
| `GET/POST /api/instagram-intake` | Meta Instagram DM webhook. Same shape as Messenger. Resolves firm by IG Business Account ID via `intake_firms.instagram_business_account_id`. `channel='instagram'`. |
| `GET/POST /api/whatsapp-intake` | Meta WhatsApp Cloud API webhook. Different payload shape (entry.changes[].value.messages[]). Resolves firm by Phone Number ID via `intake_firms.whatsapp_phone_number_id`. Ignores non-text inbound (image/audio/document) and statuses-only payloads (delivery receipts). `channel='whatsapp'`. |
| `POST /api/portal/request-link` | Lawyer-initiated magic link. Resolves email via `intake_firms.branding.lawyer_email`. Always 200 to block enumeration. |
| `GET /api/portal/[firmId]/triage` | Queue API endpoint. Same data as the page. |
| `GET /api/portal/[firmId]/triage/[leadId]` | Brief API endpoint. |
| `POST /api/portal/[firmId]/triage/[leadId]/take` | Take action — flips status to `taken`, fires `taken` webhook. |
| `POST /api/portal/[firmId]/triage/[leadId]/pass` | Pass action — flips status to `passed`, body `{ note? }`, fires `passed` webhook with resolved decline copy. |
| `POST /api/portal/[firmId]/triage/[leadId]/refer` | Refer action (Band D primary affordance) — flips status to `referred`, body `{ referredTo?, note? }`, fires `referred` webhook. No decline-with-grace cadence; the firm's GHL workflow decides downstream. |
| `GET /api/cron/triage-backstop` | Backstop sweeper for expired triaging rows. Branches on band: A/B/C expiry → status='declined'; Band D expiry → status='passed' (per 2026-05-15 doctrine). Both fire `declined_backstop`. Wired, not scheduled (Hobby plan caps daily). |
| `GET /api/cron/webhook-retry` | Outbox retry sweeper. Wired, not scheduled. |
| `GET /api/admin/webhook-outbox` | Operator-visible delivery log. Accepts CRON_SECRET / PG_CRON_TOKEN bearer or operator session. Filters: `firm_id`, `status`. |
| `POST /api/admin/webhook-outbox/[outboxId]/retry` | Operator manual retry. Resets attempts to 0. Same auth shape as the listing route. |
| `POST /api/admin/screened-leads/[id]/retry-notification` | Operator-gated `[REPLAY]` re-send of the new-lead notification (DR-066). |
| `/admin/triage` | Operator-only cross-firm triage queue. Firm filter + band filter. Rows link to /portal/[firmId]/triage/[leadId]. |
| `/admin/webhook-outbox` | Operator-only delivery log UI with manual retry button. |
| `/admin/routing` | Operator-only lead-routing config UI (2026-06-02). Firm picker (FirmFilter, `?firm_id=`) → per-practice-area lead, firm fallback lead, default assignees. Honest unconfigured states + live "a lead taken now goes to" preview + snapshot-at-take caveat. Edits the live `intake_firms` routing fields; no deploy needed for routing changes. |
| `GET/PATCH /api/admin/firms/[firmId]/routing` | Operator-gated. GET returns the firm's routing config + selectable lawyers; PATCH validates every id belongs to the firm, normalizes (drops blank PA defaults, de-dupes assignees), writes the three columns. |
| `/admin/explainers` + `/admin/explainers/[id]` | Operator-only explainer-article authoring UI (2026-06-03, S8 Phase 2). List + per-article editor (title, body via the shared `RichTextEditor`, practice area, matter stage, ordering, publish toggle). Lets the operator author the seed explainers (published=false, empty body) without a deploy. `explainer_articles` is global (no firm_id). |
| `GET /api/admin/explainers` + `GET/PATCH /api/admin/explainers/[id]` | Operator-gated. PATCH sanitizes `body_html` via `lib/explainer-html-sanitize` (broader allowlist than welcome: adds h2-h4 + blockquote) and validates matter_stage; returns the canonical article. body_html renders into the client portal, so it is never stored unsanitized. |

### S8 Phase 1 routes (added 2026-05-22)

| Route | Purpose |
|---|---|
| `POST /api/portal/[firmId]/matters/[matterId]/stage` | Advance matter stage (validates transition, fires journey cadence) |
| `GET/POST /api/portal/[firmId]/matters/[matterId]/messages` | List + send messages (channel_type discriminator gates client vs internal) |
| `GET/PATCH /api/portal/[firmId]/matters/[matterId]/welcome` | View / edit the welcome draft built at matter creation. PATCH sanitizes `edited_html` server-side via `lib/welcome-html-sanitize` (S8 Phase 2) and returns the canonical sanitized HTML. |
| `POST /api/portal/[firmId]/matters/[matterId]/welcome/send` | Send the welcome draft as a client-channel message + stamp sent_at. Sanitizes the body before insert (uniform last gate, also cleans any pre-Phase-2 unsanitized rows). |
| `POST /api/portal/[firmId]/matters/[matterId]/invite` | Generate + email a magic-link invite to the client (48h TTL) |
| `GET/POST/DELETE /api/portal/[firmId]/matters/[matterId]/explainers` | List + assign + unassign explainer articles for the matter |
| `GET/PATCH /api/portal/[firmId]/matters/[matterId]/embed` | Read / set the matter's iframe embed_url (CSP-validated against firm allow-list) |
| `POST /api/portal/[firmId]/matters/[matterId]/kickoff` | S14 composition — sends welcome, auto-assigns explainers, advances stage, generates client invite |
| `POST /api/portal/[firmId]/broadcast` | Mass-message fan-out (S11) — one body, many matters, one broadcast_id |
| `GET/PATCH /api/portal/[firmId]/config/folder-lock` | S10 firm-level client_files_locked toggle |
| `GET /api/cron/notification-batch` | Drain notification_outbox every 5 min into per-recipient digest emails |
| `/portal/[firmId]/m/[matterId]` | Client matter-stage home (S04 — magic-link gated) |
| `/portal/[firmId]/m/[matterId]/accept` | Magic-link landing — verifies token, plants client session cookie |
| `/portal/[firmId]/m/[matterId]/explainers/[slug]` | Client explainer reader (2026-06-03, S8 Phase 2). Renders one article's body, gated three ways: client session for this matter + article `published=true` + assigned to this matter (matter_explainer_assignments). Uniform "not available" on any miss (no leak). body_html sanitized again on render (defense in depth). Completes the explainer loop the matter home links into. |
| `/portal/[firmId]/clients` | Lawyer active-clients home (S05) |

### Auth model

Same HMAC magic-link pattern as the legacy Client Portal (`portal-auth.ts`). 48h link, 30-day session cookie, root-scoped (path `/`). Three role tiers on the token (S8 Phase 1 added the client role):

- `lawyer` (default): firm-scoped. Token's `firm_id` must match the requested route's firmId. Lands at /portal/[firmId]/triage.
- `operator`: cross-firm. Bypasses the firm match. Lands at /admin/triage. Operators can also view any firm's portal pages with an "Operator view" banner.
- `client` (S8 Phase 1): matter-scoped. Token carries `matter_id` + `client_email`. Only valid for routes under `/portal/[firmId]/m/[matterId]/*`. `getClientMatterSession(firmId, matterId)` is the helper. The session does NOT match `getFirmSession()` — clients have their own surfaces.

`firm_lawyers` table holds the canonical mapping of email → firm + role. The role column extends to `admin | staff | operator | lawyer` (legacy alias). New rows should use `admin` or `staff`. Multi-lawyer per firm supported. Legacy `intake_firms.branding.lawyer_email` remains as a fallback. Inserting a row into `firm_lawyers` automatically fires a magic-link invitation email via the `trg_firm_lawyers_invite` pg_net trigger.

### Operator preview (DR-084)

An operator can step into either the firm's lawyer portal or an end-client's matter portal and see it as that user sees it, read-only. A signed `portal_preview` cookie (`preview-mode.ts`, set by `/api/portal/[firmId]/preview/enter?target=lawyer|client[&matterId=]`, cleared by `/preview/exit`) carries the intent. `[firmId]/layout.tsx` drops the operator rail + banner and mounts `PreviewStrip` in preview; lawyer preview keeps the tab nav, client preview hides it. `requirePortalViewer` (lawyer surfaces) and `resolveClientMatterView` (client `/m/[matterId]` surfaces) admit the operator-in-preview for READS; every write stays blocked server-side (`denyWriteIfPreview` on the operator-accepting deliverables mutation routes; all other portal writes already reject operators or require a client token). Each open is audited to `operator_preview_log`. Controls render present-but-inert; the client preview is gated by the operator session alone. Entry links: "View as the firm" on the operator banner, "View as client" on the lawyer matter detail page. Full contract in DR-084.

### GHL webhook contract

Versioned artifact at `docs/ghl-webhook-contract.md`, now at v3. Six actions (`taken`, `passed`, `referred`, `declined_oos`, `declined_backstop`, `matter_stage_changed`), one common envelope, action-specific extension keyed by action name. Idempotency: `<lead_id>:<action>` (matter-stage events key on `<matter_id>:stage:<to_stage>`). Delivery: at-least-once via the outbox.

`declined_oos` is dormant in the intake path as of 2026-05-15 — OOS leads now land as Band D triaging and only fire decline-with-grace through lawyer-initiated Pass or the deadline backstop (`declined_backstop`). The action remains in the contract for the deadline-backstop path and any future engine-spam handling.

### Locked decisions (CRM Bible v5)

| Decision | Value |
|---|---|
| Whale nurture trigger | `value_score ≥ 7 AND readiness_score ≤ 4` |
| Decision-deadline tiers | 48h default; 24h at urgency ≥ 6; 12h at urgency ≥ 8; 96h for Band D OOS (urgency overrides apply) |
| Lifecycle states | `triaging` / `taken` / `passed` / `referred` / `declined` (hard-enforced via DB CHECK constraint) |
| Bands | `A` / `B` / `C` (in-scope axis lift) / `D` (refer-eligible OOS) |
| Decline copy resolution | per-lead override → per-PA → firm default → system fallback |
| Webhook delivery | At-least-once via `webhook_outbox`, exponential backoff, max 5 attempts |
| Band D doctrine (2026-05-15) | **Engine sorts attention, lawyer decides outcome.** All inbound — in-scope and OOS — lands as `status='triaging'`. OOS carries `band='D'` (refer-eligible) with a 96h decision window. Auto-decline is removed from the intake path; decline-with-grace fires only on lawyer-initiated Pass or the deadline backstop. Band D card surfaces **Refer · Take · Pass**. `'declined'` is reserved for future engine-spam / abuse handling. The triage portal swaps the prior "Declined" tab for a "History" tab covering `passed / referred / declined`. Supersedes the 2026-05-14 visibility doctrine. |
| Persistence layer ownership (DR-054, 2026-06-09) | **Every state field used by a downstream decision must be on `LawyerReport`.** Field-detected when historical `business_setup_advisory` rows showed `brief_json.advisory_subtrack = null` despite the engine classifying correctly at intake. Cause: `LawyerReport` had no subtrack field, so `buildReport()` dropped it on serialization. Fix: `LawyerReport.advisory_subtrack: AdvisorySubtrack` required, `buildReport()` writes `state.advisory_subtrack` into it. Triage protocol for any future "field is null" bug: check persistence first, then trigger, then classifier, then calibration. 99% of the time the bug is at persistence. |
| Bi-directional band gate · business_setup_advisory (DR-055, 2026-06-09) | **Solo + crisis = A; solo + nothing = B; partner / buy-in bypasses both.** The `business_setup_advisory` branch in `computeBand` carries paired clauses: SUPPRESSION demotes A to B when no crisis signal (signed exposure, urgent timing, this-week timing) and no high-scope subtrack (`partner_setup`, `buy_in_or_joining`). PROMOTION lifts B / C to A when an explicit crisis signal is present. Partner / buy-in subtracks bypass both and ride the four-axis result as-is. Field-detected when a $30k-$100k sole-operator advisory file with high readiness reached Band A via combined-lift on a $1,500-3,000 fee floor. |
| Calibration proportionality · advisory (DR-056, 2026-06-09) | **Revenue is a weak proxy for legal fee value on advisory matters.** Value tier for `$30,000-$100,000 (full-time, sole operator)` is 2 (was 4); `$100,000-$500,000 (small team or busy practice)` is 4 (was 5); Over $500k unchanged. "Already operating" urgency lift is gated on material exposure (signed, $100k+ revenue, employees planned) at +4; without material exposure +1. Partner / buy-in subtrack bonuses unchanged. |
| ACTION_RAIL_SLOT split-marker pattern (DR-057, 2026-06-09) | **Inline action affordances embed via server-emitted markers, React mounts in seam.** `screen-brief-html.ts` emits `<!-- ACTION_RAIL_SLOT -->` between NAP and main-grid. The page splits `brief_html` on the marker, rendering top half as one `<BriefFrame>`, `<TriageActionBar>` between, bottom half as a second `<BriefFrame>`. The action bar drops fixed positioning entirely. Fixed-position overlays for inline affordances are forbidden because they slice through content mid-scroll. |
| Engine sync drift CI gate (DR-058, 2026-06-09) | **`check-engine-sync.sh` must run on every commit that touches the engine.** Sandbox-to-app mirror discipline (DR-033) is impossible to enforce manually across sessions. Pre-existing drift on `selector.ts` and `llm/extractor.ts` proved the point. Required GitHub Actions check + optional husky pre-commit hook with intentional-drift opt-out flag. Until the gate ships, the manual checklist on engine-touching commits is: edit app, diff against sandbox, matching sandbox edit, run sync script, run BOTH test suites, commit app (sandbox has no git; deploys via `vercel --prod`). |
| Minimum discovery floor (DR-060, 2026-06-09) | **Async channels do not finalize after one substantive answer.** `business_setup_advisory` matter-gap bottoms out after `advisory_path`, so the engine stopping rule could finalize a WhatsApp lead on a single fact. `src/lib/discovery-floor.ts` `meetsDiscoveryFloor(state)` is consulted in Phase C before any finalize: 3 user-answered substantive slots required, matter-specific candidate sets for the 3 launch lanes, `GLOBAL_MIN_DISCOVERY=3` elsewhere. Counts only `answered` / `explicit` / legacy `inferred` provenance; excludes contact slots, `llm_inferred`, `profile_metadata`, `system_metadata`. `out_of_scope` / `unknown` exempt. When the engine returns a non-asking step but the floor is unmet, the processor falls back to `selectNextSlot`. Engine source unchanged; the floor is a processor-side guard in `lib/` (no sandbox mirror). |
| Async reply turn integrity (DR-061, 2026-06-09) | **The reply goes to the slot the bot ASKED, overwrites weak fills, never silently pivots.** `EngineState.pendingAskedSlotId` records the last asked slot; `src/lib/pending-slot-reply.ts` `applyPendingSlotReply` routes the inbound to it before any `getNextStep`-driven adapter runs. `isUserGroundedFill` lets a user reply overwrite `llm_inferred` / `unknown` fills (upgrading source to `answered`). If the reply does not fill the pending non-contact slot, the processor re-asks THAT slot with a `didnt_catch` clarifier rather than pivoting (sticky). When `pendingAskedSlotId === 'client_name'`, the contact extractor lifts the email/phone guard to accept a bare name (still filtered by blocklist + `isWeakName`). `DIGIT_REPLY_RE` tolerates leading whitespace / backtick / quotes. All routing in `lib/`; `pendingAskedSlotId` is an optional field mirrored to sandbox types.ts but only the app sets it. |
| The route is the gate (DR-063, 2026-06-09) | **Client-role sessions are excluded from every lawyer surface.** Triage endpoints, legacy data APIs, and pages all reject client sessions; the legacy operator surface and the entire `/api/admin` tree are gated; `legacy-surface-auth.test.ts` pins the posture. Take/Pass/Refer check the UPDATE row count and include `referred` in the already-actioned guards. |
| Sliding channel-session expiry (DR-064, 2026-06-09) | **`expires_at` slides 24h on every state save.** The expiry sweeper finalizes contact-complete sessions into `screened_leads` as thin leads; only contact-incomplete sessions go to `unconfirmed_inquiries`. |
| Inbound webhook idempotency (DR-065, 2026-06-09) | **Meta receivers claim message mids in `processed_channel_messages` before engine work** (release on throw, 7-day sweep via data-retention); voice dedupes `call_id` in a 10-minute window (GHL sends the contact id as `call_id`, so the window stays short). |
| New-lead notification delivery state (DR-066, 2026-06-09) | **DR-046 invariants applied to the intake path.** Four `notification_*` columns on `screened_leads`; `[REPLAY]` retry at `POST /api/admin/screened-leads/[id]/retry-notification`; Sent/Failed/Pending chip on `/admin/triage`. |
| Matter-stage cadences are GHL-owned (DR-067, 2026-06-09) | **Stage transitions enqueue `matter_stage_changed` through `webhook_outbox`** (idempotency `<matter_id>:stage:<to_stage>`); the dead in-app `triggerSequence` path is removed; the `webhook_outbox` CHECK is widened to six actions, also fixing the latent `referred` rejection; the operator must build the four GHL stage workflows. |
| App engine is the leading edge (DR-068, 2026-06-09) | **Partially supersedes DR-028.** App-to-sandbox sync executed, all engine files byte-identical, sandbox redeployed. |
| Inference informs; only the lead routes (DR-069, 2026-06-11) | **matter_type is provenance-tracked** (`matter_type_provenance` on EngineState + LawyerReport: deterministic / user_routing_answer / llm_inferred / unknown). `rerouteFrom*General` fires only on user-grounded routing answers and no-ops off the catch-all; employment/estates gained their missing deterministic reroutes; `mergeLlmResults` promotes `*_general` lanes only with `allowGeneralPromotion` (single-pass callers: voice webhook, promote replay, reclassify), while the `unknown` lane always promotes (DR-039). The unguarded post-merge reroute blocks were deleted from `channel-intake-processor.ts` and `voice-realtime/run-engine-turn.ts`. The merge overwrite guard protects every user-grounded source, not just `explicit`. Briefs render inference-routed classifications honestly (cover note, risk flag, truth warning, open question, band bullet); `FactSource` gained `llm_inferred`. Field-detected on a commercial-lease widget test force-fit to "Buying or selling commercial property". |
| Taxonomy completeness + no-force-fit (DR-070, 2026-06-11) | **Closed option lists must cover the inquiry space; the escape option is never punished against inference.** 17 high-confidence buckets added across 12 slots (leasing commercial space, corporate transactional destinations to business_setup_advisory, constructive dismissal, contractor, trust, lost-capacity, POA misuse, dependant support, and more). Prompt rule 2a forbids nearest-option force-fits. Band's "Something else" demotion requires the LEAD's own answer. `real_estate_problem_type` sits at the 10-row WhatsApp list cap; do not append to it. Medium-confidence buckets deferred to the operator review queue (DR-070 register entry). |
| Clarify step is a first-class widget surface (DR-071, 2026-06-11) | **When the engine can't classify (matter_type stays `unknown`), `getNextStep` returns `{ type: 'clarify', message }` with no slot; every channel surface must render it.** The web widget renders the clarify message in a free-text card, caps at two rounds, then routes to contact capture with a calm fallback ("We can still get this to the team"). Counter resets on Back-to-kickoff. Field-detected: a "Fractional Counsel" widget test loaded forever because DR-070 stopped the LLM force-fitting and the widget had no clarify branch. `clarify-step-doctrine.test.ts` pins the invariant: no NextStep is ever returned without a slot AND without a clarify message. |
| general_counsel_advisory matter type (DR-072, 2026-06-11) | **28th canonical matter type, a PEER (not a business_setup_advisory subtrack), absorbing Fractional Counsel + standalone Contract Review + Records Upkeep.** Three signal families route in (after setup+dispute, before the catch-alls). Anti-scope is load-bearing: a 12-case no-leak sweep proves it never swallows other matters. Tight 4-slot intake; readiness reuses the universal slots. Conservative banding (B default, never D). `corporate_problem_type` gains "Ongoing legal support for an existing business" (DR-069 gate holds). Bonus fix: bare "power of attorney" added to the estates area gate (was only matching the long forms). |
| OOS captures contact + notary_services lane (DR-073, 2026-06-16) | **Two coupled fixes from a notary widget test.** (1) `out_of_scope` no longer stops immediately on web/SMS/GBP: it drives `present_insight` → `capture_contact` → `stop`, so OOS leads land as Band D triaging with contact and the "a lawyer will reach out" done screen is honored. Previously OOS stopped with no contact → rejected to `unconfirmed_inquiries` (no_contact_provided) → false promise + dropped lead. Voice/Meta (contact pre-seeded) stop on the first pass as before. (2) `notary_services`, the 29th matter type: a real but administrative DRG service, in-scope LOW-priority lane at fixed **Band C** (operator decision; in-queue, not bounced, not Band D). NOTARY_SIGNALS checked late in classify() so legal matters that mention notarizing stay in their lane; `getDecisionGap` short-circuits it (one doc-type question, then contact). |
| Readiness-triple priority scoped per matter chain, not global (DR-083, 2026-07-02) | **solo_setup and partner_setup (business_setup_advisory's two 10-slot chains) now offer the readiness triple after their first 4 matter facts, not only at the end.** Field case L-2026-06-09-DF5: a WhatsApp lead answered 12 matter facts and never got asked `hiring_timeline`, which suppresses the readiness axis and misbands the lead. A generalized `getDecisionGap`-wide threshold was tried first and reverted: it broke 3 sandbox `selector.test.ts` expectations for `shareholder_dispute` and `buy_in_or_joining`, confirming those chains are meant to finish before readiness. Every other matter type is untouched. |
| Contact-capture doctrine (2026-05-15) | **No contact, no lead.** Triggered by a Family Law smoke test that produced a "Forwarded to firm" brief with zero contact fields populated — the lawyer had no way to reach the person. Required for persistence: `client_name` AND (`client_email` OR `client_phone`). Briefs that fail the gate land in `unconfirmed_inquiries`, NEVER in `screened_leads`, NEVER in the triage portal. Engine `buildReport()` computes `LawyerReport.contact_complete`; every route (`/api/intake-v2`, `/api/voice-intake`, Meta receivers via `channel-intake-processor`) checks it before insert. Meta channels add multi-turn follow-up: state persists in `channel_intake_sessions`, a follow-up question is sent via the channel's Send API (Messenger / Instagram / WhatsApp), and after `MAX_FOLLOW_UPS=3` failed attempts the row moves to `unconfirmed_inquiries` with `reason='engine_refused'`. Hourly cron `/api/cron/expire-channel-intake-sessions` sweeps abandoned sessions to `unconfirmed_inquiries` with `reason='abandoned'`. Engine system prompt rule 9 instructs the LLM to ask for name + (email OR phone) and never finalise without them. Voice auto-passes via caller-ID phone seeding; if Voice AI fails to capture the name the row lands as `unconfirmed_inquiry` (SMS follow-back deferred). |

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
│   │   │           ├── pass/route.ts                   # Pass action
│   │   │           └── refer/route.ts                  # Refer action (Band D primary)
│   │   ├── cron/
│   │   │   ├── triage-backstop/route.ts                # Deadline-expiry sweeper
│   │   │   ├── webhook-retry/route.ts                  # Outbox retry sweeper
│   │   │   ├── expire-channel-intake-sessions/route.ts # Abandoned multi-turn session sweeper (contact-doctrine, hourly)
│   │   │   ├── expire-web-intake-sessions/route.ts     # Abandoned web-widget session sweeper (qualification audit item 5, hourly)
│   │   │   └── deadline-reminder/route.ts              # T-12h decision-window reminder (qualification audit F1, hourly)
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
    ├── screened-leads-labels.ts                        # Display labels
    ├── discovery-floor.ts                              # DR-060 minimum discovery floor (async finalize guard, lib/ not engine)
    ├── pending-slot-reply.ts                           # DR-061 routes a reply to the slot the bot asked + provenance overwrite + isUserGroundedFill
    ├── firm-resolver.ts                                # Meta asset ID → firm lookup (3 channels)
    ├── channel-intake-processor.ts                     # Shared server-side engine pipeline + multi-turn contact-capture loop
    ├── channel-intake-session-store.ts                 # Load/save/finalise channel_intake_sessions
    ├── web-intake-session-store.ts                     # Checkpoint/finalise web_intake_sessions (qualification audit item 5)
    ├── channel-send.ts                                 # Channel-agnostic Send dispatcher + follow-up phrasing
    ├── messenger-send.ts                               # Messenger Send API client
    ├── instagram-send.ts                               # Instagram Send API client (inherits Page token)
    ├── whatsapp-send.ts                                # WhatsApp Cloud API Send client
    ├── unconfirmed-inquiry.ts                          # persist to unconfirmed_inquiries (contact-doctrine reject path)
    ├── screen-engine/contact-doctrine.ts               # isContactComplete / evaluateContactGate (byte-for-byte mirror with sandbox)
    └── oos-area-labels.ts                              # OOS practice-area display labels (shared)
```

### Cron scheduling — Supabase pg_cron + pg_net

Crons are scheduled via Supabase pg_cron (no Vercel Pro dependency):

- `triage-backstop-hourly` — `7 * * * *`, calls `/api/cron/triage-backstop`
- `webhook-retry-5m` — `*/5 * * * *`, calls `/api/cron/webhook-retry`
- `token-expiry-check-daily` (`41 6 * * *`) calls `/api/cron/token-expiry-check`. Scheduled 2026-06-09 as pg_cron job 5; the four prior jobs verified green on the same pass.
- `deadline-reminder-hourly` (`37 * * * *`) calls `/api/cron/deadline-reminder`. Scheduled 2026-07-02 as pg_cron job 6. T-12h decision-window reminder to firm lawyers (qualification audit F1): triaging rows at least 12h old whose deadline falls within the next 12h get one reminder email before the backstop fires; stamped on `screened_leads.deadline_reminder_sent_at`.
- `expire-web-intake-sessions-hourly` (`17 * * * *`) calls `/api/cron/expire-web-intake-sessions`. Scheduled 2026-07-02 as pg_cron job 7. Web-widget drop-off sweep (qualification audit item 5): expired `web_intake_sessions` rows finalize into a thin `screened_leads` brief (contact-complete) or `unconfirmed_inquiries` (`reason='abandoned'`).

Migration `20260506_pg_cron_pg_net_setup.sql` enables `pg_cron` and `pg_net`, stores the bearer token in Supabase Vault as `pg_cron_token`, defines `cron_internal.call_cron_route(path)` (reads token from Vault, posts to `https://app.caseloadselect.ca` via pg_net), and schedules the two jobs.

Auth: routes accept either `CRON_SECRET` or `PG_CRON_TOKEN` via Bearer token (`lib/cron-auth.ts`, constant-time compare). Both tokens are also accepted by `/api/admin/webhook-outbox/*` for ops scripts. The operator can rotate one without affecting the other.

Run history is visible via `cron.job_run_details` and pg_net responses via `net._http_response`.

### Lead notifications (Band D doctrine, 2026-05-15)

Every persisted lead lands as `status='triaging'` with a band assigned by the engine and fires a fan-out email to all `firm_lawyers` rows with `role='lawyer'` for the firm. Doctrine: "The engine sorts attention, the lawyer decides outcome." OOS matters carry `band='D'` (refer-eligible) with a 96h decision window so the lawyer can Refer / Take / Pass. Auto-decline is removed from the intake path; decline-with-grace fires only on lawyer-initiated Pass or backstop expiry.

Three notification treatments share the navy header band but differ at the subject, eyebrow, status panel, and CTA:

- **Band A/B/C triaging** — subject prefix `Priority A —` / `New lead —`. Shows decision-window countdown, prompts Take / Pass. CTA: "Open the brief".
- **Band D triaging (refer-eligible OOS)** — subject `Priority D — Name · Refer opportunity · <Practice Area>`. Status panel explains the matter is outside the firm's practice areas, surfaces the 96h window, and offers Refer / Take / Pass. CTA: "Open the brief".
- **Declined** (dormant intake-path-wise; reserved for future engine-spam / abuse handling) — subject prefix `[Auto-filtered]`. Builder retained so a future spam-block path can engage it without re-writing.

**Channel-aware subject suffix:** when the inbound channel is anything other than `web`, the subject appends ` (via <label>)` — e.g. `Priority B — Sarah · Wrongful Dismissal (via WhatsApp)`. Web leads are silent (most common channel). The status panel in the email body also shows an "Inbound via" line for non-web channels.

All four entry points fire notifications: `/api/intake-v2` (web), `/api/voice-intake` (GHL Voice AI), and the three Meta-channel receivers via `lib/channel-intake-processor`. Builders are pure (`lib/lead-notify-pure.ts`); I/O wrapper (`lib/lead-notify.ts`) resolves recipients and dispatches via Resend. Best-effort — failure does not block intake. Falls back to legacy `branding.lawyer_email` when no firm_lawyers row exists.

**Operator inbox is `adriano@caseloadselect.ca` only (CRM Bible DR-047).** `OPERATOR_NOTIFICATION_EMAIL` env var and the `FALLBACK_OPERATOR_EMAIL` constant in `firm-onboarding-notification.ts` (and any sibling notification helper) point to that address. Personal addresses such as `adrianosortudo@gmail.com` are never substituted as fallback defaults, regardless of which env var is unset or what debugging context is active. The Claude Code profile-level `userEmail` is a separate identity (operator's Claude product login), not an operational inbox for CaseLoad Select.

### Compliance pages

- `/privacy` — PIPEDA-aware retention table tied to `lib/data-retention.ts`. Public.
- `/terms` — LSO Rule 4.2-1 calibrated. No outcome promises, lawyer-client relationship is between lead and engaged firm. Public.
- Footer links from portal, admin, login.

### Phase 4+ deferred

- Webhook delivery `vercel.json` cron (currently the Supabase pg_cron path; the Vercel slot remains unused)
- Supabase Realtime queue subscription (replace RefreshOnFocus)
- HMAC signature header on outbound webhooks (when GHL adds inbound shared-secret support)
- v5 operator dashboard reading from `screened_leads` (deferred until real lead flow accumulates)

## Channels (seven canonical)

Screen 2.0 produces lead briefs from seven input channels. The engine is the same for all of them; the channel field on `EngineState` carries the channel-specific behaviour (budget, contact pre-fill, brief chip, open-questions copy).

| Channel | Inbound surface | Engine where it runs | Endpoint |
|---|---|---|---|
| Web widget | `ScreenEnginePublicWidget` at `/widget-public/[firmId]` (this app); the Vite SPA sandbox at `caseload-screen-v2.vercel.app` is the operator demo surface only | Client-side (app engine) | `POST /api/intake-v2` (server-persisted) |
| Facebook Messenger | Meta webhook to a connected FB Page | Server-side via `lib/channel-intake-processor` | `POST /api/messenger-intake` (resolves firm by `intake_firms.facebook_page_id`) |
| Instagram DM | Meta webhook to a connected IG Business Account | Server-side via `lib/channel-intake-processor` | `POST /api/instagram-intake` (resolves firm by `intake_firms.instagram_business_account_id`) |
| WhatsApp | Meta Cloud API webhook to a connected Phone Number | Server-side via `lib/channel-intake-processor` | `POST /api/whatsapp-intake` (resolves firm by `intake_firms.whatsapp_phone_number_id`) |
| SMS / GBP | Vite SPA tabs (production handlers TBD per channel) | Client-side (sandbox engine) | `POST /api/intake-v2` (same persistence path) |
| Voice | GHL Voice AI inbound calls (DR-033, live for DRG) OR Vapi custom-LLM realtime loop (DR-048, code built 2026-06-11, pending deploy) | Server-side | DR-033: `POST /api/voice-intake` (post-call transcript). DR-048: `POST /api/voice-realtime/turn` (per-turn realtime) + `POST /api/voice-realtime/end` (hangup finalize). |

The three Meta-channel receivers share `lib/channel-intake-processor.ts` so the engine pipeline (initialiseState → seed sender → evidence pass → LLM extract → buildReport → render brief HTML → insert into `screened_leads` → fire new-lead notification → fire OOS webhook if needed) is identical across them. Firm resolution lives in `lib/firm-resolver.ts`. Asset-ID columns on `intake_firms` (added 2026-05-14): `facebook_page_id`, `instagram_business_account_id`, `whatsapp_phone_number_id`, each with a partial unique index. Receivers HMAC-verify via `lib/meta-webhook-auth.ts`, ACK 200 within ~1-2s, and run the engine in `waitUntil` so Meta does not retry on the 5-15s LLM call.

The engine port at `src/lib/screen-engine/` is a byte-for-byte mirror of the sandbox `src/engine/`. Discipline: changes land in both repos in the same commit, enforced by `bash scripts/check-engine-sync.sh`. See CRM Bible DR-033 for the architecture decision.

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

## Firm Onboarding Notification (CRM Bible DR-046)

When a firm fills out the public firm onboarding form (e.g. Damaris for DRG), the submit endpoint persists the intake row and notifies the operator. The notification path obeys four reliability invariants:

1. **Persistent delivery state.** The `firm_onboarding_intake` row carries `notification_sent_at`, `notification_error`, `notification_attempts`, `notification_last_attempt_at`. Migrations `20260520_firm_onboarding_directory_prep.sql` plus `20260520_firm_onboarding_notification_tracking.sql` applied.
2. **No silent error swallowing.** `src/lib/firm-onboarding-notification.ts` `sendOperatorNotification()` is the single helper; errors are logged to the row's `notification_error` field and surfaced in the API response. The submit route (`src/app/api/firm-onboarding/[token]/submit/route.ts`) delegates to the helper and does not wrap with a hiding try/catch.
3. **Manual retry endpoint.** `POST /api/admin/onboarding-submissions/[id]/retry-notification` reuses the same builder with a `[REPLAY]` subject prefix and an in-body callout.
4. **Admin UI visibility.** Each submission's detail page at `/admin/onboarding-submissions/[id]` renders `OnboardingNotificationPanel.tsx` showing a Pending / Sent / Failed badge with a "Send again" button.

`FALLBACK_OPERATOR_EMAIL` in `firm-onboarding-notification.ts` is hardcoded to `adriano@caseloadselect.ca` (DR-047).

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

## Language Position

CaseLoad Select is language-agnostic at intake, English at the lawyer surface. The CaseLoad Screen widget accepts intake in any language Gemini can handle. The screen engine auto-detects the lead's language and continues the conversation in that language. The brief the lawyer reads is always English — the screen engine translates the lead's responses to English when generating the structured brief. UI chrome defaults to English; the intake conversation does not.

This is a deliberate competitive position for the Toronto multilingual market. Four axes that must not be conflated:
1. Intake tool language (widget conversation, screen engine dialogue): matches the lead's language
2. Client language (the lead's native language): whatever it is
3. Brief language (the structured doc the lawyer reads): always English
4. Lawyer language capacity (the firm's ability to serve in a given language): per-lead decision, per-firm capability

Implementation notes:
- `screen-engine/llm/prompt.ts` `buildSystemPrompt()` includes rule 8 (MULTILINGUAL INPUT): extraction still uses English option strings verbatim; `__detected_language` gives Gemini the hook to return the ISO 639-1 code when franc confidence was below threshold (DR-035)
- `screened_leads.brief_html` is always English regardless of intake language
- `screened_leads.intake_language` stores the ISO 639-1 code of the lead's intake language (populated by both `/api/intake-v2` from the body field and `/api/voice-intake` from `state.language`). Migration: `20260512_intake_language_and_raw_transcript.sql`
- `screened_leads.raw_transcript` stores the lead's raw original-language text for LSO compliance and audit reference. For voice leads: the full call transcript. For web leads: the initial description when non-English. Never rendered in the triage portal
- Language detection pipeline: `franc` (extractor.ts) → `__detected_language` LLM confirmation when uncertain (schema.ts / control.ts) → `state.language` → persisted as `intake_language`
- Triage portal shows a language badge on the queue card and a callout banner on the brief page for non-English leads (`src/lib/intake-language-label.ts`)
- New-lead notification email includes the intake language when non-English (`lead-notify-pure.ts`, `lead-notify.ts`)
- GHL webhook `CommonEnvelope` now includes `intake_language` (v2 of the contract); GHL workflows can branch on this for language-capable routing or translated decline templates
- The triage portal is English-only; no language toggle or translation pane
- No per-firm language whitelist; every firm gets language-agnostic intake by default

## Do Not

- Build firm-facing admin panels or self-serve configuration
- Default to immigration examples (practice-area agnostic)
- Use mock or seed data in any production-facing component
- Change the tech stack without explicit instruction
- Use em dashes anywhere in copy or UI text
- Use banned AI vocabulary (delve, tapestry, landscape, pivotal, testament, vibrant, intricate, meticulous, garner, interplay, underscore, bolstered, fostering, showcasing, highlighting, emphasizing, enhance, crucial, enduring, boasts, align with, valuable)
- Allow orphan words (single word alone on last line of any text block)

## Portal Upgrades (2026-06-23)

Two portal features landed in one session, both lawyer-and-operator facing,
both gated by the existing magic-link auth (operator OR matching firm-lawyer;
client sessions excluded).

### Messaging upgrade (Phase 1)

Threaded replies, file attachments, and richer notifications on the existing
`matter_messages` surfaces.

- `matter_messages.parent_message_id` (migration `20260623_matter_messages_threading.sql`, applied). One level of threading; a reply cannot be replied to. `ON DELETE SET NULL` orphans replies rather than cascading.
- `MatterAttachment` type (`{ storage_path, signed_url?, name, size?, mime? }`). Attachments live in the `firm-files` bucket under a `message-attachments/` prefix (NO `firm_files` rows, so they stay out of the Files hub), signed at list time with a 1h TTL by `signAttachments()` in `lib/matter-messages.ts`.
- `POST /api/portal/[firmId]/matters/[matterId]/messages/upload` stores one file (25 MB cap, image/pdf/word/excel/text) and returns the attachment metadata for inclusion in the next message POST.
- Lawyer surface (`MessageThreads.tsx`): root + indented replies, Reply button, file picker, attachment chips. Client surface (`ComposeForm.tsx`): `router.refresh()` instead of full reload, file picker. Client matter page renders attachment links.
- `notification-batch` digest now carries the full message body, the matter `primary_name` as the section heading, and a per-matter deep link.

### Content approval (Phase 2)

The operator posts marketing deliverables; the firm's lawyer reviews,
annotates, and formally signs off. The sign-off is an LSO Rule 4.2-1
compliance record: append-only, timestamped, versioned, capturing signer
identity, IP, user agent, and the exact attestation copy.

Tables (migration `20260623_content_approval.sql`, applied; service-role only):

```
content_deliverables (id, firm_id, title, description, content_kind[text|image|pdf],
  status[draft|in_review|changes_requested|approved|archived], current_version_id,
  approved_version_id, approved_at, created_by_role, created_by_id, created_at, updated_at)
deliverable_versions (id, deliverable_id, firm_id, version_number, body_html,
  storage_path, asset_mime, asset_size_bytes, asset_name, note, created_by_*, created_at)
deliverable_comments (id, deliverable_id, version_id, firm_id, author_role, author_id,
  author_name, annotation jsonb, body, resolved, resolved_at, resolved_by_role,
  parent_comment_id, created_at)
approval_records (id, deliverable_id, version_id, firm_id, decision[approved|changes_requested],
  signer_role, signer_id, signer_name, signer_email, attestation, version_number,
  deliverable_title, ip_address, user_agent, note, created_at)   -- append-only
```

- Annotation model (`annotation` jsonb on a comment): `{type:'text',start,end,quote}` for a passage; `{type:'pin',x,y}` and `{type:'region',x,y,w,h}` (normalised 0..1) on images; `{type:'page',page}` on PDFs. A null annotation is a general comment.
- Version-drift guard: comments anchor to a `version_id`. Posting a new version returns the deliverable to `in_review` and clears `approved_version_id` (the prior `approval_records` row is retained as history). The approve route requires the signed version to be the current one (409 otherwise).
- Current-version invariant: any deliverable with versions has `current_version_id` pointing at the highest-numbered one. Enforced by an `AFTER INSERT` trigger on `deliverable_versions` (`deliverable_track_current_version`, migration `20260707_deliverable_current_version_invariant.sql`), so a direct insert that bypasses `addVersion` (seed scripts, bulk backfills, manual SQL) cannot leave the pointer null. Do NOT hand-set `current_version_id` in a seed and assume it is required; the trigger owns it. A null pointer while versions exist is the broken state that hid the sign-off Approve button (fixed 2026-07-07); the review UI now shows an explicit message if it ever recurs.
- Compliance posture: sign-off is LAWYER ONLY. The approve route enforces `role==='lawyer'` and a signer email on file; an operator viewing the firm portal cannot attest on the licensee's behalf. The attestation copy is frozen into `approval_records.attestation` (`APPROVAL_ATTESTATION` / `CHANGES_ATTESTATION` in `lib/deliverables-pure.ts`).
- Assets live in `firm-files` under a `deliverables/` prefix (no Files-hub rows), signed at read with a 1h TTL. Text bodies are sanitised on save via `sanitizeExplainerHtml`.
- Notifications reuse `notification_outbox` with four new event types (`deliverable_review_requested`, `deliverable_comment_added`, `deliverable_approved`, `deliverable_changes_requested`); the digest groups deliverable events by title with a deep link. Operator-bound events go to `OPERATOR_NOTIFICATION_EMAIL` (default `adriano@caseloadselect.ca`); firm-bound events fan out to enabled, non-disabled `firm_lawyers`.

Surfaces:

| Route | Purpose |
|---|---|
| `/portal/[firmId]/deliverables` | List + create (operator or lawyer). `?archived=1` includes archived. New "Deliverables" tab in `PortalTabNav`. |
| `/portal/[firmId]/deliverables/[id]` | Review surface: annotation layer (text select / image pin+region / PDF page-tag), comment thread with resolve, version history, post-new-version, sign-off panel (lawyer), approval record, archive. |
| `GET/POST /api/portal/[firmId]/deliverables` | List + create |
| `GET/PATCH /api/portal/[firmId]/deliverables/[id]` | Detail; PATCH `{action:'archive'}` |
| `POST .../[id]/versions` | New version: JSON `{body_html,note,responds_to_approval_id?}` for text, multipart `file+note+responds_to_approval_id?` for image/pdf (50 MB cap) |
| `POST .../[id]/comments` | Add comment `{version_id, body, annotation?, parent_comment_id?, approval_record_id?, attachments?}` |
| `PATCH .../[id]/comments/[commentId]` | Resolve / reopen `{resolved}` |
| `POST .../[id]/approve` | Lawyer sign-off `{version_id, decision, agreed, note?, attachments?}` |
| `POST .../[id]/attachments` | Upload one feedback image/PDF (25 MB cap), returns `{storage_path,name,size,mime}` for use in the comments/approve bodies above |

Key files: `lib/deliverables.ts` (I/O), `lib/deliverables-pure.ts` (validators, status machine, attestation copy), `lib/deliverables-auth.ts` (actor resolution), `components/portal/DeliverableReview.tsx` (the review client), `components/portal/DeliverableList.tsx`.

Operator dependency: a lawyer cannot sign off until an email is on file (`firm_lawyers.email` for the signed-in member, or `intake_firms.branding.lawyer_email`). For DRG, add Damaris via `/admin/access`.

**Change-request loop (DR-085, 2026-07-09).** Three additions to the append-only compliance record, none of which weaken it. Replies: a comment with `approval_record_id` set threads under the change-request record (server forces its `version_id` and null `annotation`; excluded from the passage margin and the open-comment count). Version-as-answer: a version posted while `changes_requested` links back via `deliverable_versions.responds_to_approval_id` (explicit id validated against this deliverable, or auto-linked to the latest open record when omitted); the composer quotes the open request, the approval-history panel renders "Addressed in vN..." instead of a dead end. Attachments: the change-request note and any reply may carry image/PDF evidence (`deliverables/{firmId}/{deliverableId}/feedback/` prefix, content-sniffed), frozen into `approval_records.attachments` at INSERT via the widened `record_approval_atomic` RPC, never by UPDATE. Migration `20260709_deliverable_change_request_loop.sql`. Build plan: `docs/BUILD_PLAN_deliverables_change_request_loop_v1.md`.

### Standing Publishing Authorization (DR-104, 2026-07-17; display language amended by DR-107, 2026-07-23)

A client-controlled, per-firm alternative to individual per-version lawyer
approval. Standing authorization permits release after QA; it does not
represent individual lawyer review of a particular version. Per DR-107
(2026-07-23), eligible in_review content displays as "Pre-approved" (ready
to publish per the operator schedule): a display state derived at render
time from the latest authorization event plus the current version's
requires_individual_review flag, never a stored status and never a
fabricated version-level approval record. Only the firm's own
lawyer/client decision-maker can turn it on or off, from
`/portal/[firmId]/how-your-content-works`; an operator can never enable it
for a client (checked both at the portal route, via `getFirmSession` which
structurally cannot admit an operator session, and independently at the
database layer).

State is append-only, migration `20260717230956_standing_publishing_authorization.sql`:

```
standing_publishing_authorizations (id, firm_id, event_seq [identity, the
  authoritative ordering column], event[enabled|disabled], actor_role[lawyer
  only], actor_id, actor_name, actor_email, authorization_text, policy_version,
  scope, notification_preference[per_publication|weekly_digest], reason,
  ip_address, user_agent, effective_at, created_at)  -- append-only, RPC-only
```

"Current state" is always derived by reading the latest row (`order by
event_seq desc limit 1`), never a separately-maintained boolean/projection.
Writes go exclusively through `set_standing_publishing_authorization`
(SECURITY DEFINER, owned by `postgres`), which locks the `intake_firms` row
so two concurrent enable/disable calls for the same firm serialize instead
of racing, and independently rejects any `actor_role` other than `'lawyer'`
as defense in depth against an application bug. `authorization_text` is
never accepted from the request body -- `buildStandingAuthorizationText()`
(`lib/standing-publishing-authorization.ts`) assembles the canonical,
firm-name-interpolated wording server-side, so the frozen copy can never
diverge from what the lawyer actually saw and confirmed.

**Operator-only exception.** `deliverable_versions.requires_individual_review`
(+ reason/actor audit columns) lets an operator force one specific version
back onto the individual-approval path -- "unusual, sensitive, uncertain, or
high-risk" content -- via `set_deliverable_version_individual_review_requirement`
(operator-only, independently enforced at the RPC layer, mirroring the
lawyer-only check above but inverted).

**Release-gate integration.** `claim_placement_for_publish` (see the
publishing-evidence system above) now accepts a version either because it
was individually approved (unchanged path A) or because the firm's latest
authorization event is `'enabled'` and the version does not carry the
individual-review exception (new path B, `standing_authorization`). Every
other gate the RPC already enforced -- version-must-be-current, no
competing active claim, no already-verified receipt -- is byte-for-byte
unchanged and applies identically on both paths; nothing upstream of this
substitution (QA, artifact validation, placement, metadata) is bypassed.
`publication_placement_claims.release_path` +
`standing_authorization_event_id` record which path authorized a given
claim; because the referenced `standing_publishing_authorizations` row is
itself immutable, that foreign key durably preserves the authorization
snapshot even after the firm later disables authorization --
`derive_publication_receipt_release_path()` propagates the same two
columns onto `publication_receipts` for any receipt that doesn't set them
explicitly. Status language keeps "Individually approved" distinct from
the DR-107 Pre-approved states (`components/portal/PublicationStatusSummary.tsx`);
the two are never merged into one label.

DRG Law was **not** silently activated from the WhatsApp conversation that
prompted this feature -- it ships with authorization off, and Damaris must
confirm through the portal herself so the system captures her authenticated
identity, the exact wording, and a durable audit event.

Key files: `lib/standing-publishing-authorization.ts` (I/O + canonical
text), `components/portal/StandingAuthorizationCard.tsx` (the on/off
control + inline confirmation), `components/portal/PublicationStatusSummary.tsx`
(deliverable-detail status). Postgres verification:
`scripts/verify-standing-publishing-authorization.sql` (rollback-wrapped,
run via the Supabase MCP against production) and
`src/lib/__tests__/standing-publishing-authorization-concurrency.integration.test.ts`
(gated on `DIRECT_DATABASE_URL`, same convention as the publication-claim
concurrency suite).

## Content Performance / Content-to-Matter Attribution (2026-07-17)

Content Studio's initial, evidence-first home for tracing an enquiry back to the published content it may relate to. Full doctrine: `docs/CONTENT_PERFORMANCE_ATTRIBUTION_MODEL.md`. Operator runbook: `docs/runbooks/content-performance-attribution-runbook.md`.

Core rule: every attribution fact carries both an **attribution state** (`known_first_touch` / `known_assisted` / `self_reported` / `offline_referral` / `unknown`) and a **provenance method** (`verified_utm` / `observed_referrer` / `verified_landing_path` / `self_report` / `operator_offline_referral` / `imported_crm_outcome` / `insufficient_evidence`). Never inferred from topic similarity or timing; a placement link is attached only on an exact `utm_content`/`utm_term` match against a real `content_placements.id`.

Table (migration `20260717030000_content_attribution_evidence.sql`, applied; service-role only, append-only, firm-scoped with a `validate_content_attribution_evidence_scope` cross-firm-reference guard trigger and the shared `block_append_only_mutation` trigger):

```
content_attribution_evidence (id, firm_id, screened_lead_id, deliverable_id, deliverable_version_id,
  placement_id, receipt_id, attribution_state, evidence_method, self_report_category,
  evidence_payload jsonb, evidence_note, observed_at, recorded_by_role, recorded_by_id,
  recorded_by_name, supersedes_evidence_id, created_at)   -- append-only

content_attribution_current   -- derived VIEW, not a table: best evidence per (firm, lead) by
                               -- state priority, left-joined to client_matters via
                               -- source_screened_lead_id. No stored "current attribution" state.
```

Reuses, never duplicates: `screened_leads` (lead subject, `utm_*`/`referrer` already captured by P12), `content_deliverables`/`deliverable_versions`/`content_placements`/`publication_receipts` (existing publishing-evidence chain), `client_matters` (existing qualified-matter/outcome source of truth via `source_screened_lead_id`).

Surfaces: `src/app/admin/content-studio/attribution/**` (operator: deliverable breakdown, attributed-lead list, per-lead evidence timeline + self-report/offline-referral entry form + per-lead observed-evidence sync button, date-range report) and `src/app/portal/[firmId]/content-performance/**` (client/lawyer-safe aggregate view, client sessions excluded, never exposes raw leads/contact/evidence notes -- only counts and pre-built sentences like "2 enquiries have a self-reported connection to this content"). Key files: `lib/content-attribution-pure.ts` (pure logic, deterministic matching, client-safe sentence builder), `lib/content-attribution.ts` (I/O layer).

Never touches consent (`consent_log`, `screened_leads.*_consent_*`) or the live customer-facing intake widget -- self-report/offline capture is operator-console-only by design; adding a source question to the public intake funnel is a distinct, higher-risk product decision this build explicitly deferred. Never a bulk historical backfill: `syncObservedEvidenceForLead` is deterministic and idempotent but always per-lead, operator-triggered.

**Placement-tagged tracking + release gate (Ses.21 follow-up).** `lib/content-placement-tracking-pure.ts` generates deterministic `utm_content=<placement id>` tracking parameters per placement, never a fabricated domain (`intake_firms` has none to guess). The receipts route (`.../placements/[placementId]/receipts`) rejects a `firm_website` receipt whose `public_url` does not carry the placement's exact tracking marker -- the one destination where this is honestly enforceable without assuming a domain. `PlacementsTrackingPanel.tsx` (operator-only, on the deliverable review page) surfaces the parameters for every destination as copy-paste help. LinkedIn/GBP/email are not hard-gated, consistent with `channel-validation.ts`'s existing unverifiable-beyond-attestation posture for those destinations.

### Surface-presentation adaptations (DR-105, 2026-07-19)

Republishing an already-approved version on a different destination surface (e.g. a native LinkedIn Article for a version whose source surface is the firm's website) is not automatically a new editorial version and does not by itself require the lawyer to re-approve, but it is also never something an agent drafts at publish time. This is doctrine and a documented registry only as of 2026-07-19; nothing in the app reads or enforces it yet (no `resolve_surface_presentation_adaptation` code path exists). Full policy: DR-105 in the decision registry (`00_System/01_Doctrine/DECISION_RECORDS.md`), the registry contract in `docs/publication-operator/surface-presentation-adaptation-registry.md`, and the preflight step design in `docs/publication-operator/publication-resolution-preflight-design-2026-07-19.md` §4.1a/§5. Agents:

- Resolve any destination-surface-required compliance wrapper (disclaimer banners, locale notices) by `firm + locale + source_surface + destination_surface`, never by copying the source surface's own wrapper verbatim onto a different surface.
- Use only an exact, pre-registered adaptation rule from the registry above. Never draft, paraphrase, translate, or improve compliance wording at publish time, even when the requested change looks minor.
- Never generalize one firm/locale/surface rule to any other firm, locale, or surface.
- Treat a missing registry rule as a preflight failure (`surface_adaptation_rule_missing`) that blocks that surface, not as license to invent the missing wording.
- Treat any request to change substantive content, legal claims, scope, CTA, translation, or the destination itself as `substantive_adaptation_requires_approval`, routed to the normal lawyer sign-off path, never resolved by an operator instruction alone.
- A LinkedIn post promoting an editorial piece links to that piece's matching live native LinkedIn Article when that is the configured routing rule; it must not silently fall back to the website URL just because no Article exists yet (report the gap instead).
- A source version is eligible for a Surface-Presentation Adaptation only when it is immutable and release-authorized (`immutable_release_authorized_version`) through either an individual lawyer approval, or an active standing publishing authorization covering a version that is not flagged `requires_individual_review` -- the same two-path bar `claim_placement_for_publish()` already applies, never a separate or looser one. When `requires_individual_review = true`, standing authorization is not sufficient and individual lawyer approval remains required.
- `platform_link_formatting`, where a matching rule allows it, may only re-render an already-approved, existing link in the destination platform's required format. It must never change the URL, the destination, the CTA target, or an anchor's meaning; add or remove a link; or substitute a website URL for a destination surface that requires the native LinkedIn Article URL specifically.
- Passing this policy resolves the compliance-wording objection only. It does not, by itself, close the LinkedIn/GBP `channel_auth_missing` gap (no publishing credential or API integration exists in this codebase for either), implement the runtime registry lookup, add deterministic output-diff validation, or capture adaptation evidence -- see the design document's §10 for that separate, not-yet-started implementation work.

## Build Roadmap

| Session | Scope | Status |
|---|---|---|
| S1 | Foundation (Supabase, auth, base schema) | DONE |
| S2 | Pipeline + Intake (kanban, CaseLoad Screen widget) | DONE |
| S3 | Scoring + Sequences (CPI engine, email automation, Resend) | DONE |
| S4 | Review + Recovery (WF-05 no-show, WF-06 stalled retainer, review requests) | DONE |
| S5 | Persistence + Nurture (WF-03, 6 nurture tracks) | DONE |
| S6 | Retainer Automation | **REMOVED FROM SCOPE 2026-05-06.** The dormant files (retainer.ts, docuseal.ts, docugenerate.ts, retainers/page.tsx, docuseal webhook) were deleted in commit c9b8cd2; only the dormant retainer_agreements table remains. The retainer document workflow is permanently lawyer-owned. |
| S7 | Migration Lockdown + Cron (schema freeze, vercel.json crons) | DONE |
| S8 | Client Portal (Clio API v4, magic link auth, firm dashboard) | DONE |
| S9 | Custom Domains + White-Label (Vercel API, CNAME, middleware routing) | DONE |
| Ses.4 | J5A, J5B, J6, Clio matter creation — full conversion flow | DONE |
| Ses.5 | PIPEDA, analytics dashboard, onboarding checklist | DONE |
| Ses.6 | Conflict check system, J2, J8–J12, send-sequences processor | DONE |
| Ses.7 | CaseLoad Screen 35-area expansion (interfaces, complexity indicators, value tiers, inference rules, default-question-modules, onboarding seeder), J7 Welcome/Onboarding migration + stage trigger | DONE |
| Ses.8 | Multilingual Screen Engine — language-agnostic intake, English at lawyer surface. i18n Steps 1-10 (slot options, summary labels, summary text, prompts, bridge text, chip catalogue, engine sync) + full multilingual build (schema migration, prompt rule 8, intake_language + raw_transcript persistence, triage portal language badges, notification email language note, GHL webhook v2 envelope, intake-language-label utility). Sandbox engine byte-for-byte mirror maintained. | DONE |
| Ses.9 voice | Voice channel build-out — GHL Voice AI agent for DRG, /api/voice-intake architecture (API-fetch primary via Voice AI Public API list endpoint, body-fallback for resilience), voice agent prompt iterations v1→v2.5 (CALL COMPLETION GATE + GATE ATTEMPT LIMITS + mandatory surname spelling + bot-line classifier strip + ACTIVE LISTENING + caller-ID lead + no-third-party-names + decision-maker question fix). Per-firm `voice_api_token` + `ghl_location_id` columns on intake_firms. | DONE |
| Ses.9 engine Phase A | Engine expansion — employment + estates moved from out_of_scope hard-route into in-scope `*_general` matter packs with proper banding (routes through `bandRoutingLane` not forced D). Adds `employment_general` and `estates_general` matter_types with full matter packs (snapshot, services, fee, strategic, openers, what-to-confirm, cross-sell, risk flags). | DONE |
| Ses.9 engine Phase B | Sub-type packs deepen Phase A — 9 new matter_types: wrongful_dismissal, severance_review, harassment_complaint, wage_recovery, employment_contract_review for employment; will_drafting, power_of_attorney, probate, estate_dispute for estates. Each carries Ontario-tuned fee ranges, Bardal/Waksdale/HRTO/EAT/SLRA-aware flags, sub-shape strategic considerations and call openers. Routes through the four-axis scorer for proper A/B/C/D banding. | DONE |
| Ses.9 brief | NAP block at top of every brief (Name + Phone + Postal code + Email, source-provenance chips). Full-name extraction (multi-word regex + bot-confirmation upgrade for voice transcripts). Postal-code extraction (canonical + bot phonetic forms). New `client_postal_code` slot. Admin reclassify route + backfill. Bot-line classifier strip prevents bot opening narration from polluting matter classification. | DONE |
| Ses.9 S8 Phase 1 | All 16 stories shipped — client_matters state machine + matter_messages + welcome draft + client magic-link + matter-stage home + lawyer active-clients home + per-client internal chat data plane + notification batching cron + explainer library + folder-lock + mass-message broadcast + branded subdomain middleware + Band A post-OTP kickoff composition + iframe embed slot. 7 SQL migrations applied. PortalRole widened to include `client` with matter-scoped session helper. Take handler creates client_matters on Band A. 1894/1894 tests pass. | DONE |
| Ses.10 triage UX | NAP-first triage queue card redesign (band chip + name 22px + click-to-call/email + arrival timestamp as secondary row, matter type and channel demoted to tags). Smart search layer (`lib/triage-search.ts`) with token-aware multi-word AND, quoted phrases, negation (`-channel:voice`), field qualifiers, Damerau-Levenshtein fuzzy matching, ranked scoring, match highlighting via `<mark>`. Saved-view chips (Top priority / Whales / Voice / Stale 4h+) plus user-defined views and search history both persisted to localStorage per firm. Keyboard shortcuts (`/` focus, `↑↓` navigate, `Esc` clear). | DONE |
| Ses.10 engine + ops hygiene | #94 universal contact slots applies_to (covers all 26 matter types + unknown/OOS, was 7 Corporate only). #92 graceful contact-capture exhaustion message before unconfirmed_inquiries drop. #96 LLM uncertainty preservation through merge (lead said "not sure" → keep "Not sure" extracted, instead of dropping as Gemini hedging). #90 token-expiry monitoring (6 columns on intake_firms + `lib/token-expiry.ts` helper + `/api/cron/token-expiry-check` route). #91 purged 6 stale Adriano voice smoke-test rows from unconfirmed_inquiries (DRG, May 21-22). #93 Meta App Review screencast test message changed from immigration (OOS for DRG) to wrongful_dismissal (Phase B in-scope, rich brief). 2370/2370 tests pass. | DONE |
| Ses.11 brief polish + calibration | Brief UX pass (commits `5cf8b65` brand alignment, `db89dfa` scan-speed + mobile, `e9fb789` inline action rail via DR-057). Action bar dropped fixed positioning, mounts inline via `ACTION_RAIL_SLOT` marker. Grid rebalanced 1.7fr/0.95fr to 2.2fr/0.85fr. Sidebar modules differentiated by semantic weight (navy caution / gold action / muted passive). Mobile reorder via `display:contents` + CSS `order`. Calibration pass (commit `34450d5` per DR-055 + DR-056): `business_setup_advisory` value tiers recalibrated ($30-100k 4→2, $100-500k 5→4), "Already operating" urgency gated on material exposure (+4 vs +1), bi-directional small-ticket gate. Subtrack persistence + hardening (commit `4867225` per DR-054): `LawyerReport.advisory_subtrack` required, `decision_authority` reads as tertiary signal, `band.ts` defense-in-depth re-derivation. 34 new regression tests across two new files (`business-setup-advisory-band.test.ts` + `advisory-subtrack-classification.test.ts`). Sandbox mirrored for the five touched engine files. 2789/2789 tests pass. | DONE |
| Ses.12 async intake turn integrity | DRG WhatsApp launch-week repeat/loop class killed across five commits (`9fff6ce` minimum discovery floor, `148750a` name-capture context, `ea8a092` pending-slot routing, `0724950` provenance overwrite, `2335338` no-repeat sticky + leading-junk digit tolerance). One root-cause family: the engine's `getNextStep` prefers a different slot than the bot asked last turn, so the lead's reply was lost, mis-routed, or the slot was re-asked with a name question wedged between. New processor-side helpers `discovery-floor.ts` + `pending-slot-reply.ts` (both `lib/`, no engine mirror); `pendingAskedSlotId` added to types.ts (mirrored) and `didnt_catch` to pt.json (mirrored). CRM Bible DR-060 + DR-061. 32 new regression tests across three new files (min-discovery 15, name-capture-resume 7, pending-slot 8, plus the provenance-overwrite + leading-junk cases). App 3058/3058 + sandbox 382/382 pass. Engine logic untouched (the `screen-engine/*.ts` provenance drift from #169 remains DR-058 deferred). | DONE |
| Ses.13 launch hardening | Full-app launch audit (`Version3_CaseLoadSelect/CaseLoad_Screen_Launch_Audit_2026-06-09.md`) + two fix waves: auth sweep (DR-063), sliding session expiry + contact-aware sweep (DR-064), webhook idempotency (DR-065), notification delivery state (DR-066), matter_stage_changed GHL event (DR-067), engine-sandbox sync + redeploy (DR-068), OTP attempt cap + LLM proxy rate limits, lockdown migration recovery, token-expiry cron scheduled. Suite 3090 to 3325 tests. | DONE |
| Ses.14 Voice v2 (DR-048) | Engine-owned realtime voice loop on Vapi HTTP shape. 5 new lib files: `src/lib/voice-realtime/{voice-session-store,run-engine-turn,tts-shaping,finalize,turn-handler}.ts` + 2 new routes: `src/app/api/voice-realtime/{turn,end}/route.ts`. `voice_turn_sessions` migration APPLIED to prod (verified 2026-07-02). `QUESTION_BUDGET_BY_CHANNEL.voice` raised 3 to 8. Zero TypeScript errors. Pending (operator/vendor-account steps, outside Claude's access): `VAPI_SERVER_SECRET` env var, Vapi assistant config (Custom LLM URL + end-of-call webhook), DRG phone forwarding, vendor spike (Vapi 4h then Twilio ConversationRelay 4h per Appendix A.5 of build plan). DR-033 GHL path stays active until cutover. | IN PROGRESS |
| Ses.15 Content Studio SEO/AEO | Full 5-step operator-confirmed build order from `docs/CONTENT_STUDIO_SEO_AEO_SPEC.md` Section 10, all independently verified via local `vitest`/`tsc` runs (zero TS errors throughout): (1) structured-output branch for `canonical_service_page` (`content-studio-structured.ts`: tool-use JSON schema, prompt builders, deterministic assembly; storage into the pre-existing `body_structured`/`seo_metadata` JSONB columns, no migration; 22 tests). (2) Response-schema validation folded into (1). (3) Nine AEO/SEO validators (`content-validators.ts`: `validateNamedAuthorPresent`, `validateFaqBlockPresent`, `validateAnswerInTop30Percent`, `validateLastUpdatedDateVisible`, `validatePrimaryQueryPresence`, `validateJurisdictionAndServiceAreaEarly`, `validateInternalLinksPresent`, `validateFaqQuestionsAreQuestionShaped`, `validateSchemaDirectivesPresent`) wired into `validate/route.ts`'s `canonical_service_page` branch (34 tests). (4) Admin preview renderer `renderServicePagePreview` (`content-studio-structured.ts`, HTML escaped before any markup reintroduction, JSON-LD returned separately from `html` per operator instruction) wired into `admin/content-studio/[id]/page.tsx` (29 tests). (5) `counsel_note`/`checklist` retrofit: `buildSystemPrompt`/`buildUserPrompt` extracted from `draft/route.ts` into new `content-studio-prompt.ts` (format-agnostic, directly unit-testable, `import type` only for `StrategyRow` to dodge `content-studio.ts`'s real `server-only` import); SEO/AEO prompt layer + stricter answer-first opening discipline, both gated on `source_brief.primary_query`; three new plain-text validators (`validateAnswerInTop30PercentText`, `validatePrimaryQueryPresenceText`, `validateJurisdictionServiceAreaEarlyText`) gated into `runDeterministicValidators` (11 + 48 tests). Zero schema/migration/Supabase changes across all 5 steps; Task #12 / Lane 1 do-not-touch list held throughout. `import "server-only"` removed from `content-validators.ts` (pure logic, no I/O; the real package throws unconditionally on import and was breaking its own vitest file). Known gaps, not yet closed: no domain-allowlist check on `internal_link_targets` URLs (spec Section 8); named-author/FAQ-block/last-updated/schema-directives validators still not retrofitted to Markdown formats (would need `body_structured`/`seo_metadata` population that `counsel_note`/`checklist` don't have); `checklist`'s SEO fields belonging on the wrapping `landing_page` (spec Section 2) is a documented authoring convention, not a code-enforced one. End-to-end smoke test EXECUTED against prod 2026-07-05 (piece `16eba76a-5690-41a2-9e5e-09b7310f6460`, title prefixed SMOKE TEST, left in live storage for inspection): create piece via API, gate advance, draft generation (claude-sonnet-5, 12 blocks, 4 JSON-LD schema blocks), 9/9 validators pass, admin preview renders with populated Validator Results panel. Four real-workflow defects the unit tests could not see, all fixed + deployed same day: (1) piece-creation route `validFormats` had drifted from the `content_pieces_format_check` CHECK, so `canonical_service_page` (and `checklist`/`landing_page`) could not be created through the API at all (commit d99b4df); (2) hardcoded model `claude-sonnet-4-20250514` retired upstream, returning 404; now `CONTENT_STUDIO_MODEL` env override with `claude-sonnet-5` default (4992aca); (3) without constrained decoding the model emitted `sections` as a malformed JSON string; fixed with Anthropic strict structured outputs (`strict: true` + `anthropic-beta: structured-outputs-2025-11-13`; strict requires `additionalProperties: false` on every object node and rejects `minItems` above 1, so the FAQ floor moved to the post-hoc validator) plus `max_tokens` 4096 to 16384 and an explicit truncation error path (8904901, d774ec2); (4) `recordValidationRun` never stamped `piece_id`, so the admin page (which queries runs by `piece_id`) could never show validation results (28c87bf, which also carried the `buildValidatorConfig` flag plumbing). Live-data gap, not code: the DRG strategy row has no `strategy_json.canonical_nap` (breadcrumb JSON-LD URLs incomplete, warning surfaced in the draft response), no `authority_assets`, no `voice_rules.approved_ctas`, and no `format_specs.canonical_service_page` entry; populate before real service-page production. Lane 1 (Task #12 migration reconciliation, `RUNBOOK_20260626_content_studio_apply.md` Steps 5-6) remains the next lane. | DONE |
| Ses.16 Content Studio ends-of-pipeline | Autonomous run of `docs/CONTENT_STUDIO_NEXT20_BUILD_PLAN.md` (operator-authorized, zero-input execution against the live DRG firm; stop-lines held throughout: no notification reached Damaris, no public surface was touched, no migration was authored or applied). Took Content Studio from ~63% to ~83% of its product goal by building the two ends the Ses.15 audit found missing: legal-gate enforcement and a publish path. **WP-1** (strategy data): found the SEO/AEO entity facts (`canonical_nap`, `authority_assets`, `approved_ctas`, `format_specs.canonical_service_page`) already fully authored in `drg_strategy_v2.upload.json` (a prepared but never-executed v2 strategy upgrade, separate `upload_drg_strategy_v2.mjs` script, NOT run since it bumps name/version and archives v1, out of scope for "same id, same version" data completion) and merged just those four fields into the live v1 row in place; verified live (smoke piece's `breadcrumb_urls_incomplete` warning cleared, JSON-LD carries the real NAP entity). **WP-2** (`content-studio-gates.ts`, pure, 12 tests): `draft -> legal_gate` now requires a current version with a zero-fail validation run; `legal_gate -> authoring/production` now requires the linked deliverable approved or an active publish delegation (guarded read, `content_publish_delegations` is staged not applied). Advancing into legal_gate auto-creates the deliverable via the existing approval system with `addVersion({silent: true})`, so zero notifications reach the firm; `content_pieces.deliverable_id` links it; the admin page shows deliverable status + a live blocked-reason hint computed with the same pure functions the route enforces. Verified live: entry/exit blocks tested and confirmed, `review_notified_at` null, zero `notification_outbox` rows. **WP-3** (export/publish, `renderServicePageExport`/`renderMarkdownExport`, 6 tests): standalone HTML bundle (real DRG brand tokens from `drg-law-website/globals.css`, the DR-082 LSO banner before content verbatim from the live site copy, JSON-LD with `</script>`-breakout escaping) written to `firm-files` under `exports/content-studio/<id>/v<n>/`; `POST .../publish-record` stamps `{url,at,exported_version}` onto the CURRENT VERSION's `seo_metadata` (not `source_brief`) and sets the already-legal `status='published'`; both gated behind the same WP-2 exit condition, shared via a new `resolvePublishGateStatus` helper in `content-studio.ts`. Verified live end-to-end on the smoke piece (deliverable force-approved via direct SQL, explicitly only on that labeled fixture): exported bundle passed a zero-banned-vocabulary sweep against the strategy's own list. **WP-4** (the factory run, 5 real DRG pieces from the 5 stale calendar slots, briefs grounded in `06_Clients/DRGLaw` strategy docs + the live `drg-law-website` journal with zero overlap found): the first pass failed all 5 after 3 retries each, but the SAME 2-3 failure categories recurred across unrelated pieces and unrelated regenerations, which does not fit random model variance, so investigated before accepting per the standing engine-investigation protocol. Found and fixed three real, pre-existing, previously-uncovered defects in `content-validators.ts`/`content-studio-prompt.ts` (19 new regression tests, 128/128 total pass): `validateItalicsMarkup` counted every `**bold**` phrase as italics (regex captured `*text*` hiding inside `**text**`); `validateLsoCompliance`'s bare `guarantee` pattern flagged the legal noun "personal guarantee" (load-bearing in commercial-lease content) as an outcome-promise violation; `buildSystemPrompt` never surfaced `format_specs.<format>.five_line_brief`'s literal labels to the model even though the validator checks for them literally. Bonus fix from the new tests: `/\b#\s*1\b/i` could never match (`#` is not a word character). After the fixes, 4 of 5 pieces passed on re-validate with zero regeneration; the 5th (counsel_letter) needed its brief patched twice more (missing `legal_distinction`, then explicit CASL footer instruction using DRG's real, verified contact facts) before passing. All 5 pieces confirmed live at `legal_gate` with an `in_review` deliverable each, zero notifications fired, all 5 calendar slots flipped to `briefed`. **WP-5**: read-only coverage report at `/admin/content-studio/coverage?firm_id=` (title, format, primary_query, gate, deliverable status, published URL, last validation verdict, plus an unbriefed-slots block); verified live rendering all 6 pieces correctly. Six real pieces now sit in this firm's Content Studio, one (the smoke piece) carrying a test-only force-approved publish record, five awaiting Damaris's actual review. Next: Damaris reviews the 5 pieces in the portal; after that, Lane 1 (Task #12) resumes as the other open lane. | DONE |
| Ses.17 Content Studio finish | Autonomous run of `docs/CONTENT_STUDIO_FINISH_BUILD_PLAN.md` (operator-authorized, zero-input execution against the live DRG firm; all six stop-lines held throughout: no notification reached Damaris on any of the ~15 fixture pieces created and archived this run, no public surface was touched, no `supabase/` file was created/modified/committed, `screen-engine/` was never touched, the 5 real review-queue pieces were never regenerated/edited/archived/advanced). Took Content Studio from ~83% to 100% of the buildable-without-migration definition stated in the plan's own preamble. Commits `6243275`..`1e23d44`. **WP-0/1** (from the prior session's tail, folded into this run's continuity): SMOKE TEST piece archived, the five missing `format_specs` keys merged. **WP-2** (revision loop): `draft/route.ts` gate widened to `draft`+`legal_gate`; new `PUT .../version` (operator edit, auto-validates, carries `seo_metadata` forward) and `POST .../send-to-review` (posts current version(s) to the linked deliverable via `addVersion({silent:true})`, triggers the existing drift guard) routes; edit UI on the piece page. **WP-3** (validator/schema completion, `6243275`): Article JSON-LD + `generated_at` last-updated marker for every Markdown format (`buildArticleSchemaBlock`/`buildMarkdownSeoMetadata` in `content-studio-prompt.ts`); `validateInternalLinkDomains` (new `content-studio-links.ts`, also filters non-firm-host links out of the prompt before generation); four new AEO/SEO validators (`validateHeadingQueryAlignment`, `validateEntityPresent`, `validateSecondaryQueryCoverage`, `validateServiceAreaPresence`); cross-piece `no_cannibalization` check in `content-studio.ts` (I/O, corpus query, not a pure validator). Found live and fixed same day (`7c9e707`): the WP-2 edit route never carried `seo_metadata` forward for Markdown edits, silently dropping the Article schema on any operator edit. Also found and fixed: `renderMarkdownExport` never read `seo_metadata.schema` at all, so the WP-3 Article block never reached the export bundle; it now emits every `schema.*` block as its own JSON-LD script tag. **WP-4** (Portuguese authoring, `e61b180` + `1efc627` + `833023c`): `draft`/`validate`/`export` routes accept `{language:'pt'}` (400 on a non-bilingual piece); PT system-prompt layer (meaning parity, never translated, explicit jurisdiction disclosure) with PT-filtered reference samples; reduced 6-check PT validator battery (`runPtValidators`: em dash, italics, orphan words, word count, rule of three, plus new `pt_jurisdiction_disclosure`); `checkBilingualAuthoringCondition` blocks a bilingual piece from leaving `legal_gate` without a current PT version; `send-to-review` posts both languages in one deliverable version behind a labeled divider; PT export renders the Portuguese LSO banner (`LSO_DISCLAIMER_HEADLINE_PT`/`_BODY_PT`, read verbatim from `drg-law-website/src/lib/i18n.ts`, read-only reference). Found live and fixed same day: a bilingual FIXTURE piece with a Portuguese-worded brief produced Portuguese content for its "EN" version too, because only the PT branch had an explicit language directive; both `buildSystemPrompt` (Markdown) and the structured `canonical_service_page` branch now state the target language explicitly in both directions (`buildEnLanguageDirective`/`buildPtLanguageDirective`). **WP-5** (the three previously-blocked compliance formats, `eb92cf9` + `8aed9fe` + `a740064`): `paid_traffic_landing`, `review_request`, `review_response` now draft through the existing Markdown path (removed from the retired `STRUCTURED_OUTPUT_REQUIRED_FORMATS` set entirely) rather than a new structured-output branch, since none of the three need JSON-LD or a FAQ block; entity facts (credentials, testimonials, CASL sender identification, the actual review being responded to) are injected into the system prompt as literal verbatim text the model must reproduce, never invented (Article IV). `review_response` requires `source_brief.review_context.review_text` (422 otherwise); its `rating` drives TEARS negative/positive subformat selection. The pre-existing compliance validators (`validateReviewRequest`, `validateNegativeReviewResponse`, `validateNoFreeConsultLure`, `validateNoDistressHero`, `validateNoUsTrustBadges`, `validateNoLsaQualityClaim`) were already fully wired into `runDeterministicValidators` before this session, just unreachable because nothing could draft these formats; zero new validator wiring was needed. Found live and fixed same day: `validateSourceIntegrity` ran unconditionally for every format with a `source_brief`, requiring `decision_question`/`legal_distinction`/`consequence` even for formats that never use that brief shape, failing a clean `review_request` draft for fields the format was never designed around; and the negative-review switch-channels regex only matched the literal phrases "call the firm"/"email the firm", missing a genuinely compliant close ("please call the office or send an email directly to the firm"), the same false-negative class as the Ses.16 italics/guarantee validators. Both `validateNegativeReviewResponse` and `validateReviewRequest` had zero test coverage before this session; both now have first coverage. **WP-6** (coverage truth + final sweep, `1e23d44`): coverage page gained a PT column (Exists/Missing/EN-only) and a cannibalization column fed by the WP-3 check's latest stored result; full suite (4754 tests, 221 files) and `tsc --noEmit` clean throughout; every WP's acceptance line re-verified live against prod (see the delivery report in this session's transcript for the exact verification trail). All ~15 fixture pieces created during this run (prefixed `FIXTURE:`) are archived along with their deliverables; the coverage report shows exactly the 5 real review-queue pieces, zero `FIXTURE:` rows, zero notifications fired to the firm across the entire run. Human-gated remainder, unchanged from Ses.16: Damaris reviews the 5 real pieces; live publishing to drglaw.ca stays an explicit operator action; Task #12 / Lane 1 (schema reconciliation) is a separate, still-open lane this plan explicitly excluded. | DONE |
| Ses.18 Firm Assist v1 | New surface: `POST /api/assist/[firmId]`, a per-firm website-grounded question-answering endpoint (DR-100, DR-101, DR-102, doctrine registered in `00_System/01_Doctrine/DECISION_RECORDS.md`), built to counter a competitor product (JurisDigital's WordPress RAG chatbot) with an LSO-compliant, Screen-integrated version. Full build plan: `docs/BUILD_PLAN_firm_assist_v1.md`. Merged via PRs #34, #36, #38, all CI-green, all live-verified against production. **Phase 1** (schema + ingestion): `assist_corpus_pages`/`assist_corpus_chunks`/`assist_queries` (pgvector, HNSW cosine index, RLS-forced service-role-only), sitemap-based page discovery with DR-101 default seed-exclude rules (privacy/terms/thank-you/taxonomy/pagination/non-HTML), heading-aware chunker, `match_assist_chunks` SECURITY DEFINER RPC (supabase-js cannot express pgvector `<=>` directly). **Phase 2** (`src/lib/assist/`): the answer prompt (`answer-prompt.ts`) is corpus-bound with a hard case-specific-question refusal that hands off to the Screen, never leaves the retrieved chunks, treats chunks and the question as untrusted content; CORS-gated public route (`embed_origins` allow-list, no iframe, real cross-origin `fetch`); new `assist` rate-limit bucket. **Phase 3** (drg-law-website repo, separate CLI-deployed project): `AskTheFirm.tsx`, a capability-gated client component mounted in the shared `PillarV3Page`/`ArticleBlocks`/`faq` renderers but restricted to a `PILOT_PATHS` allow-list (`/faq`, `/pt/faq`, `/journal/read-before-sign`, `/journal/commercial-lease-clauses-ontario`) so the shared-component architecture doesn't accidentally go live sitewide. **Phase 4**: `/admin/firms/[firmId]/assist` operator console (page list with include toggles, reindex trigger, query log), nav entry added to `FirmSwitcher.tsx`. 82 new tests, zero regressions in the existing 4850-test suite, `tsc --noEmit` clean. **Live verification surfaced two real defects unit tests could not catch** (same class as the Ses.15/16 pattern: the unit suite proves the code path, not the live API/data): `text-embedding-004` is not available on this project's Gemini API key (`ListModels` confirmed only `gemini-embedding-001` supports `embedContent`; switched to direct REST calls with `outputDimensionality: 768`, since the SDK's request types don't expose it); the real drglaw.ca site renders apostrophes as `&#x27;` hex numeric character references, which the named-entity-only decoder left literal in retrieved chunk text (`decodeEntities` now resolves numeric refs generically via `String.fromCodePoint`). DRG's live corpus is seeded and indexed (74 URLs discovered, 70 included, 698 chunks, zero errors after both fixes) and confirmed working end to end via a real browser driving the live `AskTheFirm` module on drglaw.ca: informational answers render with real source links, case-specific questions hand off to `#matter-review` with fixed compliance copy (never model-generated), out-of-corpus questions get the fixed miss copy, and the module is correctly absent on non-pilot pages. `ASSIST_HASH_SALT` set in app Vercel prod; `NEXT_PUBLIC_CASELOAD_SELECT_URL`/`NEXT_PUBLIC_CASELOAD_SELECT_FIRM_ID` set in DRG site Vercel prod; DRG's `intake_firms.embed_origins` updated for `drglaw.ca`. Open: weekly pg_cron reindex schedule not yet wired (route exists, cron entry is an operator SQL step); Upstash rate-limit vars still unset (pre-existing repo-wide posture, now also gates the assist bucket); Phase 5 (content-gap mining into Content Studio) deferred pending real query volume. | DONE |

| Ses.19 Direct answer / quotable definition rule | Formalized "quotable definition" from an implicit outcome of existing editorial practice into an explicit, enforceable AEO doctrine (task-directed build, PR pending). **Zero schema migration**: the decision lives on `content_pieces.source_brief.direct_answer` (operator-authored, same no-new-column JSONB pattern `docs/CONTENT_STUDIO_SEO_AEO_SPEC.md` already used for `answer_summary`), snapshotted onto `content_piece_versions.seo_metadata.direct_answer` at draft/edit time by `buildSeoMetadata`/`buildMarkdownSeoMetadata`, the exact mechanism every other SEO/AEO field in this system already uses. New pure module `src/lib/content-studio-direct-answer.ts` (types: `applicability` required/optional/not_applicable, `classification` binding_rule/market_practice/firm_judgment/illustration/explanatory, `source_status` mapped/not_required/exempted; format-applicability sets mirroring `validateSourceIntegrity`'s existing `NO_DECISION_BRIEF_FORMATS` exemption). New validator `validateDirectAnswerDefinition` in `content-validators.ts`, wired into both `runDeterministicValidators` (Markdown, reads live `sourceBrief.direct_answer`) and `runCanonicalServicePageValidators` (structured, reads the version-bound `seoMetadata.direct_answer` snapshot) so it runs for every format that generates today; proportionate by design (silent pass on exempt formats with no decision, fail only on a long-form format's silent omission, warn-only on the false-universality and presence-in-first-30% heuristics, matching `validateAnswerInTop30PercentText`'s existing pattern). Lawyer review: `renderDirectAnswerSummary` in `content-studio-review.ts` renders the decision, classification, scope, and source status into the same `body_html` `renderReviewPayload` already produces, so it rides the existing approval-identity byte-comparison with no new staleness mechanism, no new approval action, and no change to the lawyer-only sign-off invariant. Operator UX: new "Direct answer / quotable definition" section in `SourceBriefForm` (`components.tsx`), format-aware guidance, forces an intentional choice on the 7 long-form formats. Doctrine: new Section 4A in `docs/CONTENT_STUDIO_SEO_AEO_SPEC.md` (good/bad examples, format matrix, validator behavior, locale note). Read-only audit: `docs/audits/DIRECT-ANSWER-COVERAGE-AUDIT-2026-07-17.md`, queried prod via Supabase MCP, heuristically classified the 5 real review-queue pieces as candidates without mutating any of them. Boundary note added to `src/app/api/tools/seo-check/route.ts`'s "Direct-answer sentences" check: that public/operator tool is confirmed fully disconnected from Content Studio's own AEO validator battery (verified during discovery, zero cross-imports either direction); this session's validator is the authoritative check for CaseLoad-authored content, the seo-check tool's heuristic is unchanged. 5419/5419 existing tests pass (zero regressions from the two new formats now requiring a decision on `canonical_service_page`, since no pre-existing fixture asserted a "well-formed" canonical service page had zero findings without also updating its own fixture in this same session), `tsc --noEmit` clean (ignoring 8 pre-existing `pg`-module errors in an unrelated integration-test file, present before this session, `pg` declared in `package.json` but not installed in the main worktree either). | IN PROGRESS |
| Ses.20 Content Performance / Content-to-Matter Attribution | Autonomous, task-directed build (operator-authorized) of Content Studio's first content-to-matter attribution surface. Full doctrine: `docs/CONTENT_PERFORMANCE_ATTRIBUTION_MODEL.md`. **Data model**: one additive migration, `20260717030000_content_attribution_evidence.sql` (APPLIED to prod via Supabase MCP, verified live: table + view queryable, both triggers attached, RLS forced, security advisor clean aside from the expected "RLS enabled no policy" INFO finding every other Content Studio table also carries). `content_attribution_evidence` is append-only (evidence state + provenance method + payload/note + observed/recorded actor), firm-scoped with a `validate_content_attribution_evidence_scope` cross-reference guard trigger mirroring `content_placements`/`publication_receipts`; `content_attribution_current` is a derived VIEW (`security_invoker = true`, not a materialized table) ranking evidence by state priority and left-joining the existing `client_matters` outcome via `source_screened_lead_id` -- no mutable "current attribution" field exists anywhere. **App layer**: `lib/content-attribution-pure.ts` (deterministic UTM/referrer-to-placement matching, exact-id-match only, no fuzzy/topic inference; client-safe sentence builder that never says "generated" or "client," only evidence-graded "N enquiries have a connection"), `lib/content-attribution.ts` (I/O layer, `syncObservedEvidenceForLead` idempotent and per-lead-triggered, never a bulk backfill). **Surfaces**: operator `/admin/content-studio/attribution/**` (deliverable breakdown, attributed-lead list, per-lead evidence timeline + self-report/offline-referral entry form + observed-evidence sync button, date-range report with data-sufficiency-gated "what we learned"), portal `/portal/[firmId]/content-performance` (client-safe aggregate, client sessions excluded, zero raw lead/contact/evidence-note exposure). **Explicitly excluded** (see doctrine doc): Supabase baseline branch, Publication Operator, historical bulk backfill, paid-media/fingerprinting/cross-device tracking, content rewriting, and any change to the live prospect-facing intake widget (self-report capture is operator-console-only by design, since adding a source question to the primary legal-intake funnel is a distinct higher-risk product/legal decision this build deliberately did not make unsupervised). **Tests**: 35 new tests (pure-logic matching/sentence-building, mocked I/O idempotency, two API route auth-boundary suites) plus one real-Postgres integration suite (`content-attribution-scope.integration.test.ts`, gated on `DIRECT_DATABASE_URL`, same convention as the two existing publication-receipt/claim concurrency suites) proving the scope-validation and append-only triggers and the view's priority/supersession logic against genuine Postgres, not a mock; full suite 5463/5463 pass (274 files, 3 skipped -- the 2 pre-existing env-gated integration files plus this session's new one), `tsc --noEmit` clean. | DONE |

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
12. `20260512_intake_language_and_raw_transcript.sql` — adds `intake_language TEXT` and `raw_transcript TEXT` to `screened_leads` (multilingual build, Ses.8)
13. `20260515_band_d_and_referred_status.sql` — extends `band` CHECK to include `'D'`, extends `status` CHECK to include `'referred'`, backfills pre-existing OOS-declined rows to `band='D', status='triaging'` (Band D doctrine flip, 2026-05-15)
14. `20260516_unconfirmed_inquiries.sql` — contact-capture doctrine reject store (APPLIED 2026-05-15)
15. `20260516_channel_intake_sessions.sql` — Meta-channel multi-turn intake sessions (APPLIED 2026-05-15)
16. `20260516_intake_firms_meta_access_tokens.sql` — `facebook_page_access_token` + `whatsapp_cloud_api_access_token` columns on `intake_firms` (APPLIED 2026-05-15). Tokens must be populated manually per firm (Messenger API Settings → Page access token; WhatsApp API Setup → access token).
17. `20260525_channel_intake_sessions_recent_finalized_index.sql` — partial index on `(firm_id, channel, sender_id, last_activity_at DESC) WHERE finalized = true`. Supports the post-finalization secretary mode (DR-104 / Ses.9 fix #105).
18. `20260526_intake_firms_token_expiry.sql` — adds 6 columns to `intake_firms` for token-expiry monitoring (`facebook_page_token_expires_at` + `_alert_sent_at` × 3 tokens) plus a partial index for the daily cron sweep. APPLIED 2026-05-26 via Supabase MCP. See `lib/token-expiry.ts` + `GET /api/cron/token-expiry-check`.
19. `20260602_intake_firms_gemini_disabled_alert.sql` — adds `gemini_disabled_alert_sent_at timestamptz` to `intake_firms` (per-firm suppression for the LLM-disabled operator alert, #128). APPLIED 2026-06-02 via Supabase MCP. See `lib/llm-health-alert.ts`.
20. `20260605175457_security_lockdown_anon_authenticated.sql`: anon column-scoped host resolution + `authenticated` grant revocation (Database Access Invariant). APPLIED 2026-06-05; the migration file was recovered from the ledger 2026-06-09.
21. `20260609_processed_channel_messages.sql`: inbound webhook idempotency claim table (DR-065). APPLIED 2026-06-09 via Supabase MCP before the same-day deploy.
22. `20260609_screened_leads_notification_state.sql`: four `notification_*` delivery-state columns on `screened_leads` (DR-066). APPLIED 2026-06-09 via Supabase MCP before the same-day deploy.
23. `20260609_otp_attempt_cap.sql`: OTP brute-force attempt cap. APPLIED 2026-06-09 via Supabase MCP before the same-day deploy.
24. `20260609_webhook_outbox_action_check_expand.sql`: widens the `webhook_outbox` action CHECK to six actions (DR-067; also fixes the latent `referred` rejection). APPLIED 2026-06-09 via Supabase MCP before the same-day deploy.
25. `20260611_voice_turn_sessions.sql`: `voice_turn_sessions` table for the Voice v2 realtime loop (DR-048). Per-call session store keyed on `call_id`, holds `engine_state` jsonb between turns. Unique partial index on `(call_id) WHERE NOT finalized`. Service-role RLS only. APPLIED to prod (verified 2026-07-02: table exists, RLS forced). Vapi assistant config remains the outstanding step, see roadmap row below.
26. `20260624_operator_firm_messaging.sql`: CaseLoad Connect (operator-to-firm messaging). Three tables (`operator_firm_channels`, `operator_firm_messages`, `operator_firm_channel_reads`), RLS forced + anon/authenticated/PUBLIC revoked, plus the `firm_message_new` event type added to the `notification_outbox` event_type CHECK. APPLIED 2026-06-24 via Supabase MCP.
27. `20260625_firm_about_explainer.sql`: `firm_about` table (per-firm standing "About this content" explainer rendered as a collapsible panel above the deliverables list at `/portal/[firmId]/deliverables`). Single row per firm (`firm_id` PK to `intake_firms`, `body_html`, `updated_at`, `updated_by`), RLS enabled + forced, anon/authenticated/PUBLIC grants revoked, service-role only. APPLIED 2026-06-25 via Supabase MCP; DRG content row seeded the same day. Read via guarded `getFirmAbout` (returns null if absent, so the page is safe to deploy ahead of the migration); written via operator-only `POST /api/portal/[firmId]/about` (sanitised with `sanitizeExplainerHtml`). See `lib/firm-about.ts` + `components/portal/AboutPanel.tsx`.
28. `20260625_firm_about_links.sql`: adds `firm_about.links jsonb NOT NULL DEFAULT '[]'` for a small set of labelled reference links (label + absolute http/https url, sanitised via `sanitizeAboutLinks`, capped at six) rendered as an always-visible "Reference" row under the About panel body. APPLIED 2026-06-25 via Supabase MCP; DRG seeded with the Content Strategy v3 link (the same doc in the Files hub). Written through the same `POST /api/portal/[firmId]/about` (`links` only persisted when provided, so a body-only update keeps existing links).
29. `20260716000000_firm_assist_corpus.sql`: Firm Assist (Ses.18, DR-100/101/102). Enables `vector` extension; creates `assist_corpus_pages`, `assist_corpus_chunks` (`vector(768)`, HNSW cosine index), `assist_queries`, all RLS-forced + anon/authenticated/PUBLIC revoked; `match_assist_chunks` SECURITY DEFINER RPC for cosine retrieval. APPLIED 2026-07-16 via Supabase MCP before code deploy (deploy-safety order held). See `docs/BUILD_PLAN_firm_assist_v1.md`.
30. `20260717030000_content_attribution_evidence.sql`: Content Performance / Content-to-Matter Attribution (Ses.20). Creates `content_attribution_evidence` (append-only, RLS-forced + anon/authenticated/PUBLIC revoked, `validate_content_attribution_evidence_scope` BEFORE INSERT trigger, `block_append_only_mutation` BEFORE UPDATE/DELETE trigger) and `content_attribution_current` (derived view, `security_invoker = true`). APPLIED 2026-07-17 via Supabase MCP before code deploy (deploy-safety order held). See `docs/CONTENT_PERFORMANCE_ATTRIBUTION_MODEL.md`.

## CaseLoad Connect (operator-to-firm messaging, 2026-06-24)

A dedicated channel between the CaseLoad operator and each firm's lawyers. Structurally Slack Connect: one shared channel per firm, two participant classes (operator sees every firm, a lawyer sees only its own). This is NOT the lawyer-to-client matter thread (`matter_messages`, channel_type `client`); those stay privileged and firm-private and the operator never reads them.

- **Data layer:** `lib/operator-firm-messaging.ts` (service-role; channel get-or-create, list with signed attachments, send + notify, edit/delete own, mark-read, unread counts). `lib/operator-firm-messaging-handlers.ts` holds the shared route handlers so the operator and lawyer trees never drift.
- **Routes:** operator at `/api/admin/firms/[firmId]/messages/*` (operator session), lawyer at `/api/portal/[firmId]/messages/*` (firm session, rejects operators + clients). Both: GET list (marks read), POST send, PATCH/DELETE own message, POST read, POST upload.
- **Surfaces:** operator `/admin/firms/[firmId]/messages` (FIRM nav "Messages" row) + unread total in the console attention bar + per-firm unread badge and a Messages link on each firm card. Lawyer `/portal/[firmId]/messages` (portal "CaseLoad" tab). Both poll every 30s (matter-thread parity).
- **Notifications:** `notification_outbox` event_type `firm_message_new`. Operator sends notify the firm's enabled lawyers; lawyer sends notify `adriano@caseloadselect.ca`. The 5-minute digest renders them under a "CaseLoad messages" group with a deep link (lawyer to the portal tab, operator to the console surface).
- **Scope:** MVP is human messages only (list, threads one level deep, attachments, edit/delete own, read state, unread badges). Phase 2/3 (reactions, search, pins, mark-unread, realtime, system auto-posts, multiple topic channels) deferred. Full feature inventory + roadmap: `docs/operator-firm-messaging-spec-v1.md`.

## Email Branding & Delivery (2026-06-25)

DRG-style correspondence shell for client-facing transactional emails, shipped in commit `b98795a`.

**Brand ownership (DR-074).** Two axes set an email's look. Who it represents sets the brand: client-facing firm correspondence (intake OTP, portal invite, client welcome, the GHL CRM cadences) carries the FIRM's brand; operator and product notifications (new-lead alerts, the 5-minute digest, magic-link sign-in, firm onboarding, screen-demo) stay CaseLoad. Do not re-skin the product notifications per firm.

**Per-firm shell, opt-in via `intake_firms.branding.theme`.** `lib/email-branding.ts` `resolveEmailBranding(branding)` reads the same theme that drives the widget, solidifies its rgba tokens to hex (email clients drop rgba), and returns null when the firm has no theme. Null tells the caller to keep its existing default rendering, so non-themed firms are byte-for-byte unchanged. Only DRG carries a theme today. `lib/email-shell.ts` `renderEmailShell()` builds the email-safe document (600px table, Outlook MSO conditional, no shadow, rgba, flex, grid, or gradient). `lib/firm-email-branding.ts` is the IO loader (no `server-only`; see Developer Gotchas). Wired into `api/otp/send`, the client `invite` route, and the welcome `send` route. Pure libs are covered by `__tests__/email-branding.test.ts` and `email-shell.test.ts` (the latter doubles as the email-safety scan).

**Welcome is digest-delivered, not a standalone send.** The welcome body is inserted as a `matter_message` (client channel), and the client receives it through the shared 5-minute digest (`matter_message` to `notification_outbox` to `cron/notification-batch`). For a themed firm, the welcome `send` route sends a standalone branded email and suppresses that one client digest copy via `insertMessage({ notifyClient: false })`, falling back to the digest if the standalone send fails. Lawyers are notified either way. Rule: before restyling any notification, trace `insertMessage` to `notification_outbox` to the digest to find where it actually reaches the recipient.

**GHL half (operator-deployed, not code).** The CRM cadence emails L01-L14 and the LTT calculator result email are GHL email-step HTML, not app code. Files plus the operator handoff are in `06_Clients/DRGLaw/02_Strategy/EmailTemplates/` (`GHL_Email_Deployment_Checklist_v1.md`). The in-app sequence engine (`sequence-engine.ts` and `send-sequences.ts`) is dormant; DRG's cadences run in GHL.

## Developer Gotchas + Deploy-Safety (2026-06-25)

**Hooks reach code and client files, not only brand deliverables.** The banned-vocab hook blocks em dashes and banned vocabulary in any Write or Edit content, including TypeScript and JS comments, so use commas, colons, or parens in source comments. The DOC-META hook blocks editing any file under `06_Clients/*/`, `04_Playbooks/`, `00_System/`, and the other doc folders (HTML email templates included) unless it carries a DOC-META header (YAML frontmatter for markdown, an `<!-- DOC-META v1 ... -->` comment for HTML).

**`server-only` breaks vitest route tests.** An IO lib imported (transitively) by a route that has its own test must not `import "server-only"`; it throws when the test loads the route module. The repo pattern is IO libs importing `supabaseAdmin` without `server-only`. `lib/firm-about.ts` still carries `server-only` and is a latent test-breaker if a tested route ever imports it.

**Deploy-safety is a pattern, not a per-case call.** Every read of a new table or column is guarded (return null when absent, so the surface renders unchanged and is safe to deploy ahead of its migration), and additive migrations are applied to prod first, then the reading code is pushed. The about panel and the email shell both shipped this way. The "do not auto-apply migration to prod" rule is an awareness gate: hold by default, but when the operator directly asks to see the live result, apply it and report exactly what hit prod.

## Voice intake — observability + defense in depth (2026-06-02)

Hardening landed across `/api/voice-intake` so a live voice line does not lose leads or degrade silently. All operator alerts go to `adriano@caseloadselect.ca` only (the resolver in `lib/voice-callback-notify.ts`), best-effort via `waitUntil` (never block the webhook ACK, never affect the persisted row).

- **Unconfirmed-voice alert (#125).** When a call fails the contact-capture gate (no name and/or no reachable contact) it lands in `unconfirmed_inquiries`; on voice the call is over and cannot re-ask, so `notifyOperatorOfUnconfirmedVoiceIntake` emails what was captured (phone + transport source, partial name, likely matter, recording link, transcript excerpt) with a next-action that branches on call-back-number / recording / unrecoverable. Pure builder in `lib/voice-callback-notify-pure.ts`.
- **Name recovery (#122).** Before the contact gate, `recoverNameIfMissing` backfills `client_name` ONLY when empty, from a bot readback the caller cleanly affirmed ("I have your name as X, is that correct?" → "yes"). The engine's name patterns cover caller intros + acknowledgments but not this readback shape, so this recovers leads the engine would drop. Never overwrites; `extractReadbackConfirmedName` returns null on any doubt. Extractor in `lib/readback-detection.ts`; provenance is then upgraded to `confirmed_by_caller_after_readback` by `promoteContactProvenance`.
- **LLM-disabled alert (#128).** When `llmExtractServer` returns `mode='disabled'` (GEMINI_API_KEY missing/invalid) every brief degrades to regex-only. The route emits a distinctive `console.error` and emails the operator, throttled per firm (6h window via `intake_firms.gemini_disabled_alert_sent_at`, mirroring the token-expiry convention). Cooldown + email body are pure in `lib/llm-health-alert.ts`.
- **Audit fields on `voice_meta` (#126/#128).** Every voice row records `caller_phone_source` (`body` | `voice-ai-api` | `none`) and `llm_mode` on all persistence paths (screened lead, unconfirmed inquiry, callback request), so an operator can see how the phone resolved and what extraction ran.
- **Firm-local timestamps everywhere (#140).** All server-side brief renderers (`/api/voice-intake`, admin reclassify, the Meta-channel `channel-intake-processor`) and the secondary lawyer/client UI renderers now render stored UTC timestamps in firm-local time via `lib/firm-timezone.ts` (`formatTimestamp` for instants, `formatDateOnly` for `date` columns, `resolveFirmTimezone` chain). Default `America/Toronto`; no server/browser-local leak.

## Retainer Agreement Automation (DEPRECATED — REMOVED FROM SCOPE 2026-05-06)

The retainer document workflow is permanently lawyer-owned. Retainer document generation and e-signature are explicitly out of scope. Use Clio (for Clio firms) or the lawyer's own tool of choice. CaseLoad Select fires the J6 follow-up cadence; the document itself is never touched by the platform.

**Dormant code: DELETED in commit `c9b8cd2`.** The formerly dormant files (`src/lib/retainer.ts`, `src/lib/docuseal.ts`, `src/lib/docugenerate.ts`, `src/app/retainers/page.tsx`, the `/api/webhooks/docuseal` receiver) are gone from the tree. Do not reintroduce them.

**Dormant table:** `retainer_agreements` is unused after 2026-05-06. Leave in place; do not run a destructive migration without explicit operator confirmation.

**Env vars retired:** `DOCUGENERATE_API_KEY`, `DOCUGENERATE_TEMPLATE_ID`, `DOCUSEAL_API_KEY`, `DOCUSEAL_TEMPLATE_ID`, `DOCUSEAL_WEBHOOK_SECRET`. Safe to unset in Vercel; the dormant code degrades to no-op without them.

See master `CLAUDE.md` Build Roadmap for the formal scope-removal note (S6 retired 2026-05-06) and CRM Bible v5.1 DR-032 for the doctrine entry.

## Env Vars to Add in Vercel

`CLIO_CLIENT_ID` · `CLIO_CLIENT_SECRET` · `CLIO_REDIRECT_URI` · `VERCEL_API_TOKEN` · `VERCEL_PROJECT_ID` · `GEMINI_API_KEY` (used by `/api/voice-intake` for LLM extraction; if missing, the endpoint falls back to regex-only and the row still persists) · `ALARM_TEST_SECRET` (used by the test-fire mode of `POST /api/internal/vercel-deployment-check`: a Bearer-authenticated synthetic alarm drill that exercises the full alarm email path with no deployment involved; deliberately a normal encrypted env var, NOT Sensitive, so operator drills can pull it; if unset, test mode returns 403 and the HMAC webhook path is unaffected)

(DocuGenerate and DocuSeal env vars are retired with S6; safe to unset in Vercel.)

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
<!-- NOTE: the Brand Assets quick reference table was truncated by an Edit tool host-side write limit on 2026-05-11. The lockup-stacked, icon, and wordmark variant rows + the long footer paragraphs need restoring from git history before the next commit. The Voice channel / FACT-to-ACTS edits above this point are correct and intact. -->
