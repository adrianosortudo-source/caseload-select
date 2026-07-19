---
doc-type: audit
scope: publication-operator-reopening-conditions
auditor: Claude Sonnet 5 (migration-lineage remediation-design task)
date: 2026-07-18
status: complete — conditions defined, none of them met yet
revision: corrected 2026-07-18 (v2), per reviewer correction — the CI real-Postgres job's scope (disposable Docker Postgres, not production) is now stated explicitly in this document itself, not only by reference to the parent design doc.
related-docs:
  - docs/audits/MIGRATION_LINEAGE_REMEDIATION_DESIGN_2026-07-18.md
  - docs/PUBLICATION_OPERATOR_ARCHITECTURE.md (the paused branch's own architecture doc)
---

# Publication Operator / Publishing Agent: what continues, what stays blocked, and the exact reopening conditions

## What can continue right now, without waiting on migration-lineage remediation

Anything that touches no `supabase/migrations/` file and issues no `apply_migration`/`db push`/`migration repair` call. Concretely, on the existing `feat/publication-operator` branch and in any future work in this area:

- Reading, reviewing, or discussing the branch's existing code (manifest builder, preflight taxonomy, adapters, the read-only route, the queue UI) — none of this is blocked by the freeze.
- Portal/UI work anywhere else in the app that does not add a migration file — explicitly stated as not blocked, both by the incident report ("Portal/UI work that touches no `supabase/migrations/` file is not blocked by this freeze") and unaffected by anything in this remediation design.
- Further design work, documentation, or planning for the Publication Operator or a future Publishing Agent, as long as it stays design/documentation and does not merge, apply, or execute anything.
- Running the existing non-integration test suite against the branch (as already done in the prior corrective pass) — this exercises application logic only, never production, and was never blocked by the freeze.

## What remains blocked, and why

- **The branch's two proposed migrations** (`20260718120000_publication_receipt_standing_authorization_release_path.sql`, `20260718121500_publication_destination_configs.sql`) stay exactly what they are today: authored, reviewed, committed to the branch, **not applied**. The freeze this document's parent design doc addresses applies to every new migration entering production, not only to migrations directly connected to this incident's own root cause — adding more history on top of an unresolved ledger compounds the problem, which is precisely what the incident report's own "Publishing Operator scope note" already states.
- **A DRG dry-run pilot that requires any new migration** stays blocked for the same reason. (Note: the most recent pilot found `content_placements` has zero rows in production for every firm — a data-population question, not a migration question. If a future pilot only needs to populate rows in already-existing tables via the existing, already-applied schema, that is a data operation, not a migration, and is evaluated on its own merits, separately from this freeze. It is not automatically unblocked by anything in this document — it needs its own explicit authorization, since writing real placement/claim rows is a production write with its own hard-boundary implications this document does not relax.)
- **A constrained Publishing Agent build** (the eventual system that would execute a valid, version-bound manifest) stays blocked in its entirety while the migration-lineage freeze is active, because it is very unlikely to be buildable to completion without at least one new migration (at minimum, the two already-proposed ones, and plausibly more for the claim → manual-publish → receipt → verification workflow the original Publication Operator brief deferred to "after" this exact corrective pass).

## Exact conditions required before each item reopens

### 1. Reopening the prepared Publication Operator branch (further code changes, not migrations)

- The branch may be rebased onto current `origin/main` and have non-migration code changes made to it (bug fixes, test additions, documentation) at any time — this was never gated by the freeze. State this explicitly so a future session does not over-apply this document's caution to work that was never blocked.

### 2. Applying its two proposed migrations

All of the following, in order:
- Migration-lineage remediation Option is selected and the acceptance gates in the parent design doc's Workstream F are fully satisfied (data-engineer/human review, disposable-DB rehearsal, `supabase db push --dry-run` succeeds cleanly against production, branch protection re-verified).
- The chosen remediation is actually executed against production and independently re-verified afterward (a fresh `list_migrations` pull confirms no more duplicate-version pairs for the reconciled set, and `supabase db push --dry-run` computes a clean plan).
- Only after that: the two Publication Operator migrations are reviewed fresh (schema may have moved further in the interim; re-diff against current production before applying), approved by a data-engineer or the operator, and applied via the now-restored normal `supabase db push` path — not via a special-cased exception to the freeze.

### 3. A DRG dry-run pilot

- Requires nothing beyond what's already true today IF it only exercises the existing, already-applied dry-run/preflight code path against already-existing tables (no new migration, no new database write). The prior pilot already did this and is not blocked.
- If a future pilot decision is made to populate real `content_placements`/claim rows for DRG's real content (a decision explicitly deferred, not made, in the original Publication Operator release): that is a production **data** write, gated by the original release's own hard safety boundary ("no production database migrations or writes"), and needs its own explicit operator authorization at the time — this document does not grant it, and completing migration-lineage remediation does not automatically grant it either.

### 4. The constrained Publishing Agent build

- All of condition 2 (both proposed migrations actually applied, using the restored normal path).
- The controlled claim → manual-publish → receipt → verification workflow (explicitly deferred by the original Publication Operator brief's own "step 7") is designed and reviewed as its own piece of work, not assumed to already be covered by anything in this document.
- The real-Postgres integration gate is genuinely available and used for verification before anything in this workflow is trusted. **Stated explicitly here, not only by reference to the parent design doc:** this repository's existing CI job ("Publication concurrency integration tests (real Postgres)") runs `supabase start` against a fresh, disposable Postgres instance inside the CI runner's own Docker environment. That is real and valuable — it proves migrations replay correctly and that the tested code paths behave correctly against a genuine Postgres server. **It is not, and cannot be, a validation of production's actual Supabase-hosted migration ledger or Supabase-platform-specific runtime behavior** (connection pooling, platform-level extension pre-installs, Supabase Auth/Storage internals, real `pg_cron` scheduling) — it never connects to the production project at all. Do not treat "CI's real-Postgres job passed" as evidence that a change is safe against production; it is evidence the change is safe against a disposable local Postgres, which is necessary but not sufficient. Separately: one of the four real-Postgres-gated integration test files in this repository (`content-attribution-scope.integration.test.ts`) is not currently run in that CI job at all — confirm that gap is closed, or is irrelevant to whatever the Publishing Agent build touches, before relying on the job's green status for anything involving that code path.
- Every hard safety boundary from the original Publication Operator brief remains in force, unchanged, for the eventual agent itself, restated here because this is the terminal document a future "start building the Publishing Agent" session is most likely to read first:
  - It may only execute a valid, version-bound manifest — never generate, rewrite, summarize, or otherwise invent content.
  - It may never infer an external destination (a website domain, a LinkedIn page, a GBP location) from historical evidence when explicit, operator-set configuration is available and should be preferred; where no explicit configuration exists, it blocks rather than guesses. (The `publication_destination_configs` proposed migration exists specifically to make this possible; until it's applied, this constraint is enforced by the existing evidence-tier fallback in `publication-execution-manifest.ts`, which is weaker and known to be weaker — see that file's own corrective-pass documentation.)
  - It may never bypass an approval or standing-authorization gate. The two release paths (individual lawyer approval, standing publishing authorization) are the only two ways a version may ever be released, and both must remain independently, cryptographically/structurally traceable to a real actor and a real event — never inferred, never defaulted.
  - It may never claim a publication happened without a verifiable receipt. A "successful publish" with no receipt, or a receipt whose evidence cannot be independently reconciled against the actual external platform, is not success — it is exactly the kind of synthetic evidence the original brief prohibited outright.

## What this document deliberately does not do

It does not evaluate whether the Publication Operator's existing design is otherwise sound (that was the subject of the prior corrective-pass review cycle, already completed and already responded to). It does not propose new Publication Operator features. It does not authorize any of the four reopening paths above — it only defines, precisely, what would have to be true before each one is authorized, so that a future session (or the same operator, later) can check the actual state against this list rather than re-deriving it from memory.
