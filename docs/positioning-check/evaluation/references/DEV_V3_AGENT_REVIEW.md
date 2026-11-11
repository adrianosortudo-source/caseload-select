# Development v3 output review (locked dev references)

**Reviewer:** Luna agent review only; not human-reviewed accuracy, ground truth, or a public accuracy claim. **Prompt:** `positioning-v3`; model `gemini-2.5-flash`; holdouts remained sealed; no further model calls were made.

## Gene (`site_gene_v3.json`)

Input reference: `evaluation-local/dev-inputs/site_gene.json`; output: `evaluation-local/dev-outputs/site_gene_v3.json`.

- Partial state is appropriate; 8 element keys; 3 directions; 0 visual findings for text-only evidence.
- Blind clarity reference denominator: 8; 8/8 ratings are within one point of the locked reference. The model gives all eight elements a 3; this suggests a possible ceiling tendency to monitor, not a failure of the approved within-one criterion or an exact confidence calibration.
- Material support defects: direction 2 says “secure your assets and future”; direction 3 expectation says the firm “ensures their case is heard fairly.” Both should be reframed as exploratory possibilities without promising legal outcomes. The `central_promise` wording “achieve fair resolutions” summarizes the website's attributed advocacy purpose and aspirations about protecting what matters and helping families move forward; clearer attribution could improve precision, but this is not counted as a material guarantee. The emotional-benefit finding is supported when read with its reason and uncertainty, which attribute feelings to cited testimonials and say they are not guaranteed. “Protect children’s relationships” is an aspirational advocacy purpose supported by the site. Experience statements (47 years, nearly five decades, over 44 years, over 37 years) are compatible lower-bound descriptions without same-date contradictory claims; no conflict-flag or confidence defect is counted.
- Fails internal factual-support gate. Do not report as a human-validated or release-passing result.

## MHC (`site_mhc_v3.json`)

Input reference: `evaluation-local/dev-inputs/site_mhc.json`; output is an `invalid_analysis` failure record after two model calls; raw candidates and requests are retained under `evaluation-local/request-inspection/site_mhc_v3_response_{1,2}.json` and matching request files.

- Both candidates contain unsupported “unparalleled” in a possible statement, so rejection is justified. Both also use the website-supported phrase “children’s best interests”; validator's unqualified `best` match is overbroad and would falsely reject that wording. Because the retry limit is two, no usable report was returned.
- Record as a product failure and validator precision issue, not a successful semantic evaluation. No human-reviewed criteria passed.

## Readiness

The two dev cases do not meet the internal 95% material-support gate. Holdouts were not opened or tuned against. These agent-review observations do not substitute for the plan's human validation requirement.




