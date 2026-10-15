# Agency follow-up journeys

## Current delivery boundary

The Agency CRM follow-up feature supports versioned template drafts, reviewer approval, versioned journey schedules, one-prospect enrollment, per-message approval, durable scheduling, and a deterministic fake-provider dispatcher. No real email provider is configured. The fake dispatcher is an internal local operation and has no API route or scheduled trigger. It must not be used as evidence that a message was sent.

Before any real provider is considered, add a separately reviewed adapter and operational controls. Keep final eligibility, shared contactability history, conversation stop signals, recipient hash, content hash, reviewer identity, approval timestamp, due time, and minimum spacing checks immediately before provider handoff.

## Authoring and versioning

- Template content is immutable. Create a new `template_key` version for changed copy, then record an operator approval on that version.
- Journey configuration is immutable. Create a new `journey_key` version for changed steps, timezone, business days, local window, or minimum spacing.
- Steps reference approved template versions and have ordered step numbers with business-day delays.
- Activating a draft retires the previous active version for that key in one database transaction. Existing enrollments retain their original journey and template references.
- Review and authoring events are append-only and include the operator identity.

## Scheduling and worker states

Enrollment computes and persists each step's due instant in the configured IANA timezone, using the configured business days and local window start. Immediately before fake-provider handoff, the worker checks the current local weekday and full half-open window `[start, end)`. A delayed claim outside that window is rescheduled to the next configured local opening. Step delays and minimum spacing are applied before the individual prospect is released. Message approval moves that message to the durable `scheduled` queue.

The claim function uses `FOR UPDATE SKIP LOCKED` and a bounded lease. A claimed message is reloaded against current prospect and shared Agency history before the fake adapter is called. A changed suppression, eligibility decision, identity, message hash, reviewer, or review timestamp prevents handoff. Definitive retryable failures use the same logical idempotency key and bounded backoff. Permanent failures stop. A provider interruption or expired lease becomes `unknown`; it is quarantined and never automatically retried.

## Migration, release, and rollback

The migration may be applied to a disposable loopback Supabase stack for the explicitly authorized synthetic walkthrough, only after verifying that the target has a distinct disposable project identity and the migration blob exactly matches a pushed branch. That local test does not authorize production changes. Production migration/release still requires the pushed migration, CI's fresh-Postgres checks, code review, and separate explicit release approval. Never use the pre-existing database or import real firms, people, or conversations.

After an approved migration, rollback should first disable the worker entrypoint and retire active journey versions. Pause active enrollments and preserve message and event history. Do not drop tables or delete audit records. If a schema correction is needed after rows exist, ship a forward repair migration that preserves foreign keys and immutable history. This branch does not merge or deploy and does not perform production database or provider actions.

## Local verification

Use synthetic prospect, reviewer, and message fixtures. The fake provider must remain network-free. The local walkthrough starts the actual Next app with process-only test credentials, seeds only synthetic rows into the verified disposable stack, signs an operator session cookie, and drives the actual operator page with Playwright. It covers normal authoring and approval plus duplicate enrollment, pause, suppression, invalidated approval, retry, and UNKNOWN quarantine. `npm run agency-followup:walkthrough` runs automated checks and writes screenshots plus a summary under ignored `test-results/agency-followup-walkthrough`; `npm run agency-followup:manual` opens the signed synthetic operator page in a headed browser and keeps the local server alive until Ctrl+C. Both modes leave their synthetic audit and fixture rows in the disposable database; discard the scratch stack to remove them. Never point these commands at any existing or production database. Never copy real credentials into files or print cookie/key values. Browser checks use the actual operator page with synthetic data at 1440, 1024, 768, 640, 375, and 320 CSS pixels.

From the repository root in PowerShell, with the isolated walkthrough stack already started and verified:

```powershell
$env:AGENCY_FOLLOWUP_DISPOSABLE_DATABASE_CONFIRMATION = 'YES-LOCAL-DISPOSABLE-ONLY'
npm run agency-followup:walkthrough
```

Use `npm run agency-followup:manual` instead to open the headed operator page. It creates the same isolated synthetic operator and prospect fixtures, then stays open until Ctrl+C. The runner independently checks the scratch project ID, loopback API/DB ports, both migration ledger versions, both migration blobs against their verified pushed branch revisions, and the service-role-only CRM table grants before seeding anything. It reads local Supabase keys into process memory only.

## 2026-10-14 synthetic walkthrough report

A full local synthetic walkthrough passed with exit code 0 earlier on 2026-10-14; that is historical evidence only. Fresh full reruns on the current PR head have not completed. One reached the actual operator page, which returned 200 after a slow compile, but no client chunks loaded before the hydration timeout. Later runs using both default Turbopack and Webpack exited after the 10-minute startup bound without binding loopback port 55435 or writing Next stdout/stderr. A lightweight `next --version` eventually returned 16.4.0 after about 100 seconds, which confirms unusually slow local module loading but does not establish its cause. The runner uses `--webpack` to match the repository `dev` script and the earlier run that reached the operator page. On PR commit `5357d1a9c8b3c57b15538ebdb7aa654b204ad361`, 89 Agency CRM tests passed across 13 files, including operator UI contracts, follow-up services, prospect routes, and import routes. This is useful code-level evidence but does not verify the rendered journeys.

On pushed PR head `c3aa3e8fd08fa4bb47b7c91d44a3581d48db9d96`, the screenshot runner now scrolls the page to the top immediately before each full-page viewport capture, keeping fixed mobile navigation evidence consistent. Local ESLint completed with zero errors and four existing unused-variable warnings. The exact-head PR CI passed ESLint, TypeScript, the full Vitest suite, operator-login and Secure Import rendered-copy gates, render parity, and both Vercel preview statuses. The real-Postgres job passed fresh-stack migration startup, publication/privacy integration, restore rehearsal, and the prospect-enrichment database contract. It then passed all 21 Prospect Enrichment rendered/intake-review Playwright tests and uploaded the prospect-enrichment-rendered-evidence artifact (107 files, about 39 MB). This is a separate CRM journey and does not verify the Agency Follow-up operator journey.

On 2026-10-14, the automated local Agency walkthrough passed on pushed branch `codex/crm-operator-walkthrough-20261013` at commit `cc173d3348a0e41fdfe882c941f5246682a6164a`. The Docker Linux engine was available to the elevated walkthrough process; ordinary sandboxed shell probes still received access denied for its named pipe. Docker reported 25 containers, 22 running, and WSL reported `docker-desktop` running. The walkthrough completed with exit code 0.

- The runner verified disposable project ID `crm-followup-walkthrough-20261013`, loopback API and database ports, migration versions `20261013154000` and `20261013230354`, the exact migration blobs on the pushed branch, six follow-up tables, and Agency CRM grants before seeding.
- Confirmed the follow-up API returns 401 without an operator session and 200 with the synthetic signed operator session.
- Passed template create/approve, journey create/activate, exact prospect search, enrollment, eligibility, per-prospect release, and per-message approval.
- Passed duplicate enrollment protection, pause behavior, suppression blocking, approval invalidation after content changes, accepted fake-provider persistence, UNKNOWN quarantine without retry, weekend-window rescheduling, concurrent claim exclusivity, and stale-lease rejection.
- Verified rendered copy and horizontal overflow at 1440, 1024, 768, 640, 375, and 320 CSS pixels. The six current queue screenshots are `screenshots/queue-{1440,1024,768,640,375,320}.png`; the machine-readable result is `summary.json` under ignored `test-results/agency-followup-walkthrough`. The screenshots also show synthetic fixtures left by earlier runs in this same disposable database, so the queue contains more than the six records seeded by this run.

This run seeded one synthetic operator and six synthetic prospects into the existing disposable local database; it did not reset the database, and the synthetic audit and fixture rows remain there. No production database, real contact, or real provider was accessed, and no message was sent. The fake provider is local-only and network-free.

### Run the walkthrough

From the repository root in PowerShell, start and verify the dedicated scratch stack, then run:

```powershell
$env:AGENCY_FOLLOWUP_DISPOSABLE_DATABASE_CONFIRMATION = 'YES-LOCAL-DISPOSABLE-ONLY'
npm run agency-followup:walkthrough
```

The runner checks the scratch identity, loopback endpoints, migration ledger and pushed migration blobs, and required grants before writing synthetic rows. Use `npm run agency-followup:manual` to open the signed synthetic operator page in a headed browser. The manual run remains open until Ctrl+C. Both commands are local-only and must never be pointed at an existing or production database.

## 2026-10-15 acceptance follow-up status

PR #402 merged on 2026-10-15 at 01:18 UTC as `c6b70214058a41040aeb5c484f4ba493f10f299d`. This follow-up is separate work on `codex/crm-followup-acceptance-20261014`; it does not change production or merge PR #402 again.

The acceptance changes in this worktree are not yet validated. They add stable transition waits, open and closed mobile navigation checks, point-hit occlusion checks for the heading and authoring control, and viewport checks at 1440, 1024, 769, 768, 767, 640, 375, and 320 CSS pixels. The worker unit fixture now models scheduled due times and covers early exclusion, acceptance at the retry instant, the five-attempt limit, and permanent failure. UNKNOWN remains terminal and is never automatically reclaimed.

A baseline walkthrough attempt on `c6b7021` stopped with `Cannot find module 'pg'`; it did not connect to the disposable database, seed rows, run a browser, or capture screenshots. The attempt record is `test-results/agency-followup-walkthrough/baseline-ed5ff68b-2a5a-4e05-9b24-5944bcb2f4c9.json`. The latest edited-source attempt then failed before the walkthrough loaded: `node --import tsx` raised `Error: spawn EFTYPE` from the partial `tsx/esbuild` install under Node 24.14.0. The focused worker-test command passed the metadata-secret scan, then exited with 1 because `vitest` was not recognized. The exact commands, outputs, UTC timestamps, source commit, dirty status, and diff fingerprint are recorded in `test-results/agency-followup-walkthrough/validation-attempt-a66f541b-37f5-4f6f-9d49-af498011f2be.json`. Neither latest attempt accessed the database or captured screenshots. Syntax-only TypeScript transpilation passed for the edited source and test files; the unit and full local browser/database validation remain outstanding.

The walkthrough is designed to reuse the dedicated disposable local stack without resetting it. Earlier synthetic walkthrough fixtures may remain in that stack; they are historical fixtures, not rows created by the new run. The Prospect Enrichment rendered Playwright artifact described above is separate evidence and does not establish that this Agency Follow-up walkthrough passed. A completed run must link each screenshot hash to its run ID and record source commit, working-tree fingerprint, UTC times, command, exit status, and migration identities.

### Execution checkpoint: dependency repair and stronger acceptance

The follow-up execution restored the missing local stack configuration from the prior D: walkthrough worktree after verifying its project ID, ports and disabled analytics setting. Starting the installed Docker Desktop brought the existing disposable containers back online without a database reset. Read-only preflight verified both required migration versions, their fetched origin/main blob identities, all six follow-up tables and the expected CRM grants.

The runner now requires exactly one visible, enabled and unoccluded Template key input and includes an isolated negative check for a removed input. Layout capture waits for finite transitions and three stable geometry frames within five seconds. Source state is captured before the temporary route is created and checked again after cleanup; the route has its own content hash. Success summaries are emitted after cleanup, and a separate local command wrapper records actual process exit and verifies screenshot hashes.

Each fake dispatch uses temporary row locks to exclude retained scheduled fixtures without rewriting them. The retry scenario now verifies persisted acceptance at the due instant, the same logical key, exactly two attempts, one acceptance event and no repeated claim after acceptance. Worker tests also assert that early retries and terminal exhaustion, permanent-failure and UNKNOWN states make no extra provider calls.

These additional edits still require executable validation. The locked offline installation is in progress under attempt 89e845d8-ada3-4d55-b25c-b4aa5a7d0ddb; active package extraction has been measured. No new completed database/browser run or screenshot review is claimed at this checkpoint. Final results must replace this pending status before the PR is ready.

## PR status

PR #402 is merged. This follow-up PR has not yet been opened. Do not merge or deploy from this branch. Production migration and release still require CI, review, and separate explicit approval.
