# P5 — Journey Workflows Build Guide (J1 through J12 + Recovery A/B + Decline)

**Audience:** Operator (Adriano) or build agent, executing in GHL UI for the staging sub-account.
**Effort:** ~3-4 working days for all 13 workflows. Built once in staging; propagates to client sub-accounts via snapshot.
**Drafted:** 2026-05-06
**Status:** Build-ready. Independent of the GHL Inbound Webhook billing gate — every journey here fires off pipeline stage changes, custom field matches, or webhook payloads (the last category routes through the P4 INBOUND workflow, which is itself the only billing-gated piece). Workflows can be built and verified during the trial via manual stage moves.

> **Read first:**
> - `P4-intake-webhook-build-guide.md` — the inbound side. P5 consumes the contact + custom fields P4 populates.
> - `ghl-webhook-contract.md` — the four webhook actions and their decline payload variants.
> - `Version3_CaseLoadSelect/CaseLoad_Select_CRM_Bible_v5.1.md` Sections 9 + 10 — the journey doctrine. P5 implements those journeys, doesn't redesign them.

---

## What P5 builds

13 workflows in the staging sub-account. Each consumes the contact + custom fields populated by the P4 inbound webhook, fires the right cadence, and exits cleanly.

| # | Workflow name | Trigger | Touches | Critical for first-client-live |
|---|---|---|---|---|
| 1 | `DECLINE · Decline with Grace` | Webhook payload action ∈ `passed`, `declined_oos`, `declined_backstop` | 1 email | Yes |
| 2 | `J1 · New Lead Response (Band A)` | `cadence_target = band_a` | SMS T+0; Email T+5min; Lawyer task T+0; Calendar block | Yes |
| 3 | `J2 · Consultation Reminders` | Pipeline stage = `4. Consult Booked` | T-48h email, T-24h SMS, T-2h SMS | Yes |
| 4 | `J3 · No-Show Recovery` | Calendar event = `No-show` (or stage = `5. Consult Held` with a no-show flag) | T+1h SMS, T+24h email | Yes |
| 5 | `J4 · Persistence Engine` | Pipeline stage = `1. New Inquiry`, no progress within 24h | 6 touches over 11 days | Yes |
| 6 | `J5A · Recovery A (Spoke, No Book)` | Pipeline stage = `3. Spoke, No Book` | 7 touches over 14 days | Yes |
| 7 | `J5B · Recovery B (Consulted, No Sign)` | Pipeline stage = `5. Consult Held` AND no movement to `6. Retainer Sent` within 48h | 7 touches over 14 days | Yes |
| 8 | `J6 · Retainer Follow-up Cadence` | Pipeline stage = `6. Retainer Sent` | 6 touches over 7 days | Yes |
| 9 | `J7 · Welcome / Onboarding` | Pipeline stage = `7. Retained` | 4 touches over 30 days | Yes |
| 10 | `J8 · Active Matter Update` | Custom field `matter_milestone` changes | 1-2 touches per milestone | Defer to post-launch |
| 11 | `J9 · Google Review Request` | Pipeline stage = `9. Closed-Won` (matter completed) | 3-touch sequence over 14 days | Yes |
| 12 | `J10 · Referral / Re-Engagement` | Tag = `j10_eligible` (set by J9 completion or manual) | 4 touches over 90 days | Defer to post-launch |
| 13 | `J11 · Relationship / Milestone` | Date-based: 6mo, 1yr, 2yr after Retained | 1 touch per milestone | Defer to post-launch |
| 14 | `J12 · Long-Term Nurture` | Tag = `j12_nurture` (set by J5A/J5B exit or manual) | Quarterly touch, 12-month cycle | Defer to post-launch |

13 unique workflows + 1 decline workflow = 14 total. Maps to the 15 email templates in the snapshot (one template, J11 milestone, has 3 dated variants packed into a single workflow).

**Build order:** simplest first to lock the pattern, then critical conversion cadences, then nurture. Sequence:

1. **Decline** — simplest webhook-fired branch, single email
2. **J7 Welcome** — simplest stage-fired cadence, 4 touches
3. **J9 Review Request** — 3-touch sequence, sensitive copy (LSO compliance)
4. **J6 Retainer follow-up** — 6 touches, signature reminder cadence
5. **J3 No-Show Recovery** — short, 2 touches
6. **J5A Recovery A** — 7 touches, longer cadence
7. **J5B Recovery B** — same shape as J5A
8. **J2 Consultation Reminders** — time-based (T-48h, T-24h, T-2h)
9. **J1 Band A Response** — most time-sensitive, multi-channel
10. **J4 Persistence Engine** — 11-day cadence, longest
11. **J8 Active Matter Update** — milestone-driven
12. **J10 Referral / Re-Engagement** — tag-driven
13. **J11 Relationship / Milestone** — date-based
14. **J12 Long-Term Nurture** — quarterly cycle

---

## Prerequisites

- [ ] P4 INBOUND workflow built and published (per `P4-intake-webhook-build-guide.md`).
- [ ] All 22 custom fields per P4 §5 are populated on the test contact.
- [ ] Pipeline stage nodes from P4 §6 are added (Stage 4 for taken; Stage 8 for passed/declined variants).
- [ ] Snapshot's 15 email templates are present in Marketing → Email → Templates.
- [ ] Snapshot's 8 SMS snippets are present in Conversations → Snippets.
- [ ] Custom values from §15.3 of the CRM Bible are populated for staging (use staging placeholder values; client values land at onboarding).

---

## Common patterns

The following apply to every workflow below. Document once, reference everywhere.

### Trigger types in use

- **Pipeline stage** — fires when a contact enters a specified stage. Used by J1, J2, J3, J5A, J5B, J6, J7, J9.
- **Custom field match** — fires when a custom field value matches a condition. Used by J1 (cadence_target), J8 (matter_milestone).
- **Tag added** — fires when a tag is added to a contact. Used by J10 (j10_eligible), J12 (j12_nurture).
- **Date-based** — fires on a date offset relative to a contact field. Used by J11 (6mo, 1yr, 2yr after Retained date).
- **Workflow-fired sub-flow** — fires from within another workflow. Used by Decline (called from the P4 INBOUND workflow's branches).

### Idempotency

Every workflow must dedupe to prevent double-firing on retries. Pattern:

1. First step inside the workflow: **If/Else** node checking custom field `${journey_id}_fired = true`.
2. If true, exit the workflow (no-op).
3. If false (or unset), set `${journey_id}_fired = true` immediately, then continue.

This is belt-and-braces — GHL's own dedupe handles most retries, but a workflow that ran partially before the operator paused it (e.g. for testing) can re-enter cleanly only with this guard.

### Compliance gates (every customer-facing send)

Every email or SMS step must satisfy:

- **CASL** — implied or express consent on file. The intake screen captures express consent at submission; the contact's `consent_status` custom field (set by P4) is `express` for new submissions. Non-`express` contacts skip promotional sends.
- **PIPEDA** — the lead's data is held by the firm (the operator manages on behalf). Personal data does not leave the firm's GHL sub-account.
- **LSO Rule 4.2-1** — no outcome promises ("we'll win your case"), no specialist/expert claims, no superlatives. Email + SMS templates in the snapshot are pre-vetted; do not edit copy in workflows.

Each customer-facing step must include an unsubscribe link (handled by GHL's standard email footer for email; "Reply STOP" semantics for SMS).

### Exit conditions

Every workflow must terminate cleanly. Three exit shapes:

1. **Successful conversion** — contact moves to a downstream stage (e.g. J1 exits when contact reaches stage 4, J5A exits when contact moves to stage 4 or 7).
2. **Stage-out** — contact moves to a stage that invalidates the journey (e.g. J6 exits if contact reaches stage 7 mid-cadence; the document was signed early).
3. **Cadence complete** — all touches fired, no conversion. Contact lands on `[journey_id]_complete` tag, optionally enters J12 long-term nurture.

Every workflow's last step is a **Set Tag** node tagging `${journey_id}_complete` so analytics can count completion vs conversion.

### Manual test pattern (pre-billing)

Until the inbound webhook is unblocked, every journey is verified via manual contact creation:

1. Create a test contact in staging with the relevant custom fields populated.
2. Manually drag the contact to the trigger stage (or set the trigger field).
3. Watch the workflow execution log; verify each step fires.
4. Where a step has a wait timer, use GHL's "skip wait" admin override OR shorten the timer to 0 in the test copy of the workflow.
5. Verify the email or SMS preview matches the snapshot template content (do not send to a real inbox during pre-billing tests; preview only).

---

## 1. DECLINE · Decline with Grace

**Trigger:** Called as a sub-workflow from the P4 INBOUND workflow's `passed`, `declined_oos`, and `declined_backstop` branches. The inbound payload's `decline_subject` and `decline_body` carry the resolved copy.

**Audience:** Any contact with `intake_action ∈ {passed, declined_oos, declined_backstop}`.

**Steps:**

1. Idempotency guard (`decline_fired = true` check).
2. Wait 30 seconds (lets the contact-create + custom-field-populate settle).
3. Send Email node:
   - To: `{{contact.email}}`
   - Subject: `{{custom_field.decline_subject}}`
   - Body: `{{custom_field.decline_body}}`
   - Footer: standard GHL unsubscribe + firm address (LSO-required).
4. Set Tag: `decline_complete`.
5. End workflow.

**Exit conditions:** Email sent or skipped (no exit branches; this is one-shot).

**Verification (pre-billing):** Manually create a test contact with `intake_action = passed`, `decline_subject = "Re: your inquiry"`, `decline_body = "Thank you for reaching out..."`. Manually fire the workflow from the contact detail page. Verify the email preview renders the resolved copy.

---

## 2. J7 · Welcome / Onboarding

**Trigger:** Pipeline stage = `7. Retained`.

**Audience:** Newly retained clients (lawyer marked stage = Retained after engagement signed).

**Steps (4 touches over 30 days):**

| When | Channel | Template | Purpose |
|---|---|---|---|
| T+0 | Email | `J7 · Welcome` | Branded welcome, what to expect, points of contact |
| T+1d | Email | `J7 · Next Steps` | Initial document checklist, calendar, intake questions |
| T+7d | Email | `J7 · 7-Day Check-In` | "First-week update": acknowledge complexity, normalize timeline |
| T+30d | Email | `J7 · 30-Day Update` | Milestone email; if matter has activity, reference it; otherwise generic check-in |

**Exit conditions:** Contact reaches stage `8. Closed-Lost` (matter closed unfavorably) or `9. Closed-Won` (matter closed successfully).

**Verification (pre-billing):** Manually move a test contact to stage 7. Verify J7 fires and step 1 email previews correctly. Set the wait timers to 0 for verification, then restore.

---

## 3. J9 · Google Review Request

**Trigger:** Pipeline stage = `9. Closed-Won`.

**Audience:** Clients whose matter completed successfully. Per CRM Bible DR-019, every posted review gets a 72h reply SLA.

**Steps (3-touch sequence over 14 days):**

| When | Channel | Template | Purpose |
|---|---|---|---|
| T+30d | Email | `J9 · Touch 1 — Initial Ask` | First touch, 30 days post-Closed-Won (CRM Bible DR-018: the 30-day mark works for emotionally heavy matters; week-of-close fails) |
| T+37d | Email | `J9 · Touch 2 — Soft Reminder` | Soft reminder, only if Touch 1 not opened or no review posted |
| T+44d | Email | `J9 · Touch 3 — Last Ask` | Final ask, single sentence; opt-out clear |

**Compliance gates:**

- **DR-020 anti-patterns enforced.** No funnel gating (every NPS-positive client sees the public review path; no gate before the request fires). No incentivization. No mass-blast spike paths (cadence drips over 14 days; not a daily blast).
- **LSO Rule 4.2-1.** Copy in the templates is pre-vetted. Do not edit copy in workflows.

**Exit conditions:** Review posted (detected via custom field `gbp_review_received = true`, set by an external integration), OR cadence complete after Touch 3.

**Verification (pre-billing):** Manually move a test contact to stage 9. Verify Touch 1 fires after 30-day wait (set wait to 0 for verification). Confirm template preview matches J9 templates in the snapshot.

---

## 4. J6 · Retainer Follow-up Cadence

**Trigger:** Pipeline stage = `6. Retainer Sent`.

**Audience:** Contacts whose engagement letter was sent by the lawyer (stage moved manually after the lawyer sent the document on Clio or their own tool).

> **Doctrine:** Retainer document generation and e-signature are out of scope per CRM Bible DR-032. The lawyer owns the document workflow on their own tool. J6 fires the **follow-up reminder cadence only**; the document is not touched by the platform.

**Steps (6 touches over 7 days):**

| When | Channel | Template | Purpose |
|---|---|---|---|
| T+0 | Email | `J6 · Touch 1 — Sent Notification` | Confirms the lawyer sent the engagement; sets expectation of next steps |
| T+24h | SMS | `J6 · SMS Touch 1` | "Following up on your engagement letter; takes under 2 minutes to sign" |
| T+48h | Email | `J6 · Touch 2 — Lawyer Note` | Personal note from the lawyer; breaks the auto-cadence feel |
| T+96h | SMS | `J6 · SMS Touch 2` | "Quick reminder; let us know if you have questions" |
| T+144h | Email | `J6 · Touch 3 — Last Reminder` | Final reminder; offers to talk through any concerns |
| T+168h (7d) | Tag | `j6_unsigned` set; contact escalates to manual operator review | |

**Exit conditions:** Pipeline stage moves to `7. Retained` (signed) OR T+168h reached without signing (lands in J12 long-term nurture).

**Verification (pre-billing):** Manually move a test contact to stage 6. Verify Touch 1 fires immediately. Set wait timers to 0 to verify subsequent touches fire in order.

---

## 5. J3 · No-Show Recovery

**Trigger:** Calendar event marked No-show OR custom field `consultation_outcome = no_show`.

**Audience:** Contacts who booked a consultation and did not appear.

**Steps (2 touches):**

| When | Channel | Template | Purpose |
|---|---|---|---|
| T+1h | SMS | `J3 · SMS Touch 1` | "Sorry we missed you; book a new time when ready" + booking link |
| T+24h | Email | `J3 · Email Touch 2` | Longer note; addresses common no-show reasons (forgot, conflict, second-thoughts) |

**Exit conditions:** Contact rebooks (calendar event created → exits to J2 Consultation Reminders), OR cadence complete (lands in J5A Recovery A).

**Verification (pre-billing):** Manually set `consultation_outcome = no_show` on a test contact. Verify J3 fires.

---

## 6. J5A · Recovery A (Spoke, No Book)

**Trigger:** Pipeline stage = `3. Spoke, No Book` (lawyer had a phone conversation but the lead did not book a consultation).

**Audience:** Leads who engaged with the lawyer but did not progress.

**Steps (7 touches over 14 days):**

| When | Channel | Template | Purpose |
|---|---|---|---|
| T+1h | Email | `J5A · Touch 1` | Recap of conversation, soft re-ask for booking |
| T+24h | SMS | `J5A · SMS Touch 1` | "Following up on our chat; happy to find a time" |
| T+72h | Email | `J5A · Touch 2 — Lawyer Note` | Personal lawyer note (Day 3 break in cadence feel) |
| T+5d | SMS | `J5A · SMS Touch 2` | Soft check-in |
| T+8d | Email | `J5A · Touch 3 — Value Frame` | Re-frames the value of moving forward; references something specific from the call |
| T+11d | Email | `J5A · Touch 4 — Final` | "Last touch from our side; reach out anytime" |
| T+14d | Tag | `j5a_complete`; lands in J12 long-term nurture | |

**Exit conditions:** Contact books (stage moves to `4. Consult Booked`) → exits to J2. OR cadence complete → J12.

**Verification (pre-billing):** Manually move a test contact to stage 3. Verify each touch fires in sequence (with wait timers shortened).

---

## 7. J5B · Recovery B (Consulted, No Sign)

**Trigger:** Pipeline stage = `5. Consult Held` AND 48h elapsed without movement to `6. Retainer Sent`.

**Audience:** Leads who had a consultation but did not retain.

**Steps (7 touches over 14 days):** Same shape as J5A but copy addresses the "got quote, chose another firm OR thinking it over" objection.

| When | Channel | Template |
|---|---|---|
| T+0 (i.e., 48h post-consult) | Email | `J5B · Touch 1 — Recap` |
| T+24h | SMS | `J5B · SMS Touch 1` |
| T+72h | Email | `J5B · Touch 2 — Lawyer Note` |
| T+5d | SMS | `J5B · SMS Touch 2` |
| T+7d (Day 7 in CRM Bible) | Email | `J5B · Touch 3 — Personal Lawyer Message` |
| T+11d | Email | `J5B · Touch 4 — Engagement Letter Re-share` |
| T+14d | Tag | `j5b_complete`; lands in J12 long-term nurture |

**Compliance note:** Per CRM Bible DR-018, the 30-day mark is the right re-engagement timing for emotionally heavy matters; this 14-day cadence is for the immediate post-consult window where the lead's decision is still warm. After J5B exits without conversion, J12 picks up the long-game.

**Exit conditions:** Stage moves to `6. Retainer Sent` → exits to J6. OR cadence complete → J12.

---

## 8. J2 · Consultation Reminders

**Trigger:** Pipeline stage = `4. Consult Booked` AND calendar event exists with future `start_time`.

**Audience:** Leads with a consultation booked.

**Steps (3 time-based touches relative to the consultation `start_time`):**

| When | Channel | Template | Purpose |
|---|---|---|---|
| T-48h | Email | `J2 · Email T-48h` | Confirmation, what to bring, what the call covers |
| T-24h | SMS | `J2 · SMS T-24h` | "Looking forward to tomorrow at [time]" |
| T-2h | SMS | `J2 · SMS T-2h` | "Reminder: call at [time] today" |

**Exit conditions:** Calendar event reaches `start_time` (consultation took place) → contact moves to stage `5. Consult Held` → exits this workflow. OR contact reschedules → re-enters this workflow with new `start_time`. OR contact cancels → moves to stage `1. New Inquiry` → J4 picks up.

**Verification (pre-billing):** Manually create a test contact with calendar event `start_time = now + 48h`. Verify T-48h email fires. Move `start_time` to be sooner to verify T-24h and T-2h fire (or override wait timers).

---

## 9. J1 · New Lead Response (Band A)

**Trigger:** Custom field `cadence_target = band_a` (set by P4 INBOUND workflow on `taken` action with band A).

**Audience:** Band A leads — the lawyer pressed Take and the engine called for same-day response.

> **Time-sensitive.** Band A SLA is 30 minutes. This workflow must fire within seconds of the trigger and complete the multi-channel push before the lead disengages.

**Steps (multi-channel parallel):**

| When | Channel | Action | Purpose |
|---|---|---|---|
| T+0 | SMS | Send to `{{contact.phone}}` | "A lawyer at [firm] will reach you within 30 minutes about [matter_snapshot]" |
| T+5min | Email | Send to `{{contact.email}}` | Longer touch, sets expectation of call, attaches calendar booking link as backup |
| T+0 | Internal task | Auto-task to `lawyer.cell` SMS | "Band A lead: [contact_name], [matter_type]; call within 30min" |
| T+0 | Calendar | Block 30-min slot on lawyer's calendar | Reserves the same-day call window |

If the lawyer does not call within 30 minutes (detected by `lawyer_call_completed = false` after 30min wait), escalate:

- T+30min | SMS | `J1 · Escalation SMS` to the lawyer's cell: "Band A lead overdue: [contact_name]"

**Exit conditions:** Lawyer marks `lawyer_call_completed = true` (after the call). Contact moves to stage `3. Spoke, No Book` (no booking) → J5A picks up. OR `4. Consult Booked` (booking made) → J2 picks up.

**Verification (pre-billing):** Manually set `cadence_target = band_a` on a test contact. Verify SMS, email, and lawyer-task all fire. Verify the calendar block lands on the lawyer's calendar.

**Band B variant:** If `cadence_target = band_b`, route to a sibling workflow `J1B · Band B Booking-Link Cadence` — same shape but the SMS is "We will reach you within 1-2 business days; book a time at [calendar_link]" and there is no 30-min escalation. Build J1B as a separate workflow inside the same folder.

**Band C variant:** If `cadence_target = band_c`, route to `J1C · Band C Lawyer-Choice Cadence` — same shape as J1B but with a 24h backstop: if no lawyer action, fires `declined_backstop` webhook to remove the contact from active queue.

---

## 10. J4 · Persistence Engine

**Trigger:** Pipeline stage = `1. New Inquiry` AND no progress within 24h. (Spec previously used "Pre-Qualified" for this stage; the canonical name from the deployed Core Chassis pipeline is "New Inquiry".)

**Audience:** Leads in the new inquiry state who have not been engaged by the lawyer or have not responded to initial outreach.

**Steps (6 touches over 11 days):**

| When | Channel | Template | Purpose |
|---|---|---|---|
| T+24h | Email | `J4 · Touch 1` | Standard re-engagement, references original inquiry |
| T+72h | SMS | `J4 · SMS Touch 1` | Soft reminder |
| T+5d | Email | `J4 · Touch 2 — Value Add` | Educational content related to their matter |
| T+7d | Email | `J4 · Touch 3 — Lawyer Note` | Personal lawyer touch |
| T+9d | SMS | `J4 · SMS Touch 2` | Brief check-in |
| T+11d | Email | `J4 · Touch 4 — Last Touch` | Final touch, lands in J12 if no response |

**Exit conditions:** Stage moves to `3. Spoke, No Book`, `4. Consult Booked`, or `8. Closed-Lost`.

---

## 11. J8 · Active Matter Update

**Trigger:** Custom field `matter_milestone` changes (set externally by Clio integration or by lawyer manually).

**Audience:** Retained clients with active matters.

**Steps (1-2 touches per milestone):**

| Milestone | Channel | Template |
|---|---|---|
| `filing_complete` | Email | `J8 · Filing Complete` |
| `discovery_complete` | Email | `J8 · Discovery Complete` |
| `settlement_offered` | Email + SMS | `J8 · Settlement Offered` (lawyer-prep) |
| `closing_scheduled` | Email + SMS | `J8 · Closing Scheduled` |

**Exit conditions:** Contact moves to stage `8. Closed-Lost` or `9. Closed-Won`.

**Defer to post-launch.** Not required for first-client-live.

---

## 12. J10 · Referral / Re-Engagement

**Trigger:** Tag `j10_eligible` added (set by J9 completion if a review was posted, or manually).

**Audience:** Past clients who left a positive review or are otherwise good candidates for referral.

**Steps (4 touches over 90 days):**

| When | Channel | Template |
|---|---|---|
| T+0 | Email | `J10 · Touch 1 — Thank You` |
| T+30d | Email | `J10 · Touch 2 — Referral Ask` |
| T+60d | Email | `J10 · Touch 3 — Value Update` |
| T+90d | Email | `J10 · Touch 4 — Annual Check-In` |

**Defer to post-launch.**

---

## 13. J11 · Relationship / Milestone

**Trigger:** Date-based: 6 months, 1 year, 2 years after `retained_date` (set when contact reaches stage 7).

**Audience:** All retained clients, including those whose matter has closed.

**Steps (1 touch per milestone):**

| Milestone | Channel | Template |
|---|---|---|
| 6mo | Email | `J11 · 6-Month Check-In` |
| 1yr | Email | `J11 · 1-Year Anniversary` |
| 2yr | Email | `J11 · 2-Year Re-Engagement` |

**Defer to post-launch.**

---

## 14. J12 · Long-Term Nurture

**Trigger:** Tag `j12_nurture` added (set by J5A or J5B completion, or manually).

**Audience:** Leads who did not convert through any short-cycle cadence; warm prospects for re-engagement quarterly.

**Steps (quarterly touch on a 12-month cycle):**

| Quarter | Channel | Template |
|---|---|---|
| Q1 | Email | `J12 · Q1 — Industry Update` |
| Q2 | Email | `J12 · Q2 — Educational Long-Form` |
| Q3 | Email | `J12 · Q3 — Lawyer Profile Refresh` |
| Q4 | Email | `J12 · Q4 — Year-End Annual Letter` |

**Exit conditions:** Contact unsubscribes, OR contact re-enters active pipeline (stage moves to `1. New Inquiry` or higher).

**Defer to post-launch.**

---

## Build effort

| Tier | Workflows | Effort |
|---|---|---|
| Critical for first-client-live | Decline, J7, J9, J6, J3, J5A, J5B, J2, J1 (with B + C variants), J4 | ~3 working days |
| Defer to post-launch | J8, J10, J11, J12 | ~1.5 working days |
| **Total** | 14 (with J1 variants = 16) | **~4-5 working days** |

Realistic calendar: **1 week end-to-end** including verification of each via manual stage moves.

---

## Verification gates per workflow

For each workflow built, the build agent must verify before moving to the next:

- [ ] Workflow is published (not draft).
- [ ] Idempotency guard is the first node inside the trigger (catches double-fires).
- [ ] Every customer-facing send step references a snapshot template (no inline copy).
- [ ] Wait timers are correct per the spec above (verify via "Edit timer" inspection in GHL).
- [ ] Exit conditions land the contact on the right downstream tag or stage.
- [ ] Manual test: drag a test contact to the trigger stage / set the trigger field; the workflow execution log shows every step firing in order.
- [ ] Email/SMS preview at each step shows the right template content with custom field merges resolved.

---

## Handoff to P8

P5 lands the workflows. P8 is the 10-scenario end-to-end QA:

1. Band A intake submitted from sandbox → contact created → J1 fires → SMS + email + lawyer task land within seconds.
2. Band B intake submitted → J1B fires → email + booking link.
3. Band C intake submitted → J1C fires → backstop fires after 24h.
4. OOS intake submitted → declined_oos fires → decline email lands.
5. Lawyer presses Pass → declined → decline email lands with resolved copy.
6. Lawyer presses Take then no-show → J3 fires.
7. Lawyer presses Take then consult held no sign → J5B fires after 48h.
8. Stage manually advanced to 7. Retained → J7 welcome cadence fires.
9. Stage manually advanced to 9. Closed-Won → J9 review request fires after 30 days.
10. Idempotency: re-fire the same intake via duplicate webhook payload → contact updates, journeys do NOT re-fire.

P8 build guide: written next deliverable. Cannot execute the live submission tests until the inbound webhook trigger is unblocked (Skip Trial & Pay).

---

## What can be built and verified during the GHL trial

Everything in this guide. Pipeline-stage triggers, custom-field-match triggers, and tag-added triggers are NOT premium-gated. Only the inbound webhook trigger (which is the P4 INBOUND workflow's entry point) is gated.

Workflow execution against manually-advanced contacts works in trial mode. Email and SMS sends count against the trial quota; verify steps via **preview** instead of live send during pre-billing testing to preserve the trial budget for the eventual P8 live runs.

The 12-day trial window can comfortably absorb all of P5 build + P5 verification + P8 plan drafting. Activate billing only when the inbound webhook needs to fire end-to-end (i.e. when P8 live tests run, or when the first paying client signs).
