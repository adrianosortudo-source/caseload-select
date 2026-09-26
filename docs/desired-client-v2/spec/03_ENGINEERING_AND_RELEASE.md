# Engineering and release specification
Date: 24 September 2026. Planning only.
This file fixes technical choices. It does not authorize production changes.

## 1. Repositories and source-of-truth preflight
Public website repository: `https://github.com/adrianosortudo-source/caseloadselect-site.git`.
Use its existing checkout at `D:/00_Work/01_CaseLoad_Select/05_Product/caseloadselect-site` only to inspect refs and create a worktree.

Portal repository: `https://github.com/adrianosortudo-source/caseload-select.git`.
Use the canonical checkout `D:/00_Work/01_CaseLoad_Select/05_Product/caseload-select-app` only to inspect refs and create a worktree.

Create these new worktrees from freshly fetched `origin/main`:
- App branch `codex/desired-client-v2-app`, path `D:/00_Work/01_CaseLoad_Select/05_Product/caseload-select-app-worktrees/desired-client-v2`.
- Website branch `codex/desired-client-v2-site`, path `D:/00_Work/01_CaseLoad_Select/05_Product/caseloadselect-site-worktrees/desired-client-v2`.

Use `git fetch origin`, then `git worktree add -b <specified-branch> <specified-path> origin/main` in each existing repository. Before creating either, check whether the branch/path already exists. If either exists, STOP and report its ref, HEAD and status; do not overwrite, remove or silently select another location. Read the fresh worktree's AGENTS.md, CLAUDE.md and release policy before editing.

Record remote URL, remote HEAD, worktree HEAD, clean status and applicable instructions in `docs/desired-client-v2/BASELINE.md` in the app worktree. Confirm that the website Vercel root is `production/` and its build/output configuration matches the repository. Confirm that `app.caseloadselect.ca` belongs to the portal project. Read configuration identifiers, not secret values. If these facts do not match, STOP for Astra.

The audit found:
- Canonical portal checkout: main at `74d48e051b9ef27c44c194e20c17f42fef4db17b`, diverged from local origin/main and dirty.
- Closest tool reference: `caseload-select-app/.claude/worktrees/why-your-firm`, branch `tool/why-your-firm`, HEAD `75afa44a417c2be40dc5c64e3bfffac6f1d89735`, one local commit ahead of its remote plus uncommitted changes.
- Public site checkout: unrelated `codex/lso-expansion-phase2` branch and local changes.
These are observations, not starting branches. Do not clean them, cherry-pick from them or copy their unfinished files into this implementation.

A fresh app main must contain the existing SDK, font assets, public-tools hosting pattern and shared rate-limiter exports below. Why Your Firm itself need not be on main: its design is a reference, not a dependency. If those foundational interfaces are absent or materially changed, STOP for Astra to revise this file.

## 2. Reuse boundaries
| Existing source | Reuse decision |
|---|---|
| `src/app/tools/firm-voice-builder/page.tsx` | Follow top-level public tool route and standalone/embed separation. Do not change its behaviour. |
| `src/lib/firm-voice-builder/gemini.ts` and `turn.ts` | Follow SDK initialization and explicit runtime validation patterns. Do not import its conversational transcript contract. |
| `src/lib/why-your-firm/assist.ts` in reference worktree | Learn server-only Gemini JSON generation, strict parsing and fallback pattern. Do not import tool-specific runAssist or its compliance taxonomy. Do not copy its three retries. |
| `src/lib/why-your-firm/screens.ts`, `engine.ts` | Reference dynamic screens and pure assembly architecture. New content/state remain separate. |
| `src/lib/why-your-firm/embed.ts` | Follow content-height/step-message concept; create separate message names and stricter origin/source checks. |
| `src/lib/rate-limit.ts` | Import checkRateLimit, ipFromRequest and rateLimitHeaders. Add only the named new buckets below. |
| `next.config.ts` | Add this public route to existing tools embed headers and the catch-all exclusion. Preserve all other header behaviour. |
| `src/components/AdminShell.tsx` | Existing /tools bypass should apply. Verify; do not add a second shell or authenticated tool page. |
| Existing Manrope font asset and DM Sans package | Use local fonts; no CDN fonts or new package. |
| `production/styles.css`, `site.js`, consent script | Keep marketing-site navigation/footer and approved brand. Scope new page styles. |
| Existing browser-print patterns | Use browser print/save PDF; do not reuse report-email or server PDF code. |

Do not add Supabase tables, migrations, authentication, Resend emails, a CRM write, a Screen funnel event type, generic analytics, OpenAI calls, a new Gemini package, Zod or another runtime dependency. Existing Node built-ins are sufficient for request IDs and byte checks.

## 3. New app file map
Create:
- `src/app/tools/desired-client-matter/page.tsx`: server page metadata, async searchParams, embed flag, minimal standalone header.
- `src/app/tools/desired-client-matter/desired-client.css`: tool-scoped design and print rules.
- `src/app/api/tools/desired-client-matter/analyze/route.ts`: validated stateless POST boundary.
- `src/components/desired-client/DesiredClientTool.tsx`: orchestration, reducer, consent, screen changes and request lifecycle.
- `QuestionPage.tsx`: accessible fieldsets, option rows, optional detail and Continue/Back.
- `ComparisonStep.tsx`: fixed two-pattern comparison.
- `DraftPreview.tsx`: deterministic summary only.
- `ReviewStep.tsx`: edit links, Generate, fixed clarification bank.
- `BriefView.tsx`: validated brief, provenance labels and exports.
- `ResumePanel.tsx`: resume/start-again flow.
- `src/lib/desired-client/types.ts`: types matching 02 exactly.
- `catalog.ts`: all practice packs, labels, limits and field definitions from 02.
- `copy.ts`: remaining fixed UI/error/privacy/export strings.
- `state.ts`: pure reducer, dependencies, revision invalidation.
- `screens.ts`: ordered conditional screen construction.
- `validation.ts`: strict request/answer/model-response validation.
- `clarifications.ts`: deterministic eligibility, priority and fixed question bank.
- `brief.ts`: deterministic preview/fallback assembly.
- `storage.ts`: expiry, version and safe localStorage handling.
- `export.ts`: Markdown, clipboard and print view.
- `embed.ts`: scoped resize/step messaging.
- `analyze.ts`: server-only provider adapter and normalized outcome.
- `prompt.ts`: exact system prompt, JSON response schema and safely serialized input.
- `__tests__/catalog.test.ts`, `state.test.ts`, `brief.test.ts`, `validation.test.ts`, `clarifications.test.ts`, `storage.test.ts`, `analyze.test.ts` within that library.
- `src/app/api/tools/desired-client-matter/analyze/__tests__/route.test.ts`.
- `src/components/desired-client/__tests__/flow.test.tsx`.
- `docs/desired-client-v2/BASELINE.md`, `VERIFICATION.md`, `REVIEW.md`.

Edit only existing `src/lib/rate-limit.ts` and `next.config.ts` for the specified shared integration. Add scoped tests to the existing limiter test file if one exists; otherwise create `src/lib/__tests__/desired-client-rate-limit.test.ts`. Do not refactor unrelated tools.

If a fresh main uses a different mandatory test/file convention, record the conflict and ask Astra for a mapping before creating an alternative architecture.

## 4. Public website edits
Change `production/tools/desired-client-matter.html`:
- Keep canonical URL; use title `Desired Client | CaseLoad Select`.
- Meta description: `Choose the clients, matters and working conditions your firm wants more of, then create a practical Desired Client Brief.`
- Keep the approved header/footer, consent loader and site.js.
- Remove the old four-field form and this page's tool-runtime.js include. Leave the shared runtime and other tools untouched.
- Compact page heading: `Desired Client`.
- Introduction: `Work through a few guided choices to define the clients and matters your firm wants more of.`
- Embed `https://app.caseloadselect.ca/tools/desired-client-matter?embed=1`.
- Iframe title `Desired Client guided tool`; loading eager; width 100%; border 0; initial height 800px; referrerpolicy strict-origin-when-cross-origin.
- Always-visible link below: `Open the tool in its own window` to the same route without embed=1; target _blank and rel noopener.
- A script failure or iframe failure must leave this direct link available.
- Do not repeat the full app introduction/privacy/result caveat above and below the iframe.
- Page styles in new `production/styles/desired-client-tool.css`, loaded after styles.css. Page intro padding 2rem block; H1 2.25rem; override inherited ch-based heading widths to none inside this page.
- New `production/scripts/desired-client-embed.js` manages this frame only.

Change only this tool's existing card in `production/tools.html`: name `Desired Client`; description `Choose the work you want more of and turn it into a practical client and matter brief.`; retain same destination URL.

In `production/privacy.html`, add a tool-specific paragraph without replacing existing policy/Meta wording:
`The Desired Client tool can keep a draft in your browser for seven days after your last edit. If you choose AI assistance and generate a brief, your selected answers and any optional wording are sent to Google Gemini for processing. CaseLoad Select does not save those answers to a client database. Technical request information is processed by our hosting and security services. Do not enter confidential client or matter information.`
Check that all statements match the deployed implementation. Do not promise zero provider retention or zero infrastructure logs. Preserve existing Terms and all protected privacy content.

No new redirects, rewrite to /_next, general navigation change or SEO migration. Keep existing static build/output structure.

## 5. Frame protocol, CSP and direct route
Public app page metadata: title `Desired Client | CaseLoad Select`, robots noindex/nofollow. Indexable marketing wrapper holds canonical discovery URL.

Embed mode hides app header/footer. Standalone mode shows a compact CaseLoad Select link to https://caseloadselect.ca and a Back to tools link to https://caseloadselect.ca/tools.html; no portal admin navigation.

New message types:
- `{type:'desired-client:height', version:1, height:number}`
- `{type:'desired-client:step', version:1}`

Child reads document.referrer once and accepts only exact parent origins https://caseloadselect.ca, https://www.caseloadselect.ca and http://localhost:3300. If absent/disallowed, send nothing. Always pass the accepted exact targetOrigin to postMessage; never '*'. Send after hydration, screen changes and a ResizeObserver update on the content root. Use requestAnimationFrame to coalesce updates; clean up observers/listeners on unmount. No vh/min-h-screen/min-height linked to the iframe viewport.

Parent accepts messages only if event.origin is https://app.caseloadselect.ca AND event.source equals this iframe.contentWindow. Require exact type/version and a finite height; round and clamp height to 400..20000px. Step messages scroll the frame's top into view only when it is above the visible content area; respect reduced motion and sticky site header. Never move keyboard focus into the iframe from the parent.

Local test fixture on port 3300 uses app http://localhost:3000 and accepts only that origin. This override belongs in a local test fixture, not in the production wrapper. Production app CSP may allow localhost:3300 using the existing tool-header precedent. Do not allow wildcard vercel.app framing. Test cross-project preview via the local wrapper fixture pointed at the exact app preview host.

Add exact `/tools/desired-client-matter` header entry using existing toolsEmbedSecurityHeaders. Exclude it from the general DENY header rule. Preserve other routes' strict headers. Check real response headers; a source edit alone is insufficient.

Iframe drafts live under the app origin. Browser storage partitioning may separate embedded and standalone drafts. Do not promise cross-window synchronization or transfer answers in URLs/postMessage. The direct-link hint must say `Drafts may be separate in the embedded tool and its own window.`

## 6. Visual implementation
Use the existing brand in a restrained working interface:
- Paper #f4f3ef, white #ffffff, ink #0d1520, navy #1e2f58, secondary text #455163, border rgba(13,21,32,.18).
- Manrope for headings from /fonts/Manrope-VF.ttf; DM Sans for body from the existing @fontsource-variable/dm-sans dependency. No new external font request. Verify asset/package on fresh main.
- Root font 1rem, line-height 1.55. Page title 2rem, question 1.5rem, section heading 1.125rem, helper .9375rem, stage label .8125rem. Headings line-height 1.2. Do not inherit giant marketing hero typography into the tool.
- Outer tool width min(100%,72rem), horizontal padding 1.5rem at >=768px and 1rem below. Vertical spacing in multiples of .5rem.
- Seven main stage pages with principal and related question groups from02. Focus reveals work after area, then route/service area after selection. Comparison uses the three nested screens in02. Stage navigation at top, question and help, options, optional detail, contextual preview when specified, then actions.
- Above 1024px use question column minmax(0,2fr) and preview minmax(16rem,1fr), gap 2rem. Below 1024px use one column; preview follows the question and precedes actions. No sticky sidebar.
- Option rows use real radio/checkbox inputs with complete clickable labels, 1rem padding, 1px border, .375rem radius, white background. Selected rows show navy border, explicit checked control and pale background #eef1f7. No emoji, decorative illustration, gradient, scoring gauge or giant numbered tiles.
- Native select for the 13 practice areas; accessible labelled option rows for smaller question sets. Unknown options remain visible.
- Buttons at least 44px high; body-sized sentence-case labels. Primary navy/white; secondary transparent/navy. Back left, Continue right; wrap naturally on narrow screens. Do not auto-advance when a choice is selected.
- Visible 2px navy focus outline with 4px offset. Selected state is not colour-only.
- Transitions only 150ms opacity on content change; disabled entirely for prefers-reduced-motion.
- Copy uses the full inner width of its assigned component. No max-width ch, forced line breaks, nonbreaking-space wraps, fixed text heights, truncation, tiny-print compensations or one-word heading orphans.
- Data-ui-copy attributes on headings, help, option labels, summaries and brief paragraphs for existing copy QA.

For every new screen, put focus on its heading (tabIndex -1); use an error summary linked to invalid fields. Announce loading/error/result updates once using aria-live polite, without rereading the entire page. Keep native form keyboard behaviour.

## 7. API and provider boundary
Route: POST /api/tools/desired-client-matter/analyze.
No GET generation, auth session, firmId or answer persistence.
Node runtime, force-dynamic, maxDuration 30 seconds; application provider deadline 12 seconds and client deadline 16 seconds.

Request envelope:
```ts
{
  schemaVersion: 2,
  requestId: string,       // crypto.randomUUID(), max 64
  answerRevision: number, // nonnegative integer
  reviewRunId: string,     // crypto.randomUUID(), max 64
  analysisIndex: 0 | 1 | 2,
  aiConsent: true,
  answers: DesiredClientAnswers,
  clarifications: Array<{code: ClarificationCode, answer: string}>
}
```
DesiredClientAnswers and all enums/constraints are fixed in 02. Clarifications contain only valid fixed answer IDs, at most two distinct codes, in displayed order. Do not send prior model prose, complete UI state, localStorage metadata, user agent, referrer, client identity or analytics information to Gemini.

Server returns:
```ts
{ok:true, requestId, answerRevision, reviewRunId,
 result:{brief: DesiredClientBrief, clarification_code: ClarificationCode | null}}
```
Failure returns `{ok:false, requestId, error:{code}}`. Allowed codes: INVALID_REQUEST, ORIGIN_DENIED, TOO_LARGE, RATE_LIMITED, AI_DISABLED, AI_UNAVAILABLE, INVALID_AI_OUTPUT. Never return raw SDK/provider error text or prompt.

Processing order:
1. Require application/json; reject a present Origin unless it exactly matches the request URL origin. Require Origin for this browser-only API. Deny Sec-Fetch-Site: cross-site. The iframe calls its own app origin, not the marketing parent. No CORS wildcard. Origin checks are not a substitute for rate limits.
2. Reject stated content-length over 32768 bytes. Independently read the request stream with a 32768-byte hard cap so missing/false lengths cannot bypass it. Cancel stream on excess.
3. Parse and strictly validate known fields, enums, lengths, dependency consistency and clarification history. Reject unknown keys. Normalize optional text with trim; no HTML parsing. Inputs are data, never prompt instructions.
4. Verify DESIRED_CLIENT_AI_ENABLED is exactly 'true', a server API key is present, and both existing Upstash variables exist. If not, return AI_DISABLED/503; no provider call. This flag is a new optional app setting, default off. Do not change production env in implementation.
5. Check the new fail-closed rate buckets sequentially using existing checkRateLimit. Denial before provider => 429 plus standard rateLimitHeaders.
6. Compute eligible clarification codes server-side from canonical answers. Model may select only from that list.
7. Call Gemini once, then strictly parse/validate result. No automatic retry, fallback model, repair call or agent loop.
8. Return no-store JSON; no answer/body/result logs.

Numeric grounding guard: reject percent signs and numerical assertions absent from cited answers. Extract digit-based numeric tokens from each statement and its cited, server-resolved answer labels/text, normalizing currency separators. Every generated numeric token must appear in those cited values. Do not permit computed ranges, years, rates or outcomes. Reject an experience-kind statement when focus.route is new/exploring, or its only cited support is preference/unknown/empty. This catches obvious unsupported claims; it does not prove every paraphrase is supported. Retain human source-based review in04.

Statuses: 400 invalid request; 403 origin; 413 size; 429 limit; 503 disabled/unavailable infrastructure; 502 model timeout/error/invalid result. Failure is a recoverable UI state because local brief generation remains available.

Use existing @google/generative-ai with server-side key resolution GOOGLE_AI_API_KEY ?? GEMINI_API_KEY. Model default gemini-2.5-flash; new optional DESIRED_CLIENT_MODEL override may be changed only through an Astra specification amendment. Use temperature 0.2, responseMimeType application/json, explicit schema from 02, maxOutputTokens 4096 and SDK request timeout 12000ms. Do not expose key or system prompt in client bundles. Client aborting/ignoring a request is not a guarantee that provider processing was cancelled.

Reuse implementation patterns, not the tool-specific Why Your Firm helper. No live provider call in CI. Mock the SDK boundary.

## 8. Cost limits and privacy
Add these exact RateLimitBucket/BUCKET_CONFIG entries and include all three in FAIL_CLOSED_BUCKETS:
- desiredClientAnalyze: limit 20, windowSeconds 600; identity from ipFromRequest(req).
- desiredClientDaily: limit 100, windowSeconds 86400; same identity.
- desiredClientGlobal: limit 2000, windowSeconds 86400; fixed identity 'all'.

Do not modify other buckets' fail-open/fail-closed policy. Verify Redis exceptions deny these new buckets as well as missing Redis. If current helper cannot support scoped fail-closed behaviour, STOP for Astra rather than changing all tools. Rate keys are transient security metadata, not stored answer records.

Within a client review run allow exactly indices 0,1,2; a failed attempt still consumes its index. A manually restarted run needs another explicit Generate action and is still rate-limited server-side. No automatic regeneration on resume, input change or reaching Review. Three-call UX budget is not a server authentication guarantee: the server's rate buckets are the abuse boundary.

Logs may include generated requestId, generic outcome code, elapsed milliseconds and model identifier only. Do not log prompts, answers, model text, IP values, raw request/response bodies or raw exception messages. Hosting/provider/security metadata still exists; privacy wording must not claim otherwise.

No new analytics or replay. Existing marketing page analytics remains governed by its consent mechanism and cannot read cross-origin iframe answers. Export/copy happens locally.

## 9. State, races and storage
Use a pure reducer and storage schemaVersion 2. Nested answers.schema_version is dcm-v2.1; answers.revision must equal transport answerRevision. Ordinary answer edits increment revision, end the run and clear all clarification resolutions. Prescribed clarification updates increment revision inside the same run, preserving attempt count. Leave this open is local dismissal metadata: canonical answers/revision stay unchanged and the run ends. Invalidate prior AI output after every ordinary edit; preserve answer data and return to a deterministic preview. Abort any in-flight client fetch and ignore a response unless requestId, reviewRunId and answerRevision all match current state.

Generate locks against double clicks. Revising answers or starting another brief cancels the visible run. A response arriving after Clear cannot restore the deleted draft.

LocalStorage key `cls-desired-client-v2`. Save answers, current step, lastEditedAt and schemaVersion; save a validated completed brief with its source revision if available. Do not persist AI consent or an active network request. Debounce writes by 300ms; flush on step navigation. Expire seven days after lastEditedAt, without extending expiry just for opening the page. Validate on read; discard corrupt/obsolete/expired state and show the exact notice from 02. Do not migrate old worksheet keys.

Catch storage denial/quota errors and continue in memory; show the notice that this browser cannot save progress. Clear removes only this key and resets in-memory state, output and mode. Other tools' drafts remain intact. Resume requires choosing the AI/no-AI mode again before any generation.

Brief review acknowledgement is separate from evidence. Marking a brief reviewed records only that the lawyer reviewed the wording, never that underlying claims were independently verified.

## 10. Exports
Copy plain-text brief using navigator.clipboard; on permission failure show a selectable plain-text textarea and `Select and copy the brief`.
Download deterministic Markdown as a UTF-8 Blob, file name `desired-client-brief-YYYY-MM-DD.md` using local date; revoke object URL after use.
Print calls window.print with tool-scoped @media print. Include title, generated date, working-draft status, all brief sections, uncertainty/evidence labels and source-answer appendix. Hide navigation, choices, buttons and side preview. Use white background/black text, readable heading hierarchy, avoid splitting short result blocks. No promise of identical pagination in every browser.
No answer strings in download filename, URL or document title.

## 11. Build order for Luna
1. Finish baseline. Add the six authoritative files listed in01 under app `docs/desired-client-v2/spec/`, preserving their contents so PR reviewers can trace implementation.
2. Implement catalogue, schema/types, reducer, screen builder, clarification eligibility and pure brief. Add meaningful invariant/fixture tests.
3. Build entire no-AI flow, local resume, review, exports and accessible layout. Verify it end to end before adding provider code.
4. Implement analyze route and server-only adapter. Add mock success, bad-source, malformed-output, timeout, size, origin and limiter tests.
5. Connect explicit Generate and clarification lifecycle. Verify stale-response rejection and full fallback.
6. Add app embedding/CSP and scoped frame protocol. Verify direct and iframe modes locally.
7. Modify static wrapper/card/privacy and validate static build. No old source-root edits.
8. Run checks in 04 and prepare screenshots/recorded fixtures. Commit scoped changes and push both branches to their respective origin.
9. Open one draft PR per repository with problem, changed behaviour, validation, screenshots and outstanding release gates. Attach both PR URLs to the current Codex task. Request Astra review with the artifacts.
10. Stop before merge. Report known issues precisely. Do not silently replace omitted checks with a pass.

## 12. Environment and release sequence
Required existing app settings: GOOGLE_AI_API_KEY or GEMINI_API_KEY; UPSTASH_REDIS_REST_URL; UPSTASH_REDIS_REST_TOKEN. New setting DESIRED_CLIENT_AI_ENABLED defaults off. Never display key values, include .env files in commits or request browser device login.

Local testing uses isolated worktree configuration, existing authorised credentials only where available, and mock provider responses for automated tests. Missing credentials must not stop the complete no-AI implementation. Missing live configuration is a release gate: report setting names and environment, without exposing values. Do not create an alternative service.

Before asking to enable AI, supply the exact preview, privacy copy, scoped setting change and completed validation. Approval of implementation is not approval of production configuration. Once explicit release authorization is obtained:
1. Merge the approved app PR only after all required CI succeeds.
2. Verify deployed app route in no-AI mode and its real CSP.
3. Apply only explicitly approved configuration through the existing release process; perform one synthetic live AI smoke test using fictional firm preferences, not client data.
4. Verify the AI path and fallback on deployed app.
5. Merge the separately approved website PR; check actual public URL, headers, load, consent text and exports.
6. Record deployed commit IDs and final verification.

If using Vercel CLI for an authorized step, load the old account token from C:/Users/adria/.vercel-tokens/old.txt, pass --token and --scope adrianosortudo-7282s-projects on every command, and never print the token. No direct CLI production deploy. Main merge auto-deploys.

Rollback: disable new AI via the approved flag change while keeping no-AI useful; for application regression, prepare a revert PR for the affected new-tool change. Reverting the website wrapper restores the prior public page if required. No deleting unrelated data, old prototypes or deployments. A rollback merge/config change requires the applicable explicit authorization.

## 13. Stop conditions
Stop the affected step and send Astra an evidence-based decision request when:
- Branch/path already exists; remote/main or Vercel project/root differs from this plan.
- Shared helper/signature/dependency or required font is absent.
- Repository instructions conflict with this plan.
- A required choice, field, branch, fallback, copy string or expected output is missing/contradictory.
- A semantic test fails and repair would change the product meaning.
- A new dependency, data store, provider, persistence path or global security change appears necessary.
- Required CI fails for unrelated reasons. Report it, do not weaken or bypass checks.
- Live AI/model/config is unavailable. Keep no-AI implementation and report release blocker.
- A merge/deploy/configuration step lacks explicit authorization.

Do not choose a substitute or reinterpret a failure as permission. Continue independent, already-specified work while the affected decision is pending.

## 14. Astra execution amendment: independently verified shared commit
Approved by Astra on 24 September 2026 after implementation authorization. This supersedes only the requirement in section1 to finish a Git fetch before creating a worktree when a fresh independent GitHub lookup verifies the exact shared main commit.

Root verified current shared main through authenticated GitHub reads:
- App: GitHub connector fetch_commit(main), adrianosortudo-source/caseload-select, SHA18b51a62ff79d19d0a5706deebfcd7087cfa288d.
- Website: gh api repos/adrianosortudo-source/caseloadselect-site/commits/main --jq .sha, SHAcd30f040504a4e78b43685c9091f96b0f40a7c76.

For either repository, confirm origin identity, use git cat-file -t <verifiedSHA> and require commit, complete the existing branch/path/registered-worktree collision checks, then create the prescribed worktree from that exact SHA instead of origin/main. Verify its HEAD equals the verified SHA and the new worktree is clean before editing. Read the fresh instructions and verify required infrastructure. Record lookup method/time, SHA and the substituted freshness check in BASELINE.md. If canonical status remains unavailable, say so; do not claim it was clean. Refresh the PR relationship to current remote main before review.

For the website only, if the verified commit is absent from the canonical site repository, it may be imported from the existing D:/00_Work/01_CaseLoad_Select/Version3_CaseLoadSelect repository. First verify both origins identify adrianosortudo-source/caseloadselect-site, and that the source contains the exact independently verified SHA as a commit. Record resolved source path, verification and SHA. From the canonical site repository run git fetch --no-tags --no-write-fetch-head <verified-existing-source-path> cd30f040504a4e78b43685c9091f96b0f40a7c76. Reverify the imported commit, then create the prescribed worktree at that exact SHA. This imports only history reachable from verified shared main, not local-only branches or working files.

No Git lock removal, canonical working-tree mutation, extra clone, branch overwrite or release-rule exception is authorized. Any inconclusive identity/object/import/collision check stops the affected step. Existing push, PR, CI and explicit merge-approval requirements remain in force.
## 15. Astra local-port amendment
Approved during execution on 24 September 2026. Port3000 belongs to an existing unrelated process and must remain untouched. For this implementation, every local app URL/fixture child-origin/QA command that previously used localhost:3000 now uses http://localhost:3301. The local static wrapper remains http://localhost:3300. Verify both selected ports are free before launch; if occupied, return to Astra. Production URLs, production origin validation, and the existing parent frame-ancestor allowlist are unchanged. Record the port choice in verification notes. This section supersedes only earlier local development port references.
## 16. Astra current-main limiter and E2E amendment
Approved after reading shared app main18b51a62ff79d19d0a5706deebfcd7087cfa288d. This supersedes section8's named fail-closed set: add desiredClientAnalyze, desiredClientDaily and desiredClientGlobal to ALWAYS_FAIL_CLOSED_BUCKETS, plus their exact existing union/config entries. Their fail-closed behaviour must not depend on RATE_LIMIT_FAIL_CLOSED. Do not add them only to the legacy flag-gated set.

Pass bucket through the internal Redis initialization path. For these three new buckets only, emit generic outcome codes on initialization or limiter failure. Never log their supplied identity/IP, raw exception messages, request contents or credentials. Preserve other buckets' policies and behaviour; do not refactor unrelated rate limiting.

Required focused tests: each new bucket denies on missing Redis, initialization failure and limiter exception with legacy flag true and false; these failures cause zero provider calls; new-bucket logs omit both an identity sentinel and exception-message sentinel; successful limits and quota denial preserve exact limits/headers; existing flag-dependent buckets and whyYourFirmAssist retain behaviour.

Fresh main already includes @playwright/test1.62.1. Root may use it for automated E2E and rendered checks without adding a dependency. Use app3301 and wrapper3300 from section15.
## 17. Execution amendment: use the repository's npm standard
Decision owner: Astra (root, gpt-6-astra), 2026-09-24.
Fresh shared main 18b51a62ff79d19d0a5706deebfcd7087cfa288d contains package-lock.json and no pnpm-lock.yaml. Its CI installs with npm ci. The earlier pnpm commands are therefore replaced by:
1. npm ci
2. npx vitest run src/lib/desired-client src/components/desired-client src/app/api/tools/desired-client-matter
3. npx vitest run followed by the exact scoped/new and existing shared-limiter test paths.
4. npx tsc --noEmit
5. npm run lint
6. npm run build
7. npx playwright test --config=playwright.desired-client.config.ts
8. npx playwright test --config=playwright.desired-client-embed.config.ts
Only one agent installs dependencies in the shared worktree. Preserve package-lock.json byte-for-byte; no dependency upgrades, package-manager migration or new lockfile. Required GitHub checks remain required. Record actual check outcomes, including pre-existing failures if present.

## 18. Execution amendment: accurate tool-index disclosure
Decision owner: Astra (root, gpt-6-astra), 2026-09-24.
The existing tools index labels Desired Client Browser-local and lists it in a row claiming no submission occurs. That is inaccurate for optional AI. Extend the narrowly scoped tools.html change as follows:
- Desired Client card meta: Optional AI assistance.
- Browser-local row Current routes cell: Intake Handoff Review, Paid Search Decision.
- AI-assisted row Current routes cell: Firm Voice Builder, Why Your Firm, Desired Client (optional).
Preserve every other card, table definition and method statement. This correction accompanies the exact new welcome and privacy disclosures; it does not enable AI or authorize deployment.


## 19. Execution amendment: preserve complete structured briefs and validate restored results
Decision owner: Astra (root, gpt-6-astra), 2026-09-24.
The model's 600-character definition limit is a generated-output guard. A deterministic definition can legitimately exceed it when the lawyer supplies three optional fields of up to180 characters. Never truncate those inputs. Preserve the exact section02 template, including a supplied service area appended to the definition; only an absent service area uses a separate factual note.
For a saved structured result, first validate canonical answers and result metadata. Rebuild the brief locally. Retain saved wording-reviewed status only when source revision and complete saved content match that rebuilt brief. Reject corrupt saved results; do not send a request to validate a draft.
Add src/lib/desired-client/output.ts as a pure browser-safe model-result validator, with output.test.ts. The backend owner implements this module; the app storage code reuses it to validate saved AI output. It has no provider dependency, network call or server-only import. The provider adapter, when authorized, imports the same validator. This separation does not authorize the blocked Google Gemini connection.
Deterministic provenance for definition uses the supplied work-other path when nonblank, otherwise focus.work; similarly for role-other; then situation.timing and focus.route, adding focus.certainty when provisional and focus.service_area when supplied. This keeps all claim sources within six references. Explicitly unknown preview goals/roles use their fixed unknown placeholders; all capacity=change directions keep the capacity question open, and unheard client concerns are classified unknown.


## 20. Execution amendment: original creation date and consistent source details
Decision owner: Astra (root, gpt-6-astra), 2026-09-24.
Add generatedAt:string (a valid ISO timestamp) to SavedBrief metadata. Set it in the browser when a new structured brief is created or a new accepted AI result arrives. Preserve it through review acknowledgement, resume, copy and download. A changed brief gets a new timestamp. The brief's Created date uses this original timestamp; the download filename uses the current local export date. No timestamp is sent to the model.
Add sources.ts as a pure shared helper for human-readable source question labels, resolved answer labels and the exact statement-kind labels in02. The result view and both export formats use it. Copy/export must include evidence labels and source-answer details, the exact working-draft footer, all seven sections and a separate optional Work to promote less section. Never fold less-promoted work into Marketing. Show the fixed empty Still to check sentence when applicable. Do not duplicate supplied service-area text already in the definition.
Markdown exports escape user-controlled Markdown/HTML syntax as literal content; preserve all supplied text without truncation. A denied localStorage read is unavailable storage, not evidence of a corrupt draft; show the storage-unavailable notice while allowing in-memory completion.


## 21. Execution amendment: required unknowns remain actionable
Decision owner: Astra (root, gpt-6-astra), 2026-09-24.
Semantic review of the structured fixtures found that an explicit unknown in a required field could otherwise coexist with the claim that no unresolved core question was identified. Extend deterministic Still to check coverage without adding questionnaire fields or AI clarification codes:
- At the existing capacity priority, capacity=unknown: "Establish how much of this work the firm can support." Source delivery.capacity. Capacity=change retains its existing text.
- After experience conflict, direction.aim=unknown: "Clarify how this work supports the firm's future direction." Source direction.aim.
- Next, value.reasons=[undecided]: "Establish why this work is worth pursuing for the firm." Source value.reasons.
- After unknown role, situation.timing=unknown: "Establish when this client usually seeks help." Source situation.timing.
Keep all other relative priorities and the maximum of three checks. Optional blanks do not become required questions. The five-code AI clarification bank and its two-question maximum remain unchanged.


## 22. Execution amendment: retain economics and firm direction in the result
Decision owner: Astra (root, gpt-6-astra), 2026-09-24.
The structured brief must include the supplied fee/effort assessment and firm direction even when the selected reasons do not repeat them.
Preserve the delivery_conditions limit of four statements:
1. Selected delivery conditions plus an optional Important limit sentence, citing their respective fields. If no conditions or limit are supplied, use the existing unknown-condition note.
2. Capacity and the existing applicable comparison-refinement or build-first note.
3. "Fee compared with effort: [context-appropriate label]." For new/exploring work the prefix is "Expected fee compared with effort:". Source value.fee_effort. Kind is unknown for unknown, hypothesis for a known new/exploring expectation, otherwise experience.
4. Optional commercial ranges. Prefer not to answer supplies no fee range and is omitted from this paragraph. Retain supplied hours/payment bands.
Under What supports this definition, add "Direction sought: [direction aim label]." Source direction.aim, kind preference, or unknown when aim is unknown. This is explicitly a stated firm goal, not capability evidence. Tests must show these core answers remain visible with optional limit and ranges together.


## 23. Integration file placement and review corrections
Astra decision during implementation, 24 September 2026:
- The question renderer is `src/components/desired-client/QuestionStage.tsx`; the controller imports its scoped stylesheet from `src/components/desired-client/desired-client.css`. This replaces the earlier illustrative QuestionPage/CSS file placement without changing routes or behavior.
- The server page owns the sole main landmark and standalone public-site header. The controller must not add a duplicate header or nested main. Standalone links go to `https://caseloadselect.ca` and `https://caseloadselect.ca/tools.html`.
- The fixed “No unresolved core question…” sentence appears only when both open_questions and distinct dismissed clarification presentation notes are absent.
- Suppress a separate supplied-area note only when the definition contains the exact phrase `Service area supplied: ${area}.`; an arbitrary substring match cannot hide supplied data.
- The review screen provides distinct direct-edit links for Focus and Situation as well as the remaining stages. New/exploring routes use contextual reason labels, rather than claiming established experience.
- The reducer itself clears custom work/role wording whenever a non-Other choice replaces it. UI callback cleanup is not a substitute for this invariant.
- Existing saved drafts must not be overwritten by welcome Begin buttons without the prescribed replacement confirmation. Back from Focus reloads the saved-draft choices. Clearing a draft requires confirmation and a failed storage removal must be reported.
- Repeated Generate clicks while loading cannot dispatch additional requests. The client enforces the specified 16-second timeout, ignores aborted/stale requests after edits or clearing, and preserves the three-attempt run bound.

## 24. Rendered integration decisions and regression checks
Astra decision from actual Chrome review, 24 September 2026:
- Clarification options are explicit full-width action buttons. A radio arrow-key change must not send answers or navigate the flow immediately.
- A stage heading and identical fieldset legend are not both rendered as visible headings. Keep the legend visually hidden for accessible group naming.
- Optional text inputs retain their exact accessible label, with the privacy sentence immediately after the input. A custom help sentence supplements it.
- Confirmation dialogs use the native modal dialog API for keyboard focus containment, Escape cancellation and focus restoration.
- Embedded screen changes focus the heading with preventScroll and use the verified parent message protocol. The child must not scroll the outer page through scrollIntoView.
- Responsive rules must override the desktop :has preview selector at <=1023px. Measured wrapping corrections preserve full available text tracks and natural line flow.
- Print includes source answers even when their on-screen disclosures are collapsed. A visible-source assertion is required, not just a title/status assertion.
- A dedicated `.github/workflows/desired-client.yml` runs the direct browser journey with fictional/mocked data on relevant pull requests. It follows the repository Node20/npm/Playwright pattern, has read-only contents permission, no live model keys, and retains evidence for seven days. The paired website/app fixture is a local integration check; it does not require a second private-repository checkout in CI.

## 25. Final rendered and framing review decisions (Astra, 24 September 2026)
- Bind the new catch-all framing exclusion to `tools/desired-client-matter/?$`. The exact route and trailing-slash alias use the existing embed policy; similarly prefixed siblings and deeper paths retain the strict main-app framing denial. Keep a regression test using Next's own path matcher.
- At widths up to 380px, give the app an 8px horizontal inset and remove the brief's nested panel inset/border. Retain 16px body text. Use 24px question/review/result titles, with the Value-stage question at 28px and natural wrapping. Retain a 16px inset on the standalone welcome screen. Use 16px option-card padding up to 360px and 12px at 361–380px, plus 17px naturally wrapping review introduction text. Keep the tested full-width text tracks. These phone adjustments supersede the earlier title/padding defaults at this breakpoint only.
- Display the deterministic `Fee compared with effort: ` fact as a semantic label/value pair in the brief view, while preserving the exact stored and exported statement and its provenance. Other statement rendering is unchanged.
- Allow pretty wrapping on the wrapper introduction where the observed phone layout ended in a single word. Re-measure all six prescribed widths; CSS declarations alone do not pass the gate.
- Support a paired full browser review through `DESIRED_CLIENT_FULL_REVIEW=1` with `playwright.desired-client-embed.config.ts`. This runs the existing direct and embed tests together and writes `review-browser-results.json`. The CI direct browser job remains independent of a second repository checkout.
- Final Linux/Chrome CI correction: at <=380px, question guidance uses natural wrapping; the Value-stage helper uses 17px type. The full 20-test direct browser journey passed at 8f5ec9d6 without line-break or viewport exceptions.
## 26. Consent authorization and Gemini adapter (Astra, 25 September 2026)
Adriano expressly authorized the previously specified optional external processing: only after the user chooses AI assistance, confirms consent and clicks “Prepare my brief with AI”, send that run’s validated selected answers, optional wording and commercial ranges to Google Gemini. This authorization covers implementing the scoped app path. It does not authorize changing production configuration, merging or deploying.

Implemented according to sections 7–8: existing `@google/generative-ai`, `gemini-2.5-flash`, temperature 0.2, JSON schema, 4096 output-token ceiling and 12000 ms SDK timeout; one call per explicit attempt, no retry; same-origin/body/envelope validation first; flag/key/Upstash readiness check; sequential per-attempt/per-IP daily/global fail-closed buckets; server-computed clarification eligibility; strict grounded output validation; no-store result/failure responses. Provider errors are not logged. CI and local route tests mock Gemini and Redis. No real provider call or production setting change is part of this implementation.

## 27. Audit fixes after real provider and user-journey testing (Astra, 25 September 2026)
Adriano requested bug and friction testing before his own review. The resulting changes are confined to the existing tool and its tests.

- A real Gemini request rejected the original schema as too complex. The provider schema now uses plain string source IDs instead of repeating the large source-path enum. The server still strictly validates every source path. Provider arrays carry the same small cardinality limits as the validator; text limits remain in the prompt and server validation.
- Supply a keyed map of canonical question labels, resolved answers and unknown status. Commercial range IDs must never be guessed. All answer-derived text remains untrusted input.
- Bound Gemini 2.5 Flash reasoning to 512 tokens. Retain temperature 0.2, 4096 total output-token ceiling, the 12-second provider deadline, 16-second browser deadline and one request without automatic retries. The original dynamic setting repeatedly timed out; the final five fictional profiles completed in 5.5 to 6.9 seconds.
- Attempt index 2 has no eligible clarification codes. Follow-up and retry requests return to the visible review/loading state, with a status message and the structured alternative available.
- SavedBrief may contain optional openClarificationCode metadata. Save/load validates it against current answer eligibility, and resumed briefs and exports retain the unanswered question. Older drafts without this field remain supported.
- The desired direction is a preference or hypothesis, not demonstrated success. Keep client identity separate from the person making contact, and make recommendations test the firm's profile rather than accept an individual matter.
- Narrow provenance exception: only marketing.validation_step may be a suggestion citing unknown source answers when recommending how to resolve those gaps without assuming their values. All other unknown-source restrictions remain. Positive and negative regression cases protect this boundary.
- The review includes all supplied core and optional answers in its six editable groups. Use full-width label/value rows for legibility on phones. Show selection limits before interaction.
- Preserve the first-contact answer in the brief and exports, keep separate statements for two selected goals, and replace an unspecified-work marketing topic with a concrete instruction to choose the work first.

Real provider testing used fictional profiles and the existing local key. It did not exercise the public route with live Redis: the required Redis settings are currently production-only. No production configuration, quota storage, merge or deployment was changed. See AUDIT_2026-09-25.md for results and remaining limits.
