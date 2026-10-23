# Astra execution specification: trustworthy law-firm website report

Accepted 2026-10-23. Planner/reviewer: Astra. Executor: Luna. Parent/root controls commits, pushes and PR.
Base: origin/main `04d1021f0cb7856946660168fe340a493ce65d22`.
Worktree: `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-app-worktrees\seo-lawyer-report-20261023`.
Branch: `codex/seo-lawyer-report-20261023`.

## 1. Objective and boundaries

Correct the existing SEO/AEO tool so a lawyer understands what the scan observed, which findings deserve attention first, why they may matter to someone choosing/contacting the firm, the appropriate decision/general next step, and what the scan cannot establish.

Preserve the current crawler, scan limits, request protections, authentication, lead capture, saved-run behavior, branding, fonts and established trust fixes. No new audit platform or wider redesign.

Do not merge, deploy production, apply migrations, change third-party websites, send messages, submit contact forms or make bookings. Use fake local credentials/test stubs; no database writes are needed for local acceptance. Real-firm scans use the public path, not an operator path that auto-saves.

Luna implements/tests each phase, reports changed files/evidence, and stops for parent review. Parent controls all commits/pushes/PR and pushes every commit. Finish with an open PR, never a merge. Do not tune formulas to obtain a desired Soni score or ranking order among firms.

## 2. Locked decisions

1. One numeric measure: **Website checks**.
2. No numeric AEO readiness/content-policy grades in new results.
3. AI observations do not claim actual visibility, citation likelihood, legal quality or ranking potential.
4. Remove every site-wide eligibility cap and the extra penalty below 35%.
5. Keep existing non-AI weights, described as product checklist priorities, not scientifically calibrated predictors.
6. Exclude the entire AI Visibility category from Website checks; retain its observations.
7. Prominent page-specific access warnings remain even with a high score.
8. One shared deterministic model for screen, copy-summary, public print and server PDF.
9. At most three distinct priority actions; never pad with optional policy/security recommendations.
10. Raw technical fix strings stay in supporting evidence, never the main public recommendation.
11. Preserve historical stored results with historical-method notice, never silently recompute.
12. New deprecated AI score/grade fields are null with consumer guards, not misleading compatibility numbers.
13. No database migration: saved columns/serializers already allow null.
14. Preserve existing embedded behavior; fix inaccurate app tool hero copy only, not alternate static-site wrappers.
15. Scope and uncertainty stay visible with disclosures closed.

## 3. File allowlist

Core: `src/app/api/tools/seo-check/{engine-core.ts,page-checks.ts,analysis.ts,audit-notes.ts,route.ts,report-pdf.tsx}`; `save-run.ts` only if null/version compatibility requires it.

Presentation: `src/components/seo-check/{SeoReport.tsx,SeoCheckTool.tsx}`; `src/app/(marketing)/tools/seo-check/page.tsx` only inaccurate tool claims/scan description.

Consumer guards: `src/app/admin/prospecting-diagnostic/_lib/{seo-types.ts,prospecting.ts,compare.ts}` and `_components/{SavedDiagnosticDetail.tsx,ProspectingDiagnosticTool.tsx}`.

New: `src/app/api/tools/seo-check/report-model.ts`; focused tests in existing test directories; scoped browser acceptance spec/config; this plan and validation record under `docs/seo-lawyer-report/`; scoped replay script under `scripts/` if needed.

Do not edit obsolete marketing `_components` tool copies. Do not modify crawler scheduling, fetch behavior, SSRF protection, request budgets, redirect handling, sitemap discovery, rate limiting or authorization. Passing existing robots-fetch outcome to analysis is allowed; extra requests are not. Report a genuinely required additional dependency to parent before editing it.

## 4. Phase A: scoring and evidence correctness

### A1. Version/null contract

Add `methodologyVersion: 3` to new responses/persisted JSON. Types allow `number|null` for aiSearchScore, aiPolicyScore and per-page aiVisibilityScore; `string|null` for aiSearchGrade/aiPolicyGrade. New scans emit null for all five. Historical numeric JSON remains untouched.

Historical reports show exactly: **This saved scan used an earlier scoring method. Run a new scan for the current report. Scores from different methods should not be compared.**

Historical overall label: **Historical score**. Never derive current Website checks from incomplete historical aggregates. Do not show old AI grades as current measurements.

`buildInternalSummary` accepts nullable AI input and requires a finite number before the current <50 fit adjustment; null awards no +6. Audit every score reference. Saved/detail views show **Not scored**, never null/100, /100, zero substitution or blank grade.

For comparison, missing methodologyVersion means historical version 2. Cross-version comparisons emit no numeric delta and show **Method changed**. Null is never zero.

### A2. Applicability in both directions

`applyPageTypeApplicability` must exclude exempt checks whether the detector passed or failed. Current misses-only exemption grants irrelevant passes points.

Add optional `CheckItem.applicability: "applicable"|"not-applicable"|"unknown"`. Existing exemptions get not-applicable and scored:false; preserve observed status/detail rather than granting synthetic pass. Exclude them from findings and pass/warn/fail counts; show **Not applicable**. Unknown gets scored:false and **Not assessed**. Absent applicability means applicable for legacy compatibility. Keep existing page-type lists; do not invent requirements.

### A3. AI/policy neutrality

Every `checkAiVisibility` item is scored:false. Category weight zero; weighted scorer skips it. Update comments/note: no claims these observations measure AI readiness or distinguish marketed firms.

Training choices never become top fixes or positive/negative quality judgements. Public family: **AI content-use choices**. Report observed crawler instructions, not proof of crawler behavior. No default recommendation to allow/block training. Preserve unscored llms.txt, FAQ schema, review markup and security headers.

Missing accessible robots.txt is not a defect or obligation to add Allow rules. Unavailable fetch outcome is unknown, not confirmed allowed/blocked. Preserve parser/fetch system.

Verified bot taxonomy: ClaudeBot training; Claude-SearchBot search; Claude-User user-triggered. OAI-SearchBot search; GPTBot training; ChatGPT-User user-triggered and not Search eligibility. PerplexityBot search, Perplexity-User user-triggered. Remove user-triggered bots from deterministically robots-based search conclusions; optionally show neutral rule observations with the provider caveat. Official links are in research appendix.

### A4. aggregateCategories algorithm

1. Zero pages returns [].
2. Category names are union across pages, not first page only.
3. Mean ratios only across page-category instances with maxScore>0; all-unscored is not zero.
4. Preserve aggregated-item denominator from scoreItems(items).
5. score=meanApplicablePageRatio*maxScore, no early rounding; final display/overall rounds.
6. No applicable scored instance => score0/maxScore0.
7. Preserve worst status as evidence but count fail/warn separately; never `failCount||warnCount` for combined affected count.
8. Merged item unscored only when every relevant instance is unscored.
9. Expose fail/warn/applicable/not-assessed counts required by report; worst observation does not apply to every page.

### A5. Exact formula

Weights: On-Page SEO20; Indexability8; Schema & Structured Data16; Legal Marketing16; Local SEO12; Technical & Security4; Rendering & Crawlability2; Performance6; Links & Content6; Intent Alignment8; AI Visibility0.

For positive weights and maxScore>0: `overallScore=round(sum(category.score/category.maxScore*category.weight*100)/sum(category.weight))`.

Remove the <35 multiplier. New route never calls applyEligibilityCaps/deriveEligibilityGates/describeEligibilityCaps and never adds eligibilityIssues. Historical eligibility JSON remains readable; no new cap findings.

Scoring metadata includes version3, label Website checks, actual weights/unscored labels and exact note: **A weighted summary of applicable checks on the pages inspected. It is not a measurement of rankings, enquiries, legal content quality, or AI citations.**

No letter grade in new public headline; existing grade field may remain computed for compatibility. If no applicable checks exist, display Not assessed, not a zero-quality conclusion; model carries assessed:false even if numeric compatibility value is zero.

### A6. Exact page-access evidence and copy

Separate per-page observations: noindex meta/header; Googlebot restriction; Bingbot restriction; HTTP final URL; limited server HTML; unknown. Evaluate rule for actual path/query using existing parser. Only supported URLs enter affectedUrls. Never assign team/service evidence to home. Noindex and crawl restriction do not establish actual indexing.

Noindex action:
- Title: **Review which pages should appear in search**
- Observed: **{n} of {N} checked pages contain an instruction asking search engines to leave them out of results.**
- Why: **If these pages are intended to attract clients, that instruction deserves review. Some exclusions are intentional.**
- Next: **Confirm which affected pages should appear in search, then ask your web provider to review their settings.**

Utility-only policy/intake/tool exclusions: retain evidence under **Confirm the intended use**, no urgent top card. Prioritize home/practice/attorney/location/contact/about/FAQ/blog ahead of utility exclusions. Never assume service-page noindex is accidental.

Robots action:
- Title: **Review crawler access to these pages**
- Observed: **The inspected robots.txt rules restrict {named crawler(s)} on {n} checked page(s).**
- Why: **This can limit crawling. It does not prove that a URL is absent from search results.**
- Next: **Confirm whether the restriction is intentional before changing it.**

HTTP action:
- Title: **Review the connection used by these pages**
- Observed: **{n} checked page(s) loaded over HTTP rather than HTTPS.**
- Why: **Visitors should have a secure connection when using the site, especially before sharing information.**
- Next: **Ask your web provider to confirm HTTPS is available and consistently used.**

Never claim every HTTP visitor receives an interstitial warning or quantify a ranking penalty.

Rendering action:
- Title: **Check what visitors and search systems receive**
- Observed: **The initial HTML contained limited page content on {n} checked page(s).**
- Why: **Content may appear after the page runs in a browser. This scan did not test that rendered experience.**
- Next: **Have your provider check the affected pages in a browser and with the relevant search inspection tools.**

### A7. Required bounded related fixes

- noindex+self-canonical does not automatically fail Mixed indexability signals.
- Cross-domain canonical evidence is not another independent conflict penalty. Confirm intended consolidation; never require every cross-domain canonical to become same-domain.
- Missing sitemap does not mean search engines cannot discover the site.
- Incomplete sitemap does not prove unobserved URL membership; use unknown, not true.
- structure-attorney-blocked cannot union all agents' Disallow and claim Google/Bing restriction. Evaluate relevant bots against known discovered team URLs; without known affected URL omit asserted block.
- Structure absence says **not found in the checked pages**, never firm lacks content.
- Schema/entity/phone differences need confirmation; multiple entities/locations/numbers can be intentional.
- Raw evidence copy also stays bounded: no guaranteed indexing/citations, fabricated lost cases or unsupported absolute claims hidden in appendix.

Preserve prior trust fixes for decorative alt, embedded forms/contact, service-area practices, starter exclusions, sameAs, sitemap limits and fail-versus-warn URL attribution.

## 5. Phase B: shared deterministic report model

Create pure network-free report-model.ts accepting current/historical JSON. Fields: methodology, coverage, headline, accessSummary, priorityActions, strengths, aiObservations, limitations, findingGroups, scoreExplanation, cta.

Action fields: id, family, priorityLabel, evidenceLabel, title, observed, whyItMatters, nextStep, affectedUrls, affectedCount, checkedPageCount, sourceIssueIds, technicalEvidence.

Exact evidence labels: **Observed in this scan**, **Needs confirmation**, **Not assessed**, **Optional choice**. Certainty that a tag exists is not certainty that changing it benefits the firm.

### B1. Family ranking and selection

Group overlapping findings before selecting cards. Order:
1. Search exclusion/access on non-utility pages.
2. HTTP connection.
3. Contact route not found in checked content.
4. Service/lawyer/location information requiring clarification.
5. Missing/unclear page labels/descriptions.
6. Business-information/structured-data consistency.
7. Supporting content/source-review opportunities.
8. Discovery/navigation improvements.
9. Browser/performance verification.

Union actual URLs while preserving individual observations; never apply one representative detail to every page. Prefer homepage, then commercial pages, then other inspected pages. Tie-break affected non-utility page count descending, then stable family ID. Select at most three.

Training policy, llms.txt, security-header hygiene, optional FAQ schema and generic question-heading recommendations cannot fill top slots. Bare word count, semantic-tag count or generic-verb pattern never independently generates a top action.

Exact empty state: **No priority action was identified by these checks. This limited scan does not confirm that the whole website is free of problems.**

### B2. Complete public copy mapping

All observed text uses real count/sample scope; why describes possible reader/search relevance without measured-loss/gain claims. Technical labels remain in evidence.

| Source family | Public heading | General next step |
| --- | --- | --- |
| Indexable, robots access | Exact A6 copy | Confirm intended inclusion/access |
| HTTPS, Mixed content | Review the connection used by these pages | Ask provider to check secure delivery |
| Contact form/direct contact, phone visible, no clear contact path, consultation CTA | Make the next contact step easy to find | Review affected pages on desktop/mobile and confirm how a prospective client should contact the firm |
| Practice-area intent, Intent Alignment, structure-practice | Clarify the matters the firm handles | Review whether main services and intended clients are clear on relevant pages |
| structure-attorney, trust signals, author/reviewer | Help readers understand who is responsible for the advice | Check relevant lawyer information and, where appropriate, author/reviewer details are clear and accurate |
| Page title, meta description, H1, H2, heading hierarchy | Make page topics easier to understand | Review names/headings/search descriptions for clarity and consistency |
| Business schema, JSON-LD, Entity description, NAP in structured data | Check how the firm's information is described | Ask provider to compare machine-readable information with current public details |
| Schema conflicts, phone/address differences | Confirm that business details are consistent | Verify whether differences are intentional before changing them |
| Address/NAP, GBP link, Maps embed, sameAs | Review the firm's location and profile information | Confirm public contact/service-area/profile details match how the firm operates |
| Question headings, direct-answer sentences, word count, citations, external links | Review how well key pages answer client questions | Have a qualified reviewer assess whether important questions are answered clearly and supported where appropriate |
| Internal links, anchor text, sitemap, redirects, canonical, hreflang | Review how important pages are connected and identified | Ask provider to check page relationships and intended versions |
| Rendering, TTFB, blocking resources, HTML size, compression, scripts, content/HTML ratio | Verify the visitor experience | Test in a browser and use measured performance evidence before choosing work |
| Image alt, HTML language, viewport | Review page usability details | Have provider review the identified detail in its page context |
| Security headers | Optional website security review | Review as security maintenance, not an SEO blocker |
| AI training controls | AI content-use choices | Choose a policy fitting the firm; no default recommendation |
| FAQ schema, review schema, llms.txt | Additional markup and experimental files | Show established limitations without promising visibility gains |
| WordPress starter content | Review published placeholder content | Confirm whether affected content should remain public |
| Policy/disclaimer links | Confirm relevant policy information is easy to find | Review with the appropriate responsible person |

Missing detection is **not found in the inspected HTML**, not proof of absence to visitors. Schema-only phone/address is not proof a visitor sees it. Semantic tags do not prove understandable content; generic verbs do not prove useful answers; schema does not prove expertise.

Mandatory unknown-label fallback:
- Title: **Review this website finding**
- Observed: **The scan recorded a finding on {n} checked page(s). Its significance needs confirmation.**
- Why: **Automated checks do not establish the business impact of this finding.**
- Next: **Ask your web provider to review the evidence and confirm whether any change is appropriate.**
- Evidence: **Needs confirmation**.

Unknown labels are excluded from top-three selection. No raw fix/code snippets in public body.

### B3. Observed strengths

Show at most three based on direct evidence, in order: HTTPS on all checked pages; contact route found; relevant service/lawyer content found; no noindex observed. Count-qualified example: **All 10 checked pages loaded over HTTPS.**

Never say secure website, well optimized, AI ready, fully indexable or strong legal content. If none qualify omit section. Empty/failed scans never manufacture positives.

### B4. Always-visible limitations

Exact normal text: **This scan inspected the initial HTML of {N} pages. It did not check the whole website, confirm Google indexing or rankings, measure enquiries, assess legal accuracy, or test whether AI services cite the firm.**

Additional partial text: **The scan stopped before its available page checks were complete. Findings describe the pages successfully inspected.**

Discovery confidence is about discovery process, not whole-site completeness. Ten fetched pages from a hundred-page sitemap cannot be complete coverage.

### B5. One CTA

Heading: **Discuss these findings**.
Body: **We can help confirm which findings matter for the cases you want, separate intentional choices from genuine gaps, and decide what to address first.**
Link: **Book a conversation**.
Destination: `https://cal.com/adriano-caseloadselect/conversation`, after parent verifies intended existing destination. Never book/submit. No promises of rankings/citations/enquiries or invented losses.

## 6. Phase C: screen presentation

Preserve existing CaseLoad fonts/colors/identity. Order:
1. Domain and short interpretation of highest-priority family.
2. Visible count, HTML scan, date and partial indicator.
3. Compact Website checks score and explanation.
4. Prominent access summary with actual noindex/restriction counts.
5. **Start with these findings**, up to three cards.
6. **What the scan found working**, supported strengths.
7. **AI access and content observations**, neutral facts/narrative.
8. Always-visible limitations.
9. Expandable supporting findings/pages/evidence/score explanation.
10. CTA.

Each card visibly contains title, observation, why and next step. Only URLs/raw tags/category checks/secondary evidence collapse. Unscored categories display **Not scored**, not 0%.

Replace raw hero pass/fail counts with applicable assessed counts excluding not-applicable/unknown/policy observations. Aggregate-label count is not page-check count.

Native buttons/details and text status labels; color only supplements. Copy summary/top fixes serialize shared model with coverage/limitations, never old SEO/AEO/policy sentence or raw fix text. Null metrics in history/prospecting show Not scored.

## 7. Phase D: PDF and entry consistency

PDF consumes shared model: same headline meaning, label/method, scope, action IDs/order/counts, AI caveats, limits and CTA. Technical appendix may expand evidence and retains affected URLs.

Operator analysis remains explicitly internal. Public API/report/copy/print cannot expose internalNote, prospectingAngle, prospectFitScore, internalSummary or revenue-opportunity language. Preserve export permission boundary. Existing operator appendix may remain clearly identified.

Replace narrow app tool introduction with:
**Check a sample of your law firm's website for search-access settings, page clarity, business information, and selected AI-related observations. Get a short list of findings to review, with the pages and evidence behind them.**

Remove unsupported “Most law firm websites are invisible to AI search”, “scores what actually drives visibility today”, schema/citation guarantees and stale fixed signal/category totals. Use real page limit. Do not expand into alternate static marketing wrapper.

Scan status never implies rankings/citations are tested. Completion/error uses accessible status messaging. Preserve lead-capture consent/submission behavior.

## 8. Phase E: automated acceptance

Independent expected behaviors, not snapshots merely mirroring implementation:
1. Indexable home plus noindex team/service: no cap, no home attribution, exact URLs/count.
2. Utility-only noindex: evidence, no urgent top card or site-cannot-rank claim.
3. Homepage noindex: prominent warning even with high checklist score.
4. Googlebot block without noindex: crawl restriction, never cannot-appear claim.
5. Training-only restriction: no Google/Bing/search-team finding.
6. /private/ block: no home/unrelated service attribution.
7. Training allowed/restricted: identical Website checks.
8. Add question headings/generic is/are/means alone: identical Website checks.
9. Exempt passing/failing checks: both outside numerator/denominator/findings.
10. Unknown: not pass/fail and no score reduction.
11. 100% applicable plus all-unscored category: remains100%, not50%.
12. Equal-weight100/0=>50;30/100=>65; no soft penalty.
13. Constructed formula80 plus localized noindex stays80, not35.
14. noindex+self-canonical: no duplicate mixed-signal failure.
15. Missing versus long metadata: correct evidence; present-long never labeled absent.
16. Missing CSP/HSTS/XCTO never displaces access/contact review.
17. No eligible actions: exact B1 empty state.
18. Screen/copy/PDF model: identical IDs/order/counts/labels/limitations.
19. Historical fixtures: notice, no recomputation.
20. Null AI fields serialize/render safely; no null-as-zero fit adjustment.
21. v2/v3: Method changed, no numeric delta.
22. Public result/export/copy: no internal fields or prospecting copy.
23. Public10/operator25/50 behavior unchanged.
24. Prior forms/alt/service-area/starter/schema/sitemap/security/redirect/SSRF regressions pass.
25. Empty/no applicable check: Not assessed, no fake strengths.
26. Unknown robots outcome: no confirmed block/allow; absent accessible robots file not defect.

Use exact Soni/Gosai evidence in section9 plus synthetic cases. Change old calibration assertions only where explicitly superseded; document why. Never weaken unrelated assertions.

Run complete relevant SEO suites, consumer suites, type checking, scoped lint, production build and required CI. Suggested commands using parent-supplied toolchain:
`npx vitest run src/app/api/tools/seo-check/__tests__ src/app/admin/prospecting-diagnostic/_lib/__tests__`
`npx tsc --noEmit`
`npx eslint <changed source files>`
`npm run build`

Record exact command/exit status/environmental limit. Parent obtains real required checks from PR and waits for actual outcomes; never assume CI success.

## 9. Phase F: live firms and fixed-evidence replay

Exact domains: `sonilaw.ca`, `drglaw.ca`, `sakurabalaw.ca`, `gosailaw.com`, `marathonlaw.ca`, `themblawfirm.ca`. No substitutions.

Production baselines preserved by parent as ignored artifacts: `test-results/seo-lawyer-report/baseline/<domain>.json`.

Baseline observations provided by parent, 2026-10-23:
- Soni:10 pages,35 SEO/84 AEO/50 policy,about8.8 seconds.
- DRG:10 pages,92/93/50.
- Sakurabala:10 pages,83/83/50.
- Gosai:10 pages,35/76/50.
- Marathon:9 pages,77/66/50.
- themblawfirm.ca:API422 reports target404; no usable scan.

These are historical inputs, never desired future scores or success targets.

Soni baseline homepage has no noindex; four actual affected URLs:
`https://sonilaw.ca/practice/employment-law/`
`https://sonilaw.ca/team/`
`https://sonilaw.ca/team/thanh-justin-pham/`
`https://sonilaw.ca/team/ummuhani-khaleel/`

Gosai baseline homepage has no noindex; affected paths:
`/real-estate-law/refinances-mortgages/`
`/real-estate-law/residential-sales-andpurchases/`
Resolve full final origin from saved evidence, preserving canonical host rather than guessing.

For each firm:preserve baseline; run new public-budget scan without lead/contact submission; record URLs/access/score/top families/limitations/policy placement; independently inspect bounded source/header evidence for highest finding; explain page-selection/live-content differences; never demand score increases or relative ranking order.

Soni acceptance is correct current attribution/formula/language, not a chosen replacement for35. Fixed-evidence replay proves deterministic logic; fresh live scans prove integration. Both required. Reconstruct only evidence available in fixture; never invent raw HTML or claim unavailable detectors were rerun. Distinguish raw-page detector fixtures from aggregate-result presentation fixtures.

For themblawfirm.ca preserve/verify unavailable/error state. Never quality-score failed fetch or silently replace firm. Live scores must not become brittle unit-test targets. Raw artifacts remain ignored; commit minimal purpose-specific fixtures only where needed, without private/operator data.

## 10. Phase G: rendered acceptance

Required CSS widths:1440,1024,768,640,375,320. Use real fonts/styles.
States:representative Soni; no-priority report; partial; historical; long URLs/many pages; null metrics; target unavailable/error.
Test keyboard disclosure, copy summary, public print, operator PDF and null fields in both prospecting detail views. Stub local operator saves; no production DB writes.

Literal assertions:
- Website checks
- Start with these findings
- AI access and content observations
- Discuss these findings
- Book a conversation
- Not scored for null AI
- Not assessed for unavailable evidence
- Method changed cross-version
- Exact A6 noindex copy and B4 limitations
- Exact B1 zero-priority text

Forbidden current-method headline labels:AEO Readiness, numeric Content Policy grade, SEO Health grade, Score capped.
Forbidden claims:whole website checked, guaranteed indexing/citation, legal accuracy verified, quantified missed enquiries.

Acceptance:
- No horizontal page overflow/clipping/overlap.
- Text priority/evidence cues work without color; normal text contrast4.5:1.
- Supporting text remains readable; never shrink to fit.
- Governed copy spans full usable component width.
- No avoidable one-word final line in multiline governed copy.
- No manual br/nbsp/arbitrary reading-width caps to mask wrapping.
- Keyboard access and visible focus; usable disclosure controls.
- Scope/limitations visible with disclosures closed.
- Public print contains useful findings/evidence.
- PDF selectable text, parity, complete URLs, unclipped cards.
- No user-facing em dashes.
- No public operator-prospecting language.

Tag component/copy with data-ui-component-content/data-ui-copy or inject equivalent in tests. Measure rendered word rectangles after fonts load. Source-only checks do not prove width/orphan acceptance. Preserve before/after representative screenshots plus all viewport results. Record exact genuine URL/table/code exceptions, never whole-file/card exemptions.

One batched inspection, one batched correction, one confirmation pass. Remaining material failures return to parent/Astra; never silently waive.

Impeccable detector runs once after UI only when available/applicable under the read skill; not a new dependency or arbitrary blocker. Root has successfully loaded incumbent-scoped context and clarify/craft-floor/operate references and owns final detector execution. Existing launcher:`C:\Users\adria\.codex\skills\impeccable\scripts\impeccable.cmd`. Full-width user gates take precedence over generic65ch suggestions.

## 11. Phase review, commits and handoff

Luna stops for parent review after:
A:score/types/evidence/tests.
B:shared model/copy/priority/compatibility.
C+D:web/PDF/entry copy/component checks.
E+F+G:complete acceptance matrix and outstanding issues.

Luna does not commit/push/open PR independently. Parent sequence:
1. Correct sampled scoring and evidence attribution.
2. Add shared lawyer-readable model and guards.
3. Update web/PDF/scoped entry.
4. Acceptance evidence and verified repairs.

Parent pushes every commit, opens PR against main, attaches it to chat. No merge.
PR explains localized noindex formerly capping whole site/attributed home; corrected score; neutral AI; report changes; tests/live/render evidence and limits. No memory citation markup in PR.
Validation record includes branch/SHA, commands/results, replay/live matrix, screenshot/PDF locations, intentional changed assertions and outstanding limits.

## 12. Stop/escalation

Return to parent/Astra if required work changes crawler/fetch safety/auth/schema/deploy; null requires broad consumer redesign; finding lacks URL evidence; trust regression conflicts; boundary/approval blocks; material acceptance remains after bounded correction; new live root cause lies outside plan; parent cannot push.

Never conceal failure by loosening tests, omitting viewports, treating unavailable as passed, changing firms or reintroducing unsupported scoring.

Completion:implementation, relevant tests, actual rendered checks, live+replay evidence, pushed branch, clean or explicitly named stashed state, no stranded canonical untracked implementation, open PR. No production/merge claim.

## 13. Research basis

Research informs hierarchy/evidence boundaries; it does not validate scoring weights, demonstrate ranking/citation gains or establish lawyer usability testing.

Book excerpts read by delegated book_research:
- Hoakman, Designing the Obvious, user Web Design corpus lines30333-30359:user goal outside app;35201-35234:semantic/scannable hierarchy.
- Wathan/Schoger, Refactoring UI, Web Design corpus89528-89576:priority emphasis and secondary information without tiny type;89651-89663:meaningful label/value phrases.
- Panzarella, UI & UX Web Design Simply Explained, Web Design corpus123980-124030 and124111-124122:essential visible, detail second/third depth.
- Banubakode, user UX corpus7754-7791:calibrated trust, transparent methods/limits, gradual explanation.
- Gupta, Visual Dialogues, user Graphic corpus22863-22878:never color alone.

Exact user-supplied corpus paths confirmed by parent; line ranges above refer to these files:
- Web Design: `C:\Users\adria\OneDrive\Desktop\Books\Web Design\Web_Design_Combined.md`
- UX: `C:\Users\adria\OneDrive\Desktop\Books\UX Design\UX_Design_Combined.md`
- Graphic: `C:\Users\adria\OneDrive\Desktop\Books\Graphic Design\Graphic_Design_Combined.md`

Online sources verified by web_research:
- Google AI features:https://developers.google.com/search/docs/appearance/ai-features . No extra technical requirements/special AI markup. Technical observations are not actual citation measurement.
- NN/g Progressive Disclosure:https://www.nngroup.com/articles/progressive-disclosure/ . Important actions first, secondary complexity on request.
- GOV.UK Details:https://design-system.service.gov.uk/components/details/ . Essential information stays visible.
- W3C Use of Color:https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html . Additional cues accompany color.
- W3C Contrast Minimum:https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html . Normal text4.5:1.
- W3C Status Messages:https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html . Accessible status announcements.

Official bot facts verified by web_research:
- Anthropic:https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler . ClaudeBot training; Claude-SearchBot search; Claude-User user-triggered. Provider says all respect robots directives. The report may describe an observed matching rule, never claim actual bot compliance was measured.
- OpenAI:https://developers.openai.com/api/docs/bots . OAI-SearchBot search; GPTBot training; ChatGPT-User user actions, not automatic crawling. Robots may not apply to user actions and ChatGPT-User does not determine Search eligibility.
- Perplexity:https://docs.perplexity.ai/docs/resources/perplexity-crawlers . PerplexityBot search, not foundation-model training; Perplexity-User user fetch generally ignores robots because user requested it. Never turn its robots rule into a confirmed access/search block.

Historical audit registry MEMORY.md32-40 identified cap/trust boundaries; current source verified those implementation facts. Historical scores are not current claims beyond separately preserved baseline.
