---
doc-type: audit
scope: content-studio
status: informational, read-only
version: v1
last-edited: 2026-07-17
---

# Direct answer / quotable definition coverage audit (2026-07-17)

**Read-only. No content was mutated to produce this report.** Queried
production (`ssxryjxifwiivghglqer`) via the Supabase MCP `execute_sql` tool,
one `SELECT` against `content_pieces` joined to the current EN
`content_piece_versions` row, scoped to the formats the new Direct answer /
quotable definition rule expects a decision on
(`counsel_note`, `clause_in_the_margin`, `decision_tool`, `counsel_letter`,
`checklist`, `landing_page`, `canonical_service_page`), excluding fixture
and smoke-test pieces by title prefix.

**This is a heuristic assessment, not a compliance judgment.** None of the
pieces below carry a `direct_answer` decision, because the rule did not
exist when they were authored (2026-07-05, per `CLAUDE.md` Ses.16 WP-4).
That is expected, not a defect: per the task's own instruction, existing
content is never treated as non-compliant merely because a standard
postdates it. The purpose of this report is narrower: flag which of the 5
real, non-fixture, long-form pieces currently in the review queue look, on
a plain reading of their opening, like good candidates for a later
human-reviewed revision that formalizes an already-present or near-present
definition into the new structured field, versus which ones would need
real drafting work, versus which ones are plausibly `not_applicable` by
shape.

All 5 pieces are `format: counsel_note` or `counsel_letter`,
`workflow_gate: legal_gate`, `status: draft` (awaiting the firm's lawyer
review per the Ses.16/17 roadmap notes), single firm, EN only.

## Findings

| Piece | Format | Opening reads as... | Candidate assessment |
|---|---|---|---|
| Shareholder agreements: the three clauses most founders skip | counsel_note | Decision Question heading, then: "A shareholder agreement displaces the default rules in the Business Corporations Act (Ontario) on exit and deadlock." | **Partial candidate.** The sentence is definitional and jurisdiction-scoped, but it defines a *consequence of absence* (what happens without one), not the term itself. A human reviewer should decide whether to promote this exact sentence to a formal `binding_rule` definition (source: OBCA) or draft a cleaner 1-3 sentence opening. |
| Commercial lease assignment: what the landlord can and cannot block | counsel_note | Decision Question heading, then: "This question comes up most often when an Ontario small business owner has a buyer lined up and discovers the sale depends on the landlord..." | **Needs drafting, not just formalizing.** This is scene-setting/context, not an answer. A reviewer adding a direct answer here would be writing new text, not promoting existing text; do this only as a deliberate revision, not a mechanical backfill. |
| Power of attorney in Ontario: when the document stops working | counsel_note | Decision Question heading, then: "A power of attorney in Ontario does not expire on a fixed date. It stops working the moment the named attorney can no longer act and no alternate is named, or when..." | **Strong candidate.** Two clean, jurisdiction-scoped, plain-language sentences immediately after the heading. Close to already meeting the 1-3 sentence quotable-definition bar; likely needs only classification (`binding_rule`) and a source mapping added, not new drafting. |
| Corporate minute book gaps: what the CRA audit actually checks | counsel_note | Decision Question + Legal Judgment headings, then: "A CRA audit does not enforce the Business Corporations Act (Ontario). It checks whether the c..." | **Strong candidate**, same shape as the power-of-attorney piece: negation-plus-explanation opening that reads as a real answer. Note the piece already separates a "Legal Judgment" section from the decision question, which is a good sign the firm's judgment and the legal fact are not conflated; a reviewer should confirm which classification (`binding_rule` vs. `firm_judgment`) the opening sentence actually belongs to before formalizing it. |
| July Counsel Letter: DRG Law's month in review | counsel_letter | "This letter is a general digest for the current cycle. It does not constitute legal advice..." | **Likely `not_applicable`.** A multi-topic monthly digest has no single central question to define. This is a plausible, intentional `not_applicable` choice (rationale: "monthly digest format, multiple topics, no single definable question"), not a gap to fill. Flagging here specifically because the task requires `not_applicable` to be a deliberate, reviewable choice, not a default; a human should still make that choice explicitly rather than the piece simply never being touched. |

## What this report does NOT do

- It does not mutate `content_pieces`, `content_piece_versions`, or
  `source_brief` for any of the 5 pieces above.
- It does not assert any of these pieces fail the new validator; they were
  authored before the rule existed and the validator does not run
  retroactively against historical rows outside a fresh validate call.
- It does not recommend auto-generating definition text. Every candidate
  above still requires a human editorial and, where a legal proposition is
  involved, legal decision.
- It does not cover PT versions (none of the 5 pieces have a current PT
  version at the time of this query) or formats with zero pieces in
  production today (`clause_in_the_margin`, `decision_tool`, `checklist`,
  `landing_page`, `canonical_service_page`).

## Suggested next step (human-gated, not part of this change)

When the firm's lawyer reviews these 5 pieces in the ordinary course, the
operator can walk through the brief for each and make the direct-answer
decision deliberately (using the new "Direct answer / quotable definition"
section in the Content Studio brief editor), rather than treating this as
a separate bulk backfill project. The power-of-attorney and minute-book
pieces are the cheapest wins; the lease-assignment piece needs real
drafting; the counsel letter is a legitimate `not_applicable`.
