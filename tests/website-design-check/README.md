# Website checker brand contract

Authority: CaseLoad Select Brand Book V2, chapters 6 through 9 and 11. The website checker is a utility surface. It has no terminal headline square, circular category ornaments, rounded controls, or nested framed findings.

The route-specific stylesheet owns this correction. Its contextual token overrides apply only while the marketing layout contains `.dc-page`; other marketing pages retain their current styling. Manrope is used for headings, DM Sans for prose and form copy, and Oxanium for approved compact numeric, control, and metadata roles. Existing hosted font assets and the bundled DM Sans dependency are reused.

All normal prose is tagged against the component whose actual padding defines its measure. Supporting copy in the report summary has its own full-width row. No manual breaks, nonbreaking spaces, or narrow prose caps are used to manipulate line endings.

Functional exceptions in the three checker source files: `.dc-main` is the page shell, form inputs are controls, `.dc-report-domain` and `.dc-scanning-domain` are public-domain identifiers that may wrap within a long word, and the score pairs/dimension labels are structured numeric comparisons. These are not ordinary paragraph-width exceptions. The unrelated footer email is also a functional identifier, not a prose orphan.

Run `npm run test:website-design-check-rendered`. It covers 1440, 1024, 768, 640, 375, and 320 CSS pixels; initial input, required error, submitted URL, scanning, report, failed-scan retry, reset, and embed mode. The scan response is a synthetic test-only fixture intercepted before any service call. Assertions measure actual fonts, contrast, radii, input containment, full component bounds, and word-line rectangles. Evidence is saved to `test-results/website-design-check-evidence`.

The report checks cover the closed and expanded disclosure, all ranked findings, priority count, closed-report length, individual flag link focus, clipboard success and manual-copy fallback, and restoration after reset. A real iframe host is tested at each listed width, with closed and expanded brand gates and representative host screenshots. Word-rectangle checks include orphan final lines and avoidably short nonfinal lines. Domain identifiers and structured numeric scores remain the only narrow functional exceptions described above.

The category score description list in `src/components/website-design-check/WebsiteDesignCheckReport.tsx` uses category and value as a structured numeric comparison; its score column is a functional exception, The same file represents not-applicable and not-measured category identifiers as structured records. In the same file, unchecked-signal labels are identifiers in description records; their explanations remain governed prose. Ordinary finding, flag, and unchecked-signal prose retains the full available track.
