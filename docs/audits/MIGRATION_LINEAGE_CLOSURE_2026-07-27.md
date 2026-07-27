---
doc-type: audit
scope: supabase-migration-lineage-closure
auditor: Claude (Opus 5 plan / Sonnet 5 execution), acting as data engineer per
  explicit operator instruction 2026-07-27
date: 2026-07-27
status: >
  RESOLVED AND VERIFIED. The 2026-07-18 freeze
  (MIGRATION_LINEAGE_INCIDENT_2026-07-18.md) is LIFTED, replaced by the
  process rule in section 5 below. Production ledger and git migration files
  reconcile 1:1 (191 <-> 191, zero mismatches either direction), verified
  2026-07-27 against the live ledger.
related-docs:
  - docs/audits/MIGRATION_LINEAGE_INCIDENT_2026-07-18.md (the freeze, now lifted)
  - docs/audits/MIGRATION_LINEAGE_REMEDIATION_DESIGN_2026-07-18.md (Option 1, executed in corrected form)
  - docs/audits/MIGRATION_LINEAGE_PHASE0_2026-07-27.md (stop-the-bleeding phase)
  - docs/audits/MIGRATION_LINEAGE_PHASE1_EXECUTION_PLAN.md (first plan; its Step 4 rename strategy was WRONG -- kept as the record of why)
  - docs/audits/MIGRATION_LINEAGE_PHASE1_FINDINGS_2026-07-27.md (what the stopped first attempt proved)
---

# Migration lineage: closed, 2026-07-27

## End state, verified

- **Production ledger: 191 rows. Git migration files: 191. Exact 1:1 match on
  version, zero prod-only rows, zero file-only versions.** First full
  reconciliation since the 2026-07-17 repair incident.
- `supabase db push --dry-run` against a local replica of this exact end
  state: `{"upToDate": true}` — the first computable plan since 17 July.
- Full pre-change backup preserved **in the database**:
  `supabase_migrations.schema_migrations_backup_20260727` (261 rows, includes
  the `statements` content of every deleted row). Any deleted row can be
  restored by `INSERT ... SELECT` from it.

## What was executed

1. **70 duplicate ledger rows deleted** (261 → 191), in one guarded
   transaction (raises and rolls back unless exactly 70 match). The rows
   deleted were the **timestamped originals from the 2026-07-17 repair era**,
   NOT the synthetic-versioned rows — inverting the 07-18 design's direction,
   for two proven reasons: (a) the synthetic versions ARE the filenames, and
   filename order is replay order (renaming files to timestamps broke replay
   on a real dependency: `content_approval` creates the table
   `deliverables_article_meta` alters); (b) the Supabase CLI itself, shown
   the duplicate state, recommends reverting exactly those 70 timestamped
   versions. Rehearsed end-to-end on a local disposable stack before
   production was touched.
2. **Six orphaned ledger rows got reconstructed source files** (PR #100).
   Four had been classified GENUINELY_UNTRACEABLE on 07-18 after exhaustive
   search *of git* — their SQL was in the ledger's own `statements` column
   the whole time. Files carry the recorded SQL verbatim at the row's own
   version, all idempotent DDL, replay-verified twice from zero.
3. **Two file renames + two guarded row updates fixed a real Supabase CLI
   defect**: the version matcher merge-joins files sorted by *filename*
   against rows sorted by *version*; `_` (0x5F) sorts after digits, so a
   short-date version like `20260605` with a same-date long sibling
   (`20260605175457`) silently fails to pair on both sides.
   `20260518` → `20260518000000` and `20260605` → `20260605000000`, file and
   row together. The other 11 short-date files have no same-date sibling and
   their dates are frozen in the past — provably collision-free.
4. Earlier the same day, **Phase 0** applied the never-applied
   `publishing_package_control_room` migration (live production breakage),
   reconstructed the fileless `published_at` migration, and renamed 4
   post-freeze MCP-era mismatches. See its own document.

## What the first attempt got wrong (kept on record deliberately)

The first execution plan renamed files to their ledger timestamps and deleted
the synthetic rows. CI stopped it at the gate: replay broke, because the
synthetic sequential numbering encodes dependency order and timestamps do
not. Follow-up measurement across all 70 pairs showed both rows in every
pair carry real SQL (timestamped = original apply, 1 statement, LF;
synthetic = 07-17 repair re-reading the Windows checkout, CRLF, split), so
the plan's "empty bookkeeping" premise was also false. The stop was the
process working. Details: PHASE1_FINDINGS document.

## 5. THE PROCESS RULE (replaces the freeze)

**The only path onto production is `supabase db push` of a reviewed,
committed file in `supabase/migrations/`.**

- **No `apply_migration` via any MCP tool.** It stamps apply-time versions
  that never match the filename and re-creates this entire incident one row
  at a time. Four such rows were minted *during* the freeze; that is how the
  drift survived it.
- **No raw DDL against production** outside a migration file.
- New migration files use full 14-digit `YYYYMMDDHHMMSS` prefixes (never
  bare dates — see the CLI collision defect above).
- The two v5.2 files still untracked in the working tree
  (`20260719140000_content_deliverables_email_role_widen.sql`,
  `20260719140500_renewal_clause_drg_law_minute_deliverable.sql`) now have a
  normal path: commit → PR → CI replay → merge → `db push`. Note their
  current order is load-bearing: the renewal-clause file inserts an
  `email_delivery` placement that the widening file's constraint must permit
  first, and their prefixes already order them correctly.

## Rollback reference

Everything remains reversible from
`supabase_migrations.schema_migrations_backup_20260727`:

```sql
insert into supabase_migrations.schema_migrations (version, name, statements)
select version, name, statements
from supabase_migrations.schema_migrations_backup_20260727 b
where b.version = '<version to restore>'
  and not exists (select 1 from supabase_migrations.schema_migrations m
                  where m.version = b.version);
```

(The two updated rows were `20260518` and `20260605`; restoring their old
versions would also require reverting the two file renames from PR #100.)

Keep the backup table at least until the v5.2 migrations have shipped through
the new path and one further `db push` has succeeded end-to-end against
production.
