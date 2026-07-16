---
doc_meta:
  version: v1
  status: Ready for execution
  owner: Adriano Domingues
  author: Claude (Fable, audit session 2026-07-16)
  executor: Claude Code (Sonnet 5)
  created: 2026-07-16
  updated: 2026-07-16
  scope: caseload-select-app + drg-law-website (F6c only)
---

# Build Plan: Firm Assist hardening fixes (Ses.18 audit)

## 1. What this is

Firm Assist v1 shipped 2026-07-16 (PRs #34, #36, #38, #40; see
`docs/BUILD_PLAN_firm_assist_v1.md`, whose Execution status section is the
authoritative record of what is live). A same-day audit of the merged code
found two HIGH exposures, two MEDIUM defects, one git hygiene problem, and
a LOW batch. This plan specifies the fixes. The audit findings are also
mirrored as rows in `00_System/FOLLOWUPS.md` (dated 2026-07-16, source
"Firm Assist audit (Ses.18)"); flip each row to Done as its fix ships.

No new Decision Records are needed: every fix enforces existing doctrine
(DR-100/101/102, the Database Access Invariant, and the APP-003 SSRF
posture from the Jim Manico audit).

## 2. Read before starting

1. `docs/BUILD_PLAN_firm_assist_v1.md`, Execution status section (what is live and how it was verified).
2. `src/lib/safe-outbound-fetch.ts` (the APP-003 wrapper F2 must adopt: `safeFetch(url, options): Promise<SafeFetchResult>` with `{ok, status, body, reason}`, redirect defaults to "manual", timeout defaults to 8000ms).
3. `src/app/api/assist/[firmId]/route.ts` and `src/lib/assist/` (the code under repair).
4. App `CLAUDE.md` sections: Database Access Invariant, Developer Gotchas + Deploy-Safety.

## 3. Stop-lines

- Do NOT change the public wire contract of `POST /api/assist/[firmId]` or `GET .../config`. The DRG site module is deployed against `{ok, exit, answer_html, sources: [{title, url}], message}`. Internal changes only.
- Do NOT touch `src/lib/screen-engine/` or any intake route.
- No schema changes. Every fix here is code-side; `assist_queries.source_page_ids` is jsonb and holds ids without a migration.
- Do NOT commit anything on `fix/restore-marketing-homepage` and do NOT push that branch. F5 is the only operation that touches it, and F5 removes commits, never adds them.
- The uncommitted `CLAUDE.md` working-tree edit in the main checkout (the DR-103 axis-naming paragraph, another session's in-flight work) must survive F5 byte for byte.
- Do NOT re-seed the DRG corpus with `{seed: true}`; F7's reindex verification uses `{seed: false}`.

## 4. Execution flow (do this once, work inside it)

The main checkout at `05_Product/caseload-select-app` carries unrelated
uncommitted work on `fix/restore-marketing-homepage`. Do all code work in
an isolated worktree off `origin/main`:

```bash
cd /d/00_Work/01_CaseLoad_Select/05_Product/caseload-select-app
git fetch origin main
git worktree add ../caseload-select-assist-fixes-wt -b fix/assist-hardening origin/main
git config --global --add safe.directory D:/00_Work/01_CaseLoad_Select/05_Product/caseload-select-assist-fixes-wt
```

Known environment gotchas from the build session:

- The worktree checkout of ~1300 files can exceed a 2-minute command timeout on this machine. Run it with a long timeout or in the background; if it is interrupted, remove the stale `index.lock` under `.git/worktrees/<name>/` and run `git reset --hard HEAD` inside the worktree to finish materializing files.
- D: is exFAT: install dependencies inside the worktree with `pnpm install --config.node-linker=hoisted` (pnpm is at `C:\Users\adria\AppData\Roaming\npm`; prepend to PATH). `package.json` already carries the `pnpm.onlyBuiltDependencies` block.
- Test with `npx vitest run src/lib/assist src/app/api/assist src/app/api/admin/assist` (should go from 82 to ~95+ tests) and `npx tsc --noEmit` (pre-existing errors exist only under `caseload-intake-batch/` and one `tool-intake` test; zero errors are allowed in files this plan touches).

This plan file itself exists only as an untracked file in the MAIN checkout.
Copy it into the worktree at the same path and include it in the PR so the
repo carries its own fix record (delete the untracked main-checkout copy
after the merge lands, since it would otherwise shadow the tracked one).
Note the F5 stash briefly holds this file; read the plan fully before F5.

Ship as ONE PR: `fix(assist): hardening pass from Ses.18 audit (spend cap, SSRF, cron scaling)`.
Branch protection requires green CI (typecheck, full vitest, engine sync, DR-039 eval, Vercel);
`gh pr merge <n> --squash --delete-branch=false` after checks pass, then confirm the
production deployment reaches READY (`npx vercel ls --prod` from the main checkout, which is linked).

## 5. F1 (HIGH): per-firm daily spend ceiling on the answer route

`src/app/api/assist/[firmId]/route.ts` currently has only the per-IP
Upstash bucket, which fails open because the Upstash env vars are unset
(OP-1 below). The build plan's per-firm daily ceiling was never
implemented. CORS does not stop curl with a spoofed Origin header, and the
firmId is public in the DRG page bundle, so today the endpoint is
unmetered Gemini spend. Abuse also drains the shared `GOOGLE_AI_API_KEY`
quota that the Screen engine's intake extraction depends on.

Spec:

- New constant + env override: `ASSIST_DAILY_CEILING`, default 500, parsed once per request from `process.env.ASSIST_DAILY_CEILING` (invalid or missing value falls back to 500).
- Placement: after question validation and the per-IP bucket, BEFORE `embedQuery`, so capped requests cost nothing.
- Check: `select count` (head count, same pattern as the config route) on `assist_queries` where `firm_id` matches and `created_at >= now minus 24h`. If `count >= ceiling`, return 429 with the CORS headers and body `{ok: false, error: 'daily limit reached, try again tomorrow'}`.
- On a count-query ERROR: log a `console.warn` and allow the request (repo convention: telemetry and guard-rail infrastructure failures never hard-block a public surface). When the count succeeds, the ceiling is hard.
- Tests (extend `src/app/api/assist/[firmId]/__tests__/route.test.ts`): at-ceiling returns 429 and `embedQuery` is never called; under-ceiling proceeds; count-error proceeds with a warn.

## 6. F2 (HIGH): route corpus ingestion through the SSRF-safe fetch

`src/lib/assist/corpus-ingest.ts` `fetchText()` fetches sitemap-supplied
URLs with plain `fetch`: no private-IP filter, redirects followed. A
malicious or compromised client-site sitemap could point ingestion at
cloud metadata or internal hosts, and the response text would become
retrievable corpus content. The repo already has the correct primitive.

Spec:

- Replace `fetchText`'s internals with `safeFetch(url, { timeoutMs: 15_000 })` from `@/lib/safe-outbound-fetch`. Keep the existing user-agent header. On `!result.ok`, throw `new Error(result.reason ?? String(result.status))` so all existing error handling and `last_crawl_status` stamping is unchanged. Redirects stay at the safeFetch default ("manual"); a 30x therefore records as a crawl error, which is the honest state for a page that moved.
- Same-site gate at seed time, as a pure helper in `corpus-ingest-pure.ts`: `isSameSiteUrl(url, seedOrigin)` returns true only for http(s) URLs whose host equals the seed host or its `www.`/bare-host variant. Apply it in `seedPagesFromSitemap` to BOTH sitemap-index child URLs and page URLs. Offsite URLs are skipped entirely (never inserted, so a poisoned sitemap cannot flood `assist_corpus_pages`); count them in a new `skipped_offsite` field on `SeedResult`.
- `reindexFirm` needs no host gate of its own: rows only enter the table through the gated seed or through an operator (already authorized), and `safeFetch` blocks the private-address classes regardless of host.
- Note: `safe-outbound-fetch.ts` carries `import "server-only"`. That is fine here because `corpus-ingest.ts` is imported only by routes without their own vitest files; do NOT import it from `corpus-ingest-pure.ts` or any tested route.
- Tests: pure-helper cases (same host, www variant both directions, other subdomain rejected, other host rejected, http accepted, `javascript:` rejected); a seed test asserting an offsite sitemap entry is not inserted and is counted.

## 7. F3 (MEDIUM): maxDuration + cron scaling + schedule the cron

Neither assist route sets `maxDuration` (every other cron route sets 60,
seo-check sets 300), and `/api/cron/assist-reindex` loops ALL firms in one
invocation. The DRG reindex alone runs minutes; this fails at 2-3 firms.

Spec:

- `export const maxDuration = 300;` on BOTH `/api/admin/assist/[firmId]/reindex/route.ts` and `/api/cron/assist-reindex/route.ts`.
- Cron becomes one-firm-per-invocation: pick the single firm whose included pages have the oldest `min(last_crawled_at)` (nulls first), reindex only that firm, return `{ok, firm_id, ...summary}`. With N firms and a daily schedule, each firm refreshes every N days, which is within the weekly intent at current client counts.
- Resumability inside `reindexFirm`: order pages by `last_crawled_at` ascending nulls first, accept an optional `budgetMs` (the cron passes 240_000), stop processing when elapsed time exceeds the budget, and report the remainder as `pages_skipped_budget` in the summary. The operator route keeps calling without a budget.
- Schedule the job via the Supabase MCP against project `ssxryjxifwiivghglqer`, following the `20260506_pg_cron_pg_net_setup.sql` pattern exactly (`cron_internal.call_cron_route('/api/cron/assist-reindex')`), DAILY at an unused off-hour minute (e.g. `53 5 * * *`). Verify with a `select jobname, schedule from cron.job` query afterwards. This also closes the pre-audit "cron not scheduled" followup row.
- Tests: `reindexFirm` budget cutoff (mock pages, tiny budget, assert `pages_skipped_budget` counted and untouched pages not fetched) if practical with the current mocking shape; otherwise cover the firm-selection ordering as a pure helper.

## 8. F4 (MEDIUM): log real page ids in assist_queries.source_page_ids

The answer route inserts `exitResponse.sources.map(s => s.url)` into
`source_page_ids`, so an id-named column holds URLs. Fix before Phase 5
mining consumes it.

Spec: in the route, compute `const loggedIds = genResult.response.source_page_ids.filter(id => pagesById.has(id))` and insert that. Do not change `buildExitResponse` or the public `sources` shape. Update the route test that inspects the insert payload to assert ids, not URLs. Existing rows (a handful of smoke-test queries) stay as-is; note the cutover date in the PR body.

## 9. F5 (git hygiene): dedupe fix/restore-marketing-homepage, main checkout only

The local branch `fix/restore-marketing-homepage` in the MAIN checkout
carries four commits already squash-merged to main (`ab14f07`, `abf0207`,
`2a9133b`, `d6c5983`, top-down) stacked on four unrelated unpushed commits
and an uncommitted working tree that includes another session's DR-103
`CLAUDE.md` edit. Remove exactly the four duplicates:

```bash
cd /d/00_Work/01_CaseLoad_Select/05_Product/caseload-select-app
git log --oneline -4        # MUST show ab14f07, abf0207, 2a9133b, d6c5983 in that order; STOP if not
git stash push -u -m "pre-assist-dedup safety stash"
git reset --hard HEAD~4
git stash pop               # expect clean apply; on ANY conflict: git stash apply is NOT retried, stop and report
```

Verify afterwards: `git log --oneline -1` shows `1306662`;
`git log origin/main..HEAD --oneline -- src/lib/assist` is empty;
`grep -c "DR-103" CLAUDE.md` is nonzero (the other session's edit survived);
`git stash list` still holds the stash entry only if the pop failed.
Do not push the branch.

## 10. F6 (LOW batch)

- **F6a** `src/lib/assist/gemini-embed.ts`: send the API key as an `x-goog-api-key` request header instead of a `?key=` URL query parameter (keys in URLs leak into intermediate logging). Same endpoint path otherwise.
- **F6b** `src/lib/assist/answer-html-sanitize.ts`: extend `sanitizeAnswerHtml(html, allowedHosts?: string[])`. When `allowedHosts` is provided, unwrap (keep inner text, drop the tag) any `<a>` whose href host is not in the set; sanitize-html's `exclusiveFilter` or `transformTags` can express this. The answer route passes the hosts of the firm's source pages (derive from `pagesById` URLs) plus the firm's `custom_domain` when set. Omitting the argument keeps current behavior so existing tests still pass unmodified; add cases for offsite-unwrapped and firm-host-kept.
- **F6c** (drg-law-website repo, CLI-deployed): cache the `/config` result in `AskTheFirm.tsx` via `sessionStorage` key `cls-assist-config:<firmId>` with a 1-hour TTL, skipping the fetch on a fresh cache hit. Wrap all storage access in try/catch (private-mode Safari throws). Deploy with `npx tsc --noEmit`, `npx next build`, then `npx vercel --prod --yes`; live-verify the module still renders on `https://drglaw.ca/faq` and stays absent on a non-pilot page.

## 11. Operator steps (Sonnet cannot do these; surface them in the delivery report)

- **OP-1**: create an Upstash Redis database and set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` in the caseload-select Vercel project (Production), then redeploy. Until then every rate-limit bucket in the app, including `assist`, fails open; F1's ceiling is the only hard cap. This is a long-standing repo-wide posture, listed here because the assist surface raised its stakes.

## 12. Live verification after the PR merges and deploys

1. Re-run the three-intent smoke against `https://app.caseloadselect.ca/api/assist/eec1d25e-a047-4827-8e4a-6eb96becca2b` with `Origin: https://drglaw.ca` (informational lease question expects `answered` with sources; "my landlord locked me out, can I sue" expects `screen_handoff`; "capital of France" expects `no_coverage`).
2. Re-run one reindex with `{seed: false}` via `POST /api/admin/assist/<drgFirmId>/reindex` (operator cookie: mint per the technique in memory `reference_prod_smoke_test_technique`; delete the minted token file afterwards). Expect mostly `unchanged` and zero errors; this proves ingestion still works through safeFetch.
3. Confirm the pg_cron job row exists and, next day if observable, that `cron.job_run_details` shows a green run.
4. F6c: confirm the DRG module works live post-deploy as described above.
5. Verify `assist_queries` rows created by step 1 now carry page ids in `source_page_ids`.

## 13. Delivery report + bookkeeping

Per the closing-loop standing instruction: report what shipped (PR link,
merge commit, deploy READY), the live-verification evidence from section
12, test counts, and anything skipped with the reason. Then:

- Flip the six 2026-07-16 audit rows in `00_System/FOLLOWUPS.md` to Done as applicable (the Upstash half of the spend-cap row stays Open until OP-1; note that split in the row).
- Update this file's doc_meta status and append rows to the Followups table below for anything new discovered during execution.

## Followups

| Date | Source | Flag | Priority | Touches | Suggested next action | Owner | Status |
|---|---|---|---|---|---|---|---|
| 2026-07-16 | Firm Assist fixes plan v1 | Plan authored from the Ses.18 audit; awaiting Sonnet execution (F1-F6, OP-1 operator-gated) | H | 05_Product/caseload-select-app/src/lib/assist/; src/app/api/assist/; drg-law-website AskTheFirm.tsx | Execute F5 first (main checkout), then F1-F4+F6 in the worktree as one PR, then F6c CLI deploy | Sonnet | Open |
