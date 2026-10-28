# SEO methodology v4 implementation status

Branch: `codex/seo-methodology-v4-main-20261028`
Base: `origin/main` at `7e8e072c18745a204608b62a2aa4c5068cbde8f2`
Method label in candidate route: v4
Status: review candidate; not merged or deployed.

## Score and check evidence

- A page check carries a stable ID, source IDs, evidence type, applicability, coverage, disposition, and basis. Stable labels are registered in `src/app/api/tools/seo-check/methodology-sources.ts`.
- Missing page title remains an eligible observation and maps to Google Search Central title-link guidance G13. Title and meta-description length limits are excluded.
- Known v4 exclusions are explicitly `unscored` and describe that they do not enter the score denominator or automatic action lists. A source-to-predicate mapping that has not been resolved is `pending-review`; it is also unscored. AI observations, optional schema, text quantity, trust counts, address signals, and initial-HTML rendering signals cannot lower the v4 score or generate automatic actions.
- Aggregation averages each category's eligible page ratios over pages with a positive category denominator. It then applies relative category weights, normalized over categories that have eligible checks. The route returns `overallScore: null` and grade `Not assessed` if the active denominator is empty.
- Scoreless results remain representable in operator summary types, report UI, and saved scan rows. Both existing Supabase `overall_score` columns are nullable and constrain non-null values to 0–100; the row builder preserves null.
- Saved v3 and unversioned reports keep their historical stored scores. The v4 report model does not silently recalculate them.

## Coverage contract

Coverage distinguishes attempted, successful, failed, and skipped pages. `skippedPages` sums URL/page skip reasons; sitemap truncation is reported separately as `sitemapIncomplete`, not counted as a skipped page. `pageSetHash` is SHA-256 over sorted normalized URL identities, not page contents or response bytes. The response leaves `totalSitePages` null because discovery is bounded and does not establish a complete site inventory.

## Corpus and validation status

The immutable [`BASELINE-v3.md`](BASELINE-v3.md) and JSON record the source arithmetic, four historical result JSONs, and the missing raw corpus. The exact approved comparison domains are Soni Law (`sonilaw.ca`), Sakura Bala (`sakurabalaw.ca`), Gosai Law (`gosailaw.com`), DRG Law (`drglaw.ca`), and Marathon Law (`marathonlaw.ca`). Available evidence consists of historical report JSONs for Sakura Bala, Gosai Law, DRG Law, and Marathon Law; no Soni report fixture or raw HTML/header/robots capture was found. Those JSONs are historical summaries, not replayable source evidence.

No bounded capture has run. A saving-disabled fixed-domain capture/replay harness is not ready in this branch, so the five-firm benchmark remains pending; no page evidence or comparative score has been fabricated. Local Vitest, typecheck, and build were not run because the stopped dependency installation did not provide the test/build binaries. CI is required for those checks. Static Git whitespace and source-contract checks will be recorded in the PR after they run.
