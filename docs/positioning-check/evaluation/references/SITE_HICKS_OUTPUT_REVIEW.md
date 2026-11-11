# Output review: Hicks Adams (`site_hicks_final`, sealed holdout)

**Reviewer:** Luna agent review; not human-reviewed accuracy, ground truth or a public accuracy claim. Blind holdout reference was locked before output.

- Input/output: `evaluation-local/holdout-inputs/site_hicks.json` → `evaluation-local/holdout-outputs/site_hicks_final.json`.
- Gemini `gemini-2.5-flash`, `positioning-v4`; partial state; 2 calls; 20,117 input / 6,282 output tokens; 28.557 s.
- Deterministic: 8 unique keys; 3 directions; 53 evidence references across 18 unique IDs; all resolve. No visual findings, as screenshots were unavailable. Clarity agreement 8/8 within one point.
- Field-level support denominator: 41 non-question prose fields; 41/41 supportable as site-reported claims or explicitly hypothetical directions. Trial/appeal work, resources, court presence, recognition and the firm's reported record of success are supported by the captured pages; this review does not validate outcomes or awards independently. No material unsupported claim found.
- Scope precision: consistency observations refer to the 8 captured pages, not the entire site; the packet says it was sampled. The generated limitations mention screenshot absence but do not repeat the sampling limit. Confidence remains uncalibrated. Holdout is now evaluated once; do not tune future prompt changes against it. Human validation remains not performed.
