# P5 — GHL Workflow Build Execution Script

**Staging sub-account:** `TH71IN0vUaIByLOxnFQY` (CaseLoad Select · Staging)
**Drafted:** 2026-05-08
**Status:** Ready to execute in GHL UI
**Source:** P5-journey-workflows-build-guide.md + CRM Bible v5.1 §9+10 + ghl-webhook-contract.md

This document specifies every GHL UI action needed to build the 10 critical P5 workflows. Follow in order. Each workflow section ends with a verification gate; do not proceed to the next workflow until it passes.

---

## Setup — before you touch any workflow

**Navigate:** `app.gohighlevel.com` → sub-account "CaseLoad Select · Staging" → Automation → Workflows

**Confirm:** Page shows "Create Workflow" button and 1 existing workflow (the P4 INBOUND workflow, `INBOUND · CaseLoad Screen · all actions`). If more exist, review before continuing.

**Folder:** Create a folder called `CaseLoad Select · P5 Journeys` before building the first workflow. (Click the folder icon or "New Folder" if available, otherwise leave workflows ungrouped — GHL folder creation is optional.)

**Common settings for every workflow:**
- Re-entry: **Allow** (contacts can re-enter)
- Stop on response: depends per workflow (noted in each spec)
- Execution log: default

---

## 1. DECLINE · Decline with Grace

**Type:** Sub-workflow (called from the P4 INBOUND workflow)
**Purpose:** Send a single graceful decline email using the resolved copy set by P4.

### Create the workflow

1. Click **+ Create Workflow**
2. Select **Start from Scratch**
3. Name: `DECLINE · Decline with Grace`
4. Click **Create Workflow**

### Configure the trigger

The DECLINE workflow is called as a sub-workflow from P4. In GHL, this means no trigger is needed on the DECLINE workflow itself — P4's branches call it via "Go to Workflow" action. Leave the trigger as **Workflow is run** (the default for sub-workflows).

> If GHL does not offer a sub-workflow trigger, use: Trigger = **Contact Tag** → tag = `decline_pending`. P4's branches will set this tag, and DECLINE fires when the tag is added.

### Add nodes (in order)

**Node 1 — Idempotency guard**
- Action: **If/Else**
- Name: `Guard — decline_fired?`
- Condition: Contact field `decline_fired` **equals** `true`
- If YES branch → **End Workflow** (workflow already ran)
- If NO branch → continue to Node 2

**Node 2 — Set fired flag**
- Action: **Update Contact Field**
- Field: `decline_fired`
- Value: `true`

**Node 3 — Wait**
- Action: **Wait**
- Duration: **30 seconds**
- Reason: lets P4's contact-create + field-populate settle before sending

**Node 4 — Send Email**
- Action: **Send Email**
- Template: Select from dropdown → `DECLINE · Decline with Grace`
- From: firm default sender
- To: `{{contact.email}}`
- Subject: *(leave blank — subject is inside the template)*

> **Template note:** The `DECLINE · Decline with Grace` template uses `{{custom_field.decline_subject}}` as the subject and `{{custom_field.decline_body}}` as the body. The P4 INBOUND workflow populates both fields before calling this sub-workflow.

**Node 5 — Set Tag**
- Action: **Add Contact Tag**
- Tag: `decline_complete`

**Node 6 — End Workflow**

### Publish

Click **Publish** (top right). Status should change from Draft to Published.

### Verification gate

- [ ] Workflow is published (not draft)
- [ ] Node order: Guard → Set flag → Wait 30s → Send Email → Set tag → End
- [ ] Send Email node references template `DECLINE · Decline with Grace`
- [ ] Idempotency guard is the first action node
- **Manual test:** Create a test contact, set `intake_action = passed`, `decline_subject = "Re: your inquiry — test"`, `decline_body = "Test decline body."`. From the contact's detail page, click Actions → Run Workflow → select `DECLINE · Decline with Grace`. Check execution log — all nodes should fire. Preview the email (do not send live).

---

## 2. J7 · Welcome / Onboarding

**Type:** Pipeline stage trigger
**Trigger stage:** `7. Retained`
**Touches:** 4 emails over 30 days

### Create the workflow

1. Click **+ Create Workflow** → Start from Scratch
2. Name: `J7 · Welcome / Onboarding`
3. Create Workflow

### Configure the trigger

1. Click **Add Trigger**
2. Select: **Pipeline Stage Changed**
3. Pipeline: `Core Chassis`
4. Stage: `7. Retained`
5. Filter: (none — fires on any contact entering this stage)
6. Save trigger

### Add nodes

**Node 1 — Idempotency guard**
- Action: If/Else
- Name: `Guard — j7_fired?`
- Condition: `j7_fired` equals `true`
- YES → End Workflow

**Node 2 — Set fired flag**
- Update Contact Field: `j7_fired` = `true`

**Node 3 — Send Email (T+0)**
- Action: Send Email
- Template: `J7 · Welcome`
- (fires immediately on trigger)

**Node 4 — Wait 1 day**
- Action: Wait
- Duration: **1 day**

**Node 5 — Exit check: stage 8 or 9?**
- Action: If/Else
- Name: `Exit — stage closed?`
- Condition: Pipeline Stage **is** `8. Closed-Lost` OR Pipeline Stage **is** `9. Closed-Won`
- YES → Go to **Node 11** (Set tag + End)
- NO → continue

**Node 6 — Send Email (T+1d)**
- Template: `J7 · Next Steps`

**Node 7 — Wait 6 days** (to reach T+7d)

**Node 8 — Exit check** (same as Node 5 pattern — copy)

**Node 9 — Send Email (T+7d)**
- Template: `J7 · 7-Day Check-In`

**Node 10 — Wait 23 days** (to reach T+30d)

**Node 11 — Exit check** (same pattern)

**Node 12 — Send Email (T+30d)**
- Template: `J7 · 30-Day Update`

**Node 13 — Set Tag**
- Tag: `j7_complete`

**Node 14 — End Workflow**

> **Exit condition note:** Add an additional trigger exit: under workflow Settings → Stop Workflow for Contact When → Pipeline Stage Changes to `8. Closed-Lost` or `9. Closed-Won`. This fires the exit even mid-wait.

### Publish and verify

- [ ] Trigger: Pipeline Stage Changed → Core Chassis → 7. Retained
- [ ] 4 Send Email nodes reference J7 templates (Welcome, Next Steps, 7-Day Check-In, 30-Day Update)
- [ ] Wait timers: 0 / 1d / 6d / 23d = T+0, T+1d, T+7d, T+30d
- [ ] Exit condition configured in Settings tab
- [ ] **Manual test:** Move test contact to stage 7. Verify execution log shows Node 1 (guard), Node 2 (flag), Node 3 (email). Set wait to 0 in a test copy to verify all 4 touches fire.

---

## 3. J9 · Google Review Request

**Type:** Pipeline stage trigger
**Trigger stage:** `9. Closed-Won`
**Touches:** 3 emails starting 30 days after trigger

### Create the workflow

Name: `J9 · Google Review Request`

### Trigger

1. Pipeline Stage Changed → Core Chassis → `9. Closed-Won`

### Nodes

**Node 1 — Guard:** `j9_fired` equals `true` → YES: End Workflow

**Node 2 — Set flag:** `j9_fired` = `true`

**Node 3 — Wait 30 days**

**Node 4 — Exit check:** `gbp_review_received` equals `true` → YES: End Workflow (review already posted)

**Node 5 — Send Email (T+30d)**
- Template: `J9 · Touch 1 — Initial Ask`

**Node 6 — Wait 7 days**

**Node 7 — Exit check:** `gbp_review_received` equals `true` → YES: End Workflow

**Node 8 — Send Email (T+37d)**
- Template: `J9 · Touch 2 — Soft Reminder`

**Node 9 — Wait 7 days**

**Node 10 — Exit check:** `gbp_review_received` equals `true` → YES: End Workflow

**Node 11 — Send Email (T+44d)**
- Template: `J9 · Touch 3 — Last Ask`

**Node 12 — Set Tag:** `j9_complete`

**Node 13 — End Workflow**

### Verification

- [ ] Trigger: stage 9 Closed-Won
- [ ] 30-day wait before first email
- [ ] Exit check for `gbp_review_received = true` before each touch
- [ ] 3 templates: Touch 1, Touch 2, Touch 3
- [ ] **Manual test:** Move test contact to stage 9. Set waits to 0. Verify all 3 touches fire in order.

---

## 4. J6 · Retainer Follow-up Cadence

**Type:** Pipeline stage trigger
**Trigger stage:** `6. Retainer Sent`
**Touches:** 3 emails + 2 SMS over 7 days; T+168h sets `j6_unsigned` tag

### Create the workflow

Name: `J6 · Retainer Follow-up Cadence`

### Trigger

Pipeline Stage Changed → Core Chassis → `6. Retainer Sent`

### Nodes

**Node 1 — Guard:** `j6_fired` equals `true` → End Workflow

**Node 2 — Set flag:** `j6_fired` = `true`

**Exit condition setup (in Settings):** Stop when stage changes to `7. Retained`

**Node 3 — Send Email (T+0)**
- Template: `J6 · Touch 1 — Sent Notification`

**Node 4 — Wait 24 hours**

**Node 5 — Exit check:** Pipeline Stage is `7. Retained` → YES: tag `j6_signed`, End Workflow

**Node 6 — Send SMS (T+24h)**
- Action: Send SMS
- Message: *(select snippet `J6 · SMS Touch 1` from snippets library)*

> **SMS note:** In GHL's Send SMS action, paste the snippet content directly or reference it. Snippet text: "Following up on your engagement letter — takes under 2 minutes to sign. Questions? Reply here."

**Node 7 — Wait 24 hours** (total T+48h)

**Node 8 — Exit check:** Stage 7 → End Workflow

**Node 9 — Send Email (T+48h)**
- Template: `J6 · Touch 2 — Lawyer Note`

**Node 10 — Wait 48 hours** (total T+96h)

**Node 11 — Exit check:** Stage 7 → End Workflow

**Node 12 — Send SMS (T+96h)**
- Action: Send SMS
- Content: snippet `J6 · SMS Touch 2`

**Node 13 — Wait 48 hours** (total T+144h)

**Node 14 — Exit check:** Stage 7 → End Workflow

**Node 15 — Send Email (T+144h)**
- Template: `J6 · Touch 3 — Last Reminder`

**Node 16 — Wait 24 hours** (total T+168h = 7 days)

**Node 17 — Exit check:** Stage 7 → End Workflow

**Node 18 — Set Tag:** `j6_unsigned` (escalates to manual review)

**Node 19 — Set Tag:** `j6_complete`

**Node 20 — End Workflow**

### Verification

- [ ] Trigger: stage 6 Retainer Sent
- [ ] 3 email templates: Touch 1, Touch 2 Lawyer Note, Touch 3 Last Reminder
- [ ] 2 SMS touches at T+24h and T+96h
- [ ] 7-day total cadence
- [ ] Exit on stage 7 at each check
- [ ] `j6_unsigned` tag fires at T+168h if still unsigned
- [ ] **Manual test:** Move to stage 6. Set waits to 0. Verify all 5 touches fire. Then move to stage 7 mid-cadence and confirm workflow exits at next check.

---

## 5. J3 · No-Show Recovery

**Type:** Custom field trigger
**Trigger:** `consultation_outcome` = `no_show`
**Touches:** 1 SMS (T+1h) + 1 Email (T+24h)

### Create the workflow

Name: `J3 · No-Show Recovery`

### Trigger

1. **Custom Field Changed**
2. Field: `consultation_outcome`
3. Value equals: `no_show`

### Nodes

**Node 1 — Guard:** `j3_fired` equals `true` → End Workflow

**Node 2 — Set flag:** `j3_fired` = `true`

**Node 3 — Wait 1 hour**

**Node 4 — Send SMS (T+1h)**
- Content: snippet `J3 · SMS Touch 1`
- Text: "Sorry we missed you today. Book a new time when it suits you: {{custom_value.calendar.consult_url}} — no pressure."

**Node 5 — Wait 23 hours** (total T+24h)

**Node 6 — Exit check:** Pipeline Stage is `4. Consult Booked` → YES: End Workflow (rebooked)

**Node 7 — Send Email (T+24h)**
- Template: `J3 · Email Touch 2`

**Node 8 — Set Tag:** `j3_complete`

**Node 9 — End Workflow**

> **Downstream note:** After j3_complete, J5A should pick up. Wire this by also adding Set Tag `j5a_trigger` at Node 8 and configuring J5A's trigger as Tag Added = `j5a_trigger`. OR, if J5A uses pipeline stage 3 trigger, manually move the contact to stage 3 after J3 completes.

### Verification

- [ ] Trigger: custom field `consultation_outcome` = `no_show`
- [ ] SMS fires at T+1h, Email at T+24h
- [ ] Exit check for rebooking (stage 4) before T+24h email
- [ ] **Manual test:** Set `consultation_outcome = no_show` on test contact. Set waits to 0. Verify SMS + Email fire.

---

## 6. J5A · Recovery A (Spoke, No Book)

**Type:** Pipeline stage trigger
**Trigger stage:** `3. Spoke, No Book`
**Touches:** 4 emails + 2 SMS over 14 days

### Create the workflow

Name: `J5A · Recovery A (Spoke, No Book)`

### Trigger

Pipeline Stage Changed → Core Chassis → `3. Spoke, No Book`

### Exit condition (in Settings)

Stop when stage changes to `4. Consult Booked` or `7. Retained` or `8. Closed-Lost`

### Nodes

**Node 1 — Guard:** `j5a_fired` equals `true` → End Workflow

**Node 2 — Set flag:** `j5a_fired` = `true`

**Node 3 — Wait 1 hour**

**Node 4 — Exit check:** Stage is 4 → End Workflow (booked)

**Node 5 — Send Email (T+1h)**
- Template: `J5A · Touch 1`

**Node 6 — Wait 23 hours** (total T+24h)

**Node 7 — Exit check:** Stage is 4 → End Workflow

**Node 8 — Send SMS (T+24h)**
- Content: snippet `J5A · SMS Touch 1`

**Node 9 — Wait 48 hours** (total T+72h)

**Node 10 — Exit check:** Stage is 4 → End Workflow

**Node 11 — Send Email (T+72h)**
- Template: `J5A · Touch 2 — Lawyer Note`

**Node 12 — Wait 2 days** (total T+5d)

**Node 13 — Exit check:** Stage is 4 → End Workflow

**Node 14 — Send SMS (T+5d)**
- Content: snippet `J5A · SMS Touch 2`

**Node 15 — Wait 3 days** (total T+8d)

**Node 16 — Exit check:** Stage is 4 → End Workflow

**Node 17 — Send Email (T+8d)**
- Template: `J5A · Touch 3 — Value Frame`

**Node 18 — Wait 3 days** (total T+11d)

**Node 19 — Exit check:** Stage is 4 → End Workflow

**Node 20 — Send Email (T+11d)**
- Template: `J5A · Touch 4 — Final`

**Node 21 — Wait 3 days** (total T+14d)

**Node 22 — Set Tag:** `j5a_complete` (enters J12 long-term nurture via tag trigger — deferred to post-launch)

**Node 23 — End Workflow**

### Verification

- [ ] Trigger: stage 3 Spoke, No Book
- [ ] 4 email templates: Touch 1, Touch 2 Lawyer Note, Touch 3 Value Frame, Touch 4 Final
- [ ] 2 SMS touches at T+24h and T+5d
- [ ] Stage-4 exit check before each touch
- [ ] `j5a_complete` tag fires at T+14d if no conversion
- [ ] **Manual test:** Move to stage 3. Set waits to 0. Verify all 6 touches fire. Then move to stage 4 mid-cadence and verify workflow exits at next check.

---

## 7. J5B · Recovery B (Consulted, No Sign)

**Type:** Pipeline stage trigger + 48h elapsed
**Trigger stage:** `5. Consult Held` (workflow fires immediately; internal 48h wait before first touch)
**Touches:** 4 emails + 2 SMS over 14 days

### Create the workflow

Name: `J5B · Recovery B (Consulted, No Sign)`

### Trigger

Pipeline Stage Changed → Core Chassis → `5. Consult Held`

### Exit condition (in Settings)

Stop when stage changes to `6. Retainer Sent`, `7. Retained`, or `8. Closed-Lost`

### Nodes

**Node 1 — Guard:** `j5b_fired` equals `true` → End Workflow

**Node 2 — Set flag:** `j5b_fired` = `true`

**Node 3 — Wait 48 hours** (this IS the "48h elapsed without movement to stage 6" requirement from P5 spec)

**Node 4 — Exit check:** Stage is `6. Retainer Sent` → End Workflow (moving to J6)

**Node 5 — Send Email (T+0, i.e. 48h post-consult)**
- Template: `J5B · Touch 1 — Recap`

**Node 6 — Wait 24 hours**

**Node 7 — Exit check:** Stage is 6 → End Workflow

**Node 8 — Send SMS**
- Content: snippet `J5B · SMS Touch 1`

**Node 9 — Wait 48 hours** (total: 48h + 24h + 48h = T+5d)

**Node 10 — Exit check:** Stage 6 → End Workflow

**Node 11 — Send Email**
- Template: `J5B · Touch 2 — Lawyer Note`

**Node 12 — Wait 2 days** (total T+7d)

**Node 13 — Exit check:** Stage 6 → End Workflow

**Node 14 — Send SMS**
- Content: snippet `J5B · SMS Touch 2`

**Node 15 — Wait 4 days** (total T+11d from first touch = T+59h from consult)

**Node 16 — Exit check:** Stage 6 → End Workflow

**Node 17 — Send Email**
- Template: `J5B · Touch 3 — Personal Lawyer Message`

**Node 18 — Wait 3 days** (total T+14d from first touch)

**Node 19 — Exit check:** Stage 6 → End Workflow

**Node 20 — Send Email**
- Template: `J5B · Touch 4 — Engagement Letter Re-share`

**Node 21 — Wait 3 days** (cadence complete)

**Node 22 — Set Tag:** `j5b_complete`

**Node 23 — End Workflow**

### Verification

- [ ] Trigger: stage 5 Consult Held
- [ ] 48h wait before first touch (the "elapsed without movement" gate)
- [ ] Exit check for stage 6 before each touch
- [ ] 4 email templates, 2 SMS touches
- [ ] `j5b_complete` at end
- [ ] **Manual test:** Move to stage 5. Set Node 3 wait to 0. Move to stage 6 mid-cadence to confirm exit fires.

---

## 8. J2 · Consultation Reminders

**Type:** Pipeline stage trigger
**Trigger stage:** `4. Consult Booked`
**Touches:** 3 touches relative to consultation time (T-48h, T-24h, T-2h)

### Create the workflow

Name: `J2 · Consultation Reminders`

### Trigger

Pipeline Stage Changed → Core Chassis → `4. Consult Booked`

### Important note on timer logic

J2's touches fire BEFORE the consultation, not after. In GHL, this requires using **Event Start Time** as the reference. For each wait node, instead of "wait X duration", use "Wait until [X time before] {{appointment.start_time}}."

If GHL does not support relative-to-event waiting: configure as follows — fire the T-48h email immediately when stage 4 is entered (assume the contact just booked and the consultation is ~48h out), then the T-24h and T-2h SMS on fixed waits.

### Nodes

**Node 1 — Guard:** `j2_fired` equals `true` → End Workflow

**Node 2 — Set flag:** `j2_fired` = `true`

**Node 3 — Send Email (T-48h = immediately on stage-4 entry)**
- Template: `J2 · Email T-48h`

**Node 4 — Wait 24 hours** (to reach T-24h)

**Node 5 — Exit check:** Stage is NOT `4. Consult Booked` (contact cancelled or rescheduled) → End Workflow

**Node 6 — Send SMS (T-24h)**
- Content: snippet `J2 · SMS T-24h`

**Node 7 — Wait 22 hours** (to reach T-2h)

**Node 8 — Exit check:** Stage is NOT `4. Consult Booked` → End Workflow

**Node 9 — Send SMS (T-2h)**
- Content: snippet `J2 · SMS T-2h`

**Node 10 — Set Tag:** `j2_complete`

**Node 11 — End Workflow**

### Exit condition (in Settings)

Stop when stage changes to `5. Consult Held` (consultation happened), `8. Closed-Lost` (cancelled), or `1. New Inquiry` (downgraded).

### Verification

- [ ] Trigger: stage 4 Consult Booked
- [ ] Email at T-48h (immediate), SMS at T-24h, SMS at T-2h
- [ ] Exit checks for stage change mid-cadence
- [ ] **Manual test:** Move to stage 4. Set waits to 0. Verify 3 touches fire in order (Email → SMS → SMS).

---

## 9. J1 · New Lead Response

Three sibling workflows: J1 (Band A), J1B (Band B), J1C (Band C). Build all three.

---

### 9A. J1 · New Lead Response (Band A)

**Type:** Custom field trigger
**Trigger:** `cadence_target` = `band_a`
**SLA:** 30 minutes

#### Create the workflow

Name: `J1 · New Lead Response (Band A)`

#### Trigger

1. **Custom Field Changed**
2. Field: `cadence_target`
3. Value equals: `band_a`

#### Nodes

**Node 1 — Guard:** `j1_fired` equals `true` → End Workflow

**Node 2 — Set flag:** `j1_fired` = `true`

**Node 3 — Send SMS (T+0)**
- Action: Send SMS
- To: `{{contact.phone}}`
- Message: `A lawyer at {{custom_value.firm.display_name}} will reach you within 30 minutes about your inquiry. We'll call you at this number.`

**Node 4 — Send Internal Notification (T+0)**
- Action: **Send Notification** (or Internal Notification)
- To: `{{custom_value.lawyer.cell}}`
- Message: `Band A lead: {{contact.name}}, {{custom_field.matter_type}}. Call within 30 min. Portal: {{custom_value.portal.lawyer_url}}`

**Node 5 — Create Task (T+0)**
- Action: **Create Task**
- Title: `Call Band A lead: {{contact.name}}`
- Due: 30 minutes from now
- Assigned to: lawyer user
- Notes: `Matter: {{custom_field.matter_type}}. Matter snapshot: {{custom_field.matter_snapshot}}`

**Node 6 — Wait 5 minutes**

**Node 7 — Send Email (T+5min)**
- Template: `J1 · Band A Email`
- To: `{{contact.email}}`

**Node 8 — Wait 25 minutes** (total T+30min)

**Node 9 — Escalation check: call completed?**
- Action: If/Else
- Condition: `lawyer_call_completed` equals `true`
- YES → Node 11 (Set complete tag, End)
- NO → Node 10 (Escalation SMS)

**Node 10 — Escalation SMS**
- Action: Send SMS (to lawyer cell)
- Message: `Band A lead OVERDUE: {{contact.name}} has not been called. Portal: {{custom_value.portal.lawyer_url}}`

**Node 11 — Set Tag:** `j1_complete`

**Node 12 — End Workflow**

#### Verification

- [ ] Trigger: custom field `cadence_target` = `band_a`
- [ ] SMS to lead fires immediately (T+0)
- [ ] Internal notification + task to lawyer fires at T+0
- [ ] Email to lead fires at T+5min
- [ ] Escalation SMS to lawyer fires at T+30min if `lawyer_call_completed ≠ true`
- [ ] **Manual test:** Set `cadence_target = band_a` on test contact. Set waits to 0. Verify SMS, email, task all fire.

---

### 9B. J1B · New Lead Response (Band B)

**Type:** Custom field trigger
**Trigger:** `cadence_target` = `band_b`

#### Create the workflow

Name: `J1B · New Lead Response (Band B)`

#### Trigger

Custom Field Changed → `cadence_target` = `band_b`

#### Nodes

**Node 1 — Guard:** `j1b_fired` equals `true` → End Workflow

**Node 2 — Set flag:** `j1b_fired` = `true`

**Node 3 — Send Email (T+0)**
- Template: `J1 · Band B Email`
- Contains: booking link `{{custom_value.calendar.consult_url}}`

**Node 4 — Send Internal Notification (T+0)**
- To: lawyer
- Message: `Band B lead: {{contact.name}}, {{custom_field.matter_type}}. Email sent with booking link.`

**Node 5 — Wait 12 hours**

**Node 6 — Exit check:** Stage is `4. Consult Booked` → End Workflow (booked)

**Node 7 — Send Email (T+12h — Reminder 1)**
- Template: `J1 · Band B Reminder 1`

**Node 8 — Wait 12 hours** (total T+24h)

**Node 9 — Exit check:** Stage is `4. Consult Booked` → End Workflow

**Node 10 — Send Email (T+24h — Reminder 2)**
- Template: `J1 · Band B Reminder 2`

**Node 11 — Wait 24 hours** (total T+48h)

**Node 12 — Set Tag:** `j1b_complete`

**Node 13 — End Workflow**

#### Verification

- [ ] Trigger: `cadence_target` = `band_b`
- [ ] 2 reminder emails at T+12h and T+24h
- [ ] Exit check for stage 4 before each reminder
- [ ] No 30-min escalation (Band B SLA is 1-2 business days)

---

### 9C. J1C · New Lead Response (Band C)

**Type:** Custom field trigger
**Trigger:** `cadence_target` = `band_c`

#### Create the workflow

Name: `J1C · New Lead Response (Band C)`

#### Trigger

Custom Field Changed → `cadence_target` = `band_c`

#### Nodes

**Node 1 — Guard:** `j1c_fired` equals `true` → End Workflow

**Node 2 — Set flag:** `j1c_fired` = `true`

**Node 3 — Send Email (T+0)**
- Template: `J1 · Band C Email`

**Node 4 — Send Internal Notification (T+0)**
- To: lawyer
- Message: `Band C lead: {{contact.name}}, {{custom_field.matter_type}}. Take or Pass in portal: {{custom_value.portal.lawyer_url}}. Auto-declines in 24h if no action.`

**Node 5 — Wait 24 hours**

**Node 6 — Backstop check**
- Action: If/Else
- Condition: `cadence_target` still equals `band_c` AND `intake_action` is NOT `taken` AND `intake_action` is NOT `passed`
- YES (no action) → Node 7
- NO (lawyer acted) → Node 9

**Node 7 — Set field: `declined_backstop`**
- Update Contact Field: `intake_action` = `declined_backstop`

**Node 8 — Call Sub-Workflow: DECLINE · Decline with Grace**
(or Set Tag `decline_pending` which triggers the DECLINE workflow)

**Node 9 — Set Tag:** `j1c_complete`

**Node 10 — End Workflow**

#### Verification

- [ ] Trigger: `cadence_target` = `band_c`
- [ ] 24h backstop fires if no lawyer action
- [ ] Backstop calls DECLINE workflow or sets `decline_pending` tag
- [ ] **Manual test:** Set `cadence_target = band_c`. Set wait to 0. Do NOT set `intake_action`. Verify backstop fires and DECLINE sub-workflow is called.

---

## 10. J4 · Persistence Engine

**Type:** Pipeline stage trigger + 24h elapsed
**Trigger stage:** `1. New Inquiry` (spec previously used "Pre-Qualified"; canonical name from the deployed Core Chassis pipeline is "New Inquiry")
**Touches:** 6 touches over 11 days (starting 24h after entering stage)

### Create the workflow

Name: `J4 · Persistence Engine`

### Trigger

Pipeline Stage Changed → Core Chassis → `1. New Inquiry`

### Exit condition (in Settings)

Stop when stage changes to `3. Spoke, No Book`, `4. Consult Booked`, or `8. Closed-Lost`

### Nodes

**Node 1 — Guard:** `j4_fired` equals `true` → End Workflow

**Node 2 — Set flag:** `j4_fired` = `true`

**Node 3 — Wait 24 hours** (the "no progress within 24h" gate)

**Node 4 — Exit check:** Stage is NOT `1. New Inquiry` → End Workflow (progress made)

**Node 5 — Send Email (T+24h)**
- Template: `J4 · Touch 1`

**Node 6 — Wait 48 hours** (total T+72h)

**Node 7 — Exit check:** Stage is NOT `1. New Inquiry` → End Workflow

**Node 8 — Send SMS (T+72h)**
- Content: snippet `J4 · SMS Touch 1`

**Node 9 — Wait 2 days** (total T+5d)

**Node 10 — Exit check:** Stage is NOT `1. New Inquiry` → End Workflow

**Node 11 — Send Email (T+5d)**
- Template: `J4 · Touch 2 — Value Add`

**Node 12 — Wait 2 days** (total T+7d)

**Node 13 — Exit check:** Stage is NOT `1. New Inquiry` → End Workflow

**Node 14 — Send Email (T+7d)**
- Template: `J4 · Touch 3 — Lawyer Note`

**Node 15 — Wait 2 days** (total T+9d)

**Node 16 — Exit check:** Stage is NOT `1. New Inquiry` → End Workflow

**Node 17 — Send SMS (T+9d)**
- Content: snippet `J4 · SMS Touch 2`

**Node 18 — Wait 2 days** (total T+11d)

**Node 19 — Exit check:** Stage is NOT `1. New Inquiry` → End Workflow

**Node 20 — Send Email (T+11d)**
- Template: `J4 · Touch 4 — Last Touch`

**Node 21 — Set Tag:** `j4_complete`

**Node 22 — End Workflow**

### Verification

- [ ] Trigger: stage 1 New Inquiry
- [ ] 24h wait before first touch
- [ ] 6 touches: Email T+24h, SMS T+72h, Email T+5d, Email T+7d, SMS T+9d, Email T+11d
- [ ] Exit check (stage not 1) before every touch
- [ ] `j4_complete` at T+11d if no conversion
- [ ] **Manual test:** Move to stage 1. Set waits to 0. Verify all 6 touches fire. Move to stage 3 mid-cadence to verify exit.

---

## Post-build checklist

After all 10 workflows are built and verified:

- [ ] All 10 workflows published (not draft)
- [ ] DECLINE sub-workflow is called by P4 INBOUND workflow's `passed`, `declined_oos`, `declined_backstop` branches (go to P4 workflow → update each of those 3 branches to add "Go to Workflow → DECLINE · Decline with Grace")
- [ ] J5A exit (tag `j5a_complete`) — note for J12 wiring post-launch
- [ ] J5B exit (tag `j5b_complete`) — note for J12 wiring post-launch
- [ ] Snapshot export updated (Agency → Snapshots → Create new version from staging sub-account)

## Template name reference (for Send Email node dropdowns)

| Workflow | Template name in GHL |
|---|---|
| DECLINE | `DECLINE · Decline with Grace` |
| J7 T+0 | `J7 · Welcome` |
| J7 T+1d | `J7 · Next Steps` |
| J7 T+7d | `J7 · 7-Day Check-In` |
| J7 T+30d | `J7 · 30-Day Update` |
| J9 T+30d | `J9 · Touch 1 — Initial Ask` |
| J9 T+37d | `J9 · Touch 2 — Soft Reminder` |
| J9 T+44d | `J9 · Touch 3 — Last Ask` |
| J6 T+0 | `J6 · Touch 1 — Sent Notification` |
| J6 T+48h | `J6 · Touch 2 — Lawyer Note` |
| J6 T+144h | `J6 · Touch 3 — Last Reminder` |
| J3 T+24h | `J3 · Email Touch 2` |
| J5A T+1h | `J5A · Touch 1` |
| J5A T+72h | `J5A · Touch 2 — Lawyer Note` |
| J5A T+8d | `J5A · Touch 3 — Value Frame` |
| J5A T+11d | `J5A · Touch 4 — Final` |
| J5B T+0 | `J5B · Touch 1 — Recap` |
| J5B T+72h | `J5B · Touch 2 — Lawyer Note` |
| J5B T+7d | `J5B · Touch 3 — Personal Lawyer Message` |
| J5B T+11d | `J5B · Touch 4 — Engagement Letter Re-share` |
| J2 T-48h | `J2 · Email T-48h` |
| J1 Band A | `J1 · Band A Email` |
| J1 Band B | `J1 · Band B Email` |
| J1 Band B R1 | `J1 · Band B Reminder 1` |
| J1 Band B R2 | `J1 · Band B Reminder 2` |
| J1 Band C | `J1 · Band C Email` |
| J4 T+24h | `J4 · Touch 1` |
| J4 T+5d | `J4 · Touch 2 — Value Add` |
| J4 T+7d | `J4 · Touch 3 — Lawyer Note` |
| J4 T+11d | `J4 · Touch 4 — Last Touch` |

## SMS snippet reference (for Send SMS nodes)

| Workflow | Snippet name |
|---|---|
| J6 T+24h | `J6 · SMS Touch 1` |
| J6 T+96h | `J6 · SMS Touch 2` |
| J3 T+1h | `J3 · SMS Touch 1` |
| J5A T+24h | `J5A · SMS Touch 1` |
| J5A T+5d | `J5A · SMS Touch 2` |
| J5B T+24h | `J5B · SMS Touch 1` |
| J5B T+7d | `J5B · SMS Touch 2` |
| J2 T-24h | `J2 · SMS T-24h` |
| J2 T-2h | `J2 · SMS T-2h` |
| J4 T+72h | `J4 · SMS Touch 1` |
| J4 T+9d | `J4 · SMS Touch 2` |
