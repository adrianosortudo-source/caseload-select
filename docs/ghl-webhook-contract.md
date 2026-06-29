# GHL Webhook Contract: Triage Actions + Matter Stage Events

**Version:** 3
**Drafted:** 2026-05-05
**Revised:** 2026-05-12: added `intake_language` to common envelope (multilingual build)
**Revised:** 2026-06-09: added `referred` (documents the Band D Refer action shipped 2026-05-15, DR-037), added `matter_stage_changed` (DR-049 matter-stage cadences move to GHL-owned execution, CRM Bible section 12), corrected delivery mechanics from at-most-once to at-least-once via `webhook_outbox`
**Audience:** Operator (Adriano), GHL workflow builders, future contributors
**Source surfaces:** caseload-select-app (`src/lib/ghl-webhook.ts`, the five triage action paths, the matter-stage transition helper `src/lib/matter-stage.ts`), GoHighLevel inbound webhook configured per firm in `intake_firms.ghl_webhook_url`

This document is the contract across three systems: Supabase (`screened_leads.status` enum plus the `client_matters` stage machine), the lawyer portal (Take / Pass / Refer action endpoints, the OOS auto-fire path, the backstop cron, the matter-stage transition route), and the GHL workflow that consumes the inbound payload and engages the right cadence. Drift in any field name, value enumeration, or shape breaks cadence routing silently. Treat this file as a locked artifact; bump the version when fields change and update GHL workflows in the same release.

---

## Lifecycle to action mapping

The lifecycle states on `screened_leads.status` map to five webhook actions. Every state transition out of `triaging` fires exactly one webhook. There is no transition from `taken`, `passed`, `referred`, or `declined` back to `triaging`; the lifecycle is monotonic.

| Status transition | Action | Fires from | Cadence on GHL side |
|---|---|---|---|
| `triaging` → `taken` | `taken` | `POST /api/portal/[firmId]/triage/[leadId]/take` | Band-driven engagement cadence (A = same-day call, B = booking link, C = lawyer choice) |
| `triaging` → `passed` | `passed` | `POST /api/portal/[firmId]/triage/[leadId]/pass` | Decline-with-grace, lawyer-initiated; uses resolved decline copy with optional per-lead override |
| `triaging` → `referred` | `referred` | `POST /api/portal/[firmId]/triage/[leadId]/refer` | Firm's choice; common patterns are a "we have referred you to X" note or nothing (relationship-only) |
| (insert) → `declined` | `declined_oos` | `POST /api/intake-v2` when `matter_type === 'out_of_scope'` | Decline-with-grace, OOS-flavoured; references the practice area |
| `triaging` → `declined` | `declined_backstop` | `GET /api/cron/triage-backstop` (pg_cron, runs every hour at :07) when `decision_deadline < now()` | Decline-with-grace, backstop-flavoured; lawyer never acted |

A sixth action, `matter_stage_changed`, is not a `screened_leads` lifecycle event: it fires on forward `client_matters` stage transitions (see its section below) and carries a reduced envelope.

The `action` value is the routing key on the GHL side. Every webhook payload includes `action` at the top level, and every GHL workflow MUST filter on it before consuming a payload.

---

## Common envelope

Every triage-action webhook payload includes the following envelope fields. GHL workflows route on `action` and read identity from `lead_id` + `firm_id`. The `matter_stage_changed` action carries a reduced envelope (see its section); everything in this table applies to the five `screened_leads` lifecycle actions.

| Field | Type | Notes |
|---|---|---|
| `action` | enum: `taken` \| `passed` \| `referred` \| `declined_oos` \| `declined_backstop` \| `matter_stage_changed` | The routing key |
| `lead_id` | string | `L-YYYY-MM-DD-XXX` format, the screen's stable lead identifier |
| `firm_id` | uuid | Matches `intake_firms.id` |
| `band` | enum: `A` \| `B` \| `C` \| `D` \| `null` | `null` only for `declined_oos` (OOS leads on that legacy path are never banded); `D` is the refer-eligible OOS band |
| `matter_type` | string | One of the in-scope matter types or `out_of_scope` |
| `practice_area` | string | One of the firm's in-scope practice areas or one of the OOS areas |
| `submitted_at` | ISO8601 | Original screen submission timestamp |
| `status_changed_at` | ISO8601 | Moment this transition fired |
| `status_changed_by` | string | `lawyer` or `operator` for Take/Pass/Refer, `system:oos` for `declined_oos`, `system:backstop` for `declined_backstop` |
| `contact` | object | `{ name?, email?, phone? }` from the screen submission |
| `idempotency_key` | string | `<lead_id>:<action>` for the five triage actions; GHL workflows MUST dedupe on this (delivery is at-least-once) |
| `intake_language` | string | ISO 639-1 code of the language the lead used during intake (e.g. `en`, `fr`, `pt`, `zh`, `es`, `ar`). Always present; defaults to `en` for legacy rows and English-language intakes. Use this field in GHL to route non-English leads to language-capable staff or trigger translated cadence templates. |

Action-specific fields nest under a sibling key matching the action name (`taken`, `passed`, `referred`, `declined_oos`, `declined_backstop`, `matter_stage_changed`). Unknown fields must be ignored by GHL; new fields are additive.

---

## Action: `taken`

Fires when the lawyer presses Take in the brief view. The cadence engaged on GHL depends on the band — the lawyer-recommended action is the cadence trigger.

### Payload

```json
{
  "action": "taken",
  "lead_id": "L-2026-05-05-A1B",
  "firm_id": "1f5a2391-85d8-45a2-b427-90441e78a93c",
  "band": "A",
  "matter_type": "shareholder_dispute",
  "practice_area": "corporate",
  "submitted_at": "2026-05-05T14:00:00.000Z",
  "status_changed_at": "2026-05-05T14:12:33.000Z",
  "status_changed_by": "lawyer",
  "contact": {
    "name": "Jordan Reyes",
    "email": "jreyes@example.com",
    "phone": "+14165550000"
  },
  "idempotency_key": "L-2026-05-05-A1B:taken",
  "taken": {
    "cadence_target": "band_a",
    "lawyer_recommended_action": "Call same day",
    "fee_estimate": "$5,000–$25,000",
    "matter_snapshot": "Shareholder dispute with locked-out access and money concern"
  }
}
```

### Cadence routing on GHL

| `band` | `cadence_target` | GHL workflow trigger |
|---|---|---|
| `A` | `band_a` | Same-day call cadence — auto-task to the lawyer, SMS confirmation, calendar block |
| `B` | `band_b` | Booking-link cadence — email with Calendly/SimplyBook link, 1-2 business day SLA |
| `C` | `band_c` | Lawyer-choice cadence — booking link OR pass; if no action in 24h, fires backstop |

GHL workflows match on `taken.cadence_target` directly. The `band` field is included for convenience but `cadence_target` is the canonical routing key for the Take path so a future band rename does not silently change cadence assignment.

---

## Action: `passed`

Fires when the lawyer presses Pass and confirms in the modal. Carries the resolved decline copy that GHL emails to the lead.

### Payload

```json
{
  "action": "passed",
  "lead_id": "L-2026-05-05-A1B",
  "firm_id": "1f5a2391-85d8-45a2-b427-90441e78a93c",
  "band": "C",
  "matter_type": "residential_purchase_sale",
  "practice_area": "real_estate",
  "submitted_at": "2026-05-05T14:00:00.000Z",
  "status_changed_at": "2026-05-05T14:14:02.000Z",
  "status_changed_by": "lawyer",
  "contact": {
    "name": "Jordan Reyes",
    "email": "jreyes@example.com",
    "phone": "+14165550000"
  },
  "idempotency_key": "L-2026-05-05-A1B:passed",
  "passed": {
    "decline_subject": "Re: your inquiry to Hartwell Law",
    "decline_body": "Thank you for reaching out about your home purchase. After reviewing the details you shared, this falls outside the matters our firm currently handles. We recommend connecting with a real estate lawyer in your area, and we wish you a smooth closing.",
    "decline_template_source": "per_lead_override",
    "lawyer_note_present": true
  }
}
```

### Decline template resolution (three-layer)

The `decline_body` value is resolved server-side at the moment of Pass via the following precedence order. Whichever match is hit first wins.

1. **Per-lead override** (`screened_leads.status_note`). Set if the lawyer typed a custom note in the Pass modal. `decline_template_source = "per_lead_override"`.
2. **Per-practice-area template** (`firm_decline_templates` row matching `firm_id` + `practice_area`). `decline_template_source = "per_pa"`.
3. **Firm default template** (`firm_decline_templates` row matching `firm_id` with `practice_area = null`). `decline_template_source = "firm_default"`.
4. **System fallback** (hard-coded copy in `lib/decline-resolver.ts`). `decline_template_source = "system_fallback"`.

GHL workflows do not need to know about the resolution path — they consume the resolved `decline_body` directly. The `decline_template_source` field is exposed for operator visibility / audit, not workflow logic.

---

## Action: `referred`

Fires when the lawyer presses Refer (the Band D primary affordance, DR-037 / Band D doctrine 2026-05-15) and the row flips from `triaging` to `referred`. Refer is not limited to Band D: the engine-misclassification edge case lets a lawyer refer a lead on any band, so the envelope preserves the band as-is.

No decline copy is resolved. Refer does not fire decline-with-grace; the firm's GHL workflow decides what cadence (if any) to run for a referred lead. Common downstream patterns: a "we have referred you to X" note to the contact, or nothing (relationship-only).

### Payload

```json
{
  "action": "referred",
  "lead_id": "L-2026-05-15-D2C",
  "firm_id": "1f5a2391-85d8-45a2-b427-90441e78a93c",
  "band": "D",
  "matter_type": "out_of_scope",
  "practice_area": "family",
  "submitted_at": "2026-05-15T14:00:00.000Z",
  "status_changed_at": "2026-05-15T16:40:12.000Z",
  "status_changed_by": "lawyer",
  "contact": {
    "name": "Jordan Reyes",
    "email": "jreyes@example.com",
    "phone": "+14165550000"
  },
  "idempotency_key": "L-2026-05-15-D2C:referred",
  "intake_language": "en",
  "referred": {
    "referred_to": "Jane Doe at Acme Family Law",
    "note": "Long-standing referral partner; she handles these well."
  }
}
```

Both extension fields are nullable: `referred_to` is the freeform recipient (name / firm / email, whatever the lawyer typed) and may be `null` when the lawyer marks a lead referred without naming the recipient yet; `note` is an optional internal annotation.

---

## Action: `declined_oos`

Fires from `/api/intake-v2` immediately after insert when `matter_type === 'out_of_scope'`. Practice area is named so GHL can pick the right OOS-flavoured copy if the firm has practice-area variants.

### Payload

```json
{
  "action": "declined_oos",
  "lead_id": "L-2026-05-05-OOS",
  "firm_id": "1f5a2391-85d8-45a2-b427-90441e78a93c",
  "band": null,
  "matter_type": "out_of_scope",
  "practice_area": "family",
  "submitted_at": "2026-05-05T14:00:00.000Z",
  "status_changed_at": "2026-05-05T14:00:00.000Z",
  "status_changed_by": "system:oos",
  "contact": {
    "name": "Jordan Reyes",
    "email": "jreyes@example.com"
  },
  "idempotency_key": "L-2026-05-05-OOS:declined_oos",
  "declined_oos": {
    "decline_subject": "Re: your inquiry",
    "decline_body": "Thank you for reaching out. Family law sits outside the matters our firm currently handles. We recommend contacting a family lawyer or the Law Society of Ontario referral service for help finding the right person for your situation.",
    "decline_template_source": "per_pa",
    "detected_area_label": "family law"
  }
}
```

The `practice_area` field carries the engine's OOS classification (`family`, `immigration`, `employment`, `criminal`, `personal_injury`, `estates`). GHL can branch on this if per-area copy variants are configured.

---

## Action: `declined_backstop`

Fires from `GET /api/cron/triage-backstop` (Supabase pg_cron, runs hourly at minute 7) when a row in `triaging` state has passed its `decision_deadline` without lawyer action.

### Payload

```json
{
  "action": "declined_backstop",
  "lead_id": "L-2026-05-05-A1B",
  "firm_id": "1f5a2391-85d8-45a2-b427-90441e78a93c",
  "band": "B",
  "matter_type": "contract_dispute",
  "practice_area": "corporate",
  "submitted_at": "2026-05-03T14:00:00.000Z",
  "status_changed_at": "2026-05-05T14:12:00.000Z",
  "status_changed_by": "system:backstop",
  "contact": {
    "name": "Jordan Reyes",
    "email": "jreyes@example.com",
    "phone": "+14165550000"
  },
  "idempotency_key": "L-2026-05-05-A1B:declined_backstop",
  "declined_backstop": {
    "decline_subject": "Re: your inquiry",
    "decline_body": "Thank you for reaching out. We were not able to circle back on your matter within our typical response window. We do not want to leave you waiting; please feel free to reach out again if your situation has not yet been addressed.",
    "decline_template_source": "firm_default",
    "missed_deadline": "2026-05-05T14:00:00.000Z",
    "hours_past_deadline": 0.2
  }
}
```

The `missed_deadline` field reflects the row's original `decision_deadline`; `hours_past_deadline` makes it cheap for GHL to identify recently-missed vs long-stale (the cron may pick up rows that have been past deadline for hours if it was paused).

---

## Action: `matter_stage_changed`

Fires on every forward `client_matters` stage transition that carries a DR-049 journey cadence, from `src/lib/matter-stage.ts` `transitionMatterStage` (called by `POST /api/portal/[firmId]/matters/[matterId]/stage` and the kickoff composition route).

**Why this action exists (operator decision 2026-06-09, CRM Bible section 12).** GoHighLevel is the execution layer that runs cadences; Supabase notifies it via webhooks. Stage transitions previously scheduled in-app `email_sequences` rows whose `lead_id` (a `screened_leads` UUID) resolved against the legacy `leads` table, so the send processor skipped every row and the DR-049 cadence map silently delivered nothing. Stage transitions now enqueue this event through the same at-least-once `webhook_outbox` path the five triage actions use. Until the operator builds the matching GHL workflows, the events queue and deliver harmlessly: GHL workflow filters ignore unknown actions.

### Cadence triggers

The `matter_stage_changed.cadence_trigger` field names the DR-049 journey for the transition. GHL workflows branch on it.

| Transition | `cadence_trigger` | Journey |
|---|---|---|
| `intake` → `retainer_pending` | `retainer_awaiting` | J6 retainer awaiting signature |
| `retainer_pending` → `active` | `client_won` | J7 welcome / onboarding |
| `active` → `closing` | `review_request` | J9 review request |
| `closing` → `closed` | `relationship_milestone` | J11 + J12 relationship + long-term nurture |

### Reduced envelope

This is not a `screened_leads` lifecycle event, so the payload does not carry the full common envelope: `band`, `submitted_at`, `status_changed_at`, `status_changed_by`, and `contact` describe the screened-lead lifecycle and cannot be honestly filled from a matter row. The envelope keeps `action`, `lead_id`, `firm_id`, `idempotency_key`, and `intake_language`; the contact snapshot lives in the extension as `primary_name` / `primary_email` / `primary_phone` (the matter's own columns).

- `lead_id`: the source screened lead's public id (`L-YYYY-MM-DD-XXX`) when resolvable, else the matter UUID. Lets GHL correlate with the earlier `taken` event.
- `idempotency_key`: `<matter_id>:stage:<to_stage>`. The stage machine is forward-only, so each transition fires exactly once per matter.
- `intake_language`: from the source `screened_leads` row when available, else `en`.

### Payload

```json
{
  "action": "matter_stage_changed",
  "lead_id": "L-2026-05-22-SX4",
  "firm_id": "1f5a2391-85d8-45a2-b427-90441e78a93c",
  "idempotency_key": "7c0a4e9b-2f31-4d55-9be2-6f6f1f1d2ab3:stage:retainer_pending",
  "intake_language": "en",
  "matter_stage_changed": {
    "matter_id": "7c0a4e9b-2f31-4d55-9be2-6f6f1f1d2ab3",
    "source_screened_lead_id": "f37b1d80-9a51-4f3c-8a44-1f9adfe1c001",
    "from_stage": "intake",
    "to_stage": "retainer_pending",
    "cadence_trigger": "retainer_awaiting",
    "matter_type": "shareholder_dispute",
    "practice_area": "corporate",
    "primary_name": "Jordan Reyes",
    "primary_email": "jreyes@example.com",
    "primary_phone": "+14165550000",
    "transitioned_at": "2026-06-09T15:22:10.000Z",
    "actor_role": "admin"
  }
}
```

`actor_role` is one of `admin` / `staff` / `operator` / `system`. GHL workflows that only handle triage actions MUST filter on `action` so these payloads pass through untouched.

---

## Delivery mechanics

### Where the webhook is posted

Each firm has its own `intake_firms.ghl_webhook_url`. The Next.js side fires to that URL via `fetch` with `Content-Type: application/json`. If the URL is empty or `null`, the webhook is skipped silently and no outbox row is enqueued.

### Auth

GHL inbound webhooks accept any POST to the configured URL; no shared secret is built into GHL's incoming-webhook surface. The webhook URL itself is the credential. If a per-firm shared secret becomes available in GHL, this contract gains an `X-Caseload-Signature` HMAC header (deferred).

### At-least-once delivery via `webhook_outbox`

Every fire follows the same path (`deliverWebhook` in `src/lib/ghl-webhook.ts`):

1. Look up the firm's webhook URL; skip silently when unconfigured.
2. Insert a `webhook_outbox` row keyed on `idempotency_key` (unique index). A duplicate fire returns the existing row instead of inserting.
3. POST synchronously. On success the row flips to `sent`; on failure it stays `pending` with `next_attempt_at` pushed forward by exponential backoff.

The retry cron (`GET /api/cron/webhook-retry`, Supabase pg_cron every 5 minutes) sweeps `pending` rows whose `next_attempt_at` has passed and re-attempts, up to `max_attempts` (default 5). After the fifth failure the row flips to `failed`. The operator inspects delivery state at `/admin/webhook-outbox` and can manually retry a failed row (retry resets the attempt counter).

This is an at-least-once guarantee: a transient failure between a successful POST and the outbox update, or an operator retry, can deliver the same payload twice. GHL workflows MUST dedupe on `idempotency_key`.

### Ordering

Webhooks fire AFTER the database update, never before. If the DB update fails, no webhook fires. If the DB update succeeds and delivery keeps failing, the row is in the correct state and the outbox retry (then the operator retry UI) owns getting the cadence engaged.

### Timeouts

- Outbound HTTP timeout: 8 seconds
- On timeout: the outbox row stays `pending`; the retry cron re-attempts with backoff.
- Backstop cron processes up to 25 rows per run to keep wall-clock under 60s.

---

## Lifecycle state contract: schema constraint

The five-value enum is hard-enforced in Postgres on `screened_leads.status_check` (extended by migration `20260515_band_d_and_referred_status.sql`):

```sql
CHECK (status IN ('triaging', 'taken', 'passed', 'declined', 'referred'))
```

GHL workflows that read the lifecycle state (e.g. via Supabase REST for analytics) must accept exactly these five values. New states require a migration AND a contract revision here.

The outbox side enforces the action enumeration on `webhook_outbox.action` (migration `20260609_webhook_outbox_action_check_expand.sql`):

```sql
CHECK (action IN ('taken', 'passed', 'referred', 'declined_oos', 'declined_backstop', 'matter_stage_changed'))
```

---

## Versioning

This file is `v3`. Bump the version whenever:

- Any field is renamed, removed, or has its value enumeration changed
- A new action is added (e.g. `re_engaged` for cross-cadence handoffs in Phase 3)
- The decline template resolution order changes
- The idempotency key shape changes

### v1 → v2 (2026-05-12)

- Added `intake_language` to the common envelope. ISO 639-1 code. Always present (defaults to `en`). GHL workflows can branch on this to route non-English leads to language-capable staff or select translated decline templates. Existing workflows that do not read `intake_language` are unaffected.

### v2 → v3 (2026-06-09)

- Documented the `referred` action (shipped 2026-05-15 with the Band D doctrine flip, DR-037; the contract had drifted behind the code).
- Added the `matter_stage_changed` action: DR-049 matter-stage cadences are now GHL-executed (CRM Bible section 12). Stage transitions enqueue this event instead of scheduling in-app `email_sequences` rows, which resolved against the legacy `leads` table and delivered nothing. Reduced envelope; idempotency key `<matter_id>:stage:<to_stage>`.
- Corrected delivery mechanics: at-least-once via `webhook_outbox` with exponential backoff, max 5 attempts, retry cron every 5 minutes, operator retry UI at `/admin/webhook-outbox`. The previous at-most-once wording described the pre-outbox Phase 2 behaviour.
- Updated the lifecycle schema constraint to the five-value enum (includes `referred`) and documented the `webhook_outbox.action` CHECK.

Never silently change a field's semantics. GHL workflow builders should pin their work to a version of this file.
