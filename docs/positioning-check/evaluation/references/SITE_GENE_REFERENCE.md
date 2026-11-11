# Blind reference: Gene Colman family law (`site_gene`)

**Reference locked before model output.** This is Luna's agent-reviewed interpretation of the evidence packet, not human-reviewed ground truth. It is not a public accuracy claim. Do not tune the prompt to this example after generation.

- Source packet: `D:\00_Work\01_CaseLoad_Select\05_Product\Planning\Positioning_Diagnostic\evaluation-local\dev-inputs\site_gene.json`
- Submitted URL: https://www.complexfamilylaw.com/
- Capture: 2026-11-08T16:30:35.966Z; 7 pages; 49 text evidence items; 6 substantive pages, one short blog stub; homepage and several pages truncated; all screenshots unavailable/unanalysed.
- Frozen generation contract: Gemini `gemini-2.5-flash`, prompt `positioning-v1`, rubric `positioning-rubric-v1`, prompt SHA-256 `61eaff7cc412259daf51473dea9d035c86c57155c4b8d3b595366f556ce043f6`.
- Expected API status: `partial`, because text is truncated and both screenshots are unavailable. `visualFindings` should be empty; image-based claims are unsupported by this packet.

## Element reference judgments

Clarity rubric: 0 absent in sufficiently reviewed material; 1 broad/ambiguous; 2 identifiable but incomplete; 3 explicit and developed. Confidence refers only to strength of this interpretation. Evidence refs below point to collector-owned text IDs in the packet; quoted website language is not independently verified.

| Element | Expected status | Clarity | Confidence | Reference basis / evidence IDs |
|---|---|---:|---|---|
| `audience` | observed | 3 | high | The hero explicitly addresses Ontario families in complex parenting, financial and high-conflict matters; the home page lists related parent/caregiver scenarios. `text-2`–`text-4` |
| `practice_focus` | observed | 3 | high | Family law is explicit; captured home page names parenting, support, financial/property, family violence, fathers' rights, collaborative divorce and cross-border matters. `text-3`–`text-6` |
| `central_promise` | observed | 2 | moderate | Strategic, thoughtful representation; disciplined advocacy, practical insight and clarity are stated, but no service outcome is assured. `text-2`, `text-3` |
| `practical_benefits` | observed | 2 | moderate | The site describes careful preparation, explaining steps and strategic planning; detail is partial and pages are truncated. `text-2`, `text-3` |
| `emotional_benefits` | observed | 2 | moderate | The site publishes client-reported feelings of being heard/respected/understood and discusses family pressures. Treat testimonials as reported experiences, not typical or promised outcomes. `text-3`, `text-7`, `text-8` |
| `reasons_to_choose` | observed | 2 | moderate | Explicit reasons include long experience, focus on complex disputes, strategy/preparation, and procedural fairness. These are the firm's stated reasons, not verified comparative advantages. `text-2`, `text-3`, `text-5`, `text-6` |
| `supporting_credentials` | observed | 3 | high | Site states 47 years and nearly five decades of experience; captured page also has a credentials/recognition section. Presence is assessed, not accuracy. `text-2`, `text-3`, `text-8` |
| `consistency` | observed | 2 | moderate | The home page and captured lawyer/team pages retain the family-law focus and strategy/preparation themes; other pages include resources/photos and the sample is truncated, so this is limited to captured evidence. `text-2`, `text-3`, `text-25`–`text-32`, `text-33`–`text-48` |

**Conflict:** no clear opposing positioning claims in the packet; expected `conflict:false` for all elements. **Coverage:** no visual assessment; do not claim asset recognition, differentiation, or screenshot findings. Keep all fact claims tied to citations; no competitor or outcome claims.

## Denominators for later output audit

- Clarity reference denominator: 8 assessable element ratings.
- Support audit: count every factual assertion in the generated positioning statement, rationale, element findings/reasons, visual findings and directions; record supported / unsupported / materially unsupported separately. Published testimonials and firm credentials must be described as site-reported claims.
- Coverage audit: 7 page records, 2 unavailable/unanalysed screenshots, truncation reported, `partial` state. Visual-claim denominator: any output visual assertions must be zero; otherwise each is unsupported.
- Direction audit: up to 3 hypotheses; each needs cited website basis, audience/situation, communication implication, client expectation, tradeoff, and three validation questions; none may assert demand, effectiveness, uniqueness, competitor superiority or guaranteed results.

