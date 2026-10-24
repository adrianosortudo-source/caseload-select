# SEO/AEO report validation record

Date: 2026-10-24  
Branch: `codex/seo-lawyer-report-20261023`  
Validated pushed head: `4f17c9578fa785cc1b4a5a4e536651301de73269`  
Review PR: [#420](https://github.com/adrianosortudo-source/caseload-select/pull/420)

## Live firm checks

Scans ran through the protected Vercel Preview using the public SEO check flow. No email or contact information was submitted. Scores are bounded observations from each scan, not firm rankings or acceptance targets.

| Domain | Result | Pages checked | Observed evidence |
| --- | ---: | ---: | --- |
| `sonilaw.ca` | 84/100 | 10 | Homepage separately shown without an observed `noindex` instruction; four checked page URLs with page-level `noindex` are identified. |
| `gosailaw.com` | 84/100 | 10 | Homepage separately shown without an observed `noindex`; two checked pages had a `noindex` instruction. |
| `drglaw.ca` | 94/100 | 10 | No observed `noindex`; seven pages prioritized for page-label review and uncertain browser behavior is presented as something to verify. |
| `sakurabalaw.ca` | 85/100 | 10 | All ten checked pages loaded over HTTPS; one or more HTTP resources were observed and described as mixed content with a resource-specific next step. |
| `marathonlaw.ca` | 79/100 | 9 | The report states nine checked pages; service-information review is limited to the affected page. |
| `themblawfirm.ca` | Not scored | 0 | HTTP 404 shown as an unavailable-site error; no quality score produced. |

The Soni evidence disclosure listed four observed page URLs: `/practice/employment-law/`, `/team/`, `/team/thanh-justin-pham/`, and `/team/ummuhani-khaleel/`. Its homepage message remained separate from those page-level instructions. These observations do not confirm current search indexing.

## Lawyer-facing report and page checks

The Soni report was reviewed in the protected preview and checked at CSS widths 1440, 1024, 768, 640, 375 and 320 pixels. At each emulated width, the document width stayed within the viewport. The report used the CaseLoad Select logo, Manrope headings and DM Sans prose. Evidence details were keyboard-accessible and stated that a `noindex` instruction is not confirmation of current indexing. The report labels its result as Website checks, explains the inspected-page basis and limits, and does not grade AI visibility or predict citations.

## Tool-page copy

The latest preview identifies the tool as Law Firm SEO Check. Its introduction says it checks public website signals across up to ten pages, identifies affected pages, explains why observations may matter and gives general next steps. It explicitly says AI observations are not a visibility grade or citation prediction. The supporting stat and check categories reflect ten weighted categories instead of the retired 70+ / nine-category claim.

Responsive measurements at CSS widths 1440, 1024, 768, 640, 375 and 320 pixels showed no horizontal document overflow. The hero and form copy fit their available content areas; the section’s internal side padding accounts for the difference between section width and text width.

## Automated and preview validation

- Targeted report-model suite: 12/12 tests passed, including HTTPS-page/HTTP-resource distinctions and combined HTTP-page/mixed-content cases.
- SEO-check and diagnostic-comparison suite: 323 tests passed across 22 files on the preceding implementation head.
- On validated head `4f17c957`, full Vitest suite, TypeScript typecheck, ESLint, render-service tests/typecheck, rendered-copy gates, DR-039 language parity, engine sync, render parity and self-contained build-assets checks completed successfully.
- Vercel Preview checks for both `caseload-select` and `caseload-render` passed on `4f17c957`.
- A repository-wide real-Postgres/browser acceptance job was still in progress at the time of this record; it exercises unrelated publication/prospect-enrichment surfaces. Confirm its final result in GitHub before treating all repository checks as complete.
- Two Vercel preview scans on the implementation head confirmed the Soni and Sakura report findings above. Live firm results are examples of observed behavior, not a full manual SEO audit.

## Scope

Crawler behavior and page selection were preserved. The report corrects score interpretation and misleading findings, provides affected-URL evidence, plain-language context, priority and general next steps, and clarifies the limits of the scan. No in-tool print/PDF export controls were added; the user may print the on-screen report using the browser.

The PR remains for review. Do not merge or deploy to production as part of this work.
