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

## 2026-10-13 synthetic walkthrough report

The full walkthrough is not yet complete. This report separates checks that reached the application from checks blocked by the disposable stack.

### Application checks reached

- The actual authenticated Agency CRM operator page loaded and completed hydration in Playwright.
- The follow-up API rejected an unauthenticated request with HTTP 401 and returned HTTP 200 for the synthetic signed operator session.
- From the operator page, synthetic template creation returned 201, template approval returned 200, journey creation returned 201, and journey activation returned 200.
- Prospect search then returned HTTP 500 with `permission denied for table agency_prospects`. This exposed a missing `service_role` table grant in the disposable database. The additive grant migration `20261013230354_agency_crm_service_role_grants.sql` was prepared, pushed, and covered by a migration-contract test. The walkthrough has not been rerun against that migration.

The test-only dispatch route was removed by the runner on exit. Since the run stopped during prospect search, it did not produce the promised summary or screenshot set. Pause/cancel, suppression, approval invalidation, retry, and UNKNOWN quarantine were not verified in this browser/API run; their offline unit coverage is separate.

### Automated test result

The focused source contract passed with 6 tests:

```powershell
npx vitest run --pool=forks --maxWorkers=1 --minWorkers=1 src/lib/__tests__/agency-followup-migration-contract.test.ts
```

The ordinary worker-pool invocation failed during Vitest setup before collecting tests: the `tests/vitest.server-only.setup.ts` worker fetch timed out after about 266 seconds and 0 tests were collected. This was a setup failure, not a failing assertion. No full Next build result is available from this machine.

### Disposable migration and stack diagnostics

The pushed grant migration was checked against its pinned blob and the disposable project ID before an apply attempt. A read-only ledger comparison found 274 recorded migration versions, all present as matching migration filenames in the scratch project. The only scratch version absent from the ledger was the new `20261013230354` migration.

The migration command was:

```powershell
supabase --workdir 'test-results\crm-local-stack' migration up --local
```

It did not apply SQL. The initial call pointed `--workdir` at the nested `supabase` directory and reported `LegacyMigrationMissingLocalError`. Retrying from the project root after checking the project ID, migration blob, and pending ledger version failed before migration execution with `LegacyDbConnectError: failed to connect to postgres`.

Both loopback endpoints were then confirmed closed. One project-scoped `supabase stop` invocation was interrupted after it emitted no completion status. A subsequent project-scoped `supabase start` was run without reset or repair but exited 1 with `LegacyHealthCheckTimeoutError`, reporting two unhealthy containers. A filtered status check then reported no container named `supabase_db_crm-followup-walkthrough-20261013`; the read-only container inspection timed out. The local PostgREST request returned no HTTP status. Container logs and mount metadata were unavailable, so volume persistence could not be independently confirmed. No reset, repair, production connection, or migration apply occurred.

Resume only after the disposable project is healthy and its project ID, loopback endpoints, migration ledger, and CRM grants pass the runner's preflight. Do not point the walkthrough at another database to get around this local stack failure.

## 2026-10-14 CI repair update

The CI fixes are on pushed commit `f08e38ccb30f170226a30d552c882fb34b1a1bc0` in draft PR #402. The walkthrough now uses a local prospect-search response type instead of importing an unrelated UI type. The operator-origin inventory tracks `src/lib/notification-digest.ts`, where digest URLs are actually built with the shared origin policy.

The focused origin-inventory suite passed 4/4 locally. On the current PR head, TypeScript, full Vitest, ESLint, rendered-copy gates, independent widget checks, service parity/typecheck, build assets, and both Vercel preview checks passed. The real-Postgres workflow started its fresh Supabase stack and passed publication/privacy integration tests; its prospect-enrichment Postgres contract remained in progress at the last check. PR #402 remains a draft and is unmerged.

The local synthetic Agency CRM browser walkthrough is still incomplete. The disposable local stack previously failed `supabase start` with `LegacyHealthCheckTimeoutError`; its loopback services were unavailable afterward. No CRM migration was applied to that stack, no production database/provider was contacted, and no real message was sent. The pushed migration still requires successful fresh-Postgres CI validation and a healthy disposable stack before the browser walkthrough can be completed.
