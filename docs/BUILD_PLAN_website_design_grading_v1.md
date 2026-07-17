---
doc_meta:
  version: v1
  status: Ready for review, not yet approved for execution
  owner: Adriano Domingues
  author: Claude (Sonnet 5, this session, 2026-07-16)
  executor: Claude Code (Sonnet 5)
  created: 2026-07-16
  updated: 2026-07-16 (additions pass, Fable 5 review)
  scope: caseload-select-app (new tool) + caseloadselect-website (proxy wiring)
---

# Build Plan: Website Design Grading Tool v1

## 1. What this is

A new public lead-magnet tool grading a law firm's website design, UX, and conversion craft. Distinct from `/tools/seo-check` (already live, SEO and AI-visibility only; per operator decision 2026-07-16, the two tools score distinct signals with no duplication). Full framework spec lives at `06_Clients/DRGLaw/03_Authority/Strategy/Book_Extractions/WEBSITE_DESIGN_GRADING_FRAMEWORK.md` and `WEBSITE_AUTHORITY_SIGNAL_MODULE.md`. Read those two files in full before touching code; this plan does not restate their content, only sequences the build against them.

## 2. Read before starting

1. `WEBSITE_DESIGN_GRADING_FRAMEWORK.md` — master framework: 10 weighted dimensions, render/capture/score pipeline, red-flag capping, two-track scoring, output design, calibration warnings.
2. `WEBSITE_AUTHORITY_SIGNAL_MODULE.md` — dimension 8 expansion (Authority and Positioning): the earned-versus-claimed classifier, six sub-scores, LSO compliance overlay.
3. `01_Brand/BrandBook/Visual_Craft_Principles_v1.md` through `v4.md` — cited source for most Track 1 checks.
4. `src/app/api/tools/seo-check/{route.ts,engine-core.ts}` — the SSRF-safe fetch layer to reuse for the initial raw-HTML/robots/sitemap fetch, per the 2026-07-16 decision to share crawler infrastructure between the two tools.
5. Skills the framework names as reference implementations: `design-mirror` (token extraction, feeds Track 2 if it's ever built), `design:design-critique`, `design:accessibility-review`.

## 3. Stop-lines

- Do NOT build Track 2 (Brand Conformance) in v1. The framework marks it optional, only relevant when a brand spec is supplied; no such input exists for a prospect scan. Track 1 (Universal Quality) only.
- Do NOT wire GHL lead capture. Per explicit operator instruction (2026-07-16), defer lead capture. Build the email-gate UI matching seo-check's proven pattern, but leave it non-forwarding, exactly like seo-check was before its own recent fix.
- Do NOT duplicate seo-check's categories (On-Page SEO, Legal Marketing, Local SEO, Performance's SEO framing). Per explicit operator decision, keep the two tools' scored signals distinct.
- Do NOT average away a red flag. Cap the grade; never blend a capping flag into the weighted sum.
- Do NOT grade brand preference (gradients, rounded corners, serif type) as a universal-quality defect. Explicitly Track 2 territory, off by default in v1.
- Do NOT let the vision-model judgment pass run without the framework's fixed rubric and a cited reason per score.

## 4. Architecture decision: rendering layer (research spike required first)

The app currently has zero headless-browser capability (confirmed: no `playwright`, `puppeteer`, or `@sparticuz/chromium` in `package.json`). seo-check's crawler never renders anything; it fetches raw HTML text and regexes it. This tool's pipeline requires real rendering: screenshots at two viewports (~390px mobile, ~1440px desktop), computed styles, a performance trace. Full desktop Playwright is too heavy for a Vercel serverless function.

Phase 0 is a research spike, not a feature build: confirm the serverless-compatible headless-Chromium approach (candidates: `playwright-core` + `@sparticuz/chromium`, the established Vercel/AWS Lambda pattern; or an external rendering API if the cold-start or binary-size math does not fit inside Vercel's function limits). Verify actual cold-start time, memory ceiling, and whether a full render-plus-capture pass fits inside the existing 300-second `maxDuration` precedent (seo-check's own deep-scan ceiling) before committing to an approach.

**Renderer SSRF is a different problem than fetch SSRF.** Reusing seo-check's undici-level protection (validating DNS lookup, pinned connections, blocked IP ranges) covers only the initial HTML fetch. A headless browser issues its own network requests for every subresource (images, scripts, stylesheets, iframes) and follows its own redirects, none of which pass through that agent. Phase 0 must ship request interception (Playwright route interception or an egress proxy) that applies the same blocked-range and DNS-rebinding rules to every browser-originated request, and must disable service workers. This is a Phase 0 acceptance criterion, not a later hardening pass; the APP-003 arc and the Firm Assist corpus-ingest finding are the precedent for how expensive it is to retrofit.

**D: drive feasibility is part of the spike.** Both app CLAUDE.md files document symlink and EISDIR constraints on this drive (Turbopack lock, no local `next build` on the sibling project). The spike must prove the chosen render library runs locally for tests, or explicitly accept that render-dependent tests run only on Vercel/CI while local dev relies on fixture HTML.

**Wall-clock budget with partial results.** Mirror seo-check's `CRAWL_BUDGET_MS` pattern: a render or vision call that overruns returns the dimensions already scored plus an honest "not measured" marker, never a hard failure with nothing.

## 4.1 Scope, cost, and abuse controls

- **v1 grades the single submitted URL at two viewports.** No multi-page crawl. Design grading of the homepage is the product; a multi-page tier is a later decision, not an implied default. (seo-check's multi-page crawl is an SEO need, not a design-grading need.)
- **Every scan costs real compute** (a Chromium render plus vision-model calls), unlike seo-check's fetch-and-regex. Wire `checkRateLimit` from `@/lib/rate-limit` on the public route from day one. Standing repo posture: the Upstash env vars are unset in Vercel, so all rate limits currently fail open (FOLLOWUPS, 2026-07-15). Acceptable for seo-check's cheap scans; not acceptable here. Setting the Upstash vars is a launch precondition for this tool.
- **Cache results per normalized domain** (suggest 24h) and serve the cached report on repeat submissions. This is cost control and the framework's determinism rule in one mechanism.
- **Record per-scan cost in the spike output** (render seconds, vision tokens) so a future paid deep tier has real numbers behind it.

## 4.2 Persistence and retention (resolved 2026-07-16: no Supabase persistence in v1)

**Decision:** this tool gets no runs table and no screenshot storage in v1. Two reasons, both from the operator directly: (1) this tool is not SEO and must not be modeled on or reference `seo_check_runs` in any way, naming included; (2) the migration-parity workstream (WS2) is still unresolved, and adding a new migration on top of that mess is exactly the wrong move right now.

Screenshots are discarded after the vision-model pass (Phase 2); nothing about scoring or reporting requires them to persist. If an operator-history / audit-trail feature is wanted later, it gets its own independently-named table and its own decision, made after WS2 is settled, never framed as a variant of the SEO tool's schema.

## 5. Phased build order

Deterministic-first, per the framework's own stability rule: "deterministic checks should carry the majority of the score because they do not drift between runs."

### Phase 0: Rendering infrastructure spike
Land the headless-render capability: fetch a URL, capture DOM, computed styles, and a performance trace at both viewports. No scoring logic yet. Prove it deploys and completes inside Vercel's limits against a real domain before moving on.

### Phase 1: Deterministic-only dimensions
No screenshot or vision-model dependency; build and test each in isolation against the framework's deterministic rule catalog:
- Typography and legibility (weight 12)
- Color and contrast (weight 10)
- Forms and conversion flow, deterministic half (weight 9)
- Mobile and responsive, deterministic half (weight 6)
- Performance and technical health (weight 9)
- Spacing, grid, and alignment, deterministic half (weight 9, spacing-histogram based)

Measurement honesty note for Performance: a lab trace yields LCP, CLS, and TBT. INP is a field metric requiring real user interaction; do not claim to measure it. Score TBT as the responsiveness proxy and label it as such in the report. Extend seo-check's `evidence-bounded-copy` test convention to every report string in this tool: no finding may assert more than what was measured.

### Phase 2: Screenshot capture + vision-model judgment layer
Wire Phase 0's screenshot output into a vision-model call using the framework's fixed 7-item judgment rubric verbatim, low temperature, one cited reason per score. Feed it the Phase 1 deterministic findings alongside the screenshots, per the framework's explicit instruction to grade what it sees against what was measured.

Implementation constraints, all from existing repo lessons:
- Model ID comes from an env var with a sane default, never hardcoded (the Ses.15 lesson: a hardcoded `claude-sonnet-4-20250514` was retired upstream and 404ed in production; `CONTENT_STUDIO_MODEL` is the repo pattern to copy).
- Scores return through strict structured outputs so parsing cannot fail on malformed JSON (the Ses.15 constrained-decoding lesson applies verbatim).
- Cache the judgment result keyed on a screenshot hash: same pixels in, same scores out. This is what makes the framework's stability rule survivable with a model in the loop.
- Persist the cited reasons alongside the scores; the framework requires an auditable judgment, and the reasons are also the raw material for the report's findings copy.

Covers the judgment components of:
- First impression and clarity (weight 12)
- Visual hierarchy and composition (weight 12)
- Navigation and information architecture (weight 9)
- Trust and credibility signals, non-Authority-module portion (weight 6)

### Phase 3: Authority and Positioning dimension
Full build against `WEBSITE_AUTHORITY_SIGNAL_MODULE.md`: the earned-versus-claimed classifier (self-designation lexicon scan, proximity-of-proof pairing, LSO compliance overlay), the six sub-scores, schema and NAP and review parsing. This absorbs and replaces the master framework's compressed dimension-8 bullets.

### Phase 4: Red-flag system, aggregation, and report
- Red-flag detection (manufactured urgency, pre-checked consent, bait reciprocity, bandwagon claims, color-only status, contrast failures, plus the switchable LSO overlay) as capping logic applied last, never averaged into the weighted sum.
- Honesty boundary: some flags are fully deterministic from the DOM (pre-checked consent boxes, countdown timers, color-only status). Exit-intent pop-ups and similar interaction-triggered patterns need interaction simulation the v1 render pass does not do; detect them best-effort (script-signature heuristics) and document per flag whether detection is proven or best-effort. Never report a flag class as "clear" when it was not actually checkable.
- Track 1 aggregation into a letter grade.
- Ranked findings output: problem sentence from the visitor's vantage point, dimension, severity, cost-to-fix and impact, a concrete fix. Upside-first framing per the CaseLoad Diagnostic doctrine the framework itself cites.

### Phase 5: Tool page, UX, and site wiring
- New route mirroring seo-check's page shell and email-gate UX pattern (input, scanning, email gate, report), themed for design grading rather than SEO.
- The new public route MUST be added to the AdminShell bypass list with correct headers. This is a documented incident class in the app CLAUDE.md ("any NEW public or embedded route must be added to the AdminShell bypass AND given the correct Permissions-Policy, or it renders inside the operator console with the wrong headers", the deleted /voice-handoff route being the worked example).
- Wire into `caseloadselect-website`'s `next.config.ts` rewrites, the same proxy pattern already used for `/tools/seo-check`.
- Email gate present, non-forwarding, per the stop-line above.
- Page and report copy pass the `check-no-em-dash-marketing.mjs` build gate and the workspace writing rules.

## 5.1 Execution mechanics

Do all code work in a fresh worktree off `origin/main`, not in the main checkout. The main checkout at `05_Product/caseload-select-app` currently sits on `fix/restore-marketing-homepage`, 45 commits behind `origin/main`, carrying unrelated uncommitted work whose fate is an open WS1 decision. Same isolation pattern `BUILD_PLAN_firm_assist_fixes_v1.md` §4 prescribes, for the same reason.

## 6. Test discipline

Match seo-check's own bar: a fixtures-based test suite per phase, plus a real-domain smoke test before calling any phase done. The sakurabalaw.com canonical-redirect bug found earlier this session is the standing reminder that a live-domain test catches what fixtures alone miss.

## 7. Open questions for Adriano

Status as of 2026-07-16, mid-build:

1. ~~Confirm the phased order above, or reprioritize.~~ Confirmed via "go ahead and build it"; Phase 0 complete, Phase 1 five of six dimensions complete (Spacing deferred), verified live against sakurabalaw.ca.
2. Rendering approach: no constraint flagged; Phase 0 spike proved playwright-core + @sparticuz/chromium (prod) / full playwright (local dev) works end to end.
3. Regression domain set: no explicit answer given; defaulting to reusing sakurabalaw.com/.ca (already proven against this build) plus 1-2 more real domains as Phase 2+ needs them. Revisit if a different fixed set is wanted.
4. **Resolved 2026-07-16:** v1 stays single-URL, no multi-page crawl. Operator flag: multi-page support is a wanted future improvement, not permanently out of scope. Tracked below.
5. **Resolved 2026-07-16:** no Supabase persistence in v1 (§4.2). Screenshots discarded after the vision pass. No new migration.
6. Upstash rate-limit launch precondition still stands (§4.1): this tool should not go public while rate limits fail open. Unacknowledged, not urgent until Phase 5.

## Followups

| Date | Source | Flag | Priority | Touches | Suggested next action | Owner | Status |
|---|---|---|---|---|---|---|---|
| 2026-07-16 | Website Design Grading build plan v1 | Ready for review; Phase 0 (rendering infra spike) not yet started | H | 05_Product/caseload-select-app; Book_Extractions/WEBSITE_DESIGN_GRADING_FRAMEWORK.md | Confirm phased order and rendering approach, then execute Phase 0 | Adriano + Claude | Open |
| 2026-07-16 | Website Design Grading v1 scope decision | Operator confirmed v1 stays single-URL (no multi-page crawl) but flagged multi-page support as a wanted future improvement, not permanently out of scope | M | 05_Product/caseload-select-app/.claude/worktrees/design-grading/src/lib/design-check | When prioritizing v2 work, add a multi-page crawl mode (reusing seo-check's sitemap-traversal pattern) | Adriano + Claude | Open |
| 2026-07-16 | Website Design Grading v1 persistence decision | Operator ruled out any seo_check_runs-style naming/modeling and any new migration while WS2 migration-parity is unresolved; v1 ships with no Supabase persistence, screenshots discarded after the vision pass | H | 05_Product/caseload-select-app/.claude/worktrees/design-grading | Revisit an operator-history/audit-trail table only after WS2 settles, with its own independent name and its own decision | Adriano + Claude | Open |
