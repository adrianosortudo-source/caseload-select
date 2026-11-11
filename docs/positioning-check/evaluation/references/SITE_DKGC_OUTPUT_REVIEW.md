# Output review: DKGC (`site_dkgc_final`, sealed holdout)

**Reviewer:** Luna agent review; not human-reviewed accuracy, ground truth or a public accuracy claim. Blind holdout reference was locked before output.

- Input/output: `evaluation-local/holdout-inputs/site_dkgc.json` → `evaluation-local/holdout-outputs/site_dkgc_final.json`.
- Gemini `gemini-2.5-flash`, `positioning-v4`; `invalid_analysis` after the two-call cap. No report reached the user. Both raw candidates and requests are retained at `evaluation-local/request-inspection/site_dkgc_final_response_{1,2}.json` and matching request files.
- Failure review: attempt 1 included “ensuring you feel understood and confident” and “secure the best resolution”; attempt 2 retained the first promise. The validator correctly rejected these outcome/experience guarantees in exploratory statements. The error is an unavailable report on this holdout; it is not a successful accuracy result.
- Raw candidates also misclassify experience and testimonials as supporting credentials, with clarity 3/high confidence despite no specific professional credentials cited in those fields. This is a latent semantic defect prevented from shipping by validation/failure; do not score it as a returned report.
- No retry beyond the cap. This holdout remains sealed against prompt tuning. Human validation remains not performed.
