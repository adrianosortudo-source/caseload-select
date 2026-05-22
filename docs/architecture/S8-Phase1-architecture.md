# S8 Phase 1: Architecture

**Companion to:** `docs/stories/S8.Phase1.epic.md`
**Created:** 2026-05-18
**Status:** Draft (planning artifact, not implementation)

This document records the architectural decisions implicit in the Phase 1 build plan: schema additions, new API routes, new page routes, module composition, the matter-stage state machine, integration points with existing systems, and four proposed Decision Register entries (DR-040 through DR-043) for the operator to consider promoting into CRM Bible v5.1.

---

## 1. Schema additions

### 1.1 New tables

| Table | Purpose | Migration |
|---|---|---|
| `client_matters` | One row per signed matter. Owns the matter-stage state machine, lead identity, default-assignee snapshot, embed URL. Replaces the implicit "client = screened_lead.contact_email" mapping with an explicit record the rest of the portal hangs off. | `20260520_s8p1_client_matters.sql` |
| `matter_messages` | The threaded message store. Three channel types in the data model (`individual`, `group`, `company`) but Phase 1 UI exposes individual only. Carries `channel_type IN ('client', 'internal')` to discriminate client-visible vs lawyer-internal-only threads. | `20260520_s8p1_matter_messages.sql` |
| `matter_message_recipients` | Per-recipient row for mass-message fan-out. One source message, N per-recipient thread copies. | `20260520_s8p1_matter_messages.sql` (same file) |
| `notification_outbox` | Pending email events keyed by recipient + event-batch-window. The 5-minute notification batcher drains this table. | `20260520_s8p1_notification_outbox.sql` |
| `explainer_articles` | Operator-authored matter-stage explainer library. Tagged by `practice_area` + `matter_stage`. Read-only from firms in Phase 1. | `20260520_s8p1_explainer_articles.sql` |
| `matter_explainer_assignments` | Many-to-many between matters and explainer articles. Lawyer assigns one or more articles to a matter. | `20260520_s8p1_explainer_articles.sql` (same file) |
| `matter_stage_events` | Append-only timeline of stage transitions. Powers the "What happened" surface on the client matter-stage home and the lawyer detail page. | `20260520_s8p1_client_matters.sql` (same file) |

### 1.2 Modified tables

| Table | Change | Migration |
|---|---|---|
| `firm_lawyers` | Add `role` value `'admin'` and `'staff'`. Existing `'lawyer'` rows remain valid. The resolver treats `'lawyer'` as a legacy alias for `'admin'` so no backfill is required. `'operator'` stays as it is. | `20260520_s8p1_firm_lawyers_roles.sql` |
| `intake_firms` | Add `default_lead_by_practice_area JSONB DEFAULT '{}'::jsonb`, `default_lead_id UUID REFERENCES firm_lawyers(id)`, `default_assignees JSONB DEFAULT '[]'::jsonb`, `client_files_locked BOOLEAN DEFAULT false`, `subdomain TEXT UNIQUE` (one branded subdomain per firm, distinct from `custom_domain` which is a full apex domain). | `20260520_s8p1_intake_firms_routing.sql` |
| `firm_lawyers` | Add `display_name TEXT`, `title TEXT` (carried verbatim into the welcome draft signature). | `20260520_s8p1_firm_lawyers_roles.sql` (same file) |

### 1.3 Why `client_matters` is a new table, not a column on `screened_leads`

`screened_leads` is the inbound triage artifact. Its lifecycle is `triaging | taken | passed | referred | declined`. Once a lead is taken, the screened-leads row should not be mutated further beyond its terminal state. The matter that follows the take is a different entity with its own lifecycle, its own assignee set, its own messages, its own files, and its own explainer assignments. Mixing the two would force every existing triage query to filter out client-matter columns and every matter query to exclude triage-state rows.

The link is explicit: `client_matters.source_screened_lead_id REFERENCES screened_leads(id)`. One screened lead becomes one client matter on take. If a firm takes a lead, drops it, and the same person comes back through intake later, that produces a new screened-lead row, a new take, and a new matter, with the original matter closed.

---

## 2. New API routes

### 2.1 Client surfaces

| Route | Verb | Purpose |
|---|---|---|
| `/api/portal/[firmId]/matters/[matterId]/home` | GET | Returns the matter-stage home payload: stage label, next-action object, timeline of recent activity, assigned explainer article list, embed URL if set. |
| `/api/portal/[firmId]/matters/[matterId]/messages` | GET, POST | List messages on a matter (filtered by `channel_type='client'` for the client view; both types for the lawyer view). POST creates a new message. |
| `/api/portal/[firmId]/matters/[matterId]/explainers` | GET | Returns the lawyer-assigned explainer articles for a matter. Read-only from the client side. |

### 2.2 Lawyer surfaces

| Route | Verb | Purpose |
|---|---|---|
| `/api/portal/[firmId]/active-clients` | GET | The active-clients list under the triage queue on the lawyer home. Sorted by most recent activity, optional `?filter=needs-attention` chip. |
| `/api/portal/[firmId]/matters/[matterId]/internal-messages` | GET, POST | The right-rail internal thread on a matter. Visibility: admin + staff only. |
| `/api/portal/[firmId]/matters/[matterId]/welcome-draft` | GET, POST, PUT | GET returns the system-drafted welcome message. POST sends it (and the magic-link invite). PUT saves an edited draft without sending. |
| `/api/portal/[firmId]/matters/[matterId]/stage` | POST | Transition the matter stage. Body: `{ to: 'retainer_pending' | 'active' | 'closing' | 'closed', note?: string }`. Validates the transition against the state machine. |
| `/api/portal/[firmId]/matters/[matterId]/explainers` | POST, DELETE | Lawyer assigns or removes an explainer article on a matter. |
| `/api/portal/[firmId]/matters/[matterId]/embed-url` | PUT | Operator-only. Sets the pre-authenticated embed URL on a matter. |
| `/api/portal/[firmId]/messages/broadcast` | POST | Mass-message endpoint. Body: `{ recipient_matter_ids: string[], body: string }`. Fans out into per-recipient thread copies. |
| `/api/portal/[firmId]/admin/folder-lock` | POST | Toggle the firm-level files lock. Admin role only. |

### 2.3 System / cron

| Route | Verb | Purpose |
|---|---|---|
| `/api/cron/notification-batch` | GET (pg_cron Bearer) | Drains `notification_outbox` every 5 minutes, groups events by recipient, sends one digest email per recipient per batch window. |

### 2.4 Client invite endpoint (matter-scoped)

`/api/portal/[firmId]/matters/[matterId]/invite` POST: generates a client-side magic-link token bound to `(firm_id, matter_id, recipient_email)`, sends the welcome-draft email if not yet sent, returns the link in the response so the lawyer can copy it into their own SMS or email thread. Sibling to the existing lawyer-side `/api/portal/request-link`. The token verifier loads `client_matters` and gates routes to `matter_id` match the same way `firm_id` is gated today.

---

## 3. New page routes

| Route | Purpose | Audience |
|---|---|---|
| `/portal/[firmId]/clients` | The lawyer's active clients list (below the triage queue on home, or standalone). | Lawyer (admin / staff) |
| `/portal/[firmId]/clients/[matterId]` | Lawyer's client detail page with persistent right-rail internal chat. | Lawyer (admin / staff) |
| `/portal/[firmId]/m/[matterId]` | Client-side matter-stage home. The client lands here from the magic-link invite. | Client |
| `/portal/[firmId]/m/[matterId]/messages` | Client's message thread with the firm. | Client |
| `/portal/[firmId]/m/[matterId]/explainers` | Client's view of the firm-assigned explainer articles. | Client |
| `/portal/[firmId]/m/[matterId]/embed` | The minimal iframe embed slot. Renders the firm's pre-authenticated URL inside the portal chrome. | Client |
| `/portal/[firmId]/broadcast` | Lawyer-side mass-message composer. | Lawyer (admin only) |

The `/portal/[firmId]/m/[matterId]` namespace is distinct from `/portal/[firmId]/clients/[matterId]`. The `m/` prefix is the client-facing surface; the `clients/` prefix is the lawyer-facing surface. Both render the same underlying matter, with different chrome and different role-gated visibility. Cookie role determines which one the magic link resolves to.

---

## 4. Module composition

### 4.1 Per-client internal chat fits with existing messaging

The data model carries every message in the same table (`matter_messages`) with a `channel_type` discriminator. RLS enforces that `channel_type='internal'` rows are never visible through any client-facing route. The internal-chat UI is a right-rail panel rendered on `/portal/[firmId]/clients/[matterId]` and on the matter's brief view; it shares the same compose component as the client thread, just with a different default `channel_type` payload.

Implementation note: the same React message-list component renders both threads, parameterized on `channel_type`. The compose box detects context (which rail it sits on) and stamps the channel type on submit. Server-side, the POST handler asserts the role + channel_type combination is allowed (clients can never write `internal`; staff can write either).

### 4.2 Matter-stage home wraps the existing portal

The existing `/portal/[firmId]` route redirects to `/portal/[firmId]/dashboard` (the lawyer dashboard). That stays. The new client-side surface lives under `/portal/[firmId]/m/[matterId]` and is its own layout tree. The shared `[firmId]/layout.tsx` already branches on session role (lawyer vs operator); Phase 1 extends that to recognize a third path: client-role sessions, which bypass the lawyer chrome entirely and render the client matter-stage home shell.

A client session is a magic-link token whose payload includes `role='client'`, `matter_id`, and `firm_id`. The verifier returns the role; the layout gates accordingly.

### 4.3 Drafted welcome message lives on the matter

The system generates a draft on matter creation (the moment the lawyer takes a Band A screened lead and the take pipeline produces a `client_matters` row). The draft is stored on `client_matters.welcome_draft_html` and `client_matters.welcome_draft_sent_at` (null until sent). The lawyer reviews on `/portal/[firmId]/clients/[matterId]` in a banner panel that disappears once sent. Send writes `welcome_draft_sent_at` and fires the invite + the email together (one transaction, idempotency-keyed on `matter_id`).

LSO Rule 4.2-1 protection: the draft is templated from a fixed pool of approved snippets (matter-type label, fee-band sentence, no outcome statement, no specialist language). The lawyer-edited final body is what sends. The original draft is preserved on the row for audit.

---

## 5. Matter-stage state machine

```
intake → retainer_pending → active → closing → closed
```

| Stage | Definition | Entry trigger | Exit triggers | Side effects |
|---|---|---|---|---|
| `intake` | Lead has been taken from the triage queue. The client has not yet received the welcome invite (or the lawyer has not yet sent it). | Lawyer presses Take on a Band A screened lead. | Lawyer sends the welcome-draft → `retainer_pending`. | Welcome draft generated and stored on the matter. Default lead and default assignees snapshotted from firm config. |
| `retainer_pending` | Client has been invited but the retainer document is not yet signed. The lawyer owns the retainer workflow off-platform (DR-032). | Lawyer presses Send on the welcome draft. | Lawyer presses "Mark retainer signed" → `active`. | Magic-link invite email fired. Client thread initialized with the sent welcome message as turn 1. J6 cadence (already wired) continues to fire. |
| `active` | Retainer is signed. The matter is live work. | Lawyer marks retainer signed. | Lawyer presses "Mark closing" → `closing`. | Optional J7 welcome/onboarding cadence triggers (already wired). |
| `closing` | The lawyer has flagged the matter for wrap-up. Outstanding actions (review request, final invoice handoff) gate here. | Lawyer presses "Mark closing". | Lawyer presses "Mark closed" → `closed`. | J9 review-request cadence triggers (already wired). |
| `closed` | Terminal. The matter is read-only for the client; the lawyer retains audit access. | Lawyer presses "Mark closed". | None (terminal). | J11 / J12 relationship and long-term nurture cadences trigger (already wired). |

Transitions are validated in `/api/portal/[firmId]/matters/[matterId]/stage`. Invalid transitions (e.g., `closed → active`) return 422. Every transition writes a row to `matter_stage_events` with the actor, old stage, new stage, optional note, and timestamp.

Reverse transitions (closing → active, closed → active) are not allowed in Phase 1. If the operator needs to reopen a closed matter, the database row is unlocked manually; UI does not expose this.

---

## 6. Integration points with existing systems

### 6.1 Triage Portal

The take action on a Band A screened lead already fires the `taken` webhook to GHL. Phase 1 adds a side effect: insert a `client_matters` row at `matter_stage='intake'`, with `source_screened_lead_id` pointing back. The webhook payload gets a new field `matter_id` so GHL workflows can correlate the lead-to-matter handoff. The webhook contract is extended in `docs/ghl-webhook-contract.md` (already versioned; this is contract v3).

For Band B and Band C takes, Phase 1 does NOT auto-create a matter. Those bands flow through the existing pipeline machinery (the legacy `leads` table). The operator promotes a Band B or C take into a matter manually via an admin action (out of scope for Phase 1 UI; an operator runbook in the playbooks folder covers it).

### 6.2 CaseLoad Screen

No changes to the engine. Phase 1 builds on top of the screen output without modifying `src/lib/screen-engine/`. DR-033's byte-for-byte sandbox mirror is preserved.

### 6.3 Resend

The 5-minute notification batch sits between the application and Resend. Today, individual events (new message, new file, stage change) trigger immediate Resend calls. Phase 1 routes those events into `notification_outbox` instead; the batcher drains every 5 minutes and produces one digest per recipient. Existing transactional emails (magic-link invite, welcome draft send, password reset) are not batched.

The batcher cron is scheduled via Supabase pg_cron, same pattern as `triage-backstop-hourly` and `webhook-retry-5m`. The schedule string is `*/5 * * * *`.

### 6.4 Supabase RLS

Every new table is `FORCE ROW LEVEL SECURITY`. Service-role-only access. The portal reaches Supabase through `supabaseAdmin` server-side; there is no anon path. The session cookie pattern (`getPortalSession`, `getFirmSession`) is the gate at the API route level, not at the database level.

For `matter_messages`, the route handler asserts: (a) the session role can read the requested `channel_type`; (b) the matter belongs to the session's firm; (c) for client sessions, the matter_id on the token matches the matter_id in the URL.

---

## 7. Phase 2 candidates

The following features were considered for Phase 1 and deferred. They are documented here so future planning sessions inherit the reasoning.

- **App folders in the sidebar.** Worth building once the sidebar is crowded. Phase 1 has six client-side surfaces (home, messages, files, explainers, embed, billing-stub) and four lawyer-side surfaces (home, triage, clients, dashboard); not crowded yet.
- **Dynamic homepage variants keyed on custom-field rules.** Phase 1 keys homepage variants on `matter_stage` only. Practice-area-keyed variants are a Phase 2 add when explainer assignment proves out.
- **Tasks with client visibility.** Requires a task entity, which Phase 1 does not have. The Assembly "Client Association" pattern is the target shape when Phase 2 introduces tasks.
- **Recurring automations on a schedule.** The current automation surface is event-triggered (the J1-J12 cadences). Adding cron-style triggers is a workflow-engine change, not a portal change. Defer until the J cadences ship enough data to inform what recurring jobs are worth automating.
- **Always-on form template editor.** Phase 1 ships exactly three default templates (status request, new matter, general question), seeded by the operator. Per-firm authoring is Phase 3 when the explainer library authoring lands.
- **Granular per-staff notification preferences.** Phase 1 ships one toggle per staff member: "email me / don't email me." The Assembly per-event-type preference matrix is Phase 2.
- **CSV import with field mapping.** The operator-onboarding flow handles client migration in Phase 1 (the operator transcribes the firm's existing client list into the database manually). Self-serve CSV is a Phase 2 add-on if the operator's manual load proves to be a bottleneck.
- **Three-channel-type UI (group + company).** Schema supports it; UI does not. Real legal matters with multiple parties at one client are the trigger for promoting this UI from Phase 1 to Phase 2.
- **Configurable client list columns.** Phase 1 ships a single sensible column layout. Per-user column preferences are Phase 2.

---

## 8. Phase 3 candidates

- **Client-branded sub-tenant override.** A corporate-retainer client seeing their own logo when they log into the firm portal. High-perceived-value but niche. Phase 3 when a corporate-retainer firm onboards.
- **Per-firm explainer authoring.** Phase 1 explainer library is operator-curated. Per-firm authoring tooling (rich-text editor, tagging, publish workflow) is Phase 3.
- **Custom Apps framework with auth bridge.** Phase 1 ships a minimal sandboxed iframe without an auth bridge. The Assembly app-bridge pattern is Phase 3 when at least one firm has a custom dashboard worth bridging into.

---

## 9. Proposed Decision Register entries

These are PROPOSALS for the operator. None of them are in CRM Bible v5.1 yet. The operator decides whether to promote any of them into canonical doctrine. Each is written in the same shape as existing DR entries so promotion is a copy-paste move.

---

### DR-040 (proposed) · Matter-stage state machine: five stages with forward-only transitions

**Date:** 2026-05-18

**Was.** The portal had a leads pipeline keyed on `leads.stage` with nine values (`new_lead` through `client_lost`). That table is the pre-hire funnel. Once a lead is signed, no equivalent state machine exists on the lawyer-side; the matter lives implicitly inside the firm's PMS (Clio, or whatever the firm uses off-platform). The client portal had no state model at all, which made "what is the client seeing right now" an unanswerable question.

**Now.** Every signed matter carries a `matter_stage` value through a five-stage forward-only state machine: `intake → retainer_pending → active → closing → closed`. Entry triggers, exit triggers, and side effects are documented in `docs/architecture/S8-Phase1-architecture.md` section 5. Reverse transitions are not allowed in the UI; the operator unlocks manually if a closed matter needs to reopen.

The five stages are the minimum set that supports a useful client-side variant of "what's next" without exploding into a custom workflow tree. Practice-area-specific stages (probate-progress for estate, discovery-prep for litigation) are deliberately not modeled at this layer; the explainer library carries that nuance.

The state machine lives in `client_matters.matter_stage` (the canonical column) with an enum CHECK constraint. Transitions go through `/api/portal/[firmId]/matters/[matterId]/stage` and validate against the legal-transition map. Every transition writes to `matter_stage_events` for audit.

**Reason.** A client portal without state is just file storage. The Assembly teardown is unambiguous: the homepage must answer "what's next" with a single action, and "what's next" is a function of where the matter is in its lifecycle. Five stages is the shortest sequence that distinguishes meaningful client experiences without becoming a custom-workflow-per-firm support liability. The forward-only transition rule prevents the operator from being asked to support edge cases like "what if the client moves backward from active to retainer-pending" until usage data justifies the complexity.

---

### DR-041 (proposed) · Internal team chat: privileged messaging separated from client-facing thread

**Date:** 2026-05-18

**Was.** The portal had a single client-thread message model. Lawyer-to-paralegal conversation about a matter happened off-platform (Slack, SMS, email, or in-person), creating an audit gap and forcing context switches mid-matter.

**Now.** Every matter has two thread types in the same data model. `channel_type='client'` is the lawyer-to-client thread. `channel_type='internal'` is the firm-team-only thread. Both live in `matter_messages` with RLS enforcing visibility. The lawyer sees both side by side on `/portal/[firmId]/clients/[matterId]`: the client thread in the main column, the internal thread in a persistent right-rail panel. The client sees only the client thread.

The internal thread is privileged work-product. It is treated as solicitor-client privileged communication, protected from disclosure under Ontario law. The application code never renders internal-thread content into any surface accessible to a client session (including export endpoints, public-share endpoints, or webhook payloads). API routes that read messages assert `channel_type` permissions against the session role on every request.

**Reason.** Solo and 2-lawyer firms cannot afford to switch apps mid-matter to ask their paralegal a question about the client they are talking to. Assembly's 2.0 release made this the headline feature for the same reason. The compliance constraint is real: internal lawyer-to-paralegal discussion about a matter is privileged, and any architecture that risks leaking it to the client surface is unacceptable. Putting both threads in the same table with a discriminator (rather than two tables) is the right call because it keeps the audit chronology unified: every event on the matter sits in one ordered timeline: while RLS and route-level role assertions enforce the visibility split.

---

### DR-042 (proposed) · Welcome message draft-then-send: LSO Rule 4.2-1 protection

**Date:** 2026-05-18

**Was.** Existing journey cadences (J1, J7, etc.) auto-send templated emails on stage triggers without human review. That posture is safe for short transactional messages ("we received your inquiry") but becomes risky for the welcome message a new client receives, which sets first-impression expectations about the matter.

**Now.** Every Band A take produces a system-drafted welcome message on the matter (`client_matters.welcome_draft_html`). The draft is templated from a fixed pool of approved snippets that pass LSO Rule 4.2-1 (no outcome promises, no specialist or expert language, no unverifiable superlatives). The draft is NOT auto-sent. The lawyer reviews on the client detail page, optionally edits the body, and presses Send. Send is the action that fires the invite email and initializes the client thread.

The original system-generated draft is preserved on the row for audit even after the lawyer edits it. The sent body is also preserved. Both columns are append-only after send.

**Reason.** A lawyer-reviewed message is auditable as a lawyer's own work product under LSO supervision. An auto-sent message with substantive matter content is harder to defend if a complaint surfaces. The cost of the extra click (the lawyer reviewing the draft) is trivial compared to the compliance protection. The operator decides at the doctrine level: every client-facing message that touches matter content goes through draft-then-send. Pure transactional messages (magic-link invite, scheduling confirmation, payment receipt) remain auto-send. The line is "does the message contain a substantive description of the matter, the lawyer's role, or expected next steps." If yes, draft-then-send.

---

### DR-043 (proposed) · Embedded iframe security: sandbox plus CSP, no auth bridge in Phase 1

**Date:** 2026-05-18

**Was.** The portal had no embed surface. Firms wanting to surface a third-party dashboard inside the client experience had to send the client off-portal, breaking the unified experience.

**Now.** Every matter can carry one pre-authenticated embed URL on `client_matters.embed_url`. The portal renders this URL in an iframe with `sandbox="allow-scripts allow-same-origin allow-forms"` and a Content-Security-Policy header that allow-lists the embed origin on a per-firm basis. The iframe occupies the body of `/portal/[firmId]/m/[matterId]/embed`. There is no auth bridge in Phase 1: the firm provides a URL that is either public or carries its own auth token in the path. The portal does not pass any session identity to the embedded app.

The CSP allow-list lives in `intake_firms.embed_origins JSONB` (added in the routing-config migration; one origin per firm in Phase 1, but JSONB shape supports multiple). The operator sets this during firm onboarding. The browser refuses to render iframes for unlisted origins.

**Reason.** Embeds are a high-value extensibility primitive. Letting a firm drop in an Airtable view, a Looker dashboard, or a Notion page lets the portal feel like the firm's bespoke client experience without us building those features. The auth-bridge pattern Assembly uses (Custom Apps framework, app-bridge handling session identity) is the right Phase 3 architecture but premature for Phase 1: the security surface area is large, and no firm has yet asked for it. The sandbox-plus-CSP shape is the minimum-risk floor that still delivers the use case. If a firm needs authenticated embeds in Phase 1, they generate a pre-authenticated URL on their side (signed JWT in path, or a per-matter unguessable token) and the portal renders it; we never see the auth.

---

## 10. Risks and open questions

### 10.1 Matter creation for non-Band-A takes

Phase 1 auto-creates a matter on Band A take only. Band B, C, and D takes do not auto-create matters. The operator runbook covers manual promotion. Open question: when does Phase 2 promote Band B auto-matter-creation into the default? Likely when the operator sees that Band B leads have a comparable sign rate to Band A in production data.

### 10.2 Matter-to-screened-lead relationship for retakes

If a firm takes a lead, the lead does not retain, and the same person inquires again three months later, the new inquiry produces a new `screened_leads` row and (on take) a new `client_matters` row. The relationship between matters for the same person is not modeled in Phase 1. Open question: does the explainer library need to surface "this person had a prior matter that did not retain" to the lawyer? Phase 2 question.

### 10.3 The legacy /portal/[firmId]/leads page

The existing `/portal/[firmId]/leads` page reads from the legacy `leads` table (CPI v2.1, five-band scoring). It coexists with the new `screened_leads` triage queue. Phase 1 does not touch this page. Long-term, the legacy `leads` flow will likely be aged out as Screen 2.0 becomes the only intake path. Open question: when does the operator decide to deprecate the legacy leads page entirely? Tied to whether Band B/C/D promotion-to-matter shifts entirely into Screen 2.0.

### 10.4 The legacy /portal/[firmId]/dashboard page

The existing lawyer dashboard (Tier 1 / Tier 2 / Tier 3 from CRM Bible v3) is firm-facing and uses the legacy `leads` data. Phase 1 leaves it intact and adds a NEW `/portal/[firmId]/clients` page as the active-clients surface. Open question: should the Tier 1 dashboard be the home, or should home be the new active-clients view? Phase 1 decision: home stays as the triage queue plus active-clients below (per operator decision 4). The Tier 1 dashboard remains accessible via the tab nav.

---

## 11. Implementation outcomes (shipped 2026-05-22)

All 16 stories shipped in a single focused session. This section documents what actually landed for the next @architect / @dev session to reference.

### 11.1 Migrations applied to Supabase project `ssxryjxifwiivghglqer` (7 of 7)

- `20260520_s8p1_firm_lawyers_roles.sql` — role split (admin/staff/operator/lawyer-legacy), display_name, title, email_notifications_enabled
- `20260520_s8p1_intake_firms_routing.sql` — default_lead_by_practice_area, default_lead_id, default_assignees, client_files_locked, subdomain (unique partial idx), embed_origins
- `20260520_s8p1_client_matters.sql` — client_matters + matter_stage_events, RLS FORCEd
- `20260520_s8p1_matter_messages.sql` — matter_messages + matter_message_recipients, RLS FORCEd
- `20260520_s8p1_explainer_articles.sql` — explainer_articles (10 seed slugs published=false) + matter_explainer_assignments
- `20260520_s8p1_notification_outbox.sql` — notification_outbox table, RLS FORCEd
- `20260520_s8p1_notification_batch_cron.sql` — pg_cron `notification-batch-5m` schedule `*/5 * * * *`

### 11.2 New routes (14)

```
POST   /api/portal/[firmId]/matters/[matterId]/stage           (S03)
GET    /api/portal/[firmId]/matters/[matterId]/messages         (S06)
POST   /api/portal/[firmId]/matters/[matterId]/messages         (S06)
GET    /api/portal/[firmId]/matters/[matterId]/welcome           (S08)
PATCH  /api/portal/[firmId]/matters/[matterId]/welcome           (S08)
POST   /api/portal/[firmId]/matters/[matterId]/welcome/send      (S08)
POST   /api/portal/[firmId]/matters/[matterId]/invite            (S01)
GET    /api/portal/[firmId]/matters/[matterId]/explainers        (S15)
POST   /api/portal/[firmId]/matters/[matterId]/explainers        (S15)
DELETE /api/portal/[firmId]/matters/[matterId]/explainers        (S15)
GET    /api/portal/[firmId]/matters/[matterId]/embed             (S16)
PATCH  /api/portal/[firmId]/matters/[matterId]/embed             (S16)
POST   /api/portal/[firmId]/matters/[matterId]/kickoff           (S14)
POST   /api/portal/[firmId]/broadcast                            (S11)
GET    /api/portal/[firmId]/config/folder-lock                   (S10)
PATCH  /api/portal/[firmId]/config/folder-lock                   (S10)
GET    /api/cron/notification-batch                              (S09)
```

Plus extension of `POST /api/portal/[firmId]/triage/[leadId]/take` to create `client_matters` on Band A.

### 11.3 New surfaces (3)

- `/portal/[firmId]/m/[matterId]` (S04) — client matter home, magic-link gated
- `/portal/[firmId]/m/[matterId]/accept` (S01) — magic-link landing
- `/portal/[firmId]/clients` (S05) — lawyer active-clients home

### 11.4 New libs (5)

- `src/lib/matter-stage-pure.ts` — validateStageTransition, journeyTriggerForTransition, canAdvanceStage, nextStage
- `src/lib/matter-stage.ts` — createMatterFromBandATake, transitionMatterStage, getMatterById, listActiveMattersForFirm
- `src/lib/matter-messages-pure.ts` — canWriteChannel, visibleChannelsForRole, notificationEventType, sanitiseBody
- `src/lib/matter-messages.ts` — listMessagesForMatter, insertMessage, enqueueMessageNotification
- `src/lib/welcome-draft-pure.ts` — buildWelcomeDraft (deterministic, LSO-compliant)

### 11.5 portal-auth extensions

`PortalRole` widened to `"lawyer" | "operator" | "client"`. Token + session carry `matter_id` + `client_email` for client tokens. New `getClientMatterSession(firmId, matterId)` helper. `getFirmSession()` explicitly excludes client sessions (defence-in-depth).

### 11.6 Files-route hardening

Existing firm-files routes now explicitly reject client-role sessions at the gate + narrow `ActorContext` role cast. Even if a client-role cookie somehow reached a firm-files endpoint, the upfront 401 prevents any further code path.

### 11.7 Tests + typecheck

1894/1894 vitest pass. `npx tsc --noEmit` clean on app + sandbox. `check-engine-sync.sh` passes for Phase A + Phase B engine mirrors.

### 11.8 Doctrine

CRM Bible v5.1 extended with DR-049 through DR-053 (matter-stage state machine, matter messages channel discriminator, welcome draft template, embed CSP allow-list, screen engine sub-type packs).

### 11.9 What's deferred (next sessions)

- Operator-facing UI for S13 firm routing config (DB columns shipped; admin UI deferred)
- Per-individual message read tracking (data model exists; UI Phase 2)
- Internal team chat right-rail React component (data plane shipped; UI is next session)
- Welcome draft inline editor (PATCH endpoint shipped; UI is next session)
- Matter detail page `/portal/[firmId]/matters/[matterId]` (referenced from active-clients page; not yet implemented)
- Explainer body content (10 seed slugs at `published=false`; operator authors body per future runbook)
- Phase 2 surfaces per epic scope discipline section

### 11.10 End-to-end Band A happy path (live in the codebase)

Lead → triage → take (creates client_matters + welcome draft) → kickoff (sends welcome + assigns explainers + advances stage + generates invite) → client accepts magic link → matter home (stage card + thread + explainers + embed) → ongoing message thread + stage transitions firing journey cadences → eventual close.

All routes, helpers, tables, migrations, CSS, and auth helpers live in the codebase. Vercel auto-deploys on push to main.
