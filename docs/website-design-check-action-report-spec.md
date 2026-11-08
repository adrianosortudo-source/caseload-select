# Website Design Check action report specification

Status: user approved implementation of this report contract. Merge of the specific PR requires separate approval. Scoring and API output remain unchanged.

## 1. Product contract

Render a concise 200–300 word closed report containing: domain, scan date and scope; a deterministic two-sentence assessment; the three highest-ranked stable groups; every grade-limiting flag in a compact list; current secondary score; a copy action plan; and one native collapsed `<details>` disclosure. Keep every raw finding available in that disclosure with a qualified recommendation. Preserve score calculations, finding ranking, and API shape. A projected grade appears only in details and is explicitly labeled “Calculated scenario”; it is not a result or promise.

The report describes the homepage scan. Use “Homepage” as finding location unless the source finding supplies a specific location. Never imply whole-site coverage. Preserve the exact measurement, sample size, and qualification together; otherwise keep the full observation in details. Do not manufacture evidence, praise, business outcomes, legal violations, requirements, or disclaimers.

The result adapter is pure and uses explicit mappings; no framework or taxonomy layer. The API already may supply `flagKey` and `judgmentCoverage`; add both to the local report type. Coverage is exactly `{ wholePage: true } | { wholePage: false; judgedTopPx: number; actualPageHeightPx: number }`. It describes image extent only, not successful vision review. For false, state “Visual-review capture was limited to the top {judgedTopPx} pixels of a {actualPageHeightPx}-pixel homepage.” For true, state “The desktop screenshot was not clipped.” When absent, state “Visual capture coverage was not supplied.”

Match flags by `flagKey`; label fallback is permitted only when it uniquely identifies one flag. Match ordinary findings by exact dimension and label. Never drop an unmatched flag: show it in the relevant details list with the fallback copy below. Preserve original observations in details even when recommendations are qualified.

## 2. Mapping format and fallback

Every emitted ranked finding is identified by `flagKey` for flags, or exact `(dimension, label)` for ordinary findings. Each mapping supplies title (at most 8 words), why (at most 18 words), next action (at most 25 words), owner (`Firm owner`, `Website editor`, or `Developer`), group (one allowed group or none), and evidence treatment/conditional wording. The title is a short neutral summary, not a verdict. The why explains only the observed signal and its limit. The action is actionable without exceeding the evidence.

Unmapped finding fallback is exact:

| Field | Exact value |
|---|---|
| Title | Review this automated finding. |
| Why | This signal needs review before choosing a change. |
| Next action | Ask your website editor to review the full finding before changing the page. |
| Owner | Website editor |
| Group | none |

Keep the source observation unchanged in details. Do not synthesize an alternate copy fallback.

## 3. Stable groups

Only these cross-finding groups exist; enumerate exact members. Every other finding remains separate (group = none). Do not introduce a broad Trust group.

| Group | Exact members |
|---|---|
| Claim support | flag `bandwagon_claim_without_proof`; flag `self_designation_without_proof`; ordinary `Authority and Positioning` / `Naked self-designation claims`. Group only these explicit claim-support signals. |
| Testimonial attribution | flag `unattributed_testimonials`; ordinary `Authority and Positioning` / `Testimonial attribution` |
| Text contrast | flag `contrast_failure`; ordinary `Color and Contrast` / `Text contrast` |

If an ordinary member label differs from the enumerated exact identity, keep it separate until an explicit mapping revision lists it. Do not use fuzzy matching.

## 4. Exact flag mappings

Flags are matched only by key. For all legal or claim-related flags, details quote the detector output as attributed source text; when it asserts a legal conclusion, prefix it with “Automated detector statement, not a verified legal conclusion.” Replace recommendations everywhere (main report, details, and clipboard) with a qualified action asking the firm owner to review wording and supporting evidence. Never imply illegality or that a disclaimer is mandatory.

| flagKey | Title | Why | Next action | Owner | Group | Evidence treatment / conditions |
|---|---|---|---|---|---|---|
| `pre_checked_consent` | Consent starts selected | A data-sharing or consent control appears selected by default. | Ask your website editor to make the choice affirmative and explain what the control covers. | Website editor | none | Report observed control state and location; do not characterize legal status. |
| `manufactured_urgency` | Urgency signal detected | A countdown or scarcity cue was detected. | Ask your website editor to verify the deadline or quantity and remove unsupported urgency. | Firm owner | none | Conditional on the signal being accurate and current. |
| `exit_intent_popup` | Exit pop-up detected | The detector marked an exit-intent pop-up pattern; inspect the evidence before describing behavior. | Ask your website editor whether the prompt is needed and ensure it can be dismissed. | Website editor | none | State only detected behavior. |
| `bandwagon_claim_without_proof` | Number needs a source | A numeric popularity or volume claim lacks visible support in the inspected content. | Ask the firm owner to verify the number and add its source beside the claim if substantiated. | Firm owner | Claim support | Review claim and evidence; no outcome implication. |
| `contrast_failure` | Text contrast needs review | A sampled text/background pair fell below the checker threshold. | Ask your website editor to adjust the sampled colors and recheck the measured pair. | Website editor | Text contrast | Keep ratio, threshold, sample count, and sampled element together. |
| `self_designation_without_proof` | Self-description needs support | A distinction or superlative was detected without a visible basis in the inspected content. | Ask the firm owner to verify the wording and supporting evidence before changing it. | Firm owner | Claim support | Legal/claim review; no assertion that wording is prohibited. |
| `generic_full_service` | Practice focus is broad | The page presents a broad practice list without a clearly named primary focus. | Ask the firm owner which practice focus should lead, then ask your editor to reflect that choice. | Firm owner | none | An editorial observation, not a business-performance claim. |
| `no_author_entity` | Author attribution is unclear | The scan did not find a named author entity for the inspected content. | Ask the firm owner to confirm authorship and credentials before adding a byline or profile markup. | Firm owner | none | Do not invent author identity or credentials. |
| `unattributed_testimonials` | Testimonial attribution is unclear | One or more detected testimonial blocks lack visible attribution. | Ask the firm owner to verify attribution and permission before publishing identifying details. | Firm owner | Testimonial attribution | Preserve quote and observed attribution state; no legal conclusion. |
| `lso_specialist_expert_unearned` | Credential wording needs review | The detector found specialist or expert wording without a matching designation in the inspected text. | Ask the firm owner to review this wording and its supporting evidence before changing the page. | Firm owner | none | Prefix any legal conclusion in source details with the detector caveat. |
| `lso_prohibited_word` | Word choice needs review | The detector matched wording on its configured review list. | Ask the firm owner to review this wording and its supporting evidence before changing the page. | Firm owner | none | This match is not a verified legal conclusion or a finding of violation. |
| `lso_aggressive_framing` | Promotional wording needs review | The detector matched promotional wording configured for review. | Ask the firm owner to review this wording and its supporting evidence before changing the page. | Firm owner | none | Preserve exact quote and detector attribution; no legal conclusion. |
| `possible_outcome_guarantee` | Outcome wording needs review | The detector matched wording that may read as an outcome assurance. | Ask the firm owner to review this wording and its supporting evidence before changing the page. | Firm owner | none | Conditional wording; do not state a guarantee or violation as fact. |
| `color_only_status` | Status needs another cue | The scan detected status communicated by color alone. | Ask your website editor to add a visible text or shape cue and recheck the state. | Website editor | none | Use observed status context; no broader accessibility claim. |
| `bait_reciprocity` | Offer appears after a step | The detector marked a gated-offer pattern; inspect the evidence before describing sequence. | Ask your website editor to show the offer and its conditions before requesting visitor information. | Website editor | none | Describe sequence observed; avoid motive attribution. |

All keys listed above are actual flag keys. Match by key.

## 5. Ordinary finding mappings

Key each row by the exact dimension and label shown. Preserve source branch distinctions: low versus high line length, tight versus loose line-height, and each distinct threshold or measured direction. No shared generic mapping may reverse or erase the branch-specific action. Ordinary findings not listed here use the exact fallback in §2.

| Exact identity (dimension / label) | Title | Why | Next action | Owner | Group | Evidence treatment / condition |
|---|---|---|---|---|---|---|
| Typography and Legibility / Body line length — condition `avg < 45` | Text lines are short | The sampled average is below the checker’s 45–75 character range. | Ask your website editor to widen the text column. | Website editor | none | Retain measured average, sample qualification, and threshold. |
| Typography and Legibility / Body line length — condition `avg > 75` | Text lines are long | The sampled average is above the checker’s 45–75 character range. | Ask your website editor to narrow the text column so lines are easier to track. | Website editor | none | Retain measured average, sample qualification, and threshold. |
| Typography and Legibility / Body line height — condition `avgRatio < 1.2` | Line spacing is tight | Sampled body line-height averages below the 120–145% range. | Ask your website editor to increase body-copy line height, then recheck the rendered text. | Website editor | none | Preserve measured percentage and sample qualification. |
| Typography and Legibility / Body line height — condition `avgRatio > 1.45` | Line spacing is loose | Sampled body line-height averages above the 120–145% range. | Ask your website editor to reduce body-copy line height, then recheck the rendered text. | Website editor | none | Preserve measured percentage and sample qualification. |
| Typography and Legibility / All-caps body copy | Body copy uses capitals | Paragraph-length text is set to uppercase in the inspected sample. | Ask your website editor to reserve uppercase for short labels and use normal case for paragraphs. | Website editor | none | Keep detected paragraph count. |
| Typography and Legibility / Justified text on narrow columns | Narrow text is justified | The scan found fully justified text in a column under 400 pixels wide. | Ask your website editor to use ragged-right alignment in the affected narrow column. | Website editor | none | Preserve affected block count and width qualification. |
| Typography and Legibility / Single H1 (condition `h1Count = 0` or `h1Count > 1`) | Main heading structure needs review | The scan found zero or multiple H1 elements. | Ask your website editor to keep one H1 as the page’s main heading. | Website editor | none | Details state observed H1 count; avoid implying search outcome. |
| Typography and Legibility / No skipped heading levels | Heading levels skip | The inspected heading sequence skips a level. | Ask your website editor to add the missing level or restructure the heading sequence. | Website editor | none | Quote observed sequence in details when available. |
| Color and Contrast / Text contrast | Sampled text contrast is low | A sampled text/background pair falls below the checker threshold. | Ask your website editor to adjust the sampled colors and recheck the measured pair. | Website editor | Text contrast | Keep ratio, threshold, sample count, and sampled element together. |
| Forms and Conversion Flow / Form field count | Form asks for many fields | The detected form exceeds the checker’s field-count guidance. | Ask your firm owner which fields are essential for the immediate next action, then defer others where appropriate. | Firm owner | none | Preserve count and threshold; guidance is not a conversion claim. |
| Forms and Conversion Flow / Field labels | Field labels need review | One or more detected fields rely on placeholder text instead of a persistent label. | Ask your website editor to add a persistent label to each affected field. | Website editor | none | Preserve affected field count when supplied. |
| Forms and Conversion Flow / Required-field markers explained | Required marker is unclear | The scan found a required marker without visible explanation. | Ask your website editor to explain the required marker in visible text. | Website editor | none | Do not claim legal necessity. |
| Mobile and Responsive / Viewport meta tag | Mobile viewport needs review | The viewport setting is missing or does not match device width. | Ask your developer to set the viewport to device width and an initial scale of one. | Developer | none | State observed setting. |
| Mobile and Responsive / Horizontal overflow | Page exceeds viewport width | The scan detected horizontal overflow at the tested mobile width. | Ask your developer to locate the overflowing element and constrain it to the viewport. | Developer | none | Preserve tested width and element if identified. |
| Mobile and Responsive / Tap target size | Tap targets are small | One or more sampled interactive targets fall below the checker’s minimum size. | Ask your website editor to increase padding on the affected links or buttons. | Website editor | none | Preserve measured size, sample count, and threshold. |
| Mobile and Responsive / Hamburger menu label | Menu control needs a name | The detected menu toggle lacks a visible or programmatic name. | Ask your developer to add a visible Menu label or an accessible name. | Developer | none | Describe detected control only. |
| Performance and Technical Health / Largest Contentful Paint (condition `2500 < lcpMs <= 4000`) | Main content loads slowly | The measured load is in the needs-improvement range. | Ask your developer to inspect and optimize the largest above-the-fold element. | Developer | none | Retain measured time and range. Remove the sentence “Conversions fall roughly 7% for every second past 3s.” from displayed and copied text, including details, using one identity-scoped rule; raw observation, score, and API remain unchanged. |
| Performance and Technical Health / Largest Contentful Paint (condition `lcpMs > 4000`) | Main content load needs work | The measured load exceeds the checker’s poor-range threshold. | Ask your developer to compress and preload the largest above-the-fold asset and inspect blocking resources. | Developer | none | Same single identity-scoped sentence removal as above; preserve measured time. |
| Performance and Technical Health / Cumulative Layout Shift (condition `0.1 < cls <= 0.25`) | Layout shifts during load | The measured score is in the needs-improvement range. | Ask your developer to reserve space for images and late-loading content. | Developer | none | Preserve measured score and threshold. |
| Performance and Technical Health / Cumulative Layout Shift (condition `cls > 0.25`) | Layout shift needs work | The measured score exceeds the checker’s poor-range threshold. | Ask your developer to set image dimensions and reserve space for late-loading content. | Developer | none | Preserve measured score and threshold. |
| Performance and Technical Health / Total Blocking Time (condition `200 < tbtMs <= 600`) | Main thread is blocked | The lab measure is elevated during load. | Ask your developer to split long JavaScript tasks and defer non-critical scripts. | Developer | none | Preserve measured duration and its lab-proxy qualification. |
| Performance and Technical Health / Total Blocking Time (condition `tbtMs > 600`) | Main thread blocking is high | The lab measure shows heavy blocking during load. | Ask your developer to defer or remove non-critical JavaScript and split remaining long tasks. | Developer | none | Preserve measured duration; do not equate it with real-user INP. |
| Performance and Technical Health / Logo format | Logo format can improve | The detected logo is not served as SVG. | Ask your developer whether an SVG source is available and suitable for this logo. | Developer | none | Conditional on source and platform support. |
| Performance and Technical Health / Modern image formats | Images can be lighter | Some sampled images use formats outside WebP or AVIF. | Ask your developer to serve suitable images as WebP or AVIF where supported. | Developer | none | Preserve sample count and percentage; avoid blanket conversion. |
| Spacing, Grid, and Alignment (partial: scale adherence only) / Spacing scale adherence | Spacing scale is inconsistent | Sampled spacing values do not consistently follow the measured scale. | Ask your website editor to review the sampled values against one deliberate spacing scale. | Website editor | none | Keep percentage, sample count, distinct off-scale values, and measurement limits together. |
| Authority and Positioning / Meta title and description present (producer branch: missing description) | Page description is missing | The inspected page lacks a meta description. | Ask your website editor to draft a page description that accurately names its focus and location. | Website editor | none | No ranking outcome claim. |
| Authority and Positioning / Meta title and description present (producer branch: generic title) | Page title is generic | The inspected title does not clearly name the practice focus and location. | Ask your website editor to review the title for an accurate practice focus and location. | Website editor | none | Preserve exact title in details. |
| Authority and Positioning / Named focus vs. generic full-service list | Practice focus is broad | Detected practice areas appear equally weighted without a named primary focus. | Ask the firm owner which focus should lead, then ask your editor to reflect that choice. | Firm owner | none | Preserve detected labels; no market or revenue implication. |
| Authority and Positioning / Named author entity present (producer branch: no byline) | Author attribution is missing | No named author entity was detected for the inspected content. | Ask the firm owner to confirm authorship and credentials before adding attribution. | Firm owner | none | Do not invent identity or credentials. |
| Authority and Positioning / Named author entity present (producer branch: unlinked profile) | Author profile is not linked | The detected byline has no linked profile. | Ask the firm owner to confirm a suitable profile, then ask your editor to link it. | Firm owner | none | Preserve detected byline; credentials remain subject to owner verification. |
| Authority and Positioning / Person schema present | Author markup is missing | The scan did not detect Person structured data for the named author. | Ask your developer to confirm the author details and add accurate Person markup if appropriate. | Developer | none | No search outcome claim; confirm source facts first. |
| Authority and Positioning / Review or rating structured data (producer branch: no rating schema) | Review markup is missing | No review or rating structured data was detected. | Ask your developer to review whether accurate structured data is appropriate for this page. | Developer | none | Do not create or infer reviews. |
| Authority and Positioning / Review or rating structured data (producer branch: rating missing reviewCount) | Review count is missing | Rating markup was detected without a review count. | Ask your firm owner to verify the source and count before updating structured data. | Firm owner | none | Preserve observed structured data and source; no aggregate claim. |
| Authority and Positioning / Testimonial attribution | Testimonials need attribution review | Detected testimonial blocks do not all carry visible attribution. | Ask the firm owner to verify attribution and permission before publishing identifying details. | Firm owner | Testimonial attribution | Do not invent identities or matter details. |
| Authority and Positioning / Named credentials or association membership | Credentials need review | The inspected copy does not name a verifiable credential or membership. | Ask the firm owner to confirm credentials and evidence before deciding whether to display them. | Firm owner | none | Not a legal conclusion or a mandatory disclosure. |
| Authority and Positioning / Message consistency across home, about, and service pages | Page messages differ | The inspected page messages are not consistent on the compared themes. | Ask the firm owner to confirm the intended positioning, then review the affected pages. | Firm owner | none | Preserve compared wording; do not infer business outcomes. |
| First Impression and Clarity / Value and audience clear above the fold, one action wins the eye | First view needs clarity | The vision judgment identified an unclear value, audience, or leading action. | Ask your website editor to review the first-screen message and make the intended action clear. | Website editor | none | Quote the model observation with its confidence status; do not claim measured conversion effects. |
| Visual Hierarchy and Composition / Visual hierarchy | Visual hierarchy needs review | The vision judgment identified competing or unclear visual emphasis. | Ask your website editor to review which page element should lead and adjust emphasis accordingly. | Website editor | none | Preserve judgment rationale and confidence status. |
| Visual Hierarchy and Composition / Grid and alignment | Alignment needs review | The vision judgment identified inconsistent alignment or grid use. | Ask your website editor to review the affected alignment against the page’s content structure. | Website editor | none | Preserve judgment rationale and confidence status. |
| Visual Hierarchy and Composition / Composition and whitespace | Composition needs review | The vision judgment identified an imbalance in composition or whitespace. | Ask your website editor to review the affected section’s spacing and grouping. | Website editor | none | Preserve judgment rationale and confidence status. |

| Typography and Legibility / Headline-to-subline contrast | Heading levels look similar | The measured H1-to-H2 size ratio is below the checker threshold. | Ask your website editor to review the size or weight difference between the first two heading levels. | Website editor | none | Keep the measured ratio and threshold together. |
| Authority and Positioning / About or team page linked | About or team link is missing | No matching About or team page link was found in navigation or footer. | Ask the firm owner whether an About or team page exists, then ask your editor to link it. | Firm owner | none | Preserve checked navigation/footer scope. |
| Authority and Positioning / Organization schema present | Organization markup is missing | The scan found no Organization-family structured data. | Ask your developer to confirm the firm details and add accurate markup if appropriate. | Developer | none | Do not invent firm facts or promise search outcomes. |
| Authority and Positioning / Name, address, and phone visible on this page | Contact details need review | The scan found both, either, or neither of a phone number and street address in page text. | Ask your firm owner to confirm the public contact details and ask your editor to show accurate details. | Firm owner | none | Keep detected pair state and page-text scope in details. |
| Authority and Positioning / Legal-information disclaimer present | Legal wording needs review | The detector did not find the searched disclaimer wording in visible page text. | Ask the firm owner to review this wording and its supporting evidence before making a change. | Firm owner | none | Label any detector conclusion “Automated detector statement, not a verified legal conclusion.” Never say a disclaimer is mandatory. |
| Authority and Positioning / HTTPS | Connection security needs review | The scanned page was not served over HTTPS. | Ask your developer to serve the site over HTTPS with a valid certificate. | Developer | none | Preserve observed URL scheme. |
| Authority and Positioning / Naked self-designation claims | Claim wording needs review | The detector found strong-quality wording without adjacent detected proof. | Ask the firm owner to review this wording and its supporting evidence before making a change. | Firm owner | Claim support | Preserve exact quote and detector context; no legal conclusion. |
| Authority and Positioning / LSO Rule 4.2-1: "specialist"/"expert" without the Certified Specialist designation | Credential wording needs review | The detector matched specialist or expert wording without finding the named designation in context. | Ask the firm owner to review this wording and its supporting evidence before making a change. | Firm owner | none | Label source claim “Automated detector statement, not a verified legal conclusion.” Preserve quote/context. |
Branch selectors are predicates over producer evidence, not label suffixes. Every mapping retains the exact emitted base `(dimension, label)`. Body line length: `avg < 45` selects too narrow; `avg > 75` selects too wide. Body line height: `avgRatio < 1.2` selects too tight; `avgRatio > 1.45` selects too loose. Single H1: `h1Count = 0` selects missing H1; `h1Count > 1` selects multiple H1. LCP branches at 2500ms and 4000ms; CLS branches at 0.1 and 0.25; TBT branches at 200ms and 600ms. Meta title and description branches on the producer missing-description versus generic-title condition. Named author entity branches on missing byline versus unlinked profile. Review or rating structured data retains its producer branch. Name, address, and phone visible on this page branches on whether both, either, or neither phone/address were detected.

## 6. Legal and claim honesty

For all legal-related recommendations in main copy, details, and clipboard, use a qualified action: “Ask the firm owner to review this wording and its supporting evidence before making a change.” This applies to `lso_specialist_expert_unearned`, `lso_prohibited_word`, `lso_aggressive_framing`, `possible_outcome_guarantee`, and any ordinary legal/credential claim mapping. Detector statements that sound conclusive must be labeled “Automated detector statement, not a verified legal conclusion.” Keep the original observation separately. No claim of illegality, violation, mandatory disclaimer, or required change.

## 7. Brand and language rules

Use the ACTS V2 brand roles, typography, color tokens, and square geometry as specified in the Brand Book. Do not introduce substitute colors or tokens. The report must remain calm, precise, and evidence-led. Avoid fabricated praise, competitive comparison, guaranteed results, conversion assertions, “best” claims, and unnecessary legal framing. Use “CaseLoad Select” in full where the product is named. No em dash.

## 8. Evidence and confidence treatment

- `best_effort` evidence is “Needs confirmation,” including when copied to clipboard.
- Missing confidence is never “Confirmed.”
- Keep measurements with thresholds, sample size, scope, and qualifications.
- Vision coverage never proves that a vision judgment ran or succeeded.
- Preserve raw observations in the collapsed details, with only the approved LCP sentence removed by the one identity-scoped rule.
- No finding location beyond “Homepage” unless the source explicitly provides a specific location.

## 9. Closed-report rendering and interaction

The closed report remains 200–300 words total, with domain/date/scope, two deterministic assessment sentences, top three stable groups, all grade-limiting flags compactly listed, the current secondary score, and the concise action plan. Provide one native collapsed `<details>` for all raw findings, full qualified recommendations, coverage note, original observations, and projected-grade scenario. Make full detail text copyable; clipboard uses the same qualified mapped copy and the same LCP sentence suppression. No finding disappears.

Keep the existing disclaimer. When `.dc-report` exists, hide the redundant category preview using the narrowly scoped state selector `.dc-main:has(.dc-report) > .dc-categories-preview`; it returns after reset. No new report-state framework or page component.

## 10. Acceptance checks for the implementation phase

1. Unit tests at `src/components/website-design-check/__tests__/report-presentation.test.ts` cover identity matching, unique-label fallback, unmatched flags, branch-sensitive typography, no duplicate group membership, exact fallback, legal qualification in main/details/clipboard, best-effort status, missing confidence, vision coverage variants, projected-grade labeling, and LCP suppression.
2. Browser checks remain in `tests/website-design-check/brand.spec.ts`. Verify standalone and embedded report flows, closed length, details expansion, reset restoring category preview, and unchanged disclaimer.
3. Run existing commands: `npm test`, `npm run lint`, `npm run build`, `npm run test:website-design-check-rendered`; targeted rerun: `npm test -- src/components/website-design-check/__tests__/report-presentation.test.ts`. Do not invent a typecheck script. Wait for all required PR checks after push.
4. No scoring, ranking, or API changes; no deploy, migration, live audit, competitor research, or additional AI calls in this phase.







Implementation clarification: the producer also emits missing-title-only and missing-both metadata observations. Neither equals the specified missing-description branch, so those observations use the exact unmapped fallback until separately mapped. The TBT poor branch is identified by the producer phrase “heavy main-thread blocking”.

Implementation clarification: when multiple listed members form a priority, use one shared group action in the closed report and copied plan; retain each constituent action and observation in details. The Claim support group action is “Ask the firm owner to review the highlighted claims and add supporting evidence where the claims are accurate.”
