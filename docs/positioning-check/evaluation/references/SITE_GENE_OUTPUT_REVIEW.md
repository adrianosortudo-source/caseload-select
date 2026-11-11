# Output audit: Gene Colman (`site_gene`)

**Status:** Luna agent review, not human-reviewed accuracy. Internal development evaluation only; not ground truth or a public accuracy claim. Reviewed after the blind reference was locked and the output was generated.

- Input: `D:\00_Work\01_CaseLoad_Select\05_Product\Planning\Positioning_Diagnostic\evaluation-local\dev-inputs\site_gene.json`
- Output: `D:\00_Work\01_CaseLoad_Select\05_Product\Planning\Positioning_Diagnostic\evaluation-local\dev-outputs\site_gene.json`
- Contract: Gemini `gemini-2.5-flash`; `positioning-v1`; `positioning-rubric-v1`; prompt SHA `61eaff7cc412259daf51473dea9d035c86c57155c4b8d3b595366f556ce043f6`.
- Result: `partial` as expected; 1 model call; 18,868 input / 1,982 output tokens; 9.678s reported generation time. Screenshots unavailable, output has 0 visual findings as required.

## Deterministic checks

- Eight unique keys: pass.
- Element evidence refs: 68 total references, 22 unique IDs; all 68 resolve in the collector packet; no missing evidence IDs.
- Visual evidence: zero findings, expected because both screenshots were unavailable/unanalysed.
- Clarity vs blind reference: reference denominator 8; 7/8 (87.5%) within one point. Seven are within one; `consistency` is `not_assessable` while the reference is assessable at 2. This exceeds the numeric 80% guide but reveals a false coverage explanation.
- Status/coverage: partial is correct; the consistency reason claims fewer than three substantive pages were readable, but this packet contains 6 substantive pages (7 pages total, with one short blog stub). This is a materially false coverage statement and incorrect abstention.
- Confidence: no collected-evidence contradiction was found against a high-confidence rating. Confidence has not been calibrated.

## Semantic support audit

Review unit: one non-question prose field (overall statement, rationale, each element finding/reason/uncertainty, and each direction's audience/situation, possible statement, communication implication, expectation and tradeoff), for 41 field-level units total. This is an internal field-level proxy, not a claim-level public accuracy statistic. 35/41 fields were supportable or clearly framed as an interpretation/hypothesis; 6 need correction or narrower language (85.4%, below the 95% support target):

1. Emotional-benefit finding generalizes one published testimonial into what clients “can expect” to feel. Keep it explicitly as one site's published testimonial and state that outcomes vary.
2. Consistency reason falsely says fewer than three substantive pages were readable; inspect the actual six substantive captured pages and assess only their visible shared themes.
3. Direction 1 possible statement calls the firm skilled at Ontario's “most complex” cases. The site states experience and complex-case focus, but the superlative/skill outcome is not established by this packet.
4. Direction 2 possible statement says it will ensure every child maintains contact with both parents. This is an unsubstantiated legal outcome guarantee; remove the guarantee.
5. Direction 3 possible statement says it will ensure the family's future. This is an unsupported outcome promise; remove it.
6. Direction 3 communication implication asserts long-term benefits from reduced conflict. The packet does not establish causal effects; frame as an option to validate, without claiming benefits.

Other direction fields are materially distinct in emphasis and include tradeoffs/questions. No competitor or visual-recognition claim appears. The current output does **not** pass the factual-support gate because material claims remain unsupported; these must be corrected before release. Any prompt correction should be treated as a dev-only adjustment and rerun once under the plan's cap. Holdouts remain sealed.

## Human-review status

Human-reviewed accuracy was not performed. This 35/41 result is an agent evaluation signal only. No human-reviewed plan criterion is marked passed.
