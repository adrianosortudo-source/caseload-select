# SEO checker v3 baseline before methodology changes

Captured 2026-10-28 from clean `origin/main` commit `7e8e072c18745a204608b62a2aa4c5068cbde8f2`, branch `codex/seo-methodology-v4-main-20261028`. This is a baseline record, not a claim that v3 is accurate or supported by all cited guidance. The machine-readable record is [BASELINE-v3.json](BASELINE-v3.json). It hashes the source modules and every available legacy fixture by Git blob ID.

## Evidence state

The current repository has four SEO report JSON fixtures and one calibration panel. The report JSONs preserve findings and category aggregates but do not preserve the raw HTML, response headers, `robots.txt`, or a scan method version. They are historical outputs, not a replayable source corpus. No Soni result fixture was found. No raw page capture is present in the tracked app fixtures or the read-only `fix/seo-check-drglaw-calibration` worktree. The separate marketing `sample-report-source` is a lead brief provenance example, not SEO evidence.

The exact comparison set recorded by the approved plan is:

| Firm | Domain | Available evidence |
|---|---|---|
| Soni Law | `sonilaw.ca` | Domain is recorded in the approved plan; no tracked report or raw capture. |
| Sakura Bala | `sakurabalaw.ca` | July 5 report JSON; 10 page records, 9 unique URLs. |
| Gosai Law | `gosailaw.com` | July 5 report JSON; 10 records, 10 unique URLs. |
| DRG Law | `drglaw.ca` | July report JSON with 10 page records but no aggregate score or grade; the separate 27-entry calibration panel reports 96/A. |
| Marathon Law | `marathonlaw.ca` | July 6 report JSON; 9 records, 9 unique URLs; stored build SHA `9eb2bd7`. |

The four report files have no recorded `methodologyVersion`; three have no build SHA. Their scores must not be treated as a same-method comparison or a current v3 replay. `calibration-panel.json` labels itself method 3, but its DRG entry reports AI Visibility `75/80`, while current `route.ts` emits null AI scores and current `checkAiVisibility()` marks its items unscored. That panel is retained as historical evidence only, not accepted as a current-code baseline. Raw-corpus hash is unavailable because raw HTML was not supplied. Capture remains pending.

## Current score arithmetic in the source tree

- Each scored check has a maximum of 10 points: pass earns 10, warn earns 5, fail earns 0. `scored: false`, `applicability: not-applicable`, and `applicability: unknown` are omitted from the item denominator.
- A page category is the earned points divided by its eligible maximum. The site aggregator averages each category's page ratios over pages with a positive category denominator, then applies the unique-label category denominator. The per-page ratios are equally weighted; the engine does not pool every page-check instance into one site denominator.
- The headline score multiplies each assessed category percentage by its configured relative weight, divides by the sum of active weights, then rounds to the nearest integer. Categories with no eligible checks and categories with weight zero are omitted. AI Visibility has weight zero. The configured Intent Alignment weight is 8; it appears only when operator intent is supplied. Configured weights total 98 with Intent and active public weights total 90 without Intent. They are relative product weights, not percentages.
- Grade bands are A at 90+, A- at 80+, B+ at 70+, B at 60+, C+ at 50+, C at 40+, D at 30+, and F below 30.
- `computeWeightedScore()` returns 0 when no weighted category is eligible. The report model can label an unassessed score as `Not scored`, but the route still returns numeric `overallScore: 0` and a grade field; this needs a compatibility-safe v4 review.
- `ELIGIBILITY_CAPS` defines 35 for `notIndexable`, 50 for `notHttps`, and 60 for `renderingHighRisk`. `deriveEligibilityGates()` and `applyEligibilityCaps()` are tested by `calibration-lock.test.ts`, but `route.ts` does not call them. Therefore these caps do not affect the current serving route's headline score; the old calibration lock applies simulated caps to its stored panel. Do not describe them as active route behavior. Robots-blocking is included in the utility's indexability gate even though a robots block does not prove that a URL is deindexed.
- Route methodology label is v3. The base main branch public route still caps unauthenticated callers at quick/10 pages. The separate public-cap PR #437 is based on this commit and remains a release prerequisite for the landing statement that the check covers up to 25 pages.

## Scored check inventory at baseline

These are the labels produced by the current category builders. They do not yet have stable check IDs or per-check `sourceIds` in `CheckItem`; issue IDs are derived later from category and label. Applicability is adjusted by page type before scoring. The exact predicate, threshold, recommendation, source mapping, and test coverage for each label are not all encoded in a central registry; resolving that is part of the approved methodology work.

| Category | Current checks |
|---|---|
| On-Page SEO (weight 20) | Page title; Meta description; H1 heading; H2 subheadings; Open Graph tags; Image alt text; HTML lang attribute. Title and meta length thresholds remain in code. |
| Indexability (8) | HTTP status; Redirect chain; Indexable; Followable links; Canonical tag; Mixed indexability signals; robots.txt crawl access; Sitemap membership. |
| Schema & Structured Data (16) | JSON-LD structured data; JSON-LD validity; Business / LegalService schema; Business schema fields; FAQPage schema; Review / Rating schema; Breadcrumb schema; Schema conflicts. |
| AI Visibility (0) | AI search bot access; AI training bot control; Attorney / person schema; Author / reviewer signals; Authoritative citations; Direct-answer sentences; Entity description; llms.txt file; Question-format headings; Semantic HTML structure. Current builder marks all items unscored; separate issue copy still needs source alignment. |
| Legal Marketing (16) | Phone number visible; Contact form / direct contact; Consultation call to action; Address / NAP; Trust signals; Practice-area intent; Policy / disclaimer pages. Trust-count thresholds remain in code. |
| Local SEO (12) | Phone number (NAP); Street address (NAP); Google Maps embed; NAP in structured data; Google Business Profile link. |
| Technical & Security (4) | HTTPS; Mixed content; HSTS header; X-Content-Type-Options; Content-Security-Policy; Viewport meta tag; Compression. HSTS, X-Content-Type-Options, and CSP are currently unscored. |
| Rendering & Crawlability (2) | Server-rendered content; JavaScript app-shell dependency; Noscript fallback. These initial-HTML observations are currently scored. |
| Performance (6) | Time to first byte; HTML document size; Render-blocking resources; Third-party scripts. |
| Links & Content (6) | Word count; Heading hierarchy; Internal links; Content-to-HTML ratio; Anchor text quality; External links. Word-count, text-to-HTML, and fixed-link thresholds remain in code. |
| Intent Alignment (8, operator input) | Title alignment; Meta description alignment; H1 alignment; Supporting headings; URL slug; Opening copy; Entity coverage; optional Location modifier; Schema support; Content depth; Internal-link context. It uses phrase/term thresholds and is currently added to the weighted headline score when supplied. |

The `Hreflang annotations` helper is declared in `page-checks.ts` but is not included in `buildPageResult()`'s category list. Dynamic issue construction also creates site-structure and content findings in `analysis.ts`; these issue recommendations are separate from the weighted category formula, but some excluded heuristics can still become first-priority actions. The correction must cover both score contribution and issue ordering.

## Locked changes and unresolved source mapping

The approved plan requires removing word-count/content-to-HTML thresholds, trust quotas, thin-initial-HTML/app-shell penalties, absent optional schema penalties, title/meta length thresholds, fixed internal/external-link counts, and Intent contribution to Website checks. Missing title remains a direct observed check. AI crawler observations remain neutral and outside the score. A passed check cannot imply indexing, ranking, legal compliance, content quality, or AI citation.

The marketing-side source register contains reviewed guidance and clearly pending sources, but the app check contract has no per-check source IDs. The mapping from every retained predicate to a narrow source and evidence type is still pending. In particular, absent schema, quantity thresholds, search-result character lengths, text-to-HTML ratios, testimonials/awards/credentials counts, and initial-HTML app-shell penalties lack a verified source that supports the current numerical penalty. They are locked for exclusion, not waiting for a new justification. Bing guideline text and the Law Society chapter remain marked pending in the source register.

## Baseline tests and next gate

Relevant baseline test files include `engine-core.test.ts`, `page-checks` coverage in `signals.test.ts`, `unscored-items.test.ts`, `security-descore.test.ts`, `rendering-analysis.test.ts`, `intent-analysis.test.ts`, `analysis.test.ts`, `report-model.test.ts`, and `calibration-lock.test.ts`. They have not been run locally in this worktree because `node_modules` was absent; locked `npm ci --prefer-offline` is still running. Do not copy expectations from the historical report JSONs into new tests as correctness evidence. The new raw capture must be saving-disabled, local, restricted to the five manifest domains, preserve current SSRF/robots/time/resource safeguards, and record actual pages, redirects, response metadata, omissions, and stop reason. Partial site evidence remains labeled partial.
