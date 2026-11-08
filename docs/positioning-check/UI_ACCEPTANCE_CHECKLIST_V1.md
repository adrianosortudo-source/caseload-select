# Independent UI acceptance checklist v1

Review the running route at 1440, 1024, 768, 640, 390, 375 and 320 CSS px. Record the actual report-container width, browser viewport, result state, and evidence IDs used. Check complete, partial, error, keyboard-only, expanded-source, direction-choice and copied-brief states. A source-only pass is not rendered acceptance.

## Layout and copy

- At each width, headings, paragraphs, labels, summaries, links, evidence records and directions use the full usable width of their component. The 1100px page shell is an allowed structural frame; do not mistake it for a copy-width limit.
- At 320/375/390/640px, no horizontal page overflow, clipped control, forced word-break, or action track narrowing the supporting copy. The URL input and submit action stack on mobile.
- Inspect natural wraps in every report block, especially statement, long URLs, source text, assessment reasons/uncertainty, direction statement, three implication columns, validation questions, error/partial notices, and metadata. Any block of two or more lines must not end with an avoidable one-word final line. Repair structure first; do not add manual line breaks or arbitrary copy-width caps.
- Complete: all eight element labels, all three supported directions (or an explained abstention), all evidence/source links, and the consultation action remain reachable. Partial: limitations and unavailable screenshot states are visible without implying image assessment. Error: correct message and one retry action only when retryable.
- Verify the visual-claim caveat remains clear, and that no UI implies a measured client-attraction effect, competitive uniqueness, or recognition research.

## Evidence traceability and keyboard use

- Every assessment's source link opens the expanded source area and lands on its matching `evidence-{id}` record. Check the exact excerpt/visible-region description, source URL, capture date, truncation state, and screenshot analyzed state against the mocked packet.
- A screenshot-based visual finding is only shown when its cited screenshot was captured and analyzed. Unavailable, clipped, or unanalysed screenshots are labeled accurately; no image conclusion appears for them.
- Move through URL form, report tabs, expandable assessments, sources, direction choices, copy button, consultation link and return control using keyboard only. Focus is visible at all widths; opening source details does not lose focus or strand the user.
- Tabs expose selected state and correct panel; arrows/Home/End switch and focus the matching tab. Direction choice uses an announced pressed state. Processing, errors and copy feedback are announced without fake progress.
- Check text contrast, button/input boundaries, hover and focus in light and dark system preference. The rendered palette must remain legible in both; no semantic state is conveyed by color alone.

## Current source review notes for Sol

- Source review found that the tab said “The clients you want” and invalid input could leave an old report visible. Sol changed the tab to “Possible directions” and clears the report on invalid submission. Verify both behaviors in the rendered pass.
- The visible positioning statement has no evidence links of its own. Confirm it remains explicitly framed as an interpretation and source records remain easy to reach for its constituent claims.
- Visual CSS is static-only reviewed so far. In particular inspect the three-column implication grid, source link targets, dark-mode contrast, logo scale, and orphan wrapping in the actual rendered report.

Review outcome fields: viewport/state; actual content width; overflow/clipping; orphan observations; keyboard/focus result; contrast; evidence target/result; defect severity; screenshot or reproducible note.

