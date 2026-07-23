# Build Plan: Free-Tier Deploy Guard (issue #61 corrective, v1)

DOC-META v1
- owner: operator (Adriano)
- status: authorized-for-execution
- created: 2026-07-22
- executor: Claude Sonnet (single session, zero decisions left open)
- scope: caseload-select repo + D:\00_Work\01_CaseLoad_Select\.claude config
- forbidden: any Vercel plan purchase, any `vercel --prod`/`vercel promote`/`vercel alias` execution, any migration, any change to screen-engine/, any file under (marketing)/

## Context the executor must not re-derive

Production (app.caseloadselect.ca, Vercel project `prj_nsulX2POrn1tSwTze8KwrvRsIecn`, team `team_qS5LzYPKszR4AeCUSHXi9yW3`) was clobbered twice on 2026-07-22 by direct `vercel --prod` deploys from dirty working trees (actor `codex`, and once by a Claude session). Issue #61 documents the pattern. Two native Vercel blocking mechanisms are CONFIRMED dead ends, do not retry them:

1. Rolling Releases: API returns 403 "Your current plan does not support rolling releases." Operator has declined a paid upgrade.
2. Checks API check-creation: returns 403 `invalidToken` for the project's personal access token (`VERCEL_API_TOKEN`). Vercel requires an integration OAuth token. Operator has declined the OAuth-integration build for now.

Already live and merged (PR #69): `POST /api/internal/vercel-deployment-check` receives Vercel's `deployment.created` webhook (webhook id `account_hook_AoZyV0A6ESsOp7voJlvkm9Gm`, HMAC verified via `VERCEL_WEBHOOK_SECRET`, set in the production environment). Its `createDeploymentCheck` call always fails with 403 (the dead end above), so the route currently returns 502 on every production deployment event and provides no protection. The pure decision logic in `src/lib/deploy-gate/verify.ts` (evaluateGate, gitDirty-first, fail-closed) is correct and stays.

The replacement strategy, decided by the operator: (A) block the commands at the source via a PreToolUse hook for every Claude Code session in this folder tree; (B) repurpose the live webhook from dead check-creation into an immediate operator email alarm on any dirty-tree or untraceable production deploy; (C) an AGENTS.md rule for codex, which does not honor Claude hooks.

## Execution environment

- FIRST ACTION after creating the worktree: copy this plan file from `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-app\docs\BUILD_PLAN_deploy_guard_free_tier_v1.md` (it sits untracked in the main checkout) into the worktree at `docs/BUILD_PLAN_deploy_guard_free_tier_v1.md` and include it in the Part B commit, so the plan ships with the work. At D5 cleanup, delete the untracked copy from the main checkout (`rm` that one path only, nothing else there).
- Work in a FRESH worktree from origin/main: `git -c safe.directory='*' worktree add -b chore/deploy-guard-free-tier "C:/tmp/caseload-deploy-guard-<YYYYMMDD>" origin/main` run from `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-app`. Never work in the main checkout (it is dirty with another branch's work).
- `npm install --no-audit --no-fund` in the worktree (C: drive, never install node_modules on D:).
- All git commands in the worktree need `-c safe.directory='*'`; all `gh` commands need `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0='*'` prefixed.
- The repo hook `check-banned-vocab.mjs` blocks em dashes and banned vocabulary in ALL Write/Edit content including code comments. Use commas, colons, parentheses.
- Ship via PR to main, wait for ALL CI checks (the "Publication concurrency integration tests" job is known-flaky: on failure with all tests actually passing but "Unhandled Rejection" in the log, rerun via `gh run rerun <run-id> --failed` exactly once before investigating), then `gh pr merge <n> --merge --delete-branch=false`. GitHub auto-deploys main; NEVER run any vercel deploy command.

## Part A: PreToolUse hook blocking production-deploy commands

### A1. Create `D:\00_Work\01_CaseLoad_Select\.claude\hooks\check-deploy-commands.mjs`

This file lives OUTSIDE the repo (in the operations folder's hook directory alongside check-banned-vocab.mjs etc.), so it is NOT part of the PR. Write it directly. Exact content contract:

- Node ESM script, same stdin protocol as the sibling hooks: read all of stdin, `JSON.parse` it, fields `tool_name` and `tool_input`. If stdin is TTY or empty or unparseable, exit 0 (allow, fail open for non-hook invocations).
- Only inspect when `tool_name` is `Bash` or `PowerShell`. The command string is `tool_input.command`. If absent, exit 0.
- Normalize: lowercase the command string.
- Block (exit 2 with the stderr message below) when the command matches ANY of these regexes:
  - `/\bvercel\s+(deploy\s+)?--prod\b/`
  - `/\bvercel\s+deploy\b.*--prod\b/`
  - `/\bvercel\s+promote\b/`
  - `/\bvercel\s+alias\s+set\b/`
  - `/\bvercel\s+rollback\b/`
  - `/\bvc\s+(deploy\s+)?--prod\b/`
  - Also match when the token is `npx vercel` or `npx vc` (the regexes above already match because they anchor on the word `vercel`/`vc`, verify with the tests in A2).
- Do NOT block: `vercel --version`, `vercel inspect`, `vercel env`, `vercel webhooks`, `vercel list`, `vercel logs`, `vercel redeploy` WITHOUT `--target production` (block `redeploy` only when the string also contains `--target production` or `--target=production`).
- stderr message on block, verbatim:
  `Blocked: direct production deploy/promote commands are prohibited in this project (issue #61, two dirty-tree production clobbers on 2026-07-22). Ship via PR to main; GitHub auto-deploys merged main. Emergency override: the operator may create the sentinel file D:/00_Work/01_CaseLoad_Select/05_Product/caseload-select-app/.allow-direct-deploy and re-run; the hook allows the command and deletes the sentinel so the override is single-use.`
- Sentinel behavior, exactly as the message says: before evaluating the regexes, check `fs.existsSync` on `D:/00_Work/01_CaseLoad_Select/05_Product/caseload-select-app/.allow-direct-deploy`. If present: delete it (`fs.unlinkSync` in a try/catch, ignore failure), then exit 0. Single-use by construction.
- Keep the file header comment style of the sibling hooks (path, purpose, exit codes 0 allow / 2 block).

### A2. Create `D:\00_Work\01_CaseLoad_Select\.claude\hooks\check-deploy-commands.test.mjs`

A plain Node script (no vitest, hooks folder has no package.json) that spawns the hook via `child_process.spawnSync("node", [hookPath])` feeding JSON on stdin, and asserts exit codes. Cases, all required:

1. `vercel --prod` in Bash: exit 2
2. `npx vercel --prod --yes` in Bash: exit 2
3. `npx vercel deploy --prod` in PowerShell: exit 2
4. `vercel promote dpl_abc` in Bash: exit 2
5. `npx vercel redeploy some-url --target production` in Bash: exit 2
6. `npx vercel redeploy some-url` (no target) in Bash: exit 0
7. `npx vercel env ls production` in Bash: exit 0
8. `npx vercel inspect some-url` in Bash: exit 0
9. `git push origin main` in Bash: exit 0
10. `tool_name` `Write` with any content: exit 0
11. Empty stdin: exit 0
12. Sentinel present + `vercel --prod`: exit 0 AND sentinel file removed afterward (create a temp sentinel at the real path, assert deleted, this is safe because the file never normally exists)

Run: `node "D:/00_Work/01_CaseLoad_Select/.claude/hooks/check-deploy-commands.test.mjs"`. It must print a per-case PASS line and exit 0. All 12 must pass before proceeding.

### A3. Register the hook in `D:\00_Work\01_CaseLoad_Select\.claude\settings.local.json`

Edit the existing `hooks.PreToolUse` array. It currently has ONE entry with matcher `Write|Edit` carrying four hooks. ADD a SECOND entry (do not touch the first):

```json
{
  "matcher": "Bash|PowerShell",
  "hooks": [
    {
      "type": "command",
      "command": "node \"D:/00_Work/01_CaseLoad_Select/.claude/hooks/check-deploy-commands.mjs\""
    }
  ]
}
```

Preserve every other byte of the file (permissions allowlist, disabledMcpjsonServers). Validate the result parses: `node -e "JSON.parse(require('fs').readFileSync('D:/00_Work/01_CaseLoad_Select/.claude/settings.local.json','utf8')); console.log('valid')"`.

Note: the hook registration takes effect for NEW sessions. Do not attempt to live-test it in the current session; the A2 test script is the verification.

## Part B: Repurpose the live webhook into an operator alarm

All Part B work happens in the worktree and ships via PR.

### B1. Edit `src/lib/deploy-gate/resolve.ts`

Replace the check-creation/resolution flow with an alarm flow. Precise changes:

1. Delete the imports of `createDeploymentCheck` and `resolveDeploymentCheck` usage; keep `getDeploymentInfo` and `fetchCheckRuns` and `evaluateGate`.
2. New exported function signature: `export async function evaluateAndAlarm(deploymentId: string): Promise<void>` replacing `resolveDeployGate(deploymentId, checkId)`.
3. Flow inside `evaluateAndAlarm`:
   - Fetch deployment info once via `getDeploymentInfo`. If null: send the alarm email (see B2) with reason text `deployment metadata unavailable` and return.
   - Build the same `DeploymentMeta` object as the current code.
   - If `meta.gitDirty === "1"` or no `githubCommitSha`: send the alarm immediately with the decision from `evaluateGate(meta, null)` and return. These are the two cases the operator must know about within a minute.
   - Otherwise poll: same loop shape as the current code (15s interval, 8 minute deadline) calling `fetchCheckRuns` + `evaluateGate`. While `checks_pending`/`no_check_runs`, keep polling. On a terminal decision: if `pass` is true, return silently (clean deploys produce zero email); if false (`checks_failed`), send the alarm and return.
   - On deadline expiry: send the alarm with reason text `timed out waiting for GitHub checks (8 minutes)`.
4. Keep `reasonSummary` (adjust wording only if the em dash rule requires, it currently contains none).
5. Keep the `CHECK_NAME` export DELETED (it has no consumer after this change; remove it and its import in the route).

### B2. Create `src/lib/deploy-gate/alarm.ts`

- Imports: `sendEmail` from `@/lib/email` (signature: `sendEmail(to, subject, html)`, established repo helper).
- Recipient: `process.env.OPERATOR_NOTIFICATION_EMAIL || "adriano@caseloadselect.ca"` (DR-047: never any other fallback address).
- Exported function: `sendDeployAlarm(deploymentId: string, reason: string, meta: { gitDirty?: string; githubCommitSha?: string; githubCommitRef?: string; actor?: string })`.
- Subject, exact template: `[DEPLOY ALARM] Unverified production deployment ${deploymentId}`.
- HTML body: a simple table (no external assets) with rows: Deployment ID, Reason, gitDirty, Commit SHA (or `none`), Branch ref (or `none`), Actor (or `unknown`), plus a closing line: `Inspect: https://vercel.com/adrianosortudo-7282s-projects/caseload-select` and `Rollback if needed: vercel rollback (operator only, sentinel required per issue #61 hook).` Plain declarative sentences, no em dashes, no italics.
- Best-effort: wrap the `sendEmail` call in try/catch, `console.error` on failure, never throw.

### B3. Extend `src/lib/deploy-gate/vercel-api.ts`

- `VercelDeploymentInfo.meta` gains optional fields `githubCommitRef?: string` and `actor?: string` (they are present in real payloads; passing them through enriches the alarm).
- DELETE `createDeploymentCheck` and `resolveDeploymentCheck` entirely (no consumer remains; the docstring updates to say the module now only reads deployment metadata for the alarm path, and records why the Checks API path was removed: 403 invalidToken for personal access tokens, integration OAuth token required, dead end confirmed 2026-07-22).

### B4. Edit `src/app/api/internal/vercel-deployment-check/route.ts`

- Replace the `createDeploymentCheck` + `resolveDeployGate` block with a single `waitUntil(evaluateAndAlarm(deploymentId))` and respond `Response.json({ ok: true, mode: "alarm" })`.
- Remove the 502 branch (nothing can fail synchronously anymore beyond signature/shape checks, which keep their current responses).
- Update the route docstring: it is now an ALARM, not a gate; state plainly that free-tier Vercel cannot block alias assignment and that prevention is handled by the Claude Code PreToolUse hook (`check-deploy-commands.mjs`) plus the AGENTS.md rule, with this webhook as the detection layer for anything that slips through.

### B5. Update tests

- `src/app/api/internal/vercel-deployment-check/__tests__/route.test.ts`: replace the `createDeploymentCheck`/`resolveDeployGate` mocks with a mock of `evaluateAndAlarm` from `@/lib/deploy-gate/resolve`. Keep and adapt all six cases: bad signature 403 (x2), non-deployment.created skip, preview-target skip, production path now asserts `evaluateAndAlarm` called with `"dpl_prod_1"` and response `{ ok: true, mode: "alarm" }`. The 502 case is DELETED (replaced by: `evaluateAndAlarm` rejecting does not affect the 200 response, assert via a rejected mock and a still-200 response).
- New `src/lib/deploy-gate/__tests__/resolve.test.ts`: mock `./vercel-api`, `./github-status`, `./alarm` with `vi.hoisted`. Cases, all required:
  1. dirty deployment: alarm called once, reason contains `uncommitted changes` (from reasonSummary git_dirty), no polling.
  2. no githubCommitSha: alarm called once.
  3. clean deployment, checks green on first poll: alarm NOT called.
  4. clean deployment, checks failed: alarm called once.
  5. getDeploymentInfo returns null: alarm called once.
- `src/lib/deploy-gate/__tests__/verify.test.ts`: unchanged, must still pass.

### B6. Verify in the worktree

1. `npx tsc --noEmit` — zero NEW errors (pre-existing errors live only under `caseload-intake-batch/` and `src/app/api/tool-intake/__tests__/consent-gate.test.ts`; anything else is yours to fix).
2. `npx vitest run src/lib/deploy-gate/__tests__/verify.test.ts src/lib/deploy-gate/__tests__/resolve.test.ts src/app/api/internal/vercel-deployment-check/__tests__/route.test.ts` — all pass.
3. `npx vitest run` full suite — no NEW failures versus main (record the counts).

## Part C: AGENTS.md rule for codex

### C1. Create `AGENTS.md` at the repo root (in the worktree; the file does not exist yet, verified 2026-07-22)

Exact content:

```markdown
# Agent rules for caseload-select

## Production deploys: PR-merge only (issue #61)

Never run `vercel --prod`, `vercel deploy --prod`, `vercel promote`, `vercel alias set`, `vercel rollback`, or `vercel redeploy --target production` in this repository, from any tool, agent, or working tree state. Production deploys happen exactly one way: open a PR against `main`, wait for all CI checks, merge; GitHub auto-deploys merged `main` to Vercel.

Two dirty-tree direct deploys reached production on 2026-07-22 and clobbered other sessions' shipped work. A webhook alarm now emails the operator on every production deployment that is dirty, untraceable, or CI-failed, so violations are visible within about a minute.

If you believe an emergency direct deploy is required, stop and ask the operator. Do not create `.allow-direct-deploy` yourself; that sentinel is for the operator's hands only.

## Worktrees

Never commit in `D:/00_Work/01_CaseLoad_Select/05_Product/caseload-select-app` (the main checkout) if it holds another branch's uncommitted work. Create a fresh worktree from `origin/main` on the C: drive instead.
```

This file ships in the same PR as Part B.

## Part D: Ship and close out

### D1. Commit and PR

- Single commit on `chore/deploy-guard-free-tier`, message subject: `feat(deploy): free-tier deploy guard, webhook alarm + agent rules (issue #61)`. Body must state: what was removed (Checks API path, confirmed dead end), what replaced it (alarm), where prevention now lives (hook outside the repo, AGENTS.md inside), and the verification counts from B6. End with the standard `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Push, `gh pr create` (body summarizing the same), wait for checks per the flaky-job rule, merge with `gh pr merge <n> --merge --delete-branch=false`.
- Do NOT wait for or verify the production deploy with any vercel deploy command; confirm via the Vercel MCP `get_deployment`/`list_deployments` tools that the merge auto-deploy reaches READY with `source: "git"`.

### D2. Live verification of the alarm path (read-only)

After the auto-deploy is READY: the deploy that just shipped this code was itself a clean git deploy, so NO alarm email is expected; that silence is the pass condition for the clean path. Verify the route is live: `curl -s -o /dev/null -w "%{http_code}" -X POST https://app.caseloadselect.ca/api/internal/vercel-deployment-check -d '{}'` must return 403 (unsigned). Do NOT attempt to trigger a dirty deploy to test the alarm; the resolve.test.ts unit coverage is the verification for that branch.

### D3. Ledger updates

Append one row to `D:\00_Work\01_CaseLoad_Select\00_System\FOLLOWUPS.md` (same 8-column schema as existing rows, date 2026-07-22 or the execution date): records that the free-tier deploy guard shipped (hook + alarm + AGENTS.md), that hard blocking at the Vercel layer remains impossible without a paid plan or an OAuth integration (both declined for now), and that the sentinel override exists at `.allow-direct-deploy` for operator emergencies.

Also update the existing 2026-07-22 FOLLOWUPS row about issue #61 recurrence: change its Status column from `Open` to `In progress` and append to its next-action cell: `; free-tier guard shipped (hook + webhook alarm + AGENTS.md), see BUILD_PLAN_deploy_guard_free_tier_v1.md`.

### D4. Close issue #61 with a comment, leave it OPEN

`gh issue comment 61 --body` summarizing: platform-level blocking confirmed unavailable on the current plan (Rolling Releases 403 plan-gated; Checks API 403 integration-token-gated); shipped compensating controls (list them); issue stays open as the tracking anchor for a future paid-plan or OAuth-integration upgrade. Do NOT `gh issue close`.

### D5. Cleanup

Remove the execution worktree: `git -c safe.directory='*' worktree remove "C:/tmp/caseload-deploy-guard-<YYYYMMDD>"` from the main checkout (use `--force` only if the checkout is clean and removal still fails on metadata, then `rm -rf` the leftover directory).

## Acceptance checklist (executor: verify every line before reporting done)

- [ ] A1 hook file exists, header comment matches sibling style, sentinel logic single-use
- [ ] A2 test script: 12/12 PASS lines, exit 0
- [ ] A3 settings.local.json parses, new matcher entry present, old entry untouched
- [ ] B: `createDeploymentCheck`/`resolveDeploymentCheck`/`CHECK_NAME` gone from the codebase (grep confirms zero references)
- [ ] B: alarm recipient is OPERATOR_NOTIFICATION_EMAIL fallback adriano@caseloadselect.ca, nothing else
- [ ] B6: tsc clean, targeted tests pass, full suite no new failures
- [ ] C1 AGENTS.md at repo root with the exact two sections
- [ ] D1 PR merged with all checks green (flaky-job rerun rule applied at most once)
- [ ] D2 route live returns 403 unsigned; no alarm email from the clean deploy
- [ ] D3 both FOLLOWUPS.md changes made
- [ ] D4 issue #61 commented, still open
- [ ] D5 worktree removed
- [ ] Zero vercel deploy/promote/alias/rollback commands were executed at any point
