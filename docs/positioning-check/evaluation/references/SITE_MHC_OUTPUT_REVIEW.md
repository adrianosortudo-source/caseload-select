# Output audit: McCarthy Hansen & Company (`site_mhc`)

**Status:** Luna agent review, not human-reviewed accuracy. Internal development evaluation only; not ground truth or public accuracy.

- Input: `D:\00_Work\01_CaseLoad_Select\05_Product\Planning\Positioning_Diagnostic\evaluation-local\dev-inputs\site_mhc.json`
- Output: `D:\00_Work\01_CaseLoad_Select\05_Product\Planning\Positioning_Diagnostic\evaluation-local\dev-outputs\site_mhc.json`
- Contract: Gemini `gemini-2.5-flash`; `positioning-v1`; `positioning-rubric-v1`; prompt SHA `61eaff7cc412259daf51473dea9d035c86c57155c4b8d3b595366f556ce043f6`.
- Result: `partial` as expected; one call; 9,855 input / 2,115 output tokens; 9.889s reported generation time. Screenshots unavailable; 0 visual findings as expected.

## Deterministic checks

- Eight unique element keys: pass.
- Evidence references: 38 total, 11 unique IDs; all resolve in the packet.
- Clarity: 7/8 (87.5%) within one point of the blind reference. `consistency` was reference-assessable at 2 but returned null/not-assessable, so it is the one miss; the numeric 80% guide is met, but this is a material coverage error.
- Coverage: packet contains 8 readable pages, 8 pages with at least 150 retained characters, no truncation, one sampling limitation and two unavailable/unanalysed screenshots. `partial` is correct because a limitation exists. The output twice states fewer than three substantial pages were readable; this is false. Capture counts include readable truncated pages when present; missing screenshots do not make text pages unreadable.
- Model-side structure check: `validateAnalysis` returned no schema/evidence errors. This does not establish semantic support.
- Confidence: no collected-evidence contradiction was found against a high-confidence interpretation. Confidence remains uncalibrated.

## Semantic support audit

Review unit: 41 non-question prose fields (overall statement/rationale; element findings, reasons and uncertainty; five direction prose fields each). This is an internal field-level proxy, not a public accuracy statistic. 35/41 fields were supportable or clearly interpretive/hypothetical (85.4%); six need correction or narrower attribution, below the 95% guide:

1. Emotional benefit generalizes a statement from one lawyer bio (“empowers her clients”) to the firm's clients as a whole.
2. Consistency finding says fewer than three substantial pages were readable; 8 were.
3. Consistency reason repeats the same false page-count claim.
4. Direction 1 possible statement promises “innovative, effective solutions”; the packet does not establish effectiveness.
5. Direction 2 possible statement promises stable resolution outside court; the site offers ADR, but does not establish this result or that disputes avoid protracted court proceedings.
6. Direction 3 possible statement uses “unparalleled” and “ensuring comprehensive expertise,” an unsupported superiority/guarantee claim.

Other directions are meaningfully distinct in emphasis. Direction 2's expectation of privacy/conflict minimization and Direction 3's promised team access should remain explicitly exploratory and be validated. No visual or competitor finding should appear. Current output fails the factual-support gate until material claims are corrected. Human-reviewed criteria remain `not performed`; this is only an agent review.
