# Encrypted deletion registry: operator runbook and threat model

Status: implementation candidate. It is disabled by default. This document is
not authorization to configure Redis, change a plan, deploy, apply a migration,
contact counsel, or perform a deletion/backfill/replay.

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

## Normal deletion sequence

1. The service creates an immutable encrypted `intent` record using the request
   UUID, tenant UUID, surrogate lead identifier, fixed reason, and timestamp.
2. The tenant-scoped Supabase redaction RPC may then make the local terminal
   mutation and suppress pending sends/outbox work.
3. The service writes an immutable `applied` receipt. Provider cleanup remains
   in the existing pending durable-manifest/evidence workflow; this registry
   neither requires nor invokes a provider adapter.
4. Storage cleanup and the existing completion RPC clear the transient database
   manifest only after the established completion evidence is present, while
   retaining only an aggregate count/status summary.

If any step fails, the coordinator reports failure. It must not substitute a
database-only success or log raw candidate data.

## Restore/replay procedure (approval-gated)

1. Obtain written approval for the exact restore and replay scope. Do not start
   a backup restore from this code or runbook.
2. Use the separately authenticated recovery endpoint to set `locked`. The
   external circuit is written before the durable database state. Confirm that
   operational API/webhook/cron/admin routes return the closed response.
3. Restore only under the separately approved recovery procedure. Move the
   state from `locked` to `replaying`.
4. Run the approved service-only coordinator in batches of at most 100. It
   reuses original request UUIDs, treats malformed registry values as aggregate
   failures, and writes an immutable aggregate `replay-run` record. Do not copy
   candidate output into tickets or logs.
5. Reconcile aggregate totals and every provider exception through the approved
   evidence process. Keep the circuit locked if any batch fails.
6. Only after documented reconciliation and a distinct approval may recovery
   move from `replaying` to `open`.

## Legacy backfill

Backfill has no discovery query or automatic cron. An approved, tenant-scoped
candidate source supplies no more than 100 existing intents per run. The
coordinator uses normal idempotent request UUIDs and writes a sanitized
`backfill-seal` aggregate. A failed backfill stays failed; it must not open the
circuit or create a broad scan.

## Threat model

| Threat | Control |
| --- | --- |
| Redis value swapping or kind confusion | AES-256-GCM AAD binds envelope version, record kind, and stable ID; schemas validate after decrypt. |
| Restore resurrects a subject | Intent is written before external/local mutation; circuit blocks operational API paths until replay reconciliation. |
| Registry outage silently permits a deletion | Enabled registry fails closed before the local terminal mutation. |
| Replay leaks or amplifies PII | Replay/backfill batches are capped at 100 and write aggregate-only evidence; malformed values are counted, not logged. |
| Tenant crossover | Intent contains tenant/lead coordinates; local coordinator calls tenant-scoped RPCs; recovery candidate RPC requires a firm UUID. |
| Public RPC invocation | Tables/functions explicitly revoke `PUBLIC`, `anon`, and `authenticated`; only `service_role` receives execute. |
| Recovery endpoint reuse | It has a distinct timing-safe token and returns no state read/candidate data. |
| Send/outbox race | Existing redaction transaction suppresses pending outbox/message work and database guards reject linked late inserts; the recovery circuit blocks routes before handlers run. |

Residual risks requiring review: provider deletion guarantees, Redis retention
and regional residency, key rotation/re-encryption procedure, and a real
Postgres two-connection concurrency test. None is represented as complete by
this PR.
