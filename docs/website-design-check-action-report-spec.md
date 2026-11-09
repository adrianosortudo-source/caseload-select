# Website design checker visual report specification

## Purpose and scope

This specification corrects the action report hierarchy so screenshot-grounded visual assessment is the primary user-facing result. The previous report led with authority and legal checks; those checks remain available under **Other automated checks**. This document defines report copy and behavior, not a new scoring system or additional model workflow.

## Required report order

1. Deterministic visual assessment status and its exact status sentence.
2. Desktop and mobile screenshots, with capture and assessment limitations.
3. Zero to three specific visual findings supported by the screenshots.
4. Zero to two strengths supported by the screenshots.
5. A collapsed **Other automated checks** section containing existing automated checks, including authority, legal, content, and related checks.

Place the existing mixed score in the collapsed details and label it **Combined automated score**. Explain that it includes content and authority checks. Do not create a new score or present the combined score as a visual-only score.

Assess these five areas: hierarchy; typography and readability; colour and apparent contrast; spacing and alignment; mobile and contact prominence.

## Status determination and exact copy

Use exactly one status sentence below. Insert the count phrase for the supported visual finding count; it is not a target count.

- **Complete, one finding:** `Desktop and mobile screenshots reviewed. 1 visual change identified.`
- **Complete, multiple findings:** `Desktop and mobile screenshots reviewed. {N} visual changes identified.` For `{N}` greater than 1.
- **Complete, no findings:** `No specific visual issues identified in these captures.`
- **Partial, one finding:** `Visual assessment is incomplete. 1 visual change identified in the available evidence.`
- **Partial, multiple findings:** `Visual assessment is incomplete. {N} visual changes identified in the available evidence.` For `{N}` greater than 1.
- **Unavailable:** `Visual assessment unavailable.`

Complete requires both usable desktop and mobile homepage images to have been visually reviewed across all five areas, with neither image clipped. Partial applies when valid visual assessment is possible for only some available evidence, including when one viewport is missing or an image is clipped. Unavailable applies when no valid homepage visual assessment can be made.

Follow the status sentence with a concise, evidence-specific limitation whenever a capture or assessment is incomplete. Examples:

- Missing mobile capture: `Mobile capture unavailable; desktop capture reviewed.`
- Known vertical clipping: `Screenshot shows the top {visibleTopPortion} of a {totalHeight}px-tall page; content below the captured portion was not assessed.` Use only known metadata and units supplied by the capture. Do not infer a clipped edge or unseen page content.
- Vision failure after captures: `Captured, not visually assessed.`
- Challenge or login page: `Challenge or login page shown; normal homepage visual assessment was not possible.`
- Error or uncertain page identity: state that the captured page could not be confirmed as the normal homepage and that normal homepage findings were not generated.

If required schema is missing, vision assessment fails, or a challenge, login, error, or uncertain page prevents a normal homepage assessment, do not produce normal homepage findings. Use unavailable status when no valid visual assessment remains. If another viewport still supports valid assessment, use partial status and describe the unavailable evidence.

## Capture and model constraints

- Extend the existing general model call to assess the existing desktop and mobile captures. Do not add model passes or retries.
- Each image is at most 1 MiB encoded. Preserve an original PNG when it fits; otherwise use one JPEG at quality 82. Preserve image dimensions.
- The 3 MiB limit applies to the entire serialized JSON response, including base64 image data and all other JSON fields. Do not treat it as a combined-image-only limit.
- Use the same final images for model assessment and browser display.
- Present screenshots readably inline. Do not add annotations, heatmaps, or a new image library.

## Finding contract

Each finding includes:

- Capture ID and viewport.
- Page section and element.
- Exact visible text when relevant.
- The observable screenshot-grounded problem.
- The likely consequence, explicitly framed as an inference.
- A specific property of the element to change and the intended visible result.
- High or medium priority.
- A limitation when needed to interpret the evidence.

Return at most three findings, with no minimum count. Do not force findings to fill the allowance. Do not include generic positives as findings. Do not claim unsupported pixel values, measured contrast ratios, or conversion effects. Apparent contrast may be described only as an observation from the supplied image, not as a measured compliance result.

Strengths are limited to two and must point to specific visible evidence. Omit strengths when none are useful and supported.

## Copy and visual presentation

Clipboard output is text only. Include status, screenshot references, coverage, supported strengths and findings, and limitations or uncertainty. Do not copy images or annotations and do not imply knowledge of unseen content.

Use the approved utility-surface typography and geometry: Manrope headings, DM Sans body text, square flat geometry, and full-width text within its component padding. Keep screenshot displays readable without modifying them.

## Explicit exclusions

- Do not apply a generic rule that **line height 170% is bad**. Assess the observed text in context and identify a specific visible readability or layout problem before proposing a change.
- Do not treat **11 fields** as visually overwhelming based on field count alone. A claim requires screenshot evidence of a specific visual problem.
- Do not call a raster logo blurry without supporting visual evidence in the supplied capture.
- Do not invent defects for Complex Family Law. Synthetic scenarios in the adjacent fixture specification are test cases only, not assertions about that site.

## Screenshot viewer geometry

In `WebsiteDesignCheckReport.tsx` and its route stylesheet, `.dc-capture-preview` provides a labeled top-of-image preview. `.dc-capture-scroll` is a structural image viewer limited to 70vh with native scrolling at the captured image dimensions. This restriction applies only to image inspection; report prose uses its full component content width.

## Evidence acceptance learned from the live sample

Tentative conditions in the observation field do not qualify as action-list defects; possible consequences remain explicitly inferential. Link, icon and field counts alone do not establish a visual problem. Text-contrast findings require an exact, unique text-sample match with a checkable failing measurement from the existing scorer. A passing, transparent-background, missing or unmatched sample cannot corroborate that claim. Unverified colour claims are omitted and the affected colour-contrast coverage is disclosed as unavailable. No scoring formula or extra model pass is introduced.

Capture limits use separate full-width rows. `.dc-capture-areas` is a compact category-coverage record, with no prose width cap. Clipboard output names each viewport before its coverage and limitation rows.
