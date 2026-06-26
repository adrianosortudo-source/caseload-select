# CRM Migration Runbook

**Status:** Active | **Authored:** 2026-06-26 | **Covers:** C3 scoring-delta dual-run (Phase 1 expand)

---

## 1. Scope and purpose

This runbook covers **one specific migration path only**: the scoring-delta expand phase (migration `20260625_screened_leads_scoring_delta.sql`), its backfill, and the per-firm read gate that allows lawyer-facing surfaces to surface the new columns.

It does NOT cover:

- Consent gate wiring (H5 / DR-075): see `supabase/migrations-draft/20260626_screened_leads_consent.sql`
- Matter promotion events table (H3): see `supabase/migrations-draft/20260626_matter_promotion_events.sql`
- Conflict gate rebuild (H4): requires schema decision first
- Lead-root migration from `leads` to `screened_leads` as the universal canonical: not yet planned
- Firm-table migration from `law_firm_clients` to `intake_firms` on legacy surfaces: not yet planned

Those paths have their own gates and will each get their own runbook section when cleared.

---

## 2. Firm-table duality

The codebase has two firm-table roots. They serve different surfaces and must not be conflated.

| Attribute | Canonical (current) | Legacy |
|-----------|--------------------|----|
| Table | `intake_firms` | `law_firm_clients` |
| Foreign key name | `firm_id` | `law_firm_id` |
| Primary consumers | triage portal, operator console, Files hub, scoring-delta, intake engine | older pipeline routes, `leads` table |

The scoring-delta columns (`score_confidence`, `score_completeness`, etc.) live on `screened_leads`, which uses `firm_id` (canonical). The backfill in section 5 operates on `screened_leads` only and is unaffected by the legacy firm table.

Any future migration touching `law_firm_clients` or `law_firm_id` requires a separate cleared runbook section.

---

## 3. Lead-root duality

| Attribute | Canonical | Legacy |
|-----------|-----------|--------|
| Table | `screened_leads` + `client_matters` | `leads` |
| Band A flow | triage queue, take route, scoring-delta | older pipeline |
| Scoring-delta columns | on `screened_leads` only | not present |

The scoring-delta expand phase adds columns to `screened_leads`. The legacy `leads` table is not touched and not in scope for any step in this runbook.

---

## 4. What "dual-run" means in this codebase

The dual-run pattern avoids a hard cutover by separating the write path from the read path behind a per-firm flag.

**Write path (always on):** `buildScoringDeltaForInsert` in `src/lib/scoring-port-read.ts` runs on every `screened_leads` insert, regardless of any flag. New rows always carry the scoring-delta columns.

**Read path (flag-gated):** `getScoringPortForRead` checks `intake_firms.read_scoring_port`. When false (the default for all firms), it returns null and the caller uses the legacy `brief_html` display only. When true, it runs the shadow comparator (logs drift to Vercel logs, never throws) and returns the persisted columns.

**Shadow comparator:** `shadowCompareScoringPort` in `src/lib/scoring-port-read.ts` recomputes the expected values from `slot_answers` on every gated read and logs drift via `console.warn`. It never mutates and never surfaces to the client. This is the runtime parity check; `scripts/read-shadow-scoring-delta.ts` is the batch parity check.

**Rollback:** Setting `intake_firms.read_scoring_port = false` in Supabase immediately restores legacy reads for that firm. No code change, no deploy.

---

## 5. What is cleared (scoring-delta path only)

The following is specifically authorized and applied as of 2026-06-25:

| Item | Status | Evidence |
|------|--------|---------|
| Migration `20260625_screened_leads_scoring_delta.sql` applied to prod | DONE | Applied via MCP `apply_migration` 2026-06-25 |
| 7 additive columns on `screened_leads` | DONE | `information_schema.columns` verifiable |
| CHECK constraint on `score_confidence` | DONE | Applied in same migration |
| CHECK constraint on `score_completeness` | DONE | Applied in same migration |
| Write path: `buildScoringDeltaForInsert` wired at insert | DONE | `src/lib/scoring-port-read.ts` wired into intake route |
| Read gate: `read_scoring_port` per firm (all false by default) | DONE | No firm has flag = true |
| Backfill script: `scripts/backfill-scoring-delta.ts` authored | DONE | Script exists; uses prod guard |
| Read-shadow script: `scripts/read-shadow-scoring-delta.ts` authored | DONE | Script exists; uses prod guard |

**Not yet run:** The backfill. All existing `screened_leads` rows have null scoring-delta columns. The backfill is the next required step before any firm's `read_scoring_port` can be flipped to true.

Note: the migration comments reference `scripts/backfill-scoring-delta.mjs`; the actual file is `scripts/backfill-scoring-delta.ts`.

---

## 6. What has NOT been cleared

These items are outside the scope of this runbook. Do not treat this runbook as authorization for any of them.

| Item | Blocker |
|------|---------|
| Flip any firm's `read_scoring_port = true` | Backfill not run; read-shadow not green |
| Apply consent migration to prod | N6 schema alignment pending; H5 wiring pending |
| Wire `isConsentGated()` into `ghl-webhook.ts` | Consent migration not applied |
| Apply `matter_promotion_events` migration | Operator authorization pending |
| Wire `logPromotionEvent` into take route | Table not applied |
| Implement conflict gate check | H4 schema decision (legacy vs canonical root) pending |
| Canonical migration of `leads` to `screened_leads` | Not planned |
| Canonical migration of `law_firm_clients` to `intake_firms` | Not planned |

---

## 7. Pre-flight checklist (before running the backfill)

Run these checks before executing section 8. All must pass.

```sql
-- 1. Confirm the 7 columns are present on screened_leads
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'screened_leads'
  AND column_name IN (
    'score_confidence', 'score_completeness', 'score_explanation',
    'score_missing_fields', 'field_provenance', 'score_version', 'calibration_version'
  )
ORDER BY column_name;
-- Expected: 7 rows; data types match the migration DDL.

-- 2. Confirm all firms have read_scoring_port = false (no firm already enabled)
SELECT id, name, read_scoring_port FROM intake_firms WHERE read_scoring_port = true;
-- Expected: 0 rows.

-- 3. Confirm the check constraint exists
SELECT conname, consrc FROM pg_constraint
WHERE conname IN ('screened_leads_score_confidence_chk', 'screened_leads_score_completeness_chk');
-- Expected: 2 rows.

-- 4. Confirm the old project URL is NOT in .env.local (or export SUPABASE_URL explicitly)
-- .env.local is known to point at the old project qpzopweonveumvuqkqgw.
-- The backfill script refuses to run against anything but ssxryjxifwiivghglqer.
-- Export the prod URL and key explicitly before running the backfill:
--   export SUPABASE_URL=https://ssxryjxifwiivghglqer.supabase.co
--   export SUPABASE_SERVICE_ROLE_KEY=<prod service role key>
```

---

## 8. Dual-run execution steps

These are the sequential steps to complete the Phase 1 expand path and enable the first pilot firm.

### Step 1: Run the backfill dry-run

```bash
export SUPABASE_URL=https://ssxryjxifwiivghglqer.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<prod service role key>

npx tsx scripts/backfill-scoring-delta.ts
```

The script prints one line per in-scope row: id, matter_type, band, score_confidence, score_completeness, missing-field count. Nothing is written.

**Abort if:** the script exits with a non-zero code; or the row count differs significantly from `SELECT COUNT(*) FROM screened_leads WHERE matter_type NOT IN ('out_of_scope','unknown') AND firm_id IS NOT NULL AND band IS NOT NULL`.

Capture the dry-run output. The "Scanned / Would write / Skipped" summary is the pre-backfill baseline.

### Step 2: Run the backfill (commit mode)

```bash
npx tsx scripts/backfill-scoring-delta.ts --commit
```

The script paginates through `screened_leads` in batches of 500, computes `computeScorePort` from `slot_answers`, and writes the 6 value columns (not `calibration_version`, which stays null until C5 per-firm recalibration is built).

**Abort if:** any `UPDATE failed` line appears in the output. The script exits 1 on the first failed row. Investigate the specific row before retrying.

Re-running with `--commit` is safe (idempotent, forward-only per DR-059). The skip list includes rows with null `firm_id`, null `band`, or `matter_type` in `('out_of_scope', 'unknown')`. Those rows get no delta and are reported separately.

### Step 3: Run the read-shadow parity check

```bash
npx tsx scripts/read-shadow-scoring-delta.ts
```

This script fetches every row, recomputes the expected values from `slot_answers`, and reports:

- Column population per column (expected: 0 nulls on in-scope rows after commit)
- Confidence distribution
- Parity mismatches (persisted differs from recomputed)
- Version anomalies (score_version not in {null, 1})

**Promotion criterion:** the script must exit 0 and print `READ-SHADOW: GREEN (no drift, no version anomalies)` before any firm's flag is flipped.

If any mismatches appear, investigate the specific rows listed before proceeding.

### Step 4: Run CRM-MIGRATION-TEST-MATRIX-v1.md SD-3 and SD-4

Confirm that:

- SD-3 passes: dry-run row count from step 1 matches the actual write count from step 2.
- SD-4 passes: the read-shadow script exits 0 with 0 mismatches and 0 version anomalies.

### Step 5: Enable the first pilot firm

When read-shadow is green, flip the flag on one firm:

```sql
UPDATE intake_firms SET read_scoring_port = true WHERE id = '<pilot_firm_id>';
```

Start with one firm (not all). Monitor Vercel logs for `[scoring-port-read] shadow drift` warnings on that firm's triage routes for 24-48 hours before widening.

---

## 9. Read-shadow parity evidence requirements

Before any firm flag is enabled, the following evidence must be confirmed and logged:

| Check | How | Pass condition |
|-------|-----|----------------|
| Backfill commit row count | dry-run "Would write N" == commit "Wrote N" | counts match |
| Parity mismatches | `npx tsx scripts/read-shadow-scoring-delta.ts` | 0 mismatches |
| Version anomalies | same script | 0 anomalies |
| Score-confidence distribution | same script | no unexpected nulls on in-scope rows |
| Quarantine list | dry-run or commit skip list | review; confirm skipped rows are genuinely out-of-scope |

Record the read-shadow output (the full console print) and link it in FOLLOWUPS.md before enabling any firm.

---

## 10. Rollback steps

### Rollback the read flag (immediate, no code change)

```sql
UPDATE intake_firms SET read_scoring_port = false WHERE id = '<firm_id>';
-- Or for all firms:
UPDATE intake_firms SET read_scoring_port = false;
```

Effect is immediate: the next request for that firm returns null from `getScoringPortForRead` and falls back to `brief_html`. No deploy required.

### Rollback the columns (last resort; not recommended)

The scoring-delta columns are additive and non-destructive. Dropping them is irreversible for any data already written. Only drop if the columns themselves cause a problem (type error, constraint violation, etc.).

```sql
-- Only run if the columns must be removed. This is destructive.
ALTER TABLE public.screened_leads
  DROP COLUMN IF EXISTS score_confidence,
  DROP COLUMN IF EXISTS score_completeness,
  DROP COLUMN IF EXISTS score_explanation,
  DROP COLUMN IF EXISTS score_missing_fields,
  DROP COLUMN IF EXISTS field_provenance,
  DROP COLUMN IF EXISTS score_version,
  DROP COLUMN IF EXISTS calibration_version;
```

After dropping, redeploy the app with the write-path call to `buildScoringDeltaForInsert` removed; otherwise the insert will fail on the missing columns.

### Rollback the backfill (not possible; data overwrite)

The backfill writes into previously-null columns. There is no "undo" for the writes. If the backfill produced incorrect values, recompute by re-running `--commit` after fixing the underlying scoring logic. Per DR-059, the `score_version` column is forward-only.

---

## 11. Abort criteria

Stop and escalate if any of the following occur:

| Condition | Action |
|-----------|--------|
| Backfill dry-run row count is unexpectedly low (less than 70% of all in-scope rows) | Investigate skip list; look for unexpected null-band rows |
| `UPDATE failed` in backfill commit | Exit; review the specific row; fix before retrying |
| Read-shadow exits non-zero (any parity mismatches) | Do not enable any firm; investigate drift before proceeding |
| Any `screened_leads` row shows `score_version > 1` after first backfill | Version anomaly; investigate before widening to other firms |
| Vercel logs show `[scoring-port-read] shadow drift` on a newly enabled firm | Pause widening; investigate drift rows before enabling additional firms |
| A newly enabled firm's brief route starts returning null where scoring-port data is expected | Check `read_scoring_port` column and the `getScoringPortForRead` code path |

---

## 12. Appendix: column reference

The 7 scoring-delta columns added by `20260625_screened_leads_scoring_delta.sql`:

| Column | Type | Source | Notes |
|--------|------|--------|-------|
| `score_confidence` | `text` | `ScorePort.confidence` | `high` / `medium` / `low`; CHECK constraint enforced |
| `score_completeness` | `numeric` | `ScorePort.completeness` | 0..1; CHECK constraint enforced |
| `score_explanation` | `text` | `ScorePort.explanation` | synthesized "why this score" narrative |
| `score_missing_fields` | `jsonb` | `ScorePort.missing_fields` | `[{ slot_id, label }]`; query with `->>` |
| `field_provenance` | `jsonb` | `ScorePort.field_provenance` | `{ slot_id: confirmed | inferred | unknown }` |
| `score_version` | `integer` | `scorePortToColumns` | always 1 from the backfill; bumps on re-score |
| `calibration_version` | `integer` | reserved | null until C5 per-firm recalibration; do not write |

`requires_human_review` is NOT a column. It is derived at routing time from `band` + `score_confidence`.

`axis_reasoning` is NOT a column (N2 finding). It lives inside `brief_json`. A follow-on migration is needed to promote it to a queryable top-level column.

All columns inherit the service-role-only RLS posture from the 2026-06-05 lockdown migration. No GRANT or REVOKE is needed when adding new columns to `screened_leads`.

Key source files:

| File | Purpose |
|------|---------|
| `src/lib/scoring-port-read.ts` | Write path, read gate, shadow comparator |
| `src/lib/scoring-port-persistence.ts` | `ScoringDeltaColumns` type; `scorePortToColumns` projection |
| `src/lib/scoring-port.ts` | `computeScorePort`; `rehydrateScoredState` |
| `scripts/backfill-scoring-delta.ts` | Batch backfill (dry-run default, `--commit` to write) |
| `scripts/read-shadow-scoring-delta.ts` | Parity check (read-only; exits 2 on drift) |
| `supabase/migrations/20260625_screened_leads_scoring_delta.sql` | Applied migration |
