# SEO Tool Trust-Fix Pass v1 (execution plan)

Status: READY FOR EXECUTION
Date authored: 2026-07-06
Authored by: Opus 4.8 session (five-site adversarial calibration arc)
Executor: Sonnet 5
Approver: Adriano (operator). Scope approved verbatim in session, with three refinements folded in below.

## Objective

Make the SEO and AI Visibility check's scores and recommendations trustworthy. The tool must never recommend markup that cannot work, never award score points for signals with no established search benefit, and never let security hygiene imply search-visibility gains.

## Hard acceptance criterion (operator-authored, verbatim)

> After recalibration, no site's SEO or AEO Readiness grade may improve merely because security headers, `llms.txt`, FAQ schema, or self-serving review schema are present. Each score must expose its contributing checks and weights.

Every work item below serves this criterion. Do not ship until the criterion-tests in Work Item 8 pass.

## Context you need before touching anything

The tool lives at `src/app/api/tools/seo-check/` in this repo (`caseload-select-app`). It has been through five adversarial field calibrations (preszlerlaw.com, jsmlaw.ca, chaabanelaw.com, ganganilaw.com, rozekandco.com), each of which produced fixes pinned by regression tests. Read these files first, in this order:

1. `src/app/api/tools/seo-check/engine-core.ts` (pure primitives: scoring, URL logic, robots, WP-default detection)
2. `src/app/api/tools/seo-check/route.ts` (crawl loop, per-page checks, category builders)
3. `src/app/api/tools/seo-check/analysis.ts` (buildIssues, severity model, site-structure findings)
4. `src/app/api/tools/seo-check/__tests__/calibration.test.ts` (the field-audit regression corpus; understand what it pins)
5. `src/components/seo-check/SeoReport.tsx` and `src/app/api/tools/seo-check/report-pdf.tsx` (the two report surfaces)

### Current scoring architecture (as of commit ac2369c)

- Per-item: `scoreItems()` at `engine-core.ts:554`. pass = 10, warn = 5, fail = 0. Uniform across every check.
- Per-category to overall: `computeWeightedScore()` at `engine-core.ts:581` using `CATEGORY_WEIGHTS` at `engine-core.ts:135` (On-Page SEO 22, Indexability 18, AI Visibility 14, Legal Marketing 12, Schema 10, Local SEO 8, Technical & Security 8, Intent 8, Rendering 6, Performance 4, Links & Content 4).
- AI Search score: `aiScoresFromItems()` in engine-core.ts averages every AI Visibility item except "AI training bot control" (which feeds the separate policy score).
- Issues list: `buildIssues()` in analysis.ts aggregates non-pass items across pages; `severityFor()` at `analysis.ts:366` maps label to severity via `LABEL_SEVERITY` and `CATEGORY_FAIL_SEVERITY`.

## Environment gotchas (all learned the hard way; do not rediscover)

1. **Brand-voice hook** (`.claude/hooks/check-banned-vocab.mjs` at project root `D:\00_Work\01_CaseLoad_Select`) blocks any Write/Edit containing an em dash or a word from the banned-vocabulary list in the master `CLAUDE.md` ("Writing" rules section). The block applies INSIDE code comments, string literals, and regex literals, and inline code spans are NOT exempt (only fenced code blocks are). If a regex needs an em dash character, use `String.fromCharCode(0x2014)` or drop the character from the class. Read the master CLAUDE.md banned list before writing any copy.
2. **Website-boundary hook** blocks edits under `src/app/(marketing)/`. The SEO tool components were deliberately relocated to `src/components/seo-check/` so you never need to touch the marketing tree. If a change seems to require editing `(marketing)/`, stop: you are editing the wrong file.
3. **Parallel sessions are active in this repo.** `git status` will show uncommitted files you did not create (content-studio, AdminShell, migration deletions). NEVER `git add -A`. Stage only the exact files you edited, by path. Before pushing, `git log --oneline -3` to see if HEAD moved under you; rebase is usually unnecessary because your files are disjoint from theirs.
4. **`report-pdf.test.ts` is slow and flaky under machine load** (variable-font PDF render, 10 to 60 seconds). It is not affected by scoring changes. Run the suite with `--exclude '**/report-pdf.test.ts'` for iteration; run it once at the end with `--testTimeout=90000` and accept a pass of the other 2 tests if the heavy one times out under load.
5. **`server-only` imports break vitest.** Any test importing from `route.ts` must stub: `vi.mock("server-only", () => ({}))`, `vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: {} }))`, `vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: async () => null }))`. See `__tests__/schema-conflict.test.ts` for the working pattern.
6. **Deploys:** push to `main` triggers Vercel (the "Bypassed rule violations" remote message is normal). Build takes about 3 minutes. Verify on prod via the `buildSha` field in the API response: `curl -s -X POST https://app.caseloadselect.ca/api/tools/seo-check -H "Content-Type: application/json" -d '{"domain":"rozekandco.com"}'`. Unauthenticated calls are downgraded to quick/10-page scans; that is expected and sufficient for verification.
7. **Windows/Git Bash:** `/tmp` paths break `node -e 'require(...)'` (it resolves to `C:\tmp`). Write temp JSON to the session scratchpad directory and pass absolute `C:/...` paths to node via `process.argv`.
8. **LF/CRLF warnings on commit are harmless.** Ignore them.
9. **CLAUDE.md quality gate applies:** run `npx tsc --noEmit` (must be clean for seo-check files; ignore pre-existing errors in files other sessions own) and the test suite before every commit.

## Design decisions (made; do not re-litigate)

**D-A. Unscored mechanism.** Add an optional `scored?: boolean` field to `CheckItem` (in `engine-core.ts`, where `CheckItem` is defined). Semantics: `scored: false` means the item is displayed, still generates an issues-list finding via `buildIssues`, but contributes NOTHING to `scoreItems` (excluded from both `score` and `maxScore`, so its absence never drags a category down and its presence never lifts one) and NOTHING to `aiScoresFromItems`. Default (field absent) = scored. This one mechanism implements refinements 1, 2, and 3.

**D-B. Security stays one category, headers become unscored.** Do NOT create a new category (that would ripple through CATEGORY_WEIGHTS, the UI category list, the PDF, and every fixture). Inside `checkTechnicalSecurity`, mark CSP, HSTS, and X-Content-Type-Options items `scored: false`. HTTPS and Mixed content remain scored: they directly affect accessibility and search eligibility (operator refinement 3). The category score then reflects only HTTPS + mixed content. The findings remain fully visible in the issues list with their existing field-calibrated severities.

**D-C. FAQPage schema is unscored, both directions.** Presence is not a win (Google restricted FAQ rich results to government and health sites in August 2023); absence is not a defect. Visible Q&A quality is ALREADY scored by the existing "Question-format headings" and "Direct-answer sentences" checks; do not add a new check for it.

**D-D. Review schema polarity flips, unscored both directions.** Absence is neutral (it was a warn with an "add review schema" fix, which is wrong advice). Presence becomes the flag: self-serving review markup on a LocalBusiness or Organization is ineligible for Google review stars, and is potentially misleading if the markup does not match visible reviews. Precision matters (operator refinement 2): presence is NOT automatically manipulative; the finding language is "ineligible for review snippets" plus "verify it matches visible reviews," not an accusation. Neither direction moves any score.

**D-E. llms.txt is unscored, framed experimental.** Keep detection and display. Copy states no established visibility benefit.

**D-F. Score label rename only.** "AI Search" becomes "AEO Readiness" on report surfaces. The product name ("SEO and AI Visibility Check/Audit"), API field names (`aiSearchScore`, `aiSearchGrade`), and DB columns DO NOT change (saved runs and the save-run row shape depend on them).

**D-G. Impact-aware scoring is scoped to the placeholder gate.** A full per-item impact-weight system would re-grade the entire corpus and is deferred. What ships now: the placeholder-class severity gate specified in Work Item 7. The existing category weights plus the unscored mechanism plus the placeholder gate together satisfy the acceptance criterion.

**D-H. Score transparency.** The API response gains a `scoring` object: `{ categoryWeights: <the CATEGORY_WEIGHTS map used>, unscoredLabels: string[], note: string }`. Each serialized CheckItem already flows to the client inside `pages[].categories[].items`; the new `scored: false` flags ride along automatically. UI: render a small "unscored" tag next to informational items in SeoReport.tsx. PDF: one methodology line in the footer block listing unscored checks.

## Work items (execute in order; each has a test gate)

### WI-1. The `scored` flag mechanism

Files: `engine-core.ts`.

1. Add `scored?: boolean` to the `CheckItem` interface.
2. `scoreItems()` (engine-core.ts:554): skip items with `scored === false` entirely (they contribute to neither `score` nor `maxScore`). Guard: if ALL items in a category are unscored, return `{ score: 0, maxScore: 0 }` and make sure `computeWeightedScore` already tolerates `maxScore === 0` (it computes `score / maxScore` only when `maxScore > 0`; verify and keep that behavior).
3. `aiScoresFromItems()`: exclude `scored === false` items from the `searchItems` set. The policy score path ("AI training bot control") is unaffected.

Test gate (new file `__tests__/unscored-items.test.ts`, pure engine-core imports, no mocks needed):
- A category of [pass(scored), warn(unscored)] scores 10/10, not 15/20.
- A category of [pass(scored), fail(unscored)] scores 10/10.
- Two categories identical except one has an extra unscored pass item produce identical `computeWeightedScore` results.
- `aiScoresFromItems` returns the same search score with and without an unscored item present.

### WI-2. Review schema correction (highest-priority copy fix)

Files: `route.ts` (checkSchemaMarkup, lines ~688-693), `analysis.ts` (LABEL_SEVERITY if "Review / Rating schema" has an entry; check and adjust).

Replace the current pair:

```ts
// CURRENT (wrong: recommends ineligible markup as a win)
items.push({ label: "Review / Rating schema", status: "pass", detail: "Review markup found. Supports star-rating readiness in search results." });
items.push({ label: "Review / Rating schema", status: "warn", detail: "Not found. Review schema can support star ratings in search results.", fix: "Add AggregateRating or Review schema for your client testimonials." });
```

With (exact copy, follows operator refinement 2):

```ts
// Presence is the flag: Google rules self-serving reviews on a LocalBusiness
// or Organization ineligible for review stars, so this markup cannot earn the
// snippet on a law-firm site and reads as misleading when it does not match
// reviews visible on the page. Absence is neutral, never a recommendation.
// Unscored in both directions.
if (schema.hasReview) {
  items.push({ label: "Review / Rating schema", status: "warn", scored: false, detail: "Present. Self-serving review markup on a firm's own site is ineligible for Google review stars, and can read as misleading if it does not match reviews visible on the page.", fix: "Verify the markup mirrors real, visible client reviews. Do not expect star snippets from it; Google excludes self-serving reviews for LocalBusiness and Organization entities." });
} else {
  items.push({ label: "Review / Rating schema", status: "pass", scored: false, detail: "Not present. Not recommended for a firm's own site: self-serving review markup is ineligible for Google review stars. Visible client testimonials and Google Business Profile reviews are what count." });
}
```

Also sweep: `grep -rn "AggregateRating or Review schema" src/` and remove every remaining "add review schema" recommendation (the PDF and issues list inherit `fix` from the item, so the item rewrite covers them, but verify nothing else hardcodes it).

Severity: with presence now a warn, `buildIssues` will emit a finding when markup exists. In `analysis.ts`, ensure the label maps to `low` severity and add "Review / Rating schema" to the audit-note "Verify manually" class if `audit-notes.ts` classifies by label (check `classifyAuditNote` and wire accordingly).

Test gate (extend `__tests__/schema-conflict.test.ts` or new `__tests__/schema-recs.test.ts`):
- A page with AggregateRating markup yields the presence-warn item, `scored: false`, and its fix text contains "ineligible".
- A page without review markup yields the neutral item and NO fix text recommending markup be added.
- Category score identical in both cases.

### WI-3. FAQPage schema reframe

Files: `route.ts` (checkSchemaMarkup, lines ~682-687).

Replace the pair with unscored versions:

```ts
if (schema.hasFaq) {
  items.push({ label: "FAQPage schema", status: "pass", scored: false, detail: "Present. Informational only: Google limits FAQ rich results to government and health sites, so the markup itself is not scored. Visible question-and-answer content is what the audit scores." });
} else {
  items.push({ label: "FAQPage schema", status: "pass", scored: false, detail: "Not present. Optional markup with no established rich-result benefit for law firms. Visible question-and-answer content is what the audit scores (see Question-format headings and Direct-answer sentences)." });
}
```

Note: absence becomes status `pass` (neutral) so no issues-list finding fires for missing FAQPage markup. The old warn generated a Medium "FAQPage schema: Not found" finding on every audited site; that finding disappears entirely, by design.

Test gate: page without FAQ markup produces no "FAQPage schema" entry in `buildIssues` output; category score unchanged by presence/absence.

### WI-4. llms.txt experimental and unscored

Files: `route.ts` (checkAiVisibility, lines ~795-799).

```ts
if (llmsTxt && llmsTxt.length > 50) {
  items.push({ label: "llms.txt file", status: "pass", scored: false, detail: "Present. Experimental: no major search or AI-visibility benefit has been established for this file. Harmless to keep." });
} else {
  items.push({ label: "llms.txt file", status: "pass", scored: false, detail: "Not present. Experimental, optional file. No established visibility benefit; not scored and not a recommendation." });
}
```

Both directions are neutral `pass` so no issue fires and the AI score no longer moves on it (WI-1 excludes it from `aiScoresFromItems` regardless, via the flag).

Test gate: `aiScoresFromItems` identical with llms.txt present vs absent; no "llms.txt file" issue in `buildIssues` output either way.

### WI-5. Security header descore

Files: `route.ts` (checkTechnicalSecurity, lines ~915-945 region).

Add `scored: false` to the CSP item, all HSTS items (missing, present-but-low-max-age, and the pass), and both X-Content-Type-Options items. Leave HTTPS and Mixed content items untouched (still scored). Update each header item's detail to close with: "Security hygiene; shown for completeness and excluded from the SEO score."

The issues-list findings for missing CSP/HSTS/XCTO keep firing with their existing severities (the field-calibrated HSTS low-max-age cap from marathonlaw stays as is). Only the grade contribution changes.

Test gate (new `__tests__/security-descore.test.ts` or fold into unscored-items.test.ts):
- Two otherwise-identical synthetic pages, one with all three headers present and one with none, produce IDENTICAL "Technical & Security" category scores and identical `computeWeightedScore` results.
- Both still produce the CSP/HSTS/XCTO findings in `buildIssues` when headers are absent.

### WI-6. Evidence-bounded AI copy + AEO Readiness label

Files: `route.ts`, `SeoReport.tsx`, `report-pdf.tsx`.

Copy sweep in `route.ts`. Run `grep -n "AI models\|AI systems\|AI search systems\|bots cite" src/app/api/tools/seo-check/route.ts` and rewrite every categorical claim to bounded language. Required rewrites (keep labels, statuses, and fix intents; only the claim language changes):

| Location (approx) | Current claim | Replacement |
|---|---|---|
| route.ts:754 | "AI systems weight identified, credentialed authors." | "Identified, credentialed authors are consistent with published guidance for consequential legal content." |
| route.ts:763 | "These match how people ask AI assistants." | "Matches question-style queries; may support answer extraction." |
| route.ts:765 | "More can help AI systems pull answers from the page." | "More may support answer extraction; usefulness depends on the questions matching real queries." |
| route.ts:767 | "AI models look for Q&A patterns to extract answers." | "Question-shaped headings may support answer extraction. No citation outcome can be inferred from this check alone." |
| route.ts:773 | "clear definitional sentences that AI models can extract as answers." | "clear definitional sentences, a structure consistent with answer extraction." |
| route.ts:775 | "can help AI systems extract answers." | "may support answer extraction." |
| route.ts:777 | "AI models prefer content that directly answers questions." | "Definitional sentences may support answer extraction; this check detects structure, not outcomes." |
| route.ts:808 | "AI models struggle to parse div-only pages." | "Semantic elements make structure machine-readable; div-only markup gives parsers less to work with." |

Also sweep `analysis.ts` internal angles and `audit-notes.ts` for the same categorical phrasing and bound it the same way. The public tool page in `(marketing)/` is FROZEN; do not edit it.

Label rename (report surfaces only, per D-F):
- `SeoReport.tsx:439`: `label="AI Search"` becomes `label="AEO Readiness"`.
- `SeoReport.tsx:380` (copy-summary string): "AI Search:" becomes "AEO Readiness:".
- `report-pdf.tsx:225`: `AI SEARCH` becomes `AEO READINESS`.
- Add one clarifying line under the score ring or in the PDF methodology block: "AEO Readiness measures on-site answer-engine readiness signals. It does not measure whether AI assistants actually cite this site."
- Do NOT rename `aiSearchScore` / `aiSearchGrade` fields, the `seo_check_runs.ai_search_score` column, or the admin saved-scans table accessor.

Test gate: `npx tsc --noEmit` clean; grep proves zero remaining instances of "AI models prefer", "AI systems weight", "AI models look for" in `src/app/api/tools/seo-check/`.

### WI-7. Placeholder-class severity gate (the deferred D5/D6 spec, scoped)

Files: `analysis.ts` (buildIssues or a small post-pass), `route.ts` (compute the site-class signal).

Signal: `effectiveContentPages` = count of pages where `!p.wpDefault && p.wordCount >= 150`. Compute in `route.ts` after the crawl, pass into `buildIssues` (new optional param, default `Infinity` so existing tests and callers are unaffected).

When `effectiveContentPages <= 1` (placeholder-class site):
1. Collapse the four content-dependent AI findings, when present, into ONE finding: drop "Question-format headings", "Direct-answer sentences", "Authoritative citations", "Author / reviewer signals" from the issues list and emit a single `low` severity finding titled "No informational content published yet" with detail "The site has at most one substantive page, so answer-engine content signals (question headings, direct answers, citations, authorship) cannot exist yet. Publish practice-area content first; these checks become meaningful afterwards." Category "AI Visibility", audit note "Safe to mention".
2. Cap "Content-Security-Policy" and "X-Content-Type-Options" issue severity at `low` (they are defense-in-depth on a site with no forms or input surface). Do NOT cap HSTS (the chaabanelaw verification found HTTP served with no HTTPS redirect; HSTS-missing stays as calibrated).
3. Leave schema/NAP findings, duplicate-H1, and Open Graph findings at full severity: they are actionable now even on a stub.

When `effectiveContentPages >= 2`: no behavior change at all.

Test gate (extend `__tests__/analysis.test.ts`):
- A synthetic 3-page set (1 real homepage with 300 words, 2 wpDefault pages) with all four AI findings produces the single collapsed finding and none of the four originals.
- The same set with `effectiveContentPages = 3` (all real) keeps all four findings untouched.
- CSP severity is `low` on the placeholder set and unchanged (whatever severityFor yields) on the content-rich set.
- Run `calibration.test.ts`: chaabanelaw is not in the fixture corpus yet, but rozek/preszler/tmalaw/sakuraba/gosailaw/themblawfirm/marathonlaw fixtures MUST be unaffected (all have 2+ effective content pages except themblawfirm; check: themblawfirm is a 2-page one-pager whose homepage carries the content; if its fixture has fewer than 2 pages with wordCount >= 150, its expectations may legitimately change; if so, verify against what the tests assert, and only adjust a fixture expectation when the new behavior is the intended one, with a comment naming this work item).

### WI-8. Score transparency + acceptance-criterion tests

Files: `route.ts` (response assembly, near the `buildSha` field), `SeoReport.tsx`, `report-pdf.tsx`, new test file `__tests__/acceptance-trust-pass.test.ts`.

1. Response gains:
```ts
scoring: {
  categoryWeights: CATEGORY_WEIGHTS,
  unscoredLabels: ["Content-Security-Policy", "HSTS header", "X-Content-Type-Options", "llms.txt file", "FAQPage schema", "Review / Rating schema"],
  note: "Unscored checks are shown for completeness and excluded from every grade.",
},
```
Build `unscoredLabels` dynamically if straightforward (collect labels of items with `scored === false` across scanned pages), otherwise the static list above is acceptable for v1; add a test asserting the static list matches the flags actually set.
2. `SeoReport.tsx`: render an "unscored" tag on items with `scored === false` (small muted chip next to the item label in the category detail view).
3. `report-pdf.tsx`: add one line to the footer/methodology area: "Unscored checks (security headers, llms.txt, FAQ and review markup) are reported but excluded from all grades."
4. The acceptance-criterion test file. Using synthetic pages through the real pure functions (`scoreItems`, `computeWeightedScore`, `aiScoresFromItems`, `buildIssues`):
   - `overall(with CSP+HSTS+XCTO) === overall(without)`.
   - `overall(with llms.txt pass item) === overall(without)`.
   - `overall(with FAQPage) === overall(without)`.
   - `overall(with review markup) === overall(without)`.
   - `aiSearch(with llms.txt) === aiSearch(without)`.
   - The response `scoring.unscoredLabels` covers exactly the four signal families named in the criterion.

## Verification protocol (after all work items)

1. `npx tsc --noEmit`: clean for seo-check files.
2. `npx vitest run src/app/api/tools/seo-check --exclude '**/report-pdf.test.ts'`: ALL pass. Then `npx vitest run src/app/api/tools/seo-check/__tests__/report-pdf.test.ts --testTimeout=90000` once.
3. Commit ONLY the files you edited (list them explicitly in `git add`), conventional message `fix(seo-tool): trust pass: descore security/llms/FAQ/review, AEO Readiness label, placeholder gate`, include the co-author line per repo convention.
4. Push, wait ~3 minutes, then verify live on prod:
   - `rozekandco.com` (content-rich WordPress): expect the Mixed content HIGH finding to remain (it is real and scored), CSP/HSTS/XCTO findings still listed, NO "FAQPage schema" finding, NO "add review schema" text anywhere in the response, `scoring` object present, `buildSha` matches your commit.
   - `chaabanelaw.com` (placeholder-class): expect the collapsed "No informational content published yet" finding in place of the four AI findings, CSP severity low, the WordPress-starter finding still present, and the SEO score CHANGED ONLY by the security descore (verify direction: the score must not have gone UP relative to the pre-pass baseline of 76 B+ because of unscored additions; a small movement from removing header points from maxScore is expected and acceptable in either direction, but presence/absence symmetry is what the tests guarantee).
5. Report the before/after score for both sites in your summary, with one line explaining each delta.

## Explicitly out of scope (do not build, even if tempting)

- Rendered-browser crawling.
- GSC / Bing Webmaster / AI Performance integrations.
- Observed AI visibility measurement.
- Per-firm entity truth records / phone governance.
- Issue tracking, owners, scan-over-scan diffs, portfolio dashboards.
- Renaming API fields or DB columns.
- Any edit under `src/app/(marketing)/`.
- A generalized per-item impact-weight system (D-G defers it).

## Followups

| Date | Source | Flag | Priority | Touches | Suggested next action | Owner | Status |
|---|---|---|---|---|---|---|---|
| 2026-07-06 | Trust-fix pass plan | Chaabanelaw + rozekandco should join the calibration fixture corpus once this pass ships | Medium | `src/app/api/tools/seo-check/__tests__/__fixtures__/` | Capture full API responses post-pass and pin them in calibration.test.ts | Sonnet 5 (next session) | Open |
| 2026-07-06 | Trust-fix pass plan | Batch calibration run (10 to 12 diverse firm URLs, accuracy scoring per finding) | Medium | seo-check engine | Run after this pass lands to measure false-positive rate | Operator + Claude | Open |
| 2026-07-06 | Operator audit review | Observed AI visibility (Bing AI Performance ingestion) deferred to client-reporting product | Low | 08_Reporting scope | Decide as part of client-reporting roadmap, not the scanner | Operator | Open |
