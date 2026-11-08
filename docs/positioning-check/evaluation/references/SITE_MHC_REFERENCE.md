# Blind reference: McCarthy Hansen & Company (`site_mhc`)

**Reference locked before model output.** Luna agent-reviewed judgment from captured evidence, not human-reviewed ground truth; no public accuracy claim.

- Packet: `D:\00_Work\01_CaseLoad_Select\05_Product\Planning\Positioning_Diagnostic\evaluation-local\dev-inputs\site_mhc.json`
- URL: https://www.mhcllp.ca/; captured 2026-11-08T16:30:39Z; 8 readable pages; 26 text evidence items; no text truncation; both screenshots unavailable/unanalysed; one sampling limitation.
- Frozen contract: Gemini `gemini-2.5-flash`; prompt `positioning-v1`; rubric `positioning-rubric-v1`; SHA-256 `61eaff7cc412259daf51473dea9d035c86c57155c4b8d3b595366f556ce043f6`.
- Expected status `partial` (sampling limitation + unavailable screenshots). No visual findings should be present. Evidence is website-reported, not independently verified.

## Element reference judgments

| Element | Status | Clarity | Confidence | Evidence and reference judgment |
|---|---|---:|---|---|
| `audience` | observed | 2 | moderate | Toronto-based family-law practice addresses clients/families and also counsel/self-represented parties for mediation; no single preferred client segment is stated. `text-1`–`text-3` |
| `practice_focus` | observed | 3 | high | Explicit family-law-exclusive focus, including trial/appellate litigation and mediation/arbitration. `text-1`–`text-3`, `text-15`–`text-16` |
| `central_promise` | observed | 2 | moderate | Says it will put knowledge and experience to work for clients/families and seeks a functional vision of family; broad and not an outcome guarantee. `text-1`–`text-3` |
| `practical_benefits` | observed | 2 | moderate | Lead-counsel experience, trial/appellate work and mediation/arbitration are described; the site gives limited detail about the client's process. `text-1`–`text-3` |
| `emotional_benefits` | observed | 2 | moderate | States aims of healing, security, stability and children's best interests in family disputes. `text-3` |
| `reasons_to_choose` | observed | 3 | high | Specific stated reasons include exclusive family-law focus, lead counsel in precedent-setting matters, and litigation/ADR experience. These are claims, not verified comparative advantages. `text-1`–`text-3`, `text-15`–`text-16` |
| `supporting_credentials` | observed | 3 | high | Captured biographies identify a Certified Specialist, fellowships, awards, case experience, education and leadership roles. Presence is assessed, not independent truth. `text-8`–`text-9`, `text-15`–`text-21`, `text-23`–`text-26` |
| `consistency` | observed | 2 | moderate | Homepage, team and lawyer bios reinforce family law; site also addresses the legal profession and self-represented parties for ADR, a scope variation rather than a contradiction. `text-1`–`text-3`, `text-10`–`text-26` |

No clear contradiction; expected `conflict:false` for each element. Clarity denominator: 8 assessable ratings. Audit every generated factual assertion against cited evidence and flag credentials/results as site-reported. Visual-claim denominator: expected zero. Direction assertions require the complete hypothesis fields, evidence references and validation questions; no market-demand or outcome promises.
