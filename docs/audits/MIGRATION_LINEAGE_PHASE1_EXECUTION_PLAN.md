---
doc-type: execution-plan
scope: supabase-migration-lineage-phase1
author: Claude Opus 5 (data-engineer role, per operator instruction 2026-07-27)
executor: Claude Sonnet 5
date: 2026-07-27
status: APPROVED FOR EXECUTION by the operator, who accepted the residual-risk
  statement in docs/audits/MIGRATION_LINEAGE_PHASE0_2026-07-27.md ("Open decision").
---

# Phase 1 execution plan: remove the 70 duplicate ledger rows

## What you are doing, in one paragraph

Production's migration ledger (`supabase_migrations.schema_migrations`) carries
**two rows for 72 migrations that only ever ran once**. A `migration repair
--status applied` action on 2026-07-17 inserted a second, bookkeeping-only row
for each, rather than correcting the existing row's version. That command is
metadata-only and executes no SQL — the incident report states this explicitly
— so **the duplicate rows cannot represent independent schema changes**. They
are filing errors. You are deleting exactly 70 of them (2 of the 72 are a
different problem, excluded below) and renaming the corresponding local files
so each has a 1:1 match with its one true ledger row.

**Nothing about tables, columns, constraints, functions, or client data
changes. This is bookkeeping only.**

## Non-negotiable rules

1. **Never `DELETE` without the backup table existing first.** Step 1 is not optional.
2. **Every gate below has an exact expected value. If the actual value differs by even one, STOP and report.** Do not adjust, retry with a modified query, or "make the number match."
3. **Renames merge to `main` before any ledger row is deleted.** Not the reverse.
4. Use `mcp__supabase__execute_sql` against project `ssxryjxifwiivghglqer`. Do not use `apply_migration`.
5. Do not touch the two `screened_leads_consent` rows (`20260626000004`, `20260626203055`). They are a duplicate-*file* problem, documented separately, and are out of scope.

---

## STEP 1 — Durable backup (do this first, always)

```sql
create table if not exists supabase_migrations.schema_migrations_backup_20260727 as
select * from supabase_migrations.schema_migrations;

select count(*) as backup_rows from supabase_migrations.schema_migrations_backup_20260727;
```

**GATE 1: `backup_rows` must be exactly `261`.** If not, STOP.

Rollback, if ever needed:
```sql
insert into supabase_migrations.schema_migrations
select * from supabase_migrations.schema_migrations_backup_20260727 b
where not exists (
  select 1 from supabase_migrations.schema_migrations m where m.version = b.version
);
```

---

## STEP 2 — Derive the 70 pairs from the committed evidence matrix

Source of truth is the file in git, not a scratchpad:
`docs/audits/MIGRATION_LINEAGE_EVIDENCE_MATRIX_2026-07-18.csv`

Rows classified `B_DUPLICATE_LEDGER_ROWS` (72 total). Columns are:
`local_filename, local_version, local_name, sha256_16char, classification, exact_ledger_match, other_ledger_versions`

For each row:
- **`exact_ledger_match`** = the version the local file is currently named for = **the SYNTHETIC one = the row to DELETE**
- **`other_ledger_versions`** = the real apply-timestamp = **the row to KEEP**, and the version the file must be RENAMED to

Exclude the two rows whose `local_name` is `screened_leads_consent` or
`20260626_screened_leads_consent`. That leaves **70**.

Write a Node script (Node 24 is available; there is no python) to parse the CSV
and emit the 70 `{deleteVersion, keepVersion, currentFilename}` triples.

**GATE 2: the derived list must contain exactly 70 entries.** If not, STOP.

**GATE 3 — sanity-check the direction.** For all 70, `deleteVersion` must match
the synthetic pattern (a bare 6–8 digit date with no time component, OR a
14-digit string ending in `0{5}\d`), and `keepVersion` must NOT match it.
If any pair violates this, STOP and report that pair.

---

## STEP 3 — Dry run the deletion predicate (no writes)

```sql
select version, name from supabase_migrations.schema_migrations
where version in ( <the 70 deleteVersions> )
order by version;
```

**GATE 4: exactly 70 rows returned.**

```sql
select version, name from supabase_migrations.schema_migrations
where version in ( <the 70 keepVersions> )
order by version;
```

**GATE 5: exactly 70 rows returned.** (Both halves of every pair must still exist before you remove one.)

---

## STEP 4 — Rename the 70 local files, and fix one Phase 0 inconsistency

Rename each file to **`{keepVersion}_{ledgerName}.sql`**, where `ledgerName` is
the `name` column of the KEEP row as returned by Step 3's second query.

Using the ledger's own recorded name — not the file's current stem — makes the
renamed file match its ledger row on **both** version and name, which removes
any question about how `supabase db push` matches the two. This is also the
convention already visible in correctly-reconciled files in the tree, e.g.
`20260714141535_20260714101200_publication_metadata.sql` for ledger row
`20260714141535|20260714101200_publication_metadata`.

Use `git mv`. **Zero content changes** — do not edit a single byte of SQL.

**Also fix this Phase 0 leftover** (I introduced the inconsistency; it should
follow the same convention):
```
git mv supabase/migrations/20260723024820_firm_onboarding_client_list.sql \
       supabase/migrations/20260723024820_20260722000000_firm_onboarding_client_list.sql
```
(Ledger row `20260723024820` has name `20260722000000_firm_onboarding_client_list`.)

The other three Phase 0 renames already match their ledger names — leave them.

**GATE 6: `git status` shows exactly 71 renames (70 + the fix), zero content modifications, zero deletions.**

---

## STEP 5 — Commit, PR, CI, merge (renames only)

Branch: `chore/migration-ledger-phase1-renames`

The PR must state plainly: file renames only, no ledger rows deleted yet,
Phase 1b (the deletion) follows after merge.

**Wait for all 8 checks.** The "Publication concurrency integration tests (real
Postgres)" job replays every file in `supabase/migrations/` into a disposable
Postgres — that is the closest thing to the rehearsal the remediation design
asks for, and it must pass with the renamed files.

**Known flake:** that job intermittently fails with an *unhandled promise
rejection* in `publication-receipt-concurrency.integration.test.ts` while all 13
tests still report passing. It failed this way on PR #97 and on `main` two days
earlier, unrelated to migrations. If you see that exact signature — tests pass,
error is an unhandled rejection about `approved_version_id` mismatch — re-run
the failed job (`gh run rerun <id> --failed`). If it fails a second time, or
fails differently, STOP.

Merge with `--merge`. Delete the remote branch.

---

## STEP 6 — Execute the deletion (only after Step 5 is merged)

Single statement, with `returning` so the result is self-evidencing:

```sql
delete from supabase_migrations.schema_migrations
where version in ( <the 70 deleteVersions> )
returning version, name;
```

**GATE 7: exactly 70 rows returned by `returning`.** Capture them in full.

---

## STEP 7 — Post-verification

```sql
select
  (select count(*) from supabase_migrations.schema_migrations) as total_rows,
  (select count(*) from supabase_migrations.schema_migrations
     where version in ( <the 70 deleteVersions> )) as deleted_still_present,
  (select count(*) from supabase_migrations.schema_migrations
     where version in ( <the 70 keepVersions> )) as kept_present,
  (select count(*) from supabase_migrations.schema_migrations_backup_20260727) as backup_rows;
```

**GATE 8, all four must hold exactly:**
- `total_rows` = **191** (261 − 70)
- `deleted_still_present` = **0**
- `kept_present` = **70**
- `backup_rows` = **261** (backup untouched)

If any differ, STOP, do not attempt further writes, and report — the rollback in
Step 1 is available.

Then re-run the file↔ledger comparison from Phase 0: extract version prefixes
from `git ls-files supabase/migrations/`, compare against the live ledger, and
report the remaining mismatches. **Expect roughly 6–7 leftover ledger-only rows**
— the 5 genuinely untraceable, `enable_required_extensions` (`20260518193933`),
and `pdf_artifact_integrity` (`20260713185849`). These are known, documented, and
out of scope. **Report the actual number and list; do not try to fix them.**

---

## STEP 8 — Write it up and merge the record

Append a "Phase 1 executed" section to
`docs/audits/MIGRATION_LINEAGE_PHASE0_2026-07-27.md` (or a new
`..._PHASE1_2026-07-27.md`) recording: the 70 pairs acted on, all gate values as
actually observed, the backup table name, the rollback statement, and the
leftover mismatches from Step 7. Commit, PR, merge.

---

## What "done" looks like

- 70 duplicate rows gone; ledger at 191.
- Every renamed file's version has exactly one ledger row, matching on version and name.
- A durable backup table exists in-database.
- The remaining mismatches are named, counted, and documented as out of scope.
- `supabase db push --dry-run` is expected to compute a plan again — **you cannot verify this**, there is no Supabase CLI in this environment. Say so plainly rather than claiming it works.

## Stop conditions (any one of these — halt and report, do not improvise)

- Any gate value differs from its stated expectation.
- The evidence-matrix CSV yields anything other than 70 pairs after exclusions.
- Any pair fails the synthetic/real direction check in Gate 3.
- The real-Postgres CI job fails twice, or fails with a signature other than the known flake.
- Any query errors, or returns an unexpected shape.
