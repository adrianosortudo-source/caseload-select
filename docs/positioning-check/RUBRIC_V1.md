# Positioning diagnostic rubric v1

## Purpose and limits

This rubric describes what a law firm website communicates in the captured pages and analyzed homepage screenshots. It is not a finding of the firm's adopted strategy, client demand, legal quality, effectiveness, conversion performance, market uniqueness, or likely results. The firm may choose to keep its current direction. Direction ideas are exploratory hypotheses, and require firm/client validation.

## Eight fixed elements

| Key | What to assess from the collected site |
|---|---|
| `audience` | Whether the site identifies a client group, situation, or need. |
| `practice_focus` | Which legal services or matters the site foregrounds. |
| `central_promise` | The principal value or experience the site says it offers. |
| `practical_benefits` | Explicit functional or process benefits claimed by the firm. |
| `emotional_benefits` | Explicit emotional reassurance or desired feeling claimed. Do not infer from stock imagery. |
| `reasons_to_choose` | Stated reasons or differentiators offered by the firm; do not call them unique or verified advantages. |
| `supporting_credentials` | Credentials, experience, results, affiliations, testimonials, or proof stated on the captured site; report only what each supports. |
| `consistency` | Whether the captured pages and analyzed screenshots reinforce, vary, or conflict on the above elements. Limited coverage limits this judgment. |

## Status and clarity

Use the contract enums: `observed`, `inferred`, `unclear`, `not_observed`, `not_assessable`. Keep a contradiction in the separate `conflict` flag and cite evidence on both sides. A conflict does not automatically lower the clarity score.

Clarity is only about how explicitly and specifically an element is communicated in sufficiently reviewed material:

- `0`: Not expressed in sufficiently reviewed material.
- `1`: Broad or ambiguous.
- `2`: Identifiable but incomplete.
- `3`: Explicit and developed.
- `null`: Not assessable because the reviewed material is insufficient or inaccessible.

Do not score failed fetches, unreadable pages, or unexamined visual content as zero. Do not score site quality, legal merit, or business outcomes. A sparse site can have a high clarity score for the few elements it states clearly, while other elements remain zero or null as appropriate.

## Confidence and coverage are independent

Confidence is an ordinal description of how strong and consistent the interpretation is, not a probability and not yet calibrated: `high`, `moderate`, `low`, or `null` when no defensible interpretation can be made. Use evidence quality, directness, and cross-page consistency to choose it. A high-confidence interpretation is prohibited if collected evidence contradicts it; cite both sides and flag the conflict. It must never mean the firm is effective, popular, distinctive, legally competent, or likely to attract clients.

Coverage reports what the collector actually captured and what the model actually analyzed: page URLs/titles, readable/unreadable/truncated states and retained text; screenshot viewport/state and analyzed flag; and limitations. Never let confidence substitute for missing coverage or imply that uncollected pages were reviewed.

## Evidence and interpretation checks

- Every factual finding must cite resolvable evidence collected from the submitted site. Quotes must exactly match captured text. Screenshot claims must cite a successfully analyzed screenshot and name a visible region.
- Label interpretations as interpretations; do not rewrite them as firm-approved strategy.
- Do not infer audience, practice competence, emotion, or outcomes from stock photography or decorative visuals.
- Report credentials, client reviews, and case results literally and narrowly; do not expand a credential into a quality or outcome claim.
- A visual asset can be described by visible form, placement, and repetition only. Recognition, distinctiveness, uniqueness, or mental availability requires external research and is out of scope.
- Do not compare against competitors or claim market superiority. No competitor research is included in this free report.
- Do not produce an overall grade, percentile, composite score, or competitive-uniqueness score.

## Direction review

Offer up to three materially different hypotheses only when evidence supports useful alternatives. A direction may retain and clarify the current direction. Each must state its audience/situation, possible statement, website evidence basis, communication implication, expected client expectation, tradeoff, and three validation questions. Use tentative language. A direction must not assert client preference, conversion gains, legal results, distinctiveness, competitor superiority, or external market validation. If evidence is too weak, abstain and explain what to learn. Include a clear consultation next step without implying free legal advice or guaranteed intake.

## Source grounding (targeted excerpts only; not full-book synthesis)

1. Ulli Appelbaum, *The Brand Positioning Workbook*, in `C:\Users\adria\OneDrive\Desktop\Books\Branding\Branding_Combined.md`, lines 32880–32899: positioning captures desired brand associations and should be tailored to the brand situation. Lines 34751–34790 distinguish divergent ideation from convergent evaluation. Application here: extract current observed associations first; keep proposed directions separate and label them hypotheses. The separate excerpt in the same compilation at lines 8483–8493 encourages simple, motivating positioning and consideration beyond product features. That is ideation guidance, not proof of what is ownable or motivating to this firm's clients.
2. Jenni Romaniuk, *Building Distinctive Brand Assets*, OCR compilation `C:\Users\adria\OneDrive\Desktop\Books\Branding\Building_Distinctive_Brand_Assets_Combined.md`, lines 1206–1245 and 1285–1335 (printed pages 27–30): assets become linked with a brand name through learning and memory; freshness and consistency affect retrieval. Application here: describe only visible asset use. Do not claim recognition, distinctiveness, or mental availability from a site-only scan. OCR is imperfect; no verbatim quotation is relied on.
3. *Digital Marketing for Beginners (2026 Edition)*, `C:\Users\adria\OneDrive\Desktop\Books\Digital Marketing\Digital_Marketing_Combined.md`, lines 4035–4073: the messaging passage frames positioning around why someone should choose a firm and says the message should guide a clear action. Application here: evaluate whether a stated audience/value and next step are understandable. Do not import the passage's causal result claims into this diagnostic.
4. Law Firm Marketing compilation, E-Myth client satisfaction passage, `C:\Users\adria\OneDrive\Desktop\Books\LAW MKT\Law_Firm_Marketing_Combined.md`, lines 33290–33335: client categories are described as rough hypotheses, human beings defy stereotypes, and firms should analyze their own clients; the passage relates positioning words to a preferred client category and keeping a promise. Application here: audience suggestions remain hypotheses and require validation with the firm's clients. This is one passage in a compilation, not a complete synthesis of every included book.

## Version

Rubric: `positioning-rubric-v1`. Schema authority: `src/lib/positioning-check/types.ts` in the feature worktree. Changes after Gate 1 require coordinator review and a recorded deviation.

