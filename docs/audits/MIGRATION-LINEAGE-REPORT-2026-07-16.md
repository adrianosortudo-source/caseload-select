---
doc-type: audit
scope: supabase-migration-lineage
auditor: Claude Sonnet 5 (corrective-release finding 8)
date: 2026-07-16
status: complete
---

# Migration lineage report, 2026-07-16

Comparison of the production Supabase migration ledger (`ssxryjxifwiivghglqer`,
queried live via `list_migrations`) against `supabase/migrations/*.sql` in this
repository, at repository tip `322de19` (origin/main after PR #36). Read-only
comparison; no repository file outside this report and the two trivial
stale-reference fixes below was modified as part of this check, and no
production schema was touched.

Method: for every ledger entry, checked for a repository file whose filename
prefix exactly equals the ledger's recorded `version`. The reconciliation
convention this repo already uses (established by PR #23 and PR #28,
"reconcile N migration filenames to their actual production versions") is
that the filename prefix must equal the full-precision applied version, with
the migration's original/authoring name preserved as a suffix where it
differs (e.g. `20260715191243_20260715130200_publication_receipts.sql` for
ledger version `20260715191243`, name `20260715130200_publication_receipts`).
Older migrations (pre-2026-06-05, short `YYYYMMDD_name` filenames) predate
that convention; Supabase's own tooling assigns them a full-precision applied
timestamp at push time that legitimately differs from the authoring-date
filename. That is expected, normal Supabase behavior, not drift, and is not
itemized below -- this report only surfaces cases where the exact-precision
convention was in effect (2026-07-01 onward, and any renamed/reconciled
migration explicitly) and still doesn't hold.

## Confirmed clean

Every migration from `20260702152906` (`promote_scoring_port_default_on`)
through `20260715231733` (`publication_receipt_hardening_supplement`) --
which is the entire lineage this corrective release's findings 1-6 actually
touch -- has an exact filename-prefix match in the repository. No drift in
the neighborhood this release modifies.

## Findings

### 1. Seven production-applied migrations have no repository file at all

Confirmed two ways: (a) no file anywhere under `supabase/migrations/` has a
matching filename prefix, and a full-text grep of the directory for the
migration's evident subject matter (`deliverable_suggestion`,
`fee_detail_fields`) found nothing; (b) for the two spot-checked cases, the
live schema was queried directly and the objects exist and are real:
`deliverable_suggestions` and `deliverable_suggestion_events` tables are
live in `public` (via `information_schema.tables`), and
`publication_artifacts_dedupe_idx` is a live unique index on
`publication_artifacts` (via `pg_indexes`) whose definition matches exactly
what its ledger name implies.

| Ledger version | Ledger name | Repo file |
|---|---|---|
| `20260712183638` | `add_firm_profile_fee_detail_fields` | none found |
| `20260713185849` | `pdf_artifact_integrity` | none found |
| `20260713234759` | `deliverable_suggestions` | none found |
| `20260713235455` | `deliverable_suggestion_atomic_workflow` | none found |
| `20260714001604` | `deliverable_suggestion_fk_indexes` | none found |
| `20260714011950` | `deliverable_suggestion_release_hardening` | none found |
| `20260715232702` | `20260715234500_publication_artifacts_dedupe_partial_index` | none found |

These seven are consecutive or near-consecutive in the ledger and sit
immediately before the `publication_metadata`/`publication_artifacts` series
that IS fully present (`20260714141535` onward), suggesting these were
applied directly (Supabase MCP `apply_migration` or the SQL editor) in a
session that never wrote the corresponding file to `supabase/migrations/`
and never committed it -- the same class of gap PR #23/#28 partially closed
for an earlier batch, recurring here for a later one.

### 2. One filename/version mismatch on a migration merged today

`supabase/migrations/20260716000000_firm_assist_corpus.sql` is the repo file
for the `firm_assist_corpus` migration (merged via PR #34/#36, "Firm
Assist"), but the ledger recorded its actual applied version as
`20260716022452` -- six digits different from the filename's `000000`
placeholder. Same defect class as #1, applied to a migration that landed
during this same release window (a live illustration that the gap in
finding #1 is an ongoing process risk, not only historical).

## What this report does NOT do

Per the corrective-release scope boundary: this is a read-only report, not a
fix. Reconstructing the seven missing migration files (from live schema
introspection, since their original authored SQL is not recoverable from
git history if it was never committed) and renaming
`20260716000000_firm_assist_corpus.sql` to its recorded version belong in a
**separate, non-applied migration-hygiene PR**, not in this corrective
release. No repository migration file's *content* was modified by this
report; the only files this corrective release touches are the stale
filename-reference comments fixed below (pure comment/documentation edits,
zero SQL change) and the new forward-only corrective migrations this release
adds for findings 1 and 4, whose filenames are set to their actual
Supabase-assigned versions from the moment they're applied (per the
requirement that new corrective migrations use their real production-recorded
version from the start).

## Incidental fixes bundled with this report (not migration reconstruction)

Three source comments referenced the pre-reconciliation filename
`20260715195701_content_periods_enforced_monotonic.sql` for a migration
whose real, currently-applied name is
`20260715210116_content_periods_enforced_monotonic.sql` (confirmed applied
to production via the ledger). Fixed as pure comment edits, no SQL changed:

- `scripts/verify-content-periods-enforced-monotonic.sql` (the specific file
  finding 6 asked to correct)
- `src/lib/deliverables.ts` (a docblock reference)
- `src/app/api/portal/[firmId]/periods/[periodId]/deactivate-readiness/route.ts`
  (a docblock reference)
- `src/lib/__tests__/deactivate-period-readiness.test.ts` (also corrected an
  now-inaccurate "NOT applied to production" claim in the same comment --
  the ledger confirms this migration IS applied)

## Update: concurrent-session activity during this same corrective release

Two things happened after this report was first written, both directly
relevant to it and both confirming its own thesis about this repo's
recurring apply-without-committing risk:

1. **Item #1's `20260715232702` gap was closed by a concurrent session,
   independently, before this report could recommend it.** PR #37
   ("chore(migrations): recover missing publication_artifacts dedupe
   partial-index migration") recovered
   `20260715232702_publication_artifacts_dedupe_partial_index.sql`
   byte-for-byte from the ledger's stored `statements` and merged it to
   `origin/main`. No DB change; the recovered file is a no-op on production
   (the version is already in the ledger) and self-healing on a fresh
   build. This item is now resolved; the remaining six items in the table
   above (`add_firm_profile_fee_detail_fields` through
   `deliverable_suggestion_release_hardening`) are still open.

2. **A live collision, in this exact same corrective release, over
   `validate_publication_receipt_scope()`.** While applying this release's
   own finding-1 migration (concurrency locking), a second, independent
   session applied `20260716144315` (`publication_receipt_verification_after_revision_fix`,
   a real, separate correctness fix) to the SAME function moments earlier.
   Because both migrations used `CREATE OR REPLACE FUNCTION` and this
   release's migration was authored from a pre-fetch of the function that
   predated the other session's fix, applying it silently reverted the
   other session's live production fix. Caught immediately (via
   `pg_get_functiondef` inspection right after applying), corrected within
   minutes by a third migration
   (`20260716144723_publication_receipt_reconcile_concurrency_lock_merge.sql`)
   that merges both fixes, and re-verified against production. See this
   release's final report for the full incident account.

   The other session subsequently committed its own fix as PR #39
   (`supabase/migrations/20260716120000_publication_receipt_verification_after_revision_fix.sql`,
   merged to `origin/main`). That file's own filename prefix
   (`20260716120000`) does not match its real, ledger-recorded applied
   version (`20260716144315`) -- **a third, live instance of exactly the
   drift class this report exists to catch, discovered while this very
   report was being written.** This corrective release's own byte-recovered
   copy of the same fix (originally filed at the correct
   `20260716144315_...` name) was removed once PR #39's officially-authored
   version landed, to avoid two files representing the same fix; PR #39's
   file is the one that should eventually be renamed to
   `20260716144315_publication_receipt_verification_after_revision_fix.sql`
   in the migration-hygiene follow-up below. This release's own
   `20260716144510` and `20260716144723` files were both correctly named
   from the moment they were applied and remain so.

This is the same underlying risk finding #1 above describes (apply now,
commit the file later, and meanwhile a second author touches the same
function) -- just observed live, twice, instead of only inferred from the
ledger. It reinforces the recommendation below, particularly the CI-check
item: a same-function collision window would have been far safer with an
`OR REPLACE`-aware CI check flagging "this migration redefines a function
another uncommitted, already-applied migration also touches."

## Recommendation

Open a dedicated migration-hygiene PR (separate from any corrective release)
that: (a) introspects the live schema for the seven objects above and
reconstructs equivalent, idempotent migration files under their correct
ledger-recorded filenames; (b) renames
`20260716000000_firm_assist_corpus.sql` to
`20260716022452_firm_assist_corpus.sql` with identical content; (c) renames
`20260716120000_publication_receipt_verification_after_revision_fix.sql`
(PR #39) to `20260716144315_publication_receipt_verification_after_revision_fix.sql`
with identical content; (d) adds a CI check (or extends an existing one)
that fails a PR introducing a new `supabase/migrations/*.sql` file whose
filename prefix doesn't match what `apply_migration` actually recorded, to
stop this class of drift recurring a fourth time.
