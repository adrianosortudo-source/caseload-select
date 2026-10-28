# Local SEO replay benchmark review

Status: local review artifact for PR #438. This note is intentionally aggregate-only. It contains no firm-specific score rows, page URLs, or copied page content. Raw HTML and the internal URL-to-finding map remain local and must not be published.

## Reproduction and provenance

Replay command: `node --experimental-strip-types scripts/seo-methodology-local-replay.mjs`.

- Baseline source: `7e8e072c18745a204608b62a2aa4c5068cbde8f2` (`origin/main` v3).
- Capture and candidate v4 scoring source: the relevant scoring modules are unchanged through the public harness commit `5c5168a791b490a81be386e06810278c6bf6ce2e`. The exact pre-capture source fingerprint is retained in local-only capture metadata.
- Capture harness SHA-256: `7f68ec618aced4b62fa61069a4519fb84e32034b197108a4202434483ddf4e78`.
- Local replay runner SHA-256: `753b69c213730880d4074a094cfc6c6ff1340e6f7f7ccb79dd51476e6e923b93`.
- Sanitized replay artifact SHA-256: `2b1713c0ee1e2a6dbe869ac08d5cbe8818e29319e0dab8be119ccbdc1e7e2c91` (`.local-methodology-replay/replay-results.json`).
- Internal finding-to-page URL map SHA-256: `60abac1ff5385fbca1934938032acdef81892399cf43b2abb56bb7cf92347f0a` (`.local-methodology-replay/finding-review-internal.json`; local only).

The runner invokes the exact pure `buildPageResult`, `aggregateCategories`, weighted-score, `computeTopFixes`, and issue-builder modules from baseline and candidate source. Replay made no network requests and used identical captured HTML, status/headers, robots/llms text, sitemap membership, redirect count, and timing values for both versions. Candidate page checks run against the immutable source snapshot used for the capture; its exact fingerprint remains in local-only capture metadata. All five manifests, page files, available resource files, recorded source/harness SHA values, page-set hashes, corpus hashes, and coverage counters validated with zero integrity errors.

## Nested replay results

These are ranges across five approved domains, using actual unique final destinations after deduplicating response records that redirected to the same final URL. The smaller Marathon corpus contributes its actual nine pages at every requested limit; it is not padded.

| Requested prefix | Response records | Unique final destinations | v3 score range | Candidate v4 score range |
|---|---:|---:|---:|---:|
| 10 | 49 | 49 | 79–94 | 97–100 |
| 25 | 109 | 108 | 79–93 | 98–100 |
| 50 | 209 | 184 | 79–94 | 99–100 |

At the 50-response prefix, two duplicate-final-URL groups account for 25 redundant response records: one group contains 25 requested records (24 redirect responses) to one final destination; the other contains two requested records (one redirect) to one final destination. Each group has identical final HTML hashes. Across the five captures, there were 302 logged GET request attempts, 24,881,719 decoded response bytes, 5,673,101 wire bytes, and 105,612 ms summed capture elapsed time. These totals span five separately bounded captures.

The score change must not be presented as an improvement. The v3 replay has nine active categories and a 90-unit relative-weight denominator. Candidate v4 has exactly five scored check types (Page title, HTTP status, Indexable, robots.txt crawl access, HTTPS) across three of ten categories (On-Page SEO, Indexability, Technical & Security), a 32-unit relative-weight denominator. That is 245, 540, and 920 page-check instances across the 10, 25, and 50 prefixes respectively. The remaining categories are observations or unscored. The visible report should expose this restricted denominator beside the score.

The candidate noindex action in `src/app/api/tools/seo-check/report-model.ts` states the observed count out of checked pages, explains that some exclusions are intentional, and asks the owner to confirm which pages should appear before asking a provider to review settings. It does not recommend blanket removal.

## First-priority finding review

Twenty-eight distinct first-five findings across the baseline and candidate outputs were checked against captured initial HTML and response headers: 3 supported observations, 20 overclaimed implications/actions, 5 not assessable as stated, and 0 confirmed false positives. A supported noindex observation means the directive was present; the scan cannot establish owner intent or current indexing. Header observations describe response headers only. Structured-data and content heuristics describe inspected initial HTML only. Absence claims cannot establish absence across the whole site. Browser-rendered visibility, actual resource loading, ranking effects, conversion effects, and AI citation were not verified.

The baseline site-structure heuristic builder was not replayed because the capture does not retain all route discovery URL identities required to reproduce its absence-confidence inputs. Candidate v4 excludes those bounded-crawl absence claims from current route findings. No statistical accuracy claim is made.

## Validation limits

The focused Vitest command was attempted but failed before test collection because the local `caniuse-lite` installation is incomplete (`../lib/statuses` missing through PostCSS/Autoprefixer). CI must run the new report-model and component tests. Rendered-copy review at 1440, 1024, 768, 640, 375, and 320 CSS pixels is still pending; no rendered visibility claim is made here.
