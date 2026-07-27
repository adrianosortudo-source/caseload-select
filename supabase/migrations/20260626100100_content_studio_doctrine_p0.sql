-- Reconstructed 2026-07-27 from the production ledger's own statements column
-- (supabase_migrations.schema_migrations, version 20260626100100) by the
-- migration-lineage remediation. Classified GENUINELY_UNTRACEABLE by the
-- 2026-07-18 investigation, which searched git -- the SQL was in the ledger's
-- statements column the whole time. Content below is the recorded SQL,
-- verbatim; only this header was added.

-- Content Studio doctrine layer P0 columns.
--
-- Adds per-piece classification fields that the doctrine layer reads at draft
-- time (pillar, cadence_tier, awareness_stage, spine). These are added to
-- content_pieces and to content_calendar_slots so planning carries the same
-- classification through to authoring. All columns are nullable to support
-- backfill of existing rows; the application layer is responsible for setting
-- them on new pieces.
--
-- Anchors:
--   B1 Tuckerman + B2 Hossain (pillar)
--   B2 Firestone (cadence_tier)
--   B9 Bolam/Schwartz (awareness_stage)
--   B9 Albrighton + Lance (spine)
--   06_Clients/DRGLaw/03_Authority/Strategy/drg_strategy_v2.upload.json
--
-- Authored:   2026-06-26
-- Applies after: 20260626_content_studio_format_taxonomy.sql

ALTER TABLE content_pieces
  ADD COLUMN IF NOT EXISTS pillar text
    CHECK (pillar IS NULL OR pillar IN (
      'corporate',
      'real_estate',
      'wills_estates',
      'firm_voice'
    ));

ALTER TABLE content_pieces
  ADD COLUMN IF NOT EXISTS cadence_tier text
    CHECK (cadence_tier IS NULL OR cadence_tier IN (
      'quarterly_big_rock',
      'monthly_core',
      'weekly_little_rock',
      'nurture'
    ));

ALTER TABLE content_pieces
  ADD COLUMN IF NOT EXISTS awareness_stage text
    CHECK (awareness_stage IS NULL OR awareness_stage IN (
      'most_aware',
      'product_aware',
      'solution_aware',
      'problem_aware',
      'unaware'
    ));

ALTER TABLE content_pieces
  ADD COLUMN IF NOT EXISTS spine text
    CHECK (spine IS NULL OR spine IN (
      'inverted_pyramid',
      'step_by_step',
      'problem_solution',
      'PPPP_landing',
      'AIDA_menu'
    ));

ALTER TABLE content_calendar_slots
  ADD COLUMN IF NOT EXISTS pillar text
    CHECK (pillar IS NULL OR pillar IN (
      'corporate',
      'real_estate',
      'wills_estates',
      'firm_voice'
    ));

ALTER TABLE content_calendar_slots
  ADD COLUMN IF NOT EXISTS cadence_tier text
    CHECK (cadence_tier IS NULL OR cadence_tier IN (
      'quarterly_big_rock',
      'monthly_core',
      'weekly_little_rock',
      'nurture'
    ));

ALTER TABLE content_calendar_slots
  ADD COLUMN IF NOT EXISTS awareness_stage text
    CHECK (awareness_stage IS NULL OR awareness_stage IN (
      'most_aware',
      'product_aware',
      'solution_aware',
      'problem_aware',
      'unaware'
    ));

CREATE INDEX IF NOT EXISTS idx_content_pieces_firm_pillar
  ON content_pieces (firm_id, pillar, cadence_tier);

CREATE INDEX IF NOT EXISTS idx_content_calendar_slots_firm_pillar
  ON content_calendar_slots (firm_id, pillar);

-- ============================================================================
-- ROLLBACK (manual, fail-fast preflight - not auto-applied)
-- ============================================================================
-- Audit catch 2026-06-26 HIGH 1: rollback warns about permanent data loss
-- before column drops. Any pillar / cadence_tier / awareness_stage / spine
-- values stored in production are unrecoverable after the DROP COLUMN.
--
-- Step 1: preflight. Run these queries to see how much classification data
-- would be permanently lost.
--
-- SELECT count(*) AS pieces_with_pillar FROM content_pieces WHERE pillar IS NOT NULL;
-- SELECT count(*) AS pieces_with_cadence FROM content_pieces WHERE cadence_tier IS NOT NULL;
-- SELECT count(*) AS pieces_with_awareness FROM content_pieces WHERE awareness_stage IS NOT NULL;
-- SELECT count(*) AS pieces_with_spine FROM content_pieces WHERE spine IS NOT NULL;
-- SELECT count(*) AS slots_with_pillar FROM content_calendar_slots WHERE pillar IS NOT NULL;
-- SELECT count(*) AS slots_with_cadence FROM content_calendar_slots WHERE cadence_tier IS NOT NULL;
-- SELECT count(*) AS slots_with_awareness FROM content_calendar_slots WHERE awareness_stage IS NOT NULL;
--
-- Step 2: if any of those counts are nonzero AND the values would be needed
-- to reconstruct state later, snapshot the affected rows into a side table
-- (CREATE TABLE archived_content_classification AS SELECT id, pillar,
-- cadence_tier, awareness_stage, spine FROM content_pieces WHERE ...) before
-- continuing. Otherwise the rollback drops the columns and the data is gone.
--
-- Step 3: rollback (only after the snapshot decision is made).
--
-- BEGIN;
--
-- DROP INDEX IF EXISTS idx_content_pieces_firm_pillar;
-- DROP INDEX IF EXISTS idx_content_calendar_slots_firm_pillar;
--
-- ALTER TABLE content_pieces DROP COLUMN IF EXISTS pillar;
-- ALTER TABLE content_pieces DROP COLUMN IF EXISTS cadence_tier;
-- ALTER TABLE content_pieces DROP COLUMN IF EXISTS awareness_stage;
-- ALTER TABLE content_pieces DROP COLUMN IF EXISTS spine;
--
-- ALTER TABLE content_calendar_slots DROP COLUMN IF EXISTS pillar;
-- ALTER TABLE content_calendar_slots DROP COLUMN IF EXISTS cadence_tier;
-- ALTER TABLE content_calendar_slots DROP COLUMN IF EXISTS awareness_stage;
--
-- COMMIT;
