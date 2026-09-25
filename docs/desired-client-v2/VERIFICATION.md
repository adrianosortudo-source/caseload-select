# Desired Client V2 verification
Date: 2026-09-24. Status: final local checks running. Not released.

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
| Scoped unit/regression tests | PASS: 83 tests across 9 files, including the existing shared limiter tests, new fail-closed buckets, answer/output validation, draft expiry, reducer lifecycle, exports, disconnected API, and exact framing-header boundary. |
| Full repository lint | PASS: zero errors, 373 warnings. Final changed view/harness/header files also passed focused ESLint after subsequent edits. |
| TypeScript | Pending: rerun after the production build regenerates Next types. The earlier failure was confined to malformed generated development types. |
| Production app build | Running: asset, marketing-copy and scheduled-route guards passed; production compilation is in progress. |
| Combined real-browser review | PASS: 27 tests, including all six direct and embedded viewport checks. `review/review-browser-results.json` records the final combined run. |
| Structured-output semantic review | PASS for the seven fixed variants in `review/structured-fixtures.json`; see `REVIEW.md`. This is not a live AI-output assessment. |
| Website ACTS guard | PASS before and after final static build. |
| Website static build | PASS. Output includes the wrapper, stylesheet and embed script. The generated cleanup target was verified inside the isolated worktree. |
| Website scripts | Both embed script and local fixture passed `node --check`. |
| Whitespace | `git diff --check` passed in both worktrees. |
| Live AI/provider integration | NOT IMPLEMENTED: blocked on the explicit provider authorization requested below. |
| Production configuration | NOT VERIFIED OR CHANGED. |
| Five-lawyer usability study | NOT RUN. No recruitment messages were sent. |
| GitHub CI | Check the attached draft PRs for current status. Local checks are not a substitute for required PR checks. |

## Browser evidence and coverage
The paired browser run uses installed Chrome, the app on localhost:3301 and the website fixture on localhost:3300. Every test uses fictional answers. The current acceptance record is `review/review-browser-results.json`; screenshots are in the same directory.

Coverage includes six viewports (1440, 1024, 768, 640, 375 and 320), welcome/focus/value/review/brief presentation, native keyboard controls, dialog Escape/focus behavior, optional comparison, no-typing unknown route, no-AI completion/resume/export with zero analyze requests, AI outage/network fallback, bounded mocked clarification attempts, stale-response cancellation, clipboard denial, draft expiry/clearing, source answers in print, and iframe origin/source checks plus stable growth/shrinkage. AI-success browser scenarios use intercepted fictional responses; the actual local API is separately checked to return controlled `AI_DISABLED` with no-store.

Before/after evidence retains `before-768-value-layout.png` and `before-1440-welcome-wrap.png`. No viewport or editorial exception was waived. These checks cover the named fixtures and states, not every possible user-written phrase or a usability study.

## Provider authorization: outstanding work
Automatic approval review rejected writing the Google Gemini adapter because trusted authorization did not explicitly specify the answer payload and external destination. Root requested permission to implement opt-in transmission of selected answers, optional wording and commercial ranges to Google Gemini, plus fictional-input tests. No answer to that request has arrived. No workaround, provider request or production setting change was attempted.

The route intentionally stops after same-origin/content-type/body-size/strict-envelope validation and returns `503 AI_DISABLED`. It does not read a provider key, read an enable flag, consume Redis quotas or call a model. Input/output contracts, the pure prompt/schema, isolated future limiter buckets, client request lifecycle and browser fallback are present. This is a disconnected scaffold, not a completed AI adapter awaiting only a switch.

After approval, the remaining implementation is the server-only adapter, route orchestration with the prescribed fail-closed distributed limits and settings, mocked API success/error/timeout tests, and authorized fictional live-output review. Production configuration checks and explicit approval of each specific PR merge remain separate release gates.

A prior name-only local configuration check found `GOOGLE_AI_API_KEY` present; `GEMINI_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` and `DESIRED_CLIENT_AI_ENABLED` absent. Values were neither displayed nor copied. This does not establish production configuration.

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
The structured path is implemented. The full AI-enabled release is not ready while the provider work and human/live review gates remain open. Draft PRs are for review only; do not merge or deploy from this report.

Dependency-install observation: npm reported 15 existing audit findings (1 low, 6 moderate, 6 high, 2 critical). No dependency was added/upgraded and no audit-fix command ran. This report does not claim a vulnerability triage.
