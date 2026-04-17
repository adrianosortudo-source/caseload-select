# Round 3 Question Bank — Personal Injury: Motor Vehicle Accident (PI-MVA)

**Pilot sub-type for S10. Generalise to other PAs in GA.**

## Routing

Triggered when:
- `practice_area` resolves to `personal_injury` AND
- sub-type is `motor_vehicle_accident` (or ambiguous PI, pending sub-type clarification in R1/R2)
- Band is A, B, or C

Band A/B: all 8 questions.
Band C: questions 1, 2, 5, 6 only (4 questions).

---

## Questions

### Q1 — Incident Date and Limitations Clock
```
id: pi_mva_q1
category: jurisdiction_limitations
text: "When did the accident happen? Please give the date as precisely as you can — day, month, and year."
type: free_text
follow_up_condition: if > 18 months ago
follow_up_text: "Thank you. Since more than 18 months have passed, I want to make sure we capture this accurately. Have you taken any formal steps since the accident — filed a claim with your insurer, sent a demand letter, or started any court proceedings?"
memo_label: "Incident date / Limitations status"
compliance_note: "Do not state whether a claim is time-barred. Flag for lawyer review only."
```

### Q2 — Fault and Scene Facts
```
id: pi_mva_q2
category: fact_pattern
text: "In your own words, describe how the collision happened. Who was involved, how many vehicles, and what was each vehicle doing at the moment of impact?"
type: free_text
memo_label: "Collision description / Fault indicators"
```

### Q3 — Police and First Responder Attendance
```
id: pi_mva_q3
category: evidence_inventory
text: "Did police attend the scene? If yes: do you have the collision report number, or have you requested the full report? Did an ambulance attend, and were you transported to hospital?"
type: structured_multi
options:
  - "Police attended — I have the report number"
  - "Police attended — I have not requested the report yet"
  - "Police attended — they told me no report was made"
  - "No police at scene"
  - "Ambulance attended — I was taken to hospital"
  - "Ambulance attended — I was not transported"
  - "No ambulance"
allow_multi_select: true
allow_free_text: true
free_text_label: "Report number (if known)"
memo_label: "Evidence held: Police / EMS"
```

### Q4 — Medical Treatment and Records
```
id: pi_mva_q4
category: evidence_inventory
text: "What medical treatment have you received since the accident? Please include emergency visits, family doctor, specialists, physiotherapy, or any other care."
type: structured_multi
options:
  - "Emergency room / hospital"
  - "Family doctor"
  - "Orthopaedic specialist"
  - "Neurologist"
  - "Physiotherapy"
  - "Chiropractor"
  - "Psychologist / counsellor"
  - "Other specialist"
  - "No treatment received yet"
allow_multi_select: true
allow_free_text: true
free_text_label: "Any other treatment not listed"
follow_up_text: "Do you have copies of any medical records, discharge summaries, or treatment notes? Or are they held by your care providers?"
memo_label: "Medical treatment received / Records held"
```

### Q5 — Insurance Correspondence
```
id: pi_mva_q5
category: evidence_inventory
text: "Has your own insurance company been in contact with you since the accident? What about the other driver's insurer?"
type: structured_multi
options:
  - "My insurer has contacted me — I have letters or emails"
  - "My insurer has contacted me — nothing in writing yet"
  - "My insurer has not contacted me"
  - "The other driver's insurer has contacted me — I have correspondence"
  - "The other driver's insurer has contacted me — verbally only"
  - "I do not know who the other driver's insurer is"
  - "The other driver was uninsured or fled the scene"
allow_multi_select: true
memo_label: "Insurance contact / Correspondence held"
```

### Q6 — Employment and Income Impact
```
id: pi_mva_q6
category: fact_pattern_depth
text: "Has the accident affected your ability to work? If yes, are you employed, self-employed, or a student? Have you lost income, and do you have documentation of that loss — pay stubs, a letter from your employer, or an accountant's record?"
type: free_text
memo_label: "Employment impact / Income loss documentation"
```

### Q7 — Parties and Adverse Counsel
```
id: pi_mva_q7
category: conflict_and_parties
text: "Please give me the full legal name of the other driver involved, if you know it. Do you know if they have retained a lawyer? Have you received any correspondence from a lawyer acting on behalf of the other driver or their insurer?"
type: free_text
memo_label: "Adverse parties / Opposing counsel"
compliance_note: "Names captured for conflict check at pipeline gate."
```

### Q8 — Prior Counsel and Expectations
```
id: pi_mva_q8
category: expectations_alignment
text: "Have you spoken with any other lawyer about this accident? If yes, what happened? And separately — what outcome are you hoping for from this consultation, and is there a specific timeline driving your decision to reach out now?"
type: free_text
memo_label: "Prior counsel / Client expectations and urgency"
```

---

## Evidence Manifest Output (from Q3, Q4, Q5)

The memo generator consolidates Q3, Q4, and Q5 into a single **Evidence Manifest** section:

```
Evidence held by client:
  - [x] Police report number on hand
  - [ ] Full police report (not yet requested)
  - [x] Ambulance attended / transported to hospital
  - [x] Emergency room records (held by hospital)
  - [x] Physiotherapy notes (held by provider)
  - [x] Insurer correspondence (written, in client's possession)
  - [ ] Opposing insurer correspondence

Evidence to request / subpoena:
  - Full collision report from [OPP / local police]
  - Ambulance call report (ACR)
  - Hospital records
  - Physiotherapy chart notes
```

---

## Limitations Clock Logic

Input: `incident_date` from Q1.
Compute: `days_since = today - incident_date`.

Output rules (for memo only — no legal advice to client):
- < 365 days: flag as "Within standard 2-year limitation — no urgency flag"
- 365–545 days: flag as "Approaching 18-month mark — confirm no prior proceedings"
- 546–720 days: flag as "Approaching 2-year limitation — URGENT: confirm no tolling events"
- > 720 days: flag as "Beyond standard limitation period — lawyer to assess tolling, discoverability, or statutory exceptions before consultation proceeds"

The flag appears in the memo under **Jurisdiction and Timeline** — never shown to the prospect.
