# Website checker brand contract

Authority: CaseLoad Select Brand Book V2, chapters 6 through 9 and 11. The website checker is a utility surface. It has no terminal headline square, circular category ornaments, rounded controls, or nested framed findings.

The route-specific stylesheet owns this correction. Its contextual token overrides apply only while the marketing layout contains `.dc-page`; other marketing pages retain their current styling. Manrope is used for headings, DM Sans for prose and form copy, and Oxanium for approved compact numeric, control, and metadata roles. Existing hosted font assets and the bundled DM Sans dependency are reused.

All normal prose is tagged against the component whose actual padding defines its measure. Supporting copy in the report summary has its own full-width row. No manual breaks, nonbreaking spaces, or narrow prose caps are used to manipulate line endings.

Functional exceptions in the three checker source files: `.dc-main` is the page shell, form inputs are controls, `.dc-report-domain` and `.dc-scanning-domain` are public-domain identifiers that may wrap within a long word, and the score pairs/dimension labels are structured numeric comparisons. These are not ordinary paragraph-width exceptions. The unrelated footer email is also a functional identifier, not a prose orphan.

Run `npm run test:website-design-check-rendered`. It covers 1440, 1024, 768, 640, 375, and 320 CSS pixels; initial input, required error, submitted URL, scanning, email-access error, report, reset, and embed mode. The scan response is a synthetic test-only fixture intercepted before any service call. Assertions measure actual fonts, contrast, radii, input containment, full component bounds, and word-line rectangles. Evidence is saved to `test-results/website-design-check-evidence`.
