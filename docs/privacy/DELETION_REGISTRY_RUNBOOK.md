# Encrypted deletion registry: operator runbook and threat model

Status: implementation merged; production activation pending. Activation
remains incomplete until the approval-gated rollout completes. This document
is not authorization to configure Redis, change a plan, deploy, apply a
migration, contact counsel, or perform a deletion/backfill/replay.

Deployment retry note (2026-09-04): PR #214 merged the bounded registry-audit
route, but its Git-integrated production builds were rate-limited before the
route could deploy. This documentation-only change exists solely to request
fresh Git-integrated preview checks. It changes no runtime, migration,
environment, authentication, audit, or replay behavior, and its merge still
requires separate approval.

## Purpose and boundary

The external registry gives a restore replay source that is independent of
Supabase. It stores only encrypted, versioned intent coordinates and aggregate
receipts. GHL, Meta, Resend, Supabase Storage, and Supabase remain separate
systems of record; this registry never stores message bodies, emails, telephone
numbers, provider selectors, storage paths, access tokens, or customer text.

The feature stays off unless `PRIVACY_DELETION_REGISTRY_ENABLED=true` and a
valid 32-byte base64 encryption key plus the existing Upstash credentials are
provided through the approved secret-management path. An enabled registry that
is missing, malformed, or unreachable is closed by design.

The required secret names are `PRIVACY_DELETION_REGISTRY_ENCRYPTION_KEY` and
`PRIVACY_RECOVERY_CONTROL_TOKEN`, plus the existing Upstash REST credentials.
Never place their values in this runbook, a request body, a ticket, or logs.

## Normal deletion sequence

1. The service resolves the public lead reference to the tenant-scoped stable
   `screened_leads.id` UUID. If it is absent, the request returns an
   enumeration-safe no-op. The public reference is never stored externally.
2. In one Redis script, the service verifies the external circuit is `open`
   and creates the immutable encrypted `intent` with `SET NX`. This closes the
   lock/SCAN admission race.
3. The tenant-scoped stable-UUID Supabase redaction RPC then makes the local
   terminal mutation and suppresses pending sends/outbox work.
4. The service writes an immutable `applied` receipt. Provider cleanup remains
   in the existing pending durable-manifest/evidence workflow; this registry
   neither requires nor invokes a provider adapter.
5. Storage cleanup and the existing completion RPC clear the transient database
   manifest only after the established completion evidence is present, while
   retaining only an aggregate count/status summary.

If any step fails, the coordinator reports failure. It must not substitute a
database-only success or log raw candidate data.

## Service-only endpoint contract

All calls use `POST /api/internal/privacy-recovery` and the dedicated
`x-privacy-recovery-token` header. Worker responses contain aggregate counts;
firm discovery returns tenant UUIDs used only to coordinate complete backfill.
The endpoint never returns subject/candidate identifiers. Unknown fields are
rejected.

The endpoint is the sole supported authority for these transitions. Direct
invocation of the service-role recovery RPCs is prohibited: the database cannot
read the external activation marker, so only this endpoint may supply the
`p_registry_activated` assertion after reading Upstash.

- Lock: `{ "action": "lock" }`
- Begin: `{ "action": "begin", "operation": "backfill" | "replay" }`
- Discover initial-backfill firms: `{ "action": "listBackfillFirms",
  "cycleId": "<begin response>", "afterFirmId": "<optional last UUID>",
  "limit": 100 }`. Continue with the returned last firm UUID until
  `exhausted` is true.
- Diagnose a paused initial backfill: `{ "action": "diagnose", "operation":
  "backfill", "cycleId": "<begin response>", "cycleStartedAt": "<begin
  response>", "firmId": "<one discovered firm UUID>" }`. This service-only,
  bounded check reads at most one already-redacted candidate and exercises
  random 60-second Redis lease/checkpoint keys. Its response contains only
  fixed readiness booleans and one of `control`, `database_candidate_read`,
  `redis_lease_eval` (including Redis client construction), or
  `encryption_checkpoint`; it never returns raw errors,
  coordinates, URLs, tokens, plaintext, or ciphertext. Re-lock after any
  failed diagnostic and remediate before retrying a worker.
- Audit a completed initial backfill while both circuits are locked:
  `{ "action": "auditBackfillRegistry", "cycleId": "<same DB cycle>",
  "operationId": "<terminal backfill operation UUID>",
  "expectedIntentCount": <aggregate DB count> }`. This service-only action is
  read-only: its storage interface exposes only `GET` and bounded `SCAN`. It
  scans only `privacy:deletion-registry:v2:*`, stops after 100 pages or 1,000
  returned keys, and fails closed on unknown key shapes, transient keys,
  malformed/authentication-failing ciphertext, or linkage/accounting drift.
  Its response contains only fixed counts, booleans, and one of `control`,
  `registry_scan`, `key_shape`, `encrypted_envelope`, or `record_linkage`.
  It never returns Redis keys, IDs, hashes, cursors, ciphertext, decrypted
  fields, URLs, tokens, provider metadata, or raw exceptions. A valid result
  proves the expected intent, seal, terminal operation, and progress records
  share the supplied cycle and operation and that every non-control value is
  an authenticated encrypted envelope.
- Run replay: `{ "action": "run", "operation": "replay", "operationId":
  "<new UUID>", "cycleId": "<begin response>", "cycleStartedAt":
  "<begin response>", "limit": 100 }`
- Run initial backfill: the same payload with `operation: "backfill"` and one
  required `firmId`. Reuse one operation UUID until it is terminal.
- Open: `{ "action": "open", "operation": "replay", "operationId":
  "<completed replay UUID>", "cycleId": "<same cycle>" }`

The database owns `cycleId` and `cycleStartedAt`; operators must copy both from
the begin response. A client timestamp never defines certified coverage.

## Required preflight before production migration

The sensitive production environment variables are captured when Vercel builds
a deployment. After configuring them, merge an approved Git PR and use only the
resulting Git-integrated production deployment. Do not use a direct production
deploy. Confirm that this deployment has the registry enabled and that the
operational routes fail closed while the external circuit is locked before
applying any database migration. If the first lock call cannot persist the
database state because the control RPC does not exist yet, the external circuit
must still remain locked; apply the pushed migrations in order, call lock again,
and then verify both locks before continuing.

The disposable real-Postgres CI job must also execute
`src/lib/__tests__/privacy-screened-lead-redaction.integration.test.ts` against
the fresh local Supabase stack and report 14 passed tests with 0 skipped. Never
run that fixture suite against production: its terminal-mutation fixtures are
removed only when the disposable stack is torn down. A skipped or failed suite
blocks migration and activation.

## Initial activation (approval-gated)

1. Lock first. Apply the current pushed migrations before any backfill. The
   migration itself forces the database control row to `locked` and starts a
   new recovery cycle.
2. Begin `backfill`, paginate `listBackfillFirms` to exhaustion, and run one
   backfill operation to completion for every returned firm. This cycle-bound
   database function discovers the authoritative eligible set; operators must
   not construct or omit the list manually. Backfill uses the database keyset
   `(requested_at, id)`, frozen at the DB cycle start, and the stable internal
   lead UUID. Its encrypted per-intent and cursor state is resumable in Upstash.
3. Keep the database and external circuit in `replaying/backfill` while those
   firm operations run sequentially. Firm completion proofs accumulate for the
   same cycle. After every discovered firm is complete, lock once, run the
   aggregate registry audit, and only after its fixed result is valid begin the
   global `replay` operation.
4. Before the permanent external activation marker
   exists, the DB refuses replay if any eligible historical firm lacks a
   completed backfill. Exhaust the entire Redis SCAN to cursor `0` with an
   empty buffer and zero unresolved failures.
5. Open only with the completed replay operation and matching cycle. The DB
   opens idempotently, the permanent external activation marker is persisted,
   and only then does the external circuit open. Backfill alone can never open.

## Restore/replay procedure after activation (approval-gated)

1. Obtain written approval for the exact restore and replay scope. Do not start
   a backup restore from this code or runbook.
2. Use the separately authenticated recovery endpoint to set `locked`. The
   external circuit is written before the durable database state. Confirm that
   operational API/webhook/cron/admin routes return the closed response.
3. Restore only under the separately approved recovery procedure. Immediately
   call the lock endpoint again because the restored database may contain an
   old `open` control row. If that RPC is unavailable because the backup
   predates the control schema, apply the current pushed migrations while the
   external circuit remains locked, then call lock. In every case, apply and
   verify the pushed migrations and confirm both locks before continuing. The
   permanent external activation marker rejects backfill; begin a global
   replay and retain the returned cycle coordinates.
4. Run one operation UUID in batches of at most 100 until terminal. Redis
   `SCAN COUNT` is only a hint: the worker buffers oversized pages, continues
   through empty pages, deduplicates keys, and is exhausted only at cursor `0`
   with an empty buffer. The defensive ceiling is 10,000 keys per returned
   page. Checkpoints store only stable UUID suffixes and the encrypted record
   has an 800,000-character application cap; the tested worst-case page drains
   without skipped keys and round-trips below that cap. A larger provider page
   fails closed before its cursor is checkpointed. Every mutable write is
   lease-token conditional, and terminal progress plus aggregate accounting
   commits atomically.
   Recovery replay stops after the tenant-scoped database redaction and durable
   registry receipt succeed. It does not inspect, delete, acknowledge, or mark
   complete any provider or Storage cleanup; those records remain in their
   separate pending evidence workflow.
5. Reconcile aggregate totals and every provider exception through the approved
   evidence process. Keep the circuit locked if any batch fails.
6. Only after documented reconciliation and a distinct approval may recovery
   move from `replaying` to `open`.

## Initial historical backfill details

The service-only database function
`list_privacy_deletion_registry_backfill_firms` discovers every eligible firm
through a cycle-bound UUID keyset. For each discovered firm,
`list_privacy_deletion_registry_backfill_candidates` is the authoritative,
tenant-scoped candidate source. It returns no more than 100 stable coordinates,
requires the current cycle UUID and exact DB-owned upper bound, and uses a
`(requested_at, id)` keyset cursor. The worker persists cursor, retry, and
per-intent progress in encrypted Upstash records and writes a sanitized
`backfill-seal` aggregate. The database refuses first replay if any discovered
firm lacks a completion proof. There is no automatic cron. Failed or incomplete
backfill remains closed.

## Threat model

| Threat | Control |
| --- | --- |
| Redis value swapping or kind confusion | AES-256-GCM AAD binds envelope version, record kind, and stable ID; schemas validate after decrypt. |
| Restore resurrects a subject | Intent is written before external/local mutation; circuit blocks operational API paths until replay reconciliation. |
| Lock begins while a deletion is admitted | Circuit check and normal intent creation are one Redis operation; stable-ID DB mutation requires DB `open`. |
| Registry outage silently permits a deletion | Enabled registry fails closed before the local terminal mutation. |
| Replay leaks or amplifies PII | Replay/backfill batches are capped at 100 and write aggregate-only evidence; malformed values are counted, not logged. |
| Tenant crossover | Intent contains tenant/lead coordinates; local coordinator calls tenant-scoped RPCs; recovery candidate RPC requires a firm UUID. |
| Public RPC invocation | Tables/functions explicitly revoke `PUBLIC`, `anon`, and `authenticated`; only `service_role` receives execute. |
| Recovery endpoint reuse | It has a distinct timing-safe token and returns no state read/candidate data. |
| Stale or concurrent recovery worker | Single-operation lease is renewed, and every mutable/evidence checkpoint is conditional on the current lease token. |
| Old cycle checkpoint reused | DB cycle UUID and DB-owned start time are embedded in encrypted state and validated by source, completion, and open RPCs. |
| Send/outbox race | Existing redaction transaction suppresses pending outbox/message work and database guards reject linked late inserts; the recovery circuit blocks routes before handlers run. |

Residual risks requiring review: provider deletion guarantees, Redis retention
and regional residency, key rotation/re-encryption procedure, and a real
Postgres two-connection concurrency test. None is represented as complete by
this PR.
