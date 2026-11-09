# Visual review copy fixture specification

These synthetic fixtures verify status language, evidence boundaries, finding counts, and clipboard text. They are not observations about Complex Family Law or any other real site. Use no network calls or provider submissions; feed fixtures into the existing test harness/model stub only.

For all cases, rendered report order is deterministic status, desktop/mobile screenshots and limitations, supported visual findings, supported strengths, then collapsed **Other automated checks**. Clipboard content is text only and includes status, screenshot references and viewport coverage, each supported finding or the explicit zero-finding outcome, supported strengths when present, and limitations/uncertainty. It contains no image data, annotations, unsupported claims, or invented details.

## Scenarios

### 1. Multiple supported findings

**Synthetic input:** Usable desktop and mobile homepage screenshots; both reviewed across all five visual areas. Desktop capture `cap-desktop` shows a visible navigation hierarchy ambiguity. Mobile capture `cap-mobile` shows a contact action with low prominence relative to surrounding controls. Supply exact visible text only where present in fixture data.

**Expected:** Complete status: `Desktop and mobile screenshots reviewed. 2 visual changes identified.` Exactly two findings, each with its capture ID, viewport, section, element, observable problem, inferred likely consequence, specific property change and intended result, priority, and any needed limitation. Clipboard includes these same evidence-qualified findings and both screenshot references. No generic strengths are required.

### 2. One supported finding

**Synthetic input:** Both usable homepage screenshots reviewed across all five areas; one specific desktop spacing/alignment issue is visible, with no other supported visual issue.

**Expected:** Complete status: `Desktop and mobile screenshots reviewed. 1 visual change identified.` Exactly one evidence-qualified finding. No additional issue is inferred to fill the allowance.

### 3. No supported findings

**Synthetic input:** Both usable homepage screenshots reviewed across all five areas; the fixture contains no specific visual issue.

**Expected:** Exact status sentence: `No specific visual issues identified in these captures.` Zero findings and no fabricated strengths or defects. Clipboard states the zero-finding outcome and identifies both reviewed captures.

### 4. Desktop-only evidence

**Synthetic input:** Usable desktop homepage screenshot; mobile capture unavailable. One specific issue is visible in the desktop image.

**Expected:** Partial status: `Visual assessment is incomplete. 1 visual change identified in the available evidence.` Limitation: `Mobile capture unavailable; desktop capture reviewed.` One desktop-grounded finding only. Do not claim complete review or infer mobile behavior.

### 5. Vision assessment failure

**Synthetic input:** Desktop and mobile images were captured, but the vision assessment fails.

**Expected:** Unavailable status: `Visual assessment unavailable.` Follow with `Captured, not visually assessed.` No visual findings or strengths. Clipboard records screenshot references, that they were captured but not assessed, and the unavailable status.

### 6. Challenge or login page

**Synthetic input:** One or both captures show a challenge or login page, and a normal homepage cannot be confirmed.

**Expected:** Unavailable status: `Visual assessment unavailable.` Follow with `Challenge or login page shown; normal homepage visual assessment was not possible.` Generate no normal homepage findings or strengths. Clipboard preserves the limitation and capture references without implying the page is the homepage.

## Boundary assertions

- Status selection follows the evidence rules in `docs/website-design-check-action-report-spec.md`; complete requires both usable, unclipped homepage captures and review of all five areas.
- The 3 MiB ceiling is measured over the complete serialized JSON response, including base64 image data and all other fields.
- Clipping metadata may describe the known vertical top portion and total page height only. Do not assert a right-edge clip or any other unprovided extent.
- Reject generic claims that line height 170% is bad, that 11 fields are visually overwhelming, or that a raster logo is blurry without supporting screenshot evidence.
- The existing combined score appears only in collapsed details as **Combined automated score**, identified as including content and authority checks. No new score is introduced.
- The existing general model call assesses both captures; no extra pass, retry, or image-processing library is added.
