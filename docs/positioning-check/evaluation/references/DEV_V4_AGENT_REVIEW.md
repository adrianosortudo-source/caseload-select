# Development v4 output review (locked dev references)

**Reviewer:** Luna agent review only. These are not human-reviewed accuracy ratings, ground truth, or public accuracy claims. Holdouts were not used.

## McCarthy Hansen & Company (`site_mhc`)

- Input: `evaluation-local/dev-inputs/site_mhc.json`; output: `evaluation-local/dev-outputs/site_mhc_v4.json`.
- Gemini `gemini-2.5-flash`, `positioning-v4`; one call; partial state appropriate; 8 element keys; 3 directions; no visual findings, as screenshots were unavailable.
- Deterministic evidence check: 32 references across elements and directions; 11 unique IDs; all resolve to the packet.
- Blind clarity denominator 8; 8/8 ratings within one point. The output uses clarity 3 for all elements; monitor possible ceiling tendency, but do not treat this as a failure of the agreed criterion.
- The false fewer-than-three-pages abstention is corrected. `consistency` is assessed across captured pages.
- Material support concerns in directions: D1 uses “innovative legal solutions” and “shape legal outcomes,” beyond evidence of the firm's prior precedent-setting work; D3 states “effective” mediation/arbitration and expects the firm to “expertly handle” resolution paths, unsupported effectiveness/skill claims. Reframe as exploratory messaging around documented prior experience and listed services. D2's expectations of supportive process/future family dynamics and tradeoff about clients preferring to avoid court should remain explicitly conditional and validated.
- Readiness gate remains unmet; no human-reviewed criterion passed.

## Gene Colman (`site_gene`)

- Input: `evaluation-local/dev-inputs/site_gene.json`; output: `evaluation-local/dev-outputs/site_gene_v4.json`.
- The output is `invalid_analysis` after two permitted calls. Attempt 1 failed on an em dash and an outcome guarantee (“ensures their case is heard fairly”); attempt 2 removed the guarantee but still failed the global em-dash check on “resolve what matters most—your family’s future,” a sourced site aspiration in `central_promise`.
- The retry budget was exhausted on punctuation rather than a remaining material claim. The repair feedback should expose the em-dash field path, or the punctuation rule should be scoped so cited source language does not repeatedly invalidate the result.
- Record as an unavailable report for this case, not a successful review. Human validation remains not performed.

## Gene v4 normalized candidate (offline only)

- Source candidate: `evaluation-local/request-inspection/site_gene_v4_response_2.json`; normalized artifact: `evaluation-local/dev-outputs/site_gene_v4_normalized_offline.json`.
- The only recorded transformation changes the authored em dash to comma-and-space; exact source quotations are retained. The artifact reports `errors: []`.
- Against the unchanged blind reference: 8/8 clarity ratings are within one point; 8 element keys; 3 directions; no visual findings; partial state appropriate. The v3 material promises (“secure your assets and future”; “ensures their case is heard fairly”) are removed. No remaining material unsupported guarantee was found in this independent review.
- This is acceptable semantic content after offline normalization, but it is **not** a live app/run pass. The two-call v4 route ended in `invalid_analysis` before this postprocessing, so runtime normalization/guard behavior still needs a deterministic check before claiming readiness.
