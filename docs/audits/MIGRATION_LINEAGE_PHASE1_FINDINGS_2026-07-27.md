---
doc-type: audit
scope: supabase-migration-lineage-phase1-findings
auditor: Claude Opus 5 (data-engineer role) with Claude Sonnet 5 (executor)
date: 2026-07-27
status: Phase 1 NOT executed. The first execution attempt was stopped at a CI
  gate; that stop exposed a defect in the plan AND, on follow-up investigation,
  a wrong premise underneath it. Ledger untouched at 261 rows. This document
  records what was learned and what the corrected approach must be.
supersedes: the Step 4 rename strategy in MIGRATION_LINEAGE_PHASE1_EXECUTION_PLAN.md
---

# Phase 1: why the first attempt was stopped, and what it proved

## Summary

The approved plan said: rename each of the 70 local files to its true
ledger-recorded timestamp, then delete the ledger row carrying the file's old
synthetic version. Execution stopped at the CI gate before any ledger row was
deleted. Two separate problems were found, one of which invalidates the plan's
core premise.

**Nothing was deleted. Production ledger remains at 261 rows. The backup table
`supabase_migrations.schema_migrations_backup_20260727` (261 rows) is intact
and unused.**

## Problem 1: filename order IS replay order

CI's real-Postgres job failed replaying the renamed file set:

```
ERROR: relation "content_deliverables" does not exist (SQLSTATE 42P01)
```

Cause, verified independently against `origin/main`:

- `20260623000002_content_approval.sql` line 20 — `CREATE TABLE IF NOT EXISTS content_deliverables`
- `20260623000004_deliverables_article_meta.sql` line 14 — `ALTER TABLE content_deliverables`

Renaming the first to its true ledger version `20260623214957` moves it
**after** `20260623000004` in lexicographic order. Migrations replay in
filename order, so the ALTER now runs before the CREATE.

The synthetic sequential numbering (`...000001`, `...000002`, `...000004`) was
almost certainly introduced *precisely to encode a correct dependency order*.
The plan's rename would have discarded that ordering to restore timestamps that
never encoded order at all.

CI halts at the first replay error, so **this is a lower bound**: other ordering
breaks may exist further down the 70-file set. They were never reached.

## Problem 2: the plan's premise about the duplicate rows was wrong

The plan asserted the duplicate rows were empty bookkeeping — that
`migration repair --status applied` is "metadata-only and executes no SQL", so
the extra rows could not represent real content. The first half is true; the
inference was not.

`supabase_migrations.schema_migrations` has a `statements text[]` column.
**Both rows in every pair contain real SQL.** Measured across all 70 pairs:

| Property | Count | Exceptions |
|---|---|---|
| Total pairs checked | 70 | — |
| Timestamped ("real") row has exactly 1 statement | **70 / 70** | 0 |
| Timestamped row uses LF line endings | **70 / 70** | 0 |
| Synthetic-versioned row has >1 statement | 62 / 70 | 8 are single-statement migrations |
| Synthetic-versioned row uses CRLF line endings | 68 / 70 | 2 |

The pattern is essentially perfect and it tells a clear story:

- **Timestamped rows** = the original applies. One unsplit statement, LF endings
  — pushed from a Linux/CI environment or the dashboard.
- **Synthetic-versioned rows** = inserted 2026-07-17 by the repair action,
  re-reading the local Windows checkout: CRLF endings, content split into
  multiple statements, and matching *today's* file contents.

Worked example (`content_approval`):

| Version | Statements | Endings | First statement begins |
|---|---|---|---|
| `20260623000002` (synthetic) | 12 | CRLF | `-- Phase 2: content approval system\r\n--\r\n-- The operator posts…` |
| `20260623214957` (timestamped) | 1 | LF | `-- Phase 2: content approval system\nCREATE TABLE IF NOT EXISTS content_deliverables (…` |

So deleting *either* row discards a genuine record. The design document's
direction is correct about **which row recorded the original apply** — the
timestamped ones did. But the plan treated the other row as worthless, and it
is not: it is the only ledger record whose statements match the file on disk
today.

This is exactly the class of thing the remediation design's rehearsal
requirement (element 5) existed to catch, and which the execution plan
substituted away with indirect evidence.

## What the corrected approach probably is — and what must be proven first

**Candidate: delete the 70 timestamped rows instead, and rename nothing.**

- File replay order is preserved *by construction* — zero files change, so
  Problem 1 cannot occur.
- Every remaining ledger row already matches its file's version, since the
  synthetic versions are the filenames.
- The retained rows are the ones whose recorded statements match the current
  files.
- End state is identical in shape: 261 − 70 = 191 rows, one per file.

**Cost:** the ledger loses the original apply timestamps and their (older,
single-statement) SQL text. Version numbers become identifiers rather than
historical record. Whether that matters is a judgement call — Supabase matches
on version, not content, and git holds the authoritative migration text.

**Before this is executed, it needs:**

1. Confirmation that `supabase db push` matches local files to ledger rows on
   **version only**, not version+name. Several kept rows would have a `name`
   that differs from their filename stem (e.g. ledger name
   `20260623_content_approval` vs file `20260623000002_content_approval.sql`).
   Unverified — there is no Supabase CLI in this environment.
2. A decision, recorded, that discarding the original-apply statement text is
   acceptable.
3. A full-set ordering check of the *unchanged* file list (should be trivially
   true — it is today's `main`, which CI replays green — but assert it rather
   than assume it).

## Standing recommendation

Do not execute any variant of Phase 1 until item 1 above is verifiable —
i.e. until a Supabase CLI or a Docker daemon is available in the execution
environment. Two plans have now been written against this ledger and both
rested on an unverified assumption about how the tooling behaves; the third
should not.

Phase 0 remains complete and correct. Nothing in Phase 1 blocks the Content
Studio automation work, whose vocabulary migration is a separate, additive
change that only needs the freeze lifted — not this cleanup finished.
