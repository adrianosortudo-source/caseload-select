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
| Auth | Supabase Auth |
| AI Screening | OpenAI GPT-4o-mini (legacy v2.1); Google Gemini 2.5 Flash (Screen 2.0 / voice-intake) |
| SMS/Phone | GoHighLevel (GHL) — SMS, Voice AI, conversation surfaces |
| Hosting | Vercel |
| Legal PMS | Clio Manage (API v4) |

Supabase URL: https://ssxryjxifwiivghglqer.supabase.co (region: ca-central-1, Montreal). Migrated from `qpzopweonveumvuqkqgw` (us-east-2, Ohio) on 2026-05-18 to unblock the "client lead data is stored in Canadian data centers" residency line. Migration runbook at `docs/runbooks/supabase-migration.md`. Future schema migrations apply via `supabase db push` (project linked in `supabase/config.toml`). Weekly backup discipline via `scripts/backup-supabase.sh`.

## Public Marketing Site (2026-05-26)

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
- **CPI band thresholds.** Production v2.1: A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 45, E < 45. The marketing demo's `scoring.ts` and the homepage CPI section both use these thresholds. Drift between display ranges and scoring thresholds is a bug.
- **PDF scoring drift is acceptable, threshold drift is not.** The marketing demo questions are not the Layer 2 production questions. The scoring math is purpose-built for the demo. But the banding thresholds and the band labels must match the product so the artifact reads as an authentic product output.

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

CTA on all intake forms: **"Submit for review"** (revised 2026-05-06; the previous CTA "Start Your Consultation" implied the AI provided legal advice, which it does not). Hero headline: **"Book a call with the firm▪"** (revised 2026-05-06; replaces the firm's standard "Contact Us" form — the screen IS the contact path). Hero sub: *"Describe your situation in your own words, then answer a few short follow-ups. A lawyer reviews what you share and reaches out directly if your matter fits the firm's practice. Most replies within hours."*
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
| `unconfirmed_inquiries` | Contact-capture doctrine reject store. Rows that fail the gate (missing name AND/OR reachability) land here, NEVER in `screened_leads`, NEVER in the triage portal. Ops visibility only. Reasons: `no_contact_provided` / `abandoned` / `engine_refused`. Migration: `20260516_unconfirmed_inquiries.sql`. |
| `channel_intake_sessions` | Multi-turn intake sessions for Meta channels (Messenger / Instagram / WhatsApp). Distinct from `public.intake_sessions` which powers the web widget. Holds `engine_state` (serialized `EngineState`) for resume on next inbound from the same `(firm_id, channel, sender_id)`. Finalised once contact is captured (screened lead created) or `max_follow_ups=3` exhausted (moved to `unconfirmed_inquiries`). Migration: `20260516_channel_intake_sessions.sql`. |
| `intake_firms.facebook_page_access_token` | Meta Page access token used by Messenger Send + Instagram Send (IG inherits the linked Page's token). SECRET. service-role read only. Migration: `20260516_intake_firms_meta_access_tokens.sql`. |
| `intake_firms.whatsapp_cloud_api_access_token` | WhatsApp Cloud API access token. SECRET. service-role read only. Migration: `20260516_intake_firms_meta_access_tokens.sql`. |

### Routes

| Route | Purpose |
|---|---|
| `/portal/[firmId]/triage` | Triage queue page. Sorted Band A → B → C with deadline tiebreaker. `?band=A\|B\|C` filter. |
| `/portal/[firmId]/triage/[leadId]` | Single brief view. Renders `brief_html` verbatim, sticky Take/Pass action bar at bottom. |
| `POST /api/intake-v2` | Persistence endpoint — Screen 2.0 POSTs here. Demo skip on missing/invalid firmId. Fires `declined_oos` webhook for OOS leads. |
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
| `/admin/triage` | Operator-only cross-firm triage queue. Firm filter + band filter. Rows link to /portal/[firmId]/triage/[leadId]. |
| `/admin/webhook-outbox` | Operator-only delivery log UI with manual retry button. |
| `/admin/routing` | Operator-only lead-routing config UI (2026-06-02). Firm picker (FirmFilter, `?firm_id=`) → per-practice-area lead, firm fallback lead, default assignees. Honest unconfigured states + live "a lead taken now goes to" preview + snapshot-at-take caveat. Edits the live `intake_firms` routing fields; no deploy needed for routing changes. |
| `GET/PATCH /api/admin/firms/[firmId]/routing` | Operator-gated. GET returns the firm's routing config + selectable lawyers; PATCH validates every id belongs to the firm, normalizes (drops blank PA defaults, de-dupes assignees), writes the three columns. |

### S8 Phase 1 routes (added 2026-05-22)

| Route | Purpose |
|---|---|
| `POST /api/portal/[firmId]/matters/[matterId]/stage` | Advance matter stage (validates transition, fires journey cadence) |
| `GET/POST /api/portal/[firmId]/matters/[matterId]/messages` | List + send messages (channel_type discriminator gates client vs internal) |
| `GET/PATCH /api/portal/[firmId]/matters/[matterId]/welcome` | View / edit the welcome draft built at matter creation |
| `POST /api/portal/[firmId]/matters/[matterId]/welcome/send` | Send the welcome draft as a client-channel message + stamp sent_at |
| `POST /api/portal/[firmId]/matters/[matterId]/invite` | Generate + email a magic-link invite to the client (48h TTL) |
| `GET/POST/DELETE /api/portal/[firmId]/matters/[matterId]/explainers` | List + assign + unassign explainer articles for the matter |
| `GET/PATCH /api/portal/[firmId]/matters/[matterId]/embed` | Read / set the matter's iframe embed_url (CSP-validated against firm allow-list) |
| `POST /api/portal/[firmId]/matters/[matterId]/kickoff` | S14 composition — sends welcome, auto-assigns explainers, advances stage, generates client invite |
| `POST /api/portal/[firmId]/broadcast` | Mass-message fan-out (S11) — one body, many matters, one broadcast_id |
| `GET/PATCH /api/portal/[firmId]/config/folder-lock` | S10 firm-level client_files_locked toggle |
| `GET /api/cron/notification-batch` | Drain notification_outbox every 5 min into per-recipient digest emails |
| `/portal/[firmId]/m/[matterId]` | Client matter-stage home (S04 — magic-link gated) |
| `/portal/[firmId]/m/[matterId]/accept` | Magic-link landing — verifies token, plants client session cookie |
| `/portal/[firmId]/clients` | Lawyer active-clients home (S05) |

### Auth model

Same HMAC magic-link pattern as the legacy Client Portal (`portal-auth.ts`). 48h link, 30-day session cookie, root-scoped (path `/`). Three role tiers on the token (S8 Phase 1 added the client role):

- `lawyer` (default): firm-scoped. Token's `firm_id` must match the requested route's firmId. Lands at /portal/[firmId]/triage.
- `operator`: cross-firm. Bypasses the firm match. Lands at /admin/triage. Operators can also view any firm's portal pages with an "Operator view" banner.
- `client` (S8 Phase 1): matter-scoped. Token carries `matter_id` + `client_email`. Only valid for routes under `/portal/[firmId]/m/[matterId]/*`. `getClientMatterSession(firmId, matterId)` is the helper. The session does NOT match `getFirmSession()` — clients have their own surfaces.

`firm_lawyers` table holds the canonical mapping of email → firm + role. The role column extends to `admin | staff | operator | lawyer` (legacy alias). New rows should use `admin` or `staff`. Multi-lawyer per firm supported. Legacy `intake_firms.branding.lawyer_email` remains as a fallback. Inserting a row into `firm_lawyers` automatically fires a magic-link invitation email via the `trg_firm_lawyers_invite` pg_net trigger.

### GHL webhook contract

Versioned artifact at `docs/ghl-webhook-contract.md`. Five actions (`taken`, `passed`, `referred`, `declined_oos`, `declined_backstop`), one common envelope, action-specific extension keyed by action name. Idempotency: `<lead_id>:<action>`. Delivery: at-least-once via the outbox.

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
│   │   │   └── expire-channel-intake-sessions/route.ts # Abandoned multi-turn session sweeper (contact-doctrine, hourly)
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
    ├── firm-resolver.ts                                # Meta asset ID → firm lookup (3 channels)
    ├── channel-intake-processor.ts                     # Shared server-side engine pipeline + multi-turn contact-capture loop
    ├── channel-intake-session-store.ts                 # Load/save/finalise channel_intake_sessions
    ├── channel-send.ts                                 # Channel-agnostic Send dispatcher + follow-up phrasing
    ├── messenger-send.ts                               # Messenger Send API client
    ├── instagram-send.ts                               # Instagram Send API client (inherits Page token)
    ├── whatsapp-send.ts                                # WhatsApp Cloud API Send client
    ├── unconfirmed-inquiry.ts                          # persist to unconfirmed_inquiries (contact-doctrine reject path)
    ├── screen-engine/contact-doctrine.ts               # isContactComplete / evaluateContactGate (byte-for-byte mirror with sandbox)
    └── oos-area-labels.ts                              # OOS practice-area display labels (shared)
```

### Cron scheduling — Supabase pg_cron + pg_net

Both crons are scheduled via Supabase pg_cron (no Vercel Pro dependency):

- `triage-backstop-hourly` — `7 * * * *`, calls `/api/cron/triage-backstop`
- `webhook-retry-5m` — `*/5 * * * *`, calls `/api/cron/webhook-retry`

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
| Web widget | Vite SPA (`caseload-screen-v2.vercel.app`) | Client-side (sandbox engine) | `POST /api/intake-v2` (this app, receives pre-rendered brief) |
| Facebook Messenger | Meta webhook to a connected FB Page | Server-side via `lib/channel-intake-processor` | `POST /api/messenger-intake` (resolves firm by `intake_firms.facebook_page_id`) |
| Instagram DM | Meta webhook to a connected IG Business Account | Server-side via `lib/channel-intake-processor` | `POST /api/instagram-intake` (resolves firm by `intake_firms.instagram_business_account_id`) |
| WhatsApp | Meta Cloud API webhook to a connected Phone Number | Server-side via `lib/channel-intake-processor` | `POST /api/whatsapp-intake` (resolves firm by `intake_firms.whatsapp_phone_number_id`) |
| SMS / GBP | Vite SPA tabs (production handlers TBD per channel) | Client-side (sandbox engine) | `POST /api/intake-v2` (same persistence path) |
| Voice | GHL Voice AI inbound calls | Server-side (this app at `src/lib/screen-engine/`, mirrored from sandbox) | `POST /api/voice-intake` (this app, builds brief from transcript) |

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

## Build Roadmap

| Session | Scope | Status |
|---|---|---|
| S1 | Foundation (Supabase, auth, base schema) | DONE |
| S2 | Pipeline + Intake (kanban, CaseLoad Screen widget) | DONE |
| S3 | Scoring + Sequences (CPI engine, email automation, Resend) | DONE |
| S4 | Review + Recovery (WF-05 no-show, WF-06 stalled retainer, review requests) | DONE |
| S5 | Persistence + Nurture (WF-03, 6 nurture tracks) | DONE |
| S6 | Retainer Automation | **REMOVED FROM SCOPE 2026-05-06.** Code remains in tree (retainer.ts, docuseal.ts, docugenerate.ts, retainers/page.tsx, retainer_agreements table) but is dormant. Do not call from new code. The retainer document workflow is permanently lawyer-owned. |
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

## Voice intake — observability + defense in depth (2026-06-02)

Hardening landed across `/api/voice-intake` so a live voice line does not lose leads or degrade silently. All operator alerts go to `adriano@caseloadselect.ca` only (the resolver in `lib/voice-callback-notify.ts`), best-effort via `waitUntil` (never block the webhook ACK, never affect the persisted row).

- **Unconfirmed-voice alert (#125).** When a call fails the contact-capture gate (no name and/or no reachable contact) it lands in `unconfirmed_inquiries`; on voice the call is over and cannot re-ask, so `notifyOperatorOfUnconfirmedVoiceIntake` emails what was captured (phone + transport source, partial name, likely matter, recording link, transcript excerpt) with a next-action that branches on call-back-number / recording / unrecoverable. Pure builder in `lib/voice-callback-notify-pure.ts`.
- **Name recovery (#122).** Before the contact gate, `recoverNameIfMissing` backfills `client_name` ONLY when empty, from a bot readback the caller cleanly affirmed ("I have your name as X, is that correct?" → "yes"). The engine's name patterns cover caller intros + acknowledgments but not this readback shape, so this recovers leads the engine would drop. Never overwrites; `extractReadbackConfirmedName` returns null on any doubt. Extractor in `lib/readback-detection.ts`; provenance is then upgraded to `confirmed_by_caller_after_readback` by `promoteContactProvenance`.
- **LLM-disabled alert (#128).** When `llmExtractServer` returns `mode='disabled'` (GEMINI_API_KEY missing/invalid) every brief degrades to regex-only. The route emits a distinctive `console.error` and emails the operator, throttled per firm (6h window via `intake_firms.gemini_disabled_alert_sent_at`, mirroring the token-expiry convention). Cooldown + email body are pure in `lib/llm-health-alert.ts`.
- **Audit fields on `voice_meta` (#126/#128).** Every voice row records `caller_phone_source` (`body` | `voice-ai-api` | `none`) and `llm_mode` on all persistence paths (screened lead, unconfirmed inquiry, callback request), so an operator can see how the phone resolved and what extraction ran.
- **Firm-local timestamps everywhere (#140).** All server-side brief renderers (`/api/voice-intake`, admin reclassify, the Meta-channel `channel-intake-processor`) and the secondary lawyer/client UI renderers now render stored UTC timestamps in firm-local time via `lib/firm-timezone.ts` (`formatTimestamp` for instants, `formatDateOnly` for `date` columns, `resolveFirmTimezone` chain). Default `America/Toronto`; no server/browser-local leak.

## Retainer Agreement Automation (DEPRECATED — REMOVED FROM SCOPE 2026-05-06)

The retainer document workflow is permanently lawyer-owned. Retainer document generation and e-signature are explicitly out of scope. Use Clio (for Clio firms) or the lawyer's own tool of choice. CaseLoad Select fires the J6 follow-up cadence; the document itself is never touched by the platform.

**Dormant code (do not call from new code; do not extend):**
- `src/lib/docugenerate.ts` — PDF generation client. Dormant.
- `src/lib/docuseal.ts` — e-signature client. Dormant.
- `src/lib/retainer.ts` — orchestration. Dormant. The `triggerRetainerIfEligible()` call from `/api/otp/verify` should be removed in a follow-up cleanup; until then it is a no-op without the env vars set.
- `src/app/retainers/page.tsx` — admin page. Dormant; should be removed in a follow-up cleanup.
- `/api/webhooks/docuseal` — webhook receiver. Dormant.

**Dormant table:** `retainer_agreements` is unused after 2026-05-06. Leave in place; do not run a destructive migration without explicit operator confirmation.

**Env vars retired:** `DOCUGENERATE_API_KEY`, `DOCUGENERATE_TEMPLATE_ID`, `DOCUSEAL_API_KEY`, `DOCUSEAL_TEMPLATE_ID`, `DOCUSEAL_WEBHOOK_SECRET`. Safe to unset in Vercel; the dormant code degrades to no-op without them.

See master `CLAUDE.md` Build Roadmap for the formal scope-removal note (S6 retired 2026-05-06) and CRM Bible v5.1 DR-032 for the doctrine entry.

## Env Vars to Add in Vercel

`CLIO_CLIENT_ID` · `CLIO_CLIENT_SECRET` · `CLIO_REDIRECT_URI` · `VERCEL_API_TOKEN` · `VERCEL_PROJECT_ID` · `GEMINI_API_KEY` (used by `/api/voice-intake` for LLM extraction; if missing, the endpoint falls back to regex-only and the row still persists)

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
