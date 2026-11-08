# CaseLoad Select website positioning diagnostic
## Production plan v1.0 | 8 November 2026

Status: ready for owner review; implementation not started.
Owner: Adriano Domingues. Coordinator: primary agent. Delivery agents: Terra, Sol, Luna.
This plan authorizes no production release by itself. Approval to build and approval to merge a specific PR are separate decisions.

## 1. Outcome and scope contract

Deliver a free, public, English-language tool for Ontario law firms. A visitor submits one website and receives a concise two-part report using only evidence from that website. The report identifies communicated positioning, explains its evidence and uncertainty, then offers optional directions and a CaseLoad Select consultation next step.

The report must never assume the firm is unhappy, claim a better statement guarantees better clients, or describe website interpretation as the firm's confirmed strategy. The firm may retain its present direction. A direction is an exploratory hypothesis, not a market-validated recommendation.

V1 INCLUDES:
- Anonymous URL entry with no email gate, honest processing, accessible errors and one explicit retry action.
- Bounded same-site text collection and visual examination of homepage screenshots.
- Part 1: positioning statement; eight element assessments; reasons and sources; clarity 0-3; independent confidence; text/image coverage and limitations.
- Part 2: up to three different emphases with likely audience relevance, possible statement, communication changes, expectations, tradeoff and required validation.
- Existing CaseLoad Select consultation link; optional local direction selection and Copy discussion brief action. The brief includes website, selected direction or keep-current/unsure, and questions. Copying is user initiated; nothing is sent automatically.
- Canonical CaseLoad brand, keyboard access, mobile support, and bounded operational diagnostics.
- Real model and rendering failures shown honestly. Partial reports only when a usable text basis exists.

V1 EXCLUDES:
Accounts, email capture/delivery, CRM writes, public report URLs, server-side report history, dashboard, report editor, PDF generation, competitor crawling, search grounding, social/review enrichment, multilingual support, fine-tuning, vector databases, chatbot interviews, model routing, scheduled scans and automatic website copy changes.
These were possibilities in the earlier roadmap, not first-release commitments. They require a later scope decision.

Freeze the page list, schema, rubric, copy limits and states at Gate 1. After that, additions enter a change record rather than the active task list.

## 2. Evidence already inspected

Repository: D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-app
- src/app/api/tools/website-design-check/route.ts: public validation/rate limiting; isolated rendering; synchronous response; maxDuration 120; no report persistence.
- src/lib/design-check/render-client.ts and services/render/: isolated website rendering with screenshot and DOM output. Keep browser execution away from app credentials.
- src/app/api/tools/seo-check/route.ts: bounded crawl/extraction patterns. Reuse relevant functions if exported and compatible; otherwise a small feature-local adapter. Do not rewrite SEO scoring.
- src/lib/ssrf.ts, ssrf-fetch.ts, safe-outbound-fetch.ts: outbound URL protection.
- src/lib/design-check/authority-vision.ts and vision-judgment.ts: native Gemini structured vision calls and validation.
- src/lib/firm-voice-builder/gemini.ts: existing server-only key resolution and bounded error/retry conventions.
- src/lib/rate-limit.ts: existing limiting infrastructure.
- Existing Next.js/React/TypeScript, Vitest, Playwright and brand assets. No framework migration.

These are source-code observations, not proof of current deployed service health. Phase 0 verifies the exact branch, environment, service access and limits before relying on them.

Visual reference: positioning-report-brand.html from this conversation. It demonstrates interaction/content, not a completed application or certified responsive release. Production must remove hardcoded Gene Colman findings and host-specific widget APIs.
Canonical brand authority: D:\00_Work\01_CaseLoad_Select\01_Brand\CANONICAL_AUTHORITY.md and its named Brand Book V2, Round 3 and Sieve assets. Use approved assets, palette, type roles and square geometry. Do not invent a new design system.

## 3. Team contracts and decision rights

PRIMARY COORDINATOR
Owns scope, sequence, task ledger and gate decisions; reconciles the three agents; reports progress to Adriano. May choose routine implementations inside this plan. Cannot approve new scope, a new provider/infrastructure, weaker acceptance criteria or a production merge on Adriano's behalf. Does not silently change the plan to make a gate pass.

TERRA: backend and evidence pipeline
Owns feature-local collection, evidence packet, Gemini request, schema validation, API error mapping, request budgets and security tests. Allowed area: src/lib/positioning-check/**, src/app/api/tools/positioning-check/** and its tests. Proposes shared-library changes with a specific reason before editing. Does not redesign the UI, change the analysis rubric independently, migrate the entire Gemini SDK or add persistence.

SOL: interface, integration and release preparation
Owns src/app/tools/positioning-check/**, feature-specific components and browser tests; connects only the frozen contract; maintains canonical brand fidelity. Sole integration/Git operator during coordinated execution. Owns the PR, CI triage and release verification. Reviews Terra's implementation; cannot approve its own visual acceptance or waive Luna's evidence failures.

LUNA: rubric, fixtures and independent evaluation
Owns feature-specific evaluation fixtures, expected assertions, source references and the acceptance ledger. Reads the relevant sections of all four supplied book compilations and records the actual sections used. Does not claim a full-book synthesis from a skim. Tests good, weak, mixed and inaccessible websites; audits reasons and source support; checks the final interface against a fixed checklist. No runtime production edits, independent scoring redesign, deployment or approval of credentials/legal claims. Sol reviews the fixture quality; the coordinator resolves interpretive disputes against source material.

Parallelism: after Gate 1, Terra builds backend, Sol builds UI against fixed fixtures, Luna prepares held-out checks. No two agents edit the same file. Shared schema belongs to Terra until Gate 1, then changes require coordinator review. Sol serializes commits and integration. Agents hand off changed files, tests, unresolved issues and exact acceptance IDs; a narrative 'done' is insufficient.

## 4. Minimal architecture and Gemini decision

Flow: URL -> safe bounded collection -> evidence packet -> Gemini structured report -> deterministic validation -> branded report UI.

Use the existing server-side Gemini integration pattern. Existing source uses gemini-2.5-flash. Do not assume its historical presence proves current availability: Phase 0 checks the official lifecycle, actual configured access, structured output and screenshot support. Pin one supported stable Flash model and its exact identifier at Gate 0. If the existing model passes, retain it. Otherwise propose one supported replacement; no model tournament, automatic fallback or migration of other apps. Never expose keys in the browser, logs or planning documents.

One normal multimodal generation supplies both report parts as structured JSON. At most one additional model call is allowed for a transient failure OR a repair of invalid structure/evidence references, within the same total deadline. Never create an unbounded critic/rewrite loop. Repeated invalid output becomes an explicit failure. Prompt and rubric versions are recorded alongside model identifier.

Use controlled collection and supplied screenshots rather than letting Gemini discover the site. Google documents structured output and image understanding; schema compliance still requires application validation. Its URL-context tool does not follow nested links automatically. No Google Search tool or external grounding in this feature.

Public API: POST /api/tools/positioning-check; page /tools/positioning-check, subject to collision check at Gate 0. Return a discriminated success/partial/error response. Start with the existing bounded synchronous pattern. UI uses indeterminate processing copy ('Reviewing your website'), not fake percentages or stages. Do not add queues, polling jobs or streaming unless a documented deployment constraint makes this architecture fail and Adriano approves the change.

No new database, migration or server-side report retention for v1. Report lives in browser memory for the current session; refreshing may require a new run, stated clearly. Aggregate timing, token usage, model version and error-code telemetry must not log full page text, screenshots, keys, prompts or the prospect's private discussion notes.

## 5. Collection and resource contract

Proposed initial limits, validated and frozen at Gate 0:
- One submitted public HTTPS site, including validated redirects; preserve an entered page path rather than silently discarding it.
- Up to 8 HTML pages: submitted page/home, about, representative practice pages, lawyer bio, process/consultation and testimonials as available. Deterministic relevance ordering, deduplication and at most two navigational hops. Never crawl an entire blog archive.
- Each page max 8,000 retained visible-text characters; whole packet max 48,000. Record truncation explicitly. Strip menus/boilerplate without silently deleting the meaningful hero or key claims.
- Homepage desktop and mobile screenshots from the existing isolated renderer; use its existing viewport contract. At most 2 screenshots, 4 MiB each. No video, PDF, audio, OCR subsystem or new image crawler.
- Assets loaded by the site's own page, including its CDN, are presentation evidence. They are not permission to follow external websites. Renderer must continue guarding every outbound request and redirect.
- If the screenshot service fails, deliver text-only partial status and mark visual findings unassessed. If no usable primary page text exists, fail with retry guidance. Fewer than 3 substantive readable pages means limited coverage; no confident cross-page consistency conclusion.
- Total application deadline 105 seconds, leaving headroom beneath the observed 120-second route declaration; confirm actual hosting entitlement. Collection envelope 40 seconds; first Gemini call 45 seconds; repair/transient retry uses only remaining time. Enforce cancellation, not just a UI timeout.
- Starting abuse ceiling: 3 submissions per hour per network identifier, one active analysis per visitor, and a feature-wide daily generation cap. Reuse existing distributed limiter. Fail closed when the limiter is unavailable. Account for shared office networks in the error message.
- Gate 0 records an actual USD cost ceiling per run and per day using the pinned model's current prices, token bounds and rendering costs. No public launch with these fields unset. A provider call must fit remaining budget before it starts; no reliance solely on after-the-fact cost logs.

These are engineering caps, not advertised service guarantees. A limit may change before Gate 0 only with a written reason. Later increases trigger the deviation process.

## 6. Frozen report contract

Metadata: schema/rubric/prompt/model versions; generated time; requested URL and resolved origin; AI-generated status; coverage and partial reasons.
Evidence items: unique ID; source URL/title; capture time; text excerpt or screenshot ID and visible region description; retrieval/truncation state. Evidence IDs are generated by the collector, not invented by Gemini.

Part 1:
- Positioning statement, maximum 55 words; short rationale, maximum 45 words.
- Eight fixed elements: audience, practice focus, central promise, practical benefits, emotional benefits, reasons to choose, supporting credentials, consistency.
- Each element: observed/inferred/unclear/not-observed/not-assessable status; finding; 0-3 clarity OR null; confidence high/moderate/low OR null; evidence IDs; reason (maximum 45 words); material uncertainty (maximum 30 words).
- Clarity: 0 not expressed in sufficiently reviewed material; 1 broad or ambiguous; 2 identifiable but incomplete; 3 explicit and developed. A failed fetch is null, never zero. Contradiction is a flagged conflict with evidence on both sides, not automatically zero.
- Confidence describes strength/consistency of interpretation, never effectiveness, client demand, popularity or measured probability. Do not label it calibrated until validated. Coverage remains a separate factual record.
- Visual findings: maximum 3, each linked to a screenshot actually analysed. Never infer practice competence, client demographics, emotional outcomes or brand recognition from stock imagery. Asset distinctiveness/recognition requires research outside this free report.
- No overall grade, percentile, performance score or competitive-uniqueness score.

Part 2:
- Up to 3 directions, normally 3 when evidence supports useful alternatives. Each must materially differ in audience, situation or emphasis; synonym rewrites do not count.
- One may retain and clarify the current direction. Do not manufacture alternatives when evidence is too weak: show why and the questions to discuss.
- Per direction: label, audience/situation, possible statement, website evidence basis, communication implication, client expectation, tradeoff, and 3 validation questions. Each field maximum 30 words; statement maximum 35.
- Direction-wide hypothesis notice, firm-owned choice and specific CaseLoad next step.
- No invented capability, credential, named method, fee, guarantee or claim about competitors. The prospect's selection does not turn a hypothesis into a recommendation.

Server validation: required keys/types; exactly eight unique element keys; numeric/null rules; permitted enums; evidence IDs resolve; quoted text matches captured text; evidence URL belongs to collected packet; screenshot claims require successful screenshot input; word limits; no untrusted generated HTML. Invalid content is repaired once or withheld. Reference matching proves traceability, not truth: semantic support is evaluated separately.

## 7. Phases, tickets and gates

Each phase has four accepted units. Progress is accepted units / 28; future release units are not counted complete merely because code is written. Phases 2 and 3 may overlap after Gate 1. All other dependencies are sequential.

PHASE 0: lock the implementation basis (4 units)
Owner: coordinator; Terra investigates, Sol checks paths, Luna checks scope.
0.1 Inspect clean/dirty repo state, origin/main, active work and applicable AGENTS; establish one D: worktree.
0.2 Verify live availability of isolated renderer, Gemini credentials/model capabilities and distributed limiter without exposing secrets.
0.3 Freeze exact route, model, limits, cost ceiling, dependency count and allowed file paths in DECISIONS.md.
0.4 Record included/deferred features, schema ownership and a task baseline; identify blocking service conditions.
Gate 0: a narrow real text+image capability check is recorded, costs are bounded, no infrastructure question is hidden. If a prerequisite is unavailable, report it; do not build around an unverified service.

PHASE 1: define what a correct report means (4 units)
Owner: Luna for evidence standard; Terra schema; Sol states; coordinator accepts.
1.1 Extract relevant positioning principles from the four supplied books with section/page pointers and limitations; reconcile positioning versus distinctive assets. No book-to-skill project or full-library ingestion.
1.2 Freeze the schema, score/confidence rubric and both-part copy limits; create one complete and one partial example.
1.3 Freeze screen states and error codes: idle, invalid URL, processing, full report, partial report, blocked/unreadable site, rate limited, provider unavailable, invalid analysis, timeout.
1.4 Freeze evaluation corpus and expected assertions before prompt tuning.
Gate 1: Terra and Sol agree on the same contract; Luna can explain how each output will be checked. No implementation of new report fields beyond this gate without a change record.

PHASE 2: working evidence and Gemini pipeline (4 units)
Owner: Terra; reviewer: Sol; Luna evaluates samples.
2.1 Build bounded safe collector with coverage, provenance and cancellation.
2.2 Attach existing isolated captures; test text-only partial behavior and unsafe target rejection.
2.3 Implement one multimodal structured generation, validation and capped retry.
2.4 Run Gene Colman and one contrasting development fixture end to end; record evidence, response shape, timing, calls and cost.
Gate 2: a real URL yields defensible structured output or an honest partial/error response within limits. This is the first functional milestone, before visual polish. No hardcoded sample report passes this gate.

PHASE 3: branded interface (4 units; can start against fixtures after Gate 1)
Owner: Sol; Luna verifies; coordinator reviews visual result.
3.1 URL form and complete processing/error states, without fake progress or forced email collection.
3.2 Part 1 with short statement, expandable score reasons and sources, coverage and uncertainty.
3.3 Part 2 with up to three directions, keep-current/unsure choice, copyable discussion brief and consultation link.
3.4 Wire the real API; test keyboard/focus, all expanded content, dark/light pairings and canonical branding.
Gate 3: URL -> real report -> evidence -> direction -> consultation handoff works. No host widget APIs or hardcoded firm content. Screenshots show both parts and key failure/partial states.

PHASE 4: independent acceptance (4 units)
Owner: Luna runs evaluations; Sol and Terra fix their areas; coordinator accepts.
4.1 Execute frozen factual/support, clarity/confidence and direction checks.
4.2 Execute URL abuse, redirects, prompt injection, output validation, quotas, timeout and retry tests.
4.3 Execute viewport/copy/keyboard/contrast checks and integration regression checks.
4.4 Close critical/major defects, publish results and unresolved minor limitations; confirm release budget.
Gate 4: all mandatory criteria below pass. A test not run is not a pass. Maximum two planned fix-and-retest rounds; a third requires a deviation decision, not lower thresholds.

PHASE 5: reviewable release candidate (4 units)
Owner: Sol; coordinator checks evidence.
5.1 Integrate finished changes; remove scratch/untracked files and resolve only in-scope conflicts.
5.2 Push branch; open one scoped PR with summary, screenshots, tests, costs and rollback/disable approach.
5.3 Required CI passes; verify deployed preview with real services and a fresh URL plus one failure case.
5.4 Give Adriano the specific PR, preview, pass counts and known limitations; request merge approval.
Gate 5: waiting for approval is explicitly visible. No direct production deployment, no self-approval, no continuing feature development while waiting.

PHASE 6: approved release and handoff (4 units)
Owner: Sol; Luna checks outcomes; coordinator reports.
6.1 Merge only after Adriano approves that specific PR and required checks pass.
6.2 Verify the auto-deployed production route and one complete end-to-end report.
6.3 Verify protection/error behavior and the consultation destination; no automated email or CRM side effects.
6.4 Record deployed commit, results, operating caps, owner instructions and deferred backlog; clean worktree or named stash.
Gate 6: report actual live behavior. If verification fails, mark release incomplete; disable the new feature through its approved narrow control or prepare a revert PR. Do not use prohibited Vercel deploy/rollback commands.

## 8. Bounded quality evaluation

Fixed corpus: 8 law-firm sites, 6 development and 2 held out until Gate 4. Gene Colman is one development case. Cover focused positioning, generic claims, mixed messages, a broad practice, sparse evidence, and visually prominent content. Capture only public material needed for assertions. Add 10 synthetic failure fixtures: private target, unsafe redirect, resource-limit breach, blocked page, empty/JS-only extraction, unavailable render, injected instructions, invalid evidence IDs, provider quota, and deadline expiry.

Record expert judgments as reviewed reference assertions, not unquestionable ground truth. Luna drafts and Sol reviews them; coordinator settles disagreement. Keep held-out examples out of prompt tuning. Development outputs may be repeated once to check instability; no unlimited experimentation.

Mandatory gates:
- Every displayed factual assertion has a resolvable evidence reference or is visibly identified as interpretation/uncertainty. Zero fabricated quotes, credentials, capabilities, evidence URLs or material legal/outcome claims.
- Human-reviewed evidence support: at least 95% of sampled factual assertions entailed by cited material, and every unsupported material assertion corrected before release. Small fixture results are release tests, not public accuracy claims.
- At least 80% of assessable clarity ratings within one point of the reviewed reference, no systematic failure-to-zero behavior, and no high-confidence claim contradicted by visible evidence.
- 100% coverage counts, failed/truncated states and visual-assessment states match the actual packet.
- Every supported direction names audience, changed communication/expectation, tradeoff and validation; no competitor superiority or outcome promises. Weak inputs may correctly abstain.
- All synthetic security/failure cases pass, retry/cost caps hold, and invalid model content never renders as HTML.
- Complete/partial/error states pass desktop/mobile, keyboard and contrast. Required widths: 1440, 1024, 768, 640, 390, 375, 320 CSS px. Measure the actual report container; do not confuse outer browser width with iframe content width. Audit natural text wrapping/full usable width and single-word endings, both parts, all directions and expanded details.
- Existing relevant test suites and required CI pass. Fix a shared regression only when introduced by this feature; report unrelated baseline failures separately.
- Target: 90% of normal pilot runs finish inside 90 seconds; hard deadline always enforced. Report sample size. If target fails, inspect bounded bottlenecks before proposing architecture changes.

## 9. Progress and deviation controls

Maintain these execution files beside the plan until copied into the feature branch at kickoff:
- STATUS.md: current phase, accepted units/28, in-progress unit, blocker, next gate, links and last update.
- TASKS.md: ID, owner, allowed files, acceptance, status (not-started/in-progress/blocked/review/accepted), commit/evidence and reviewer.
- DECISIONS.md: frozen schema/model/limits/costs and any approved changes.
- DEVIATIONS.md: expected vs actual, first observed time, affected gate, cause, proposed smallest remedy, cost/schedule effect, owner and decision.
- ACCEPTANCE.md: each test/fixture, pass/fail/not-run, evidence and remaining limitations.

Update the ledger when a unit changes status and at every handoff. Give Adriano a short update at each gate and promptly on a blocker or material deviation. During active work, continue normal brief progress updates; never claim unseen background progress when no agent is running.

Update format:
Phase 2 / unit 2.3 | 10/28 accepted | Terra | output validator passing; live screenshot check pending | next: Gate 2 real report | deviation: none | branch/preview link.

Intervention points: Adriano may stop, narrow or reorder work at any gate or during a unit. On a stop request, agents stop mutation promptly, checkpoint authorized work and report state. The coordinator prevents further dependent work until resumed.

Deviation triggers:
- New dependency, database, provider, queue, service, model family or billable subscription.
- New report field, feature, site scope, input source, scoring interpretation or privacy behavior.
- Touching unrelated shared UI, auth, existing tools or other client applications.
- Repeated failure after two focused remedy attempts; an hour of active investigation with no reviewable progress; or consuming 150% of a unit's kickoff effort estimate.
- Proposed weakening of tests, silent reduction in source coverage, invented fallback results, or release budget overrun.

On trigger: pause the affected unit, log the smallest remedy with evidence, notify Adriano, and continue only genuinely independent authorized units. Coordinator may resolve a normal defect inside the frozen contract. Scope/cost/infrastructure/acceptance changes require Adriano's decision. Elapsed time is never approval.

Anti-overengineering rules: no general agent framework; no model debate system; no generic crawler rewrite; no shared component-library project; no cross-app SDK upgrade; no speculative caching/history/admin work; no dependency added merely for convenience. Existing module with a narrow adapter wins when correct. One bounded implementation review and up to two defect correction rounds; finish on passing acceptance rather than subjective perfection.

## 10. Git, release and failure recovery

Canonical repository and its D: git worktrees only. Never clone into C:, OneDrive or temp. Inspect other sessions' work before touching the main checkout. Use a codex/positioning-check branch in a new D: worktree when isolation is needed. Sol is the only concurrent Git writer; agents never reset, stash or overwrite each other's changes.

Push each completed commit, and all commits before the session ends. One feature PR by default; do not manufacture a PR per ticket. Tests pass before merge. Adriano must approve the specific PR. Main auto-deploys on merge. Never run direct Vercel production deploy/promote/rollback commands. Use token-file authentication with the old CaseLoad account and matching scope for any permitted Vercel CLI reads; never print tokens.

No database migration is planned. If one becomes necessary, it is a scope deviation. Any subsequently approved migration must exist on a pushed branch with filename version equal to the applied database ledger version before application.

Finish with pushed branch, clean tree or explicitly named stash, no unexplained untracked files, and exact outstanding items. A timeout, disconnected agent or tool limit must leave a recoverable handoff, never an unpushed local-only solution.

## 11. Planning limits and first action

No production code was changed while preparing this plan. Agent reviews were read-only. This plan chooses a narrow initial release and does not claim all original books have already been read or the preview has passed the final production matrix.

On authorization to implement, begin Phase 0, create the status/task records, verify reused services and establish the baseline. Do not promise a calendar completion date before Gate 0. At Gate 0 publish an effort estimate by unit and a critical path; update only through recorded deviations. Routine gates are progress checkpoints, not repeated permission requests. The specific PR merge remains a required approval under repository instructions.

## Sources
- Canonical repository AGENTS.md and the user's DR-109 rules.
- Existing implementation files listed in section 2, inspected 8 November 2026.
- CaseLoad canonical Brand Book V2 and its complementary Round 3 / Sieve authorities.
- Original books: Branding_Combined.md; Building_Distinctive_Brand_Assets_Combined.md; Digital_Marketing_Combined.md; Law_Firm_Marketing_Combined.md at the user-provided Desktop Books paths. Targeted rubric extraction is Phase 1 work.
- Google structured output: https://ai.google.dev/gemini-api/docs/structured-output
- Google image understanding: https://ai.google.dev/gemini-api/docs/image-understanding
- Google URL context: https://ai.google.dev/gemini-api/docs/url-context
- Gemini lifecycle must be verified at implementation kickoff: https://ai.google.dev/gemini-api/docs/deprecations
