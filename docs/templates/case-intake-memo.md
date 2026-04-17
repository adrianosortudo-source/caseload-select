# Case Intake Memo — Template and Generation Prompt

**Used by:** `src/lib/memo.ts`  
**Triggered by:** Round 3 completion for Band A/B/C  
**Stored in:** `intake_sessions.memo_text` + portal view  
**LSO compliance:** No outcome predictions, no "strong case" language, descriptive only.

---

## OpenAI Generation Prompt

### System Prompt (inject into memo.ts)

```
You are a legal intake analyst for a Canadian law firm. Your job is to produce a Case Intake Memo from structured intake data collected from a prospective client.

RULES:
1. Write in plain, professional English. No legal conclusions.
2. Never state or imply whether the client has a strong or weak case.
3. Never predict outcomes, damages, or likelihood of success.
4. Use the word "reported" or "states" when describing client claims — never state them as fact.
5. Flag gaps and missing information for the lawyer to probe — do not fill gaps with assumptions.
6. Ontario law applies. Reference the correct limitations period only as a factual flag, not as legal advice.
7. The memo is read by the lawyer before the consultation. Write for a busy professional who has 3 minutes.
8. No em dashes. Use commas, colons, semicolons, or restructure.
9. No AI-pattern vocabulary: "delve," "tapestry," "pivotal," "testament," "crucial," "meticulous," "ensure," "foster."
10. Each section must be concise. Total memo: 350-500 words.
```

### User Prompt Template

```
Produce a Case Intake Memo from the following intake data.

INTAKE DATA:
- Client name: {{contact.first_name}} {{contact.last_name}}
- Practice area: {{practice_area}}
- Sub-type: {{sub_type}}
- Band: {{band}} (CPI: {{cpi_score}}/100)
- Situation summary (from Round 1/2): {{situation_summary}}
- Round 3 answers: {{round3_answers_json}}
- Incident date: {{incident_date}} (Days since: {{days_since_incident}})
- Limitations flag: {{limitations_flag}}

OUTPUT FORMAT: Follow the memo template exactly. Return plain text only, no markdown headers with #. Use the section labels provided.
```

---

## Memo Template

```
CASE INTAKE MEMO
Prepared by CaseLoad Screen
{{generated_date}} | {{practice_area}} | Band {{band}} | CPI {{cpi_score}}/100

Client: {{contact.first_name}} {{contact.last_name}}
Phone: {{contact.phone}} | Email: {{contact.email}}
Consultation booked: {{booking_time ?? "Pending"}}

────────────────────────────────────────
MATTER SUMMARY
────────────────────────────────────────
{{ai_generated_summary}}
[2-3 sentences. Sub-type, key facts, incident context. Descriptive only.]

────────────────────────────────────────
JURISDICTION AND TIMELINE
────────────────────────────────────────
Incident date: {{incident_date}}
Days elapsed: {{days_since_incident}}
Limitations flag: {{limitations_flag}}
Prior proceedings: {{prior_proceedings_summary}}

────────────────────────────────────────
PARTIES AND CONFLICT FLAGS
────────────────────────────────────────
Client: {{contact.full_name}}
Adverse parties: {{adverse_parties_list}}
Opposing counsel: {{opposing_counsel ?? "Not known at intake"}}
Prior counsel: {{prior_counsel_summary}}
Conflict check: Pending — run against conflict register before consultation.

────────────────────────────────────────
EVIDENCE MANIFEST
────────────────────────────────────────
Held by client:
{{evidence_held_checklist}}

To request or subpoena:
{{evidence_outstanding_checklist}}

────────────────────────────────────────
FACT PATTERN AND REPORTED CIRCUMSTANCES
────────────────────────────────────────
{{ai_generated_fact_pattern}}
[Collision description, fault indicators, injuries, employment impact. "Client reports" framing throughout. Flag any inconsistencies with Round 1/2 data.]

────────────────────────────────────────
CLIENT EXPECTATIONS AND FEE POSTURE
────────────────────────────────────────
Desired outcome: {{client_expectations}}
Timeline pressure: {{urgency_summary}}
Fee arrangement awareness: {{fee_posture}}

────────────────────────────────────────
GAPS FOR LAWYER TO PROBE
────────────────────────────────────────
{{ai_generated_gaps_list}}
[Bullet list of missing information, unresolved inconsistencies, or areas needing verbal clarification in the consultation.]

────────────────────────────────────────
INTAKE QUALITY
────────────────────────────────────────
CPI confidence: {{cpi_confidence}}
Round 3 completion: {{round3_completion_pct}}% of questions answered
Gaps flagged: {{gap_count}}

────────────────────────────────────────
Prepared by CaseLoad Screen. This memo contains client-reported information only and does not constitute legal advice or a case assessment.
Confidential — Law Society of Ontario Rule 3.3 applies.
────────────────────────────────────────
```

---

## Portal Rendering Notes

- Memo displayed in firm portal under lead detail "Case Memo" tab.
- Lead row shows "Memo ready" badge (emerald) when `memo_generated_at` is not null.
- Memo text stored as plain text in `intake_sessions.memo_text`.
- Memo URL (`memo_url`) reserved for future PDF export (S12).
- Lawyers cannot edit the memo. Read-only.
- Gap list is highlighted in amber to draw the lawyer's eye before the consultation.

---

## Compliance Review Checklist (run before shipping)

- [ ] No sentence predicts outcome or damages
- [ ] No sentence uses "strong," "winning," "good case," or equivalents
- [ ] Every client claim uses "reports," "states," or "described"
- [ ] Limitations flag is factual, not advisory
- [ ] No em dashes in generated output
- [ ] Plain English throughout — no legalese, no AI-pattern vocabulary
- [ ] Footer disclaimer present on every memo
