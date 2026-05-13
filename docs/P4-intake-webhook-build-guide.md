# P4 — Intake Webhook + Form Configuration Build Guide

**Audience:** Operator (Adriano), executing in GHL UI for a client sub-account.
**Effort:** ~45 minutes per firm once the staging template is built once.
**Drafted:** 2026-05-06
**Status:** Build-ready. Unblocks first-client-live by wiring the GHL inbound webhook that consumes the four actions documented in `ghl-webhook-contract.md`.

> **Read first:** `caseload-select-app/docs/ghl-webhook-contract.md` is the source of truth for payload shapes. This guide assumes you know that contract; do not re-derive field names here.

---

## What P4 builds

One inbound GHL webhook per firm sub-account that:

1. Accepts the four payload shapes (`taken`, `passed`, `declined_oos`, `declined_backstop`) from `app.caseloadselect.ca` (or the Vite sandbox during testing).
2. Creates or updates a GHL contact, idempotent on `lead_id`.
3. Populates the 19 custom fields that drive J0 through J12 + Recovery A/B journey routing.
4. Places the contact on the right pipeline stage based on `action` + `band`.
5. Returns 200 to the app within 8 seconds (the at-most-once delivery timeout).

P5 (the journey workflows themselves) and P8 (end-to-end QA) come after this is verified.

---

## Prerequisites

- [ ] Client sub-account created in GHL Agency.
- [ ] `CaseLoad Select · Core Chassis · v[N].0` snapshot applied (post-apply checklist completed: `_API_TEST` deleted, demo pipeline cleared, 19 custom values populated).
- [ ] `intake_firms.id` for this firm is known (uuid).
- [ ] Operator has Agency-level access to the GHL sub-account.

---

## 1. Create the inbound webhook trigger

GHL: **Automation → Workflows → Create Workflow → Start from scratch**.

| Field | Value |
|---|---|
| Workflow name | `INBOUND · CaseLoad Screen · all actions` |
| Folder | `00 · Infrastructure` (create if absent) |
| Trigger type | Inbound Webhook |
| Allowed methods | POST |
| Auth | None (the URL itself is the credential per contract §Auth) |
| Response | 200 immediate (do not wait on downstream actions) |

GHL surfaces the inbound URL after save. Format:

```
https://services.leadconnectorhq.com/hooks/{LOC_ID}/webhook-trigger/{WORKFLOW_ID}
```

Copy that URL.

---

## 2. Store the webhook URL on the firm row

Run in Supabase SQL Editor:

```sql
UPDATE intake_firms
SET ghl_webhook_url = 'https://services.leadconnectorhq.com/hooks/.../webhook-trigger/...'
WHERE id = '<firm uuid>';
```

Verify:

```sql
SELECT id, name, ghl_webhook_url
FROM intake_firms
WHERE id = '<firm uuid>';
```

The app will start firing webhooks to this URL on the next intake submission. No deploy required.

---

## 3. Action-routing branch inside the workflow

Immediately after the trigger, add an **If/Else** node that branches on `Custom Webhook Data → action`. Four branches:

| Branch | Match | Next node |
|---|---|---|
| Taken | `action = "taken"` | Cadence-routing sub-flow (§5 below) |
| Passed | `action = "passed"` | Decline-with-grace email + tag |
| Declined OOS | `action = "declined_oos"` | OOS decline email + tag |
| Declined backstop | `action = "declined_backstop"` | Backstop decline email + tag |

Catch-all branch (else): tag the contact `webhook:unknown_action` for operator review.

---

## 4. Idempotency check

Before creating or updating the contact, dedupe on `idempotency_key`:

1. **Find Contact** node, search by custom field `idempotency_key = {{webhook.idempotency_key}}`.
2. If found: skip the contact-create step, route directly into the cadence (no duplicate firing).
3. If not found: create the contact (§5).

GHL custom field `idempotency_key` must exist on the snapshot. If it does not, add it now (Settings → Custom Fields → add `idempotency_key` text type, on Contact object).

---

## 5. Contact creation + custom field mapping

For new contacts (idempotency check fell through), create the contact and populate the fields below from the webhook payload.

### Identity (4 fields)

| GHL field | Webhook path | Notes |
|---|---|---|
| First Name | `contact.name` (split on first space) | Empty acceptable |
| Last Name | `contact.name` (everything after first space) | Empty acceptable |
| Email | `contact.email` | Primary key for GHL match-and-merge |
| Phone | `contact.phone` | E.164 format from the screen |

### Lead identifiers (3 custom fields)

| GHL custom field | Webhook path |
|---|---|
| `lead_id` | `lead_id` |
| `firm_id` | `firm_id` |
| `idempotency_key` | `idempotency_key` |

### Matter classification (4 custom fields)

| GHL custom field | Webhook path | Allowed values |
|---|---|---|
| `matter_type` | `matter_type` | One of 16 in-scope or `out_of_scope` |
| `practice_area` | `practice_area` | `corporate`, `real_estate`, or one of 6 OOS areas |
| `band` | `band` | `A`, `B`, `C`, or null |
| `cadence_target` | `taken.cadence_target` | `band_a`, `band_b`, `band_c` (taken action only) |

### Triage state (4 custom fields)

| GHL custom field | Webhook path |
|---|---|
| `intake_action` | `action` |
| `submitted_at` | `submitted_at` |
| `status_changed_at` | `status_changed_at` |
| `status_changed_by` | `status_changed_by` |

### Decline copy (4 custom fields, populated only on passed/declined_*)

| GHL custom field | Webhook path |
|---|---|
| `decline_subject` | `<action>.decline_subject` |
| `decline_body` | `<action>.decline_body` |
| `decline_template_source` | `<action>.decline_template_source` |
| `detected_area_label` | `declined_oos.detected_area_label` (OOS only) |

### Taken-only context (3 custom fields)

| GHL custom field | Webhook path |
|---|---|
| `lawyer_recommended_action` | `taken.lawyer_recommended_action` |
| `fee_estimate` | `taken.fee_estimate` |
| `matter_snapshot` | `taken.matter_snapshot` |

### Backstop-only context (1 custom field)

| GHL custom field | Webhook path |
|---|---|
| `hours_past_deadline` | `declined_backstop.hours_past_deadline` |

If a custom field above does not yet exist on the snapshot, add it before continuing. **Pin field types as text** for everything except `hours_past_deadline` (number) and `submitted_at` / `status_changed_at` (datetime).

---

## 6. Pipeline stage routing

After contact creation, place the contact on the right pipeline stage. The Core Chassis pipeline has 9 stages; the trigger maps as follows:

| Action | Band | Pipeline stage |
|---|---|---|
| `taken` | A | 4. Consult Booked (Band A) |
| `taken` | B | 4. Consult Booked (Band B) |
| `taken` | C | 4. Consult Booked (Band C) |
| `passed` | any | 8. Closed-Lost (lawyer pass) |
| `declined_oos` | null | 8. Closed-Lost (out of scope) |
| `declined_backstop` | any | 8. Closed-Lost (backstop) |

`taken` always lands on stage 4; the band tag drives which J1 / J2 / J3 cadence engages in P5. `passed` and both `declined_*` actions land on stage 8 with a substage tag for analytics.

---

## 7. Test payloads

GHL inbound webhook test surface accepts a manual JSON paste. Use the four payloads below to verify routing before live traffic.

### Test A — `taken` Band A

```json
{
  "action": "taken",
  "lead_id": "L-2026-05-06-T01",
  "firm_id": "<firm uuid>",
  "band": "A",
  "matter_type": "shareholder_dispute",
  "practice_area": "corporate",
  "submitted_at": "2026-05-06T14:00:00.000Z",
  "status_changed_at": "2026-05-06T14:12:00.000Z",
  "status_changed_by": "lawyer",
  "contact": {
    "name": "Test Taken-A",
    "email": "test-taken-a@example.com",
    "phone": "+14165550101"
  },
  "idempotency_key": "L-2026-05-06-T01:taken",
  "taken": {
    "cadence_target": "band_a",
    "lawyer_recommended_action": "Call same day",
    "fee_estimate": "$5,000-$25,000",
    "matter_snapshot": "Shareholder dispute, locked-out access"
  }
}
```

Expected: contact created with `intake_action=taken`, `cadence_target=band_a`, on stage 4 with Band A tag.

### Test B — `passed`

```json
{
  "action": "passed",
  "lead_id": "L-2026-05-06-T02",
  "firm_id": "<firm uuid>",
  "band": "C",
  "matter_type": "residential_purchase_sale",
  "practice_area": "real_estate",
  "submitted_at": "2026-05-06T14:00:00.000Z",
  "status_changed_at": "2026-05-06T14:14:00.000Z",
  "status_changed_by": "lawyer",
  "contact": {
    "name": "Test Passed",
    "email": "test-passed@example.com",
    "phone": "+14165550102"
  },
  "idempotency_key": "L-2026-05-06-T02:passed",
  "passed": {
    "decline_subject": "Re: your inquiry",
    "decline_body": "Thank you for reaching out.",
    "decline_template_source": "firm_default",
    "lawyer_note_present": false
  }
}
```

Expected: contact on stage 8, `decline_body` populated, decline-with-grace email queued.

### Test C — `declined_oos`

```json
{
  "action": "declined_oos",
  "lead_id": "L-2026-05-06-T03",
  "firm_id": "<firm uuid>",
  "band": null,
  "matter_type": "out_of_scope",
  "practice_area": "family",
  "submitted_at": "2026-05-06T14:00:00.000Z",
  "status_changed_at": "2026-05-06T14:00:00.000Z",
  "status_changed_by": "system:oos",
  "contact": {
    "name": "Test OOS",
    "email": "test-oos@example.com"
  },
  "idempotency_key": "L-2026-05-06-T03:declined_oos",
  "declined_oos": {
    "decline_subject": "Re: your inquiry",
    "decline_body": "Thank you for reaching out. Family law sits outside the matters our firm currently handles.",
    "decline_template_source": "per_pa",
    "detected_area_label": "family law"
  }
}
```

Expected: contact on stage 8 with OOS tag, `detected_area_label=family law`, OOS decline email queued.

### Test D — `declined_backstop`

```json
{
  "action": "declined_backstop",
  "lead_id": "L-2026-05-06-T04",
  "firm_id": "<firm uuid>",
  "band": "B",
  "matter_type": "contract_dispute",
  "practice_area": "corporate",
  "submitted_at": "2026-05-04T14:00:00.000Z",
  "status_changed_at": "2026-05-06T14:12:00.000Z",
  "status_changed_by": "system:backstop",
  "contact": {
    "name": "Test Backstop",
    "email": "test-backstop@example.com",
    "phone": "+14165550104"
  },
  "idempotency_key": "L-2026-05-06-T04:declined_backstop",
  "declined_backstop": {
    "decline_subject": "Re: your inquiry",
    "decline_body": "We were not able to circle back within our typical response window.",
    "decline_template_source": "firm_default",
    "missed_deadline": "2026-05-05T14:00:00.000Z",
    "hours_past_deadline": 0.2
  }
}
```

Expected: contact on stage 8 with backstop tag, `hours_past_deadline=0.2` populated.

---

## 8. End-to-end verification

After P4 build, before P5 starts:

- [ ] All four test payloads trigger the right branch and land the contact on the right stage.
- [ ] Idempotency: re-fire Test A with the same `idempotency_key`. Contact is updated, NOT duplicated.
- [ ] Custom field population is complete on the test contact (open the contact in GHL, scroll Custom Fields, verify all 19 are populated for Test A).
- [ ] Webhook responds 200 within 8 seconds. Check GHL workflow execution log.
- [ ] Live test from the Vite sandbox: submit a Band A intake at `caseload-screen-v2.vercel.app/?firmId=<firm uuid>`. Verify the test row lands in `screened_leads`. From the lawyer portal, press Take. Verify the contact appears in GHL within seconds with `intake_action=taken`.
- [ ] Live test from the production widget on the firm's site (once embedded). Same path.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Webhook fires but contact not created | Inbound URL stored on wrong firm row | Confirm `intake_firms.ghl_webhook_url` matches the workflow's URL |
| Contact created but custom fields blank | Field mapping nodes pull from wrong path | Re-check the `{{webhook.<path>}}` references against §5 |
| Two contacts for same lead | Idempotency check missing or running after contact-create | Move the Find-Contact-by-idempotency_key node BEFORE Create-Contact |
| Webhook times out | GHL workflow has a synchronous downstream call (e.g. external API) | Move slow steps after the 200 response. The trigger should respond immediately. |
| Wrong cadence engages | P5 workflow routes on `band` instead of `cadence_target` | Per contract §Cadence routing, route on `taken.cadence_target` |

---

## 10. Handoff to P5

P5 (J0 through J12 + Recovery A/B journey workflows) consumes the contact + custom fields populated here. P5 is built once in staging, propagates via snapshot. P5 build guide: `P5-journey-workflows-build-guide.md` (next deliverable).

P8 (10 end-to-end test scenarios) is the gate that says "ready to onboard a paying client" once P5 lands.
