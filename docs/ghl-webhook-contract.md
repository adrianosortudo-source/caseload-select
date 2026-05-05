# GHL Webhook Contract — Lawyer Triage Actions

**Version:** 1
**Drafted:** 2026-05-05
**Audience:** Operator (Adriano), GHL workflow builders, future contributors
**Source surfaces:** caseload-select-app (`src/lib/ghl-webhook.ts`, the four action endpoints), GoHighLevel inbound webhook configured per firm in `intake_firms.ghl_webhook_url`

This document is the contract across three systems: Supabase (`screened_leads.status` enum), the lawyer portal (Take and Pass action endpoints, the OOS auto-fire path, the backstop cron), and the GHL workflow that consumes the inbound payload and engages the right cadence. Drift in any field name, value enumeration, or shape breaks cadence routing silently. Treat this file as a locked artifact; bump the version when fields change and update GHL workflows in the same release.

---

## Lifecycle to action mapping

The four lifecycle states on `screened_leads.status` map to four webhook actions. Every state transition out of `triaging` fires exactly one webhook. There is no transition from `taken`, `passed`, or `declined` back to `triaging` — the lifecycle is monotonic.

| Status transition | Action | Fires from | Cadence on GHL side |
|---|---|---|---|
| `triaging` → `taken` | `taken` | `POST /api/portal/[firmId]/triage/[leadId]/take` | Band-driven engagement cadence (A = same-day call, B = booking link, C = lawyer choice) |
| `triaging` → `passed` | `passed` | `POST /api/portal/[firmId]/triage/[leadId]/pass` | Decline-with-grace, lawyer-initiated; uses resolved decline copy with optional per-lead override |
| (insert) → `declined` | `declined_oos` | `POST /api/intake-v2` when `matter_type === 'out_of_scope'` | Decline-with-grace, OOS-flavoured; references the practice area |
| `triaging` → `declined` | `declined_backstop` | `GET /api/cron/triage-backstop` (vercel cron) when `decision_deadline < now()` | Decline-with-grace, backstop-flavoured; lawyer never acted |

The four `action` values are the routing key on the GHL side. Every webhook payload includes `action` at the top level.

---

## Common envelope

Every webhook payload, regardless of action, includes the following envelope fields. GHL workflows route on `action` and read identity from `lead_id` + `firm_id`.

| Field | Type | Notes |
|---|---|---|
| `action` | enum: `taken` \| `passed` \| `declined_oos` \| `declined_backstop` | The routing key |
| `lead_id` | string | `L-YYYY-MM-DD-XXX` format, the screen's stable lead identifier |
| `firm_id` | uuid | Matches `intake_firms.id` |
| `band` | enum: `A` \| `B` \| `C` \| `null` | `null` only for `declined_oos` (OOS leads are never banded) |
| `matter_type` | string | One of the 16 in-scope matter types or `out_of_scope` |
| `practice_area` | string | `corporate`, `real_estate`, or one of the six OOS areas |
| `submitted_at` | ISO8601 | Original screen submission timestamp |
| `status_changed_at` | ISO8601 | Moment this transition fired |
| `status_changed_by` | string | `lawyer` for Take/Pass, `system:oos` for `declined_oos`, `system:backstop` for `declined_backstop` |
| `contact` | object | `{ name?, email?, phone? }` from the screen submission |
| `idempotency_key` | string | `<lead_id>:<action>` — GHL workflows should dedupe on this if retries are configured |

Action-specific fields nest under a sibling key matching the action name (`taken`, `passed`, `declined_oos`, `declined_backstop`). Unknown fields must be ignored by GHL; new fields are additive.

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

Fires from `GET /api/cron/triage-backstop` (Vercel cron, runs every 15 minutes) when a row in `triaging` state has passed its `decision_deadline` without lawyer action.

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

## Delivery mechanics

### Where the webhook is posted

Each firm has its own `intake_firms.ghl_webhook_url`. The Next.js endpoints fire to that URL via `fetch` with `Content-Type: application/json`. If the URL is empty or `null`, the webhook is skipped silently and a row is logged in `lead_activities` (the operator can re-fire from the lead detail page).

### Auth

GHL inbound webhooks accept any POST to the configured URL — no shared secret is built into GHL's incoming-webhook surface. The webhook URL itself is the credential. If a per-firm shared secret becomes available in GHL, this contract gains an `X-Caseload-Signature` HMAC header (deferred; not Phase 2).

### Idempotency

Every payload includes `idempotency_key = lead_id + ':' + action`. GHL workflows that retry on transient failures should dedupe on this key.

The Next.js side does not retry on transport failures in Phase 2. A failed webhook leaves the row in its updated status with no retry; the operator surfaces the failure in the dashboard and can re-fire manually. Phase 3 hardening adds an outbox pattern (`webhook_outbox` table + cron retry).

### Ordering

Webhooks fire AFTER the database update, never before. If the DB update fails, no webhook fires. If the DB update succeeds and the webhook fails, the row is in the correct state but the cadence does not engage — operator surfaces this and can re-fire.

This is the at-most-once delivery guarantee. It is a deliberate choice for MVP: Phase 3 outbox pattern would upgrade to at-least-once with idempotency dedupe on the GHL side.

### Timeouts

- Outbound HTTP timeout: 8 seconds
- On timeout: log + skip, no retry. Operator surfaces.
- Backstop cron processes up to 25 rows per run to keep wall-clock under 60s.

---

## Lifecycle state contract — schema constraint

The four-value enum is hard-enforced in Postgres on `screened_leads.status_check`:

```sql
CHECK (status = ANY (ARRAY['triaging'::text, 'taken'::text, 'passed'::text, 'declined'::text]))
```

GHL workflows that read the lifecycle state (e.g. via Supabase REST for analytics) must accept exactly these four values. New states require a migration AND a contract revision here.

---

## Versioning

This file is `v1`. Bump the version whenever:

- Any field is renamed, removed, or has its value enumeration changed
- A new action is added (e.g. `re_engaged` for cross-cadence handoffs in Phase 3)
- The decline template resolution order changes
- The idempotency key shape changes

Never silently change a field's semantics. GHL workflow builders should pin their work to a version of this file.
