# Desired Client V2 verification

Current audit: [25 September pre-user-test audit](AUDIT_2026-09-25.md) supersedes the earlier no-live-provider status and records the current fixes, real AI samples and remaining limits. The original implementation record below is retained as historical evidence.
Implementation: 2026-09-24. Verification updated: 2026-09-25 UTC. Status: structured workflow and consent-gated Gemini adapter implemented; adapter CI pending. Not released.

## Scope and source
- App: `codex/desired-client-v2-app`, base `18b51a62ff79d19d0a5706deebfcd7087cfa288d`.
- Website: `codex/desired-client-v2-site`, base `cd30f040504a4e78b43685c9091f96b0f40a7c76`.
- Both are isolated D: worktrees. Canonical checkouts were left untouched. See `BASELINE.md` for verified infrastructure and preflight limitations.
- The public website URL is preserved. The existing Next.js app supplies the guided tool through the existing public-tools embedding pattern.
- No database migration, new dependency, CRM write, email gate, analytics collector, production setting change, merge or production deployment.
- The six specification files and Astra's implementation amendments are under `spec/`.

## Actual checks
| Check | Result and evidence |
|---|---|
| Dependencies | `npm ci` completed. Lockfile unchanged: SHA256 `C071B15E36CDA77669B039BD73C807D3708518189A6FEC6E023FEE26429E4BE8`. |
| Scoped unit/regression tests | PASS: 83 tests across 9 files, including the existing shared limiter tests, new fail-closed buckets, answer/output validation, draft expiry, reducer lifecycle, exports, disconnected API, and exact framing-header boundary. The new API integration adds 9 route tests; the combined provider, output and limiter run passed 40 tests. |
| Full repository lint | PASS before the new adapter: zero errors, 373 warnings. Focused ESLint on the new adapter was started locally but stopped after no output; PR CI is checking the current source. |
| TypeScript | The earlier 8f5ec9d6 implementation passed CI and Vercel type checks. Local check for the newly added adapter exceeded the session window without output; the adapter commit is being checked by PR CI. |
| App production build for preview | PASS on Vercel at `8f5ec9d6` before the AI adapter change: Next 16.2.9 Turbopack, TypeScript finished, deployment READY. This is a preview, not a production release. CI will verify the adapter commit. Local Webpack compilation passed but generated-route validation failed on an inherited route export. |
| Combined real-browser review | PASS: 27 tests at `9c4ad373`, including six direct and embedded viewport checks. `review/review-browser-results.json` records that combined run. After the phone guidance CSS refinement, the complete 20-test direct journey passed in GitHub CI at `8f5ec9d6` (run 36086975434). |
| Structured-output semantic review | PASS for the seven fixed variants in `review/structured-fixtures.json`; see `REVIEW.md`. This is not a live AI-output assessment. |
| Website ACTS guard | PASS before and after final static build. |
| Website static build | PASS. Output includes the wrapper, stylesheet and embed script. The generated cleanup target was verified inside the isolated worktree. |
| Website scripts | Both embed script and local fixture passed `node --check`. |
| Whitespace | `git diff --check` passed in both worktrees. |
| Gemini server integration | Implemented behind explicit in-tool consent, `DESIRED_CLIENT_AI_ENABLED=true`, a server key and configured Upstash Redis. One `gemini-2.5-flash` request per attempt; strict schema/source/number validation; 12-second provider timeout; structured brief remains available on failures. No live provider request was made during testing. |
| Production configuration | NOT VERIFIED OR CHANGED. |
| Five-lawyer usability study | NOT RUN. No recruitment messages were sent. |
| GitHub CI | At `8f5ec9d6`, full Vitest, ESLint, TypeScript, direct Desired Client browser tests, other browser gates and Vercel previews passed. The real-Postgres concurrency job also passed; the complete main workflow 36086975409 finished successfully. Website PR 26 checks passed. See the PRs for later status. |

## Browser evidence and coverage
The paired browser run uses installed Chrome, the app on localhost:3301 and the website fixture on localhost:3300. Every test uses fictional answers. The current acceptance record is `review/review-browser-results.json`; screenshots are in the same directory.

Coverage includes six viewports (1440, 1024, 768, 640, 375 and 320), welcome/focus/value/review/brief presentation, native keyboard controls, dialog Escape/focus behavior, optional comparison, no-typing unknown route, no-AI completion/resume/export with zero analyze requests, AI outage/network fallback, bounded mocked clarification attempts, stale-response cancellation, clipboard denial, draft expiry/clearing, source answers in print, and iframe origin/source checks plus stable growth/shrinkage. AI-success browser scenarios use intercepted fictional responses; the actual local API is separately checked to return controlled `AI_DISABLED` with no-store.

A focused local real-Chrome rerun after the final CSS change passed both 375px and 320px journeys (2/2). `review/phone-browser-results.json` and refreshed phone screenshots record this check.

Before/after evidence retains `before-768-value-layout.png` and `before-1440-welcome-wrap.png`. No viewport or editorial exception was waived. These checks cover the named fixtures and states, not every possible user-written phrase or a usability study.

## Local build limitation and remote evidence
The local `npm run build -- --webpack` completed compilation but failed Next generated route validation because `src/app/api/cron/notification-batch/route.ts` exports `buildDigest`. That file has the identical Git blob (`abfd1823...`) at base `18b51a62` and implementation `8f5ec9d6`; Desired Client did not modify it. The successful Vercel build used the configured `next build` with Turbopack and completed TypeScript. The fresh CI typecheck runs `tsc` without generating the same Webpack route validators. No unrelated notification code was changed to hide this discrepancy. The default local Turbopack attempt was stopped before completion; no local production-build pass is claimed.

Verified preview deployment: `dpl_2a3kwfbgQ1pfwULSeQY2kXqjsGSR`, branch `codex/desired-client-v2-app`, commit `8f5ec9d6bb4674316e2c34e9fd964c636b7f80e8`, READY, target null (preview). URL: https://caseload-select-7sntr6f7o-adrianosortudo-7282s-projects.vercel.app/tools/desired-client-matter. Vercel sign-in is required by the existing preview protection.

Draft app PR: https://github.com/adrianosortudo-source/caseload-select/pull/317. Companion website PR: https://github.com/adrianosortudo-source/caseloadselect-site/pull/26.

## AI implementation and release boundary
Adriano authorized the proposed optional transmission: selected answers, optional wording and commercial ranges may be sent to Google Gemini only after the user chooses AI assistance, explicitly consents and clicks “Prepare my brief with AI”. This authorization covers this scoped integration, not production settings or release.

The route validates same-origin requests, content type, the 32 KB streamed body limit and strict answer envelope before checking the opt-in flag, server key and Upstash settings. It charges the per-attempt, per-IP daily and global buckets sequentially, then makes one Gemini request with a 12-second timeout. It does not retry. Invalid output is discarded by the shared strict validator. The response returns only validated content or a fixed error code, with no-store headers.

Mocked API tests pass for successful generation, answer payload/model settings, limiter order and quota denial, missing opt-in, invalid consent, provider failure, and invalid model output. No live Gemini request was made. Remaining gates are production configuration and deployed-path checks, synthetic live-output review through the release process, lawyer usability review, and Adriano approval of each specific PR merge.

The preview is not configured for live AI, and production settings were not inspected or changed. The new flag defaults to off unless explicitly set to `true`; a missing key or Upstash setting also returns controlled `AI_DISABLED`.

## Reproduce locally
From the app worktree, use the existing npm installation:

```powershell
npx vitest run src/lib/desired-client src/components/desired-client src/app/api/tools/desired-client-matter src/lib/__tests__/desired-client-rate-limit.test.ts src/lib/__tests__/desired-client-frame-headers.test.ts src/lib/__tests__/rate-limit.test.ts
npm run lint
npx tsc --noEmit --incremental false
npm run build
$env:DESIRED_CLIENT_FULL_REVIEW='1'
npx playwright test --config=playwright.desired-client-embed.config.ts
```

The paired browser config expects the sibling website worktree, or `DESIRED_CLIENT_SITE_WORKTREE` pointing to it. Run build/type checks after browser servers stop to avoid concurrent writes to Next's generated directory. The direct CI browser job needs only the app repository and never uses a provider key.

## Release status
The structured path and consent-gated AI adapter are implemented. Production release remains gated on configuration, a synthetic live review, lawyer usability review and approval of each specific PR. Draft PRs are for review only; do not merge or deploy from this report.

Dependency-install observation: npm reported 15 existing audit findings (1 low, 6 moderate, 6 high, 2 critical). No dependency was added/upgraded and no audit-fix command ran. This report does not claim a vulnerability triage.
