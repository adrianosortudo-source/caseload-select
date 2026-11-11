# Output audit: McCarthy Hansen & Company (`site_mhc`, v2)

**Status:** Luna agent review, not human-reviewed accuracy. Internal development evaluation only; not ground truth or public accuracy.

- Input: `D:\00_Work\01_CaseLoad_Select\05_Product\Planning\Positioning_Diagnostic\evaluation-local\dev-inputs\site_mhc.json`
- Output: `D:\00_Work\01_CaseLoad_Select\05_Product\Planning\Positioning_Diagnostic\evaluation-local\dev-outputs\site_mhc_v2.json`
- Contract: Gemini `gemini-2.5-flash`; `positioning-v2`; `positioning-rubric-v1`. This is the one authorized combined dev prompt rerun; no holdout output was generated.
- Result: `partial`, one call; 10,002 input / 1,276 output tokens; 6.331s. Text-only input; screenshots unavailable.

## Deterministic checks

- Eight unique element keys and all 38 evidence references resolve to 11 packet evidence IDs.
- Partial status is appropriate; no visual finding is expected.
- Reference clarity agreement remains 7/8 within one point (87.5%); consistency is again returned null/not-assessable although the blind reference assessed it at 2.

## Material findings

1. The supplied packet has 8 readable pages, each with at least 150 retained characters; output nevertheless says “fewer than three substantive pages” twice. This is false coverage and erroneous abstention.
2. Directions array is empty. The contract permits zero directions when evidence is weak, so this is not a schema/minimum violation. Given eight readable pages with clear family-law services, repeated stated intentions, credentials, and distinct emphases, the abstention appears unjustified; the limitations do not explain why no evidence-grounded hypothesis could be offered.
3. Firm-wide emotional-benefit prose generalizes Lauren Hanna's individual bio statement that she empowers her clients; retain attribution to that lawyer/source.

The output avoids the v1 unsupported direction guarantees and superiority phrasing, but these improvements do not offset the coverage error and unjustified abstention. Internal semantic field denominator not recomputed for v2; no human-reviewed result is claimed. Readiness gate fails.

## Prompt defect

The prompt's consistency rule says to abstain when fewer than three substantive pages were readable but does not explicitly say the supplied count is authoritative at three or more pages. The model repeats the false count despite the packet's eight-page coverage. The contract permits no directions when evidence is weak; here the concern is the apparent mismatch between that abstention and the rich evidence packet, not a formal minimum violation. Holdouts remain sealed.


