# SEO/AEO report validation record

Date: 2026-10-23  
Branch: `codex/seo-lawyer-report-20261023`  
Previous pushed head: `4fd4786c50d1b0373e7a39136d5513478cac13ae`  
Review PR: [#420](https://github.com/adrianosortudo-source/caseload-select/pull/420)

## Live firm matrix

Scans were run in the protected Vercel Preview through the public SEO check flow. No email or contact information was submitted. Scores are bounded observations from each scan, not firm rankings or acceptance targets.

| Domain | Result | Pages checked | Key observed behavior |
| --- | ---: | ---: | --- |
| `sonilaw.ca` | 84/100 | 10 | Homepage correctly shown without an observed `noindex` instruction; four affected page URLs listed separately. |
| `gosailaw.com` | 84/100 | 10 | Homepage separately shown without an observed `noindex` instruction; two checked pages had a `noindex` instruction. |
| `drglaw.ca` | 94/100 | 10 | No observed `noindex`; seven pages prioritized for page-label review and uncertain browser behavior presented as verification. |
| `sakurabalaw.ca` | 85/100 | 10 | Mixed-content observation exposed ambiguous generic HTTPS advice; report copy was corrected to distinguish HTTPS page loads from HTTP subresources. |
| `marathonlaw.ca` | 79/100 | 9 | Nine checked pages stated explicitly; service information review limited to one affected page. |
| `themblawfirm.ca` | Not scored | 0 | HTTP 404 shown as an unavailable-site error; no quality score produced. |

The Soni evidence disclosure listed these four observed page URLs: `/practice/employment-law/`, `/team/`, `/team/thanh-justin-pham/`, and `/team/ummuhani-khaleel/`. Its homepage message remained separate from those page-level instructions. These are scan observations, not confirmation of current search indexing.

## Rendered report checks

The Soni report was opened in the protected preview and checked at CSS widths 1440, 1024, 768, 640, 375 and 320 pixels. The report container remained inside the viewport at each width; document width did not exceed the viewport. The checked computed type roles were Manrope for report headings and DM Sans for report prose. The canonical CaseLoad Select logo appeared in the report header. No in-tool print or PDF controls appeared.

Keyboard-accessible evidence disclosure was opened and read. The report showed the page URLs and the caveat that a `noindex` instruction does not confirm current indexing. The summary also identified the page-check score as a weighted summary for inspected pages, separated AI access observations from scoring, and stated limitations while disclosures were closed.

## Automated validation

- `src/app/api/tools/seo-check/__tests__/report-model.test.ts`: 12/12 tests passed, including the new mixed-content distinction and combined HTTP/mixed-content cases.
- Earlier on the pushed head, the SEO-check and diagnostic-comparison suite passed 323 tests across 22 files.
- Re-running the full suite after the local correction failed before executing tests: 11 Vite worker/setup timeouts loading `tests/vitest.server-only.setup.ts` and `/@vite/env`. This is an environment failure; it is not recorded as a passing run. CI on the pushed head `4fd4786c` showed 14/14 checks successful; the correction still needs its own CI run.
- Local ESLint did not return in a reasonable interval and was stopped. The pushed head had a prior changed-file lint pass; this correction still needs CI lint verification.

## Scope and remaining gates

The crawler and page-selection behavior were not changed. The mixed-content report copy now distinguishes a page fetched over HTTP from HTTP resources found on an HTTPS page, and gives the latter a resource-specific next step. The earlier scan results above reflect the deployed preview before this local wording correction.

This record does not claim a fresh preview build of the correction. Push the correction to the existing review branch, wait for Vercel and CI on the new head, then re-run the Sakura Bala scan to verify the revised live copy. Keep the PR unmerged and do not deploy to production.
