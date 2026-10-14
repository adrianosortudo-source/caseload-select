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

The full local synthetic walkthrough passed with exit code 0 on 2026-10-14.

- Verified the dedicated disposable project ID, loopback API, migration versions `20261013154000` and `20261013230354`, migration blobs on the pushed branch, six follow-up tables, and Agency CRM grants before seeding.
- Confirmed the follow-up API returns 401 without an operator session and 200 with the synthetic signed operator session.
- Passed template create/approve, journey create/activate, exact prospect search, enrollment, eligibility, per-prospect release, and per-message approval.
- Passed duplicate enrollment protection, pause behavior, suppression blocking, approval invalidation after content changes, accepted fake-provider persistence, UNKNOWN quarantine without retry, weekend-window rescheduling, concurrent claim exclusivity, and stale-lease rejection.
- Verified rendered copy and horizontal overflow at 1440, 1024, 768, 640, 375, and 320 CSS pixels. Six screenshots and `summary.json` are written under ignored `test-results/agency-followup-walkthrough`.

The disposable local database was reset before the clean run so the screenshots contain only the current synthetic records. The migration was applied only to that local disposable database. No production database, real contact, or real provider was accessed, and no message was sent.

### Run the walkthrough

From the repository root in PowerShell, start and verify the dedicated scratch stack, then run:

```powershell
$env:AGENCY_FOLLOWUP_DISPOSABLE_DATABASE_CONFIRMATION = 'YES-LOCAL-DISPOSABLE-ONLY'
npm run agency-followup:walkthrough
```

The runner checks the scratch identity, loopback endpoints, migration ledger and pushed migration blobs, and required grants before writing synthetic rows. Use `npm run agency-followup:manual` to open the signed synthetic operator page in a headed browser. The manual run remains open until Ctrl+C. Both commands are local-only and must never be pointed at an existing or production database.

## PR status

PR #402 remains open as a draft. The local synthetic walkthrough is complete; GitHub CI and preview checks must pass for the current PR head before any merge review. Do not merge or deploy from this branch. Production migration and release still require CI, review, and separate explicit approval.
