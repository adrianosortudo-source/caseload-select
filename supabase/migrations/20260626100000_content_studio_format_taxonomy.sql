-- Reconstructed 2026-07-27 from the production ledger's own statements column
-- (supabase_migrations.schema_migrations, version 20260626100000) by the
-- migration-lineage remediation. Classified GENUINELY_UNTRACEABLE by the
-- 2026-07-18 investigation, which searched git -- the SQL was in the ledger's
-- statements column the whole time. Content below is the recorded SQL,
-- verbatim; only this header was added.

-- Extends the Content Studio format taxonomy to include 'checklist' and
-- 'landing_page' formats. Both formats are required for the DRG weekly magnet
-- workflow (PDF magnet wrapped in a gated landing page) and are referenced by
-- the format_specs blob on firm_content_strategies (drg_strategy_v2.upload.json).
--
-- This migration only widens two CHECK constraints. It does not insert or
-- modify any rows. The strategy row that uses the new formats is uploaded
-- separately by tools/upload_drg_strategy_v2.mjs after this migration applies.
--
-- Authored:   2026-06-26
-- Supersedes: _proposed_20260625_content_studio_doctrine_extensions.sql
-- Anchors:
--   00_System/01_Doctrine/Doctrine_Schema_v1.md
--   06_Clients/DRGLaw/03_Authority/Strategy/drg_strategy_v2.upload.json

ALTER TABLE content_calendar_slots
  DROP CONSTRAINT IF EXISTS content_calendar_slots_planned_format_check;

ALTER TABLE content_calendar_slots
  ADD CONSTRAINT content_calendar_slots_planned_format_check
  CHECK (planned_format IN (
    'counsel_note',
    'clause_in_the_margin',
    'decision_tool',
    'counsel_letter',
    'checklist',
    'landing_page'
  ));

ALTER TABLE content_pieces
  DROP CONSTRAINT IF EXISTS content_pieces_format_check;

ALTER TABLE content_pieces
  ADD CONSTRAINT content_pieces_format_check
  CHECK (format IN (
    'counsel_note',
    'clause_in_the_margin',
    'decision_tool',
    'counsel_letter',
    'checklist',
    'landing_page'
  ));

-- ============================================================================
-- ROLLBACK (manual, fail-fast preflight - not auto-applied)
-- ============================================================================
-- Audit catch 2026-06-26 HIGH 1: this block previously prescribed DELETE on
-- production rows whose format value would fail the narrower constraint.
-- That is a destructive copy-paste trap. The block below now refuses to
-- proceed if any dependent rows exist and requires the operator to reassign
-- or archive those rows out of band before the rollback can run.
--
-- Step 1: preflight. Run these queries first. If either returns ANY rows,
-- STOP and reassign the offending rows (e.g. UPDATE format = '<other>' or
-- archive into a snapshot table) before continuing.
--
-- SELECT id, firm_id, format, status, created_at FROM content_pieces
--  WHERE format IN ('checklist', 'landing_page');
-- SELECT id, firm_id, planned_format, status, week_of FROM content_calendar_slots
--  WHERE planned_format IN ('checklist', 'landing_page');
--
-- Step 2: rollback (only after preflight returns zero rows from both queries).
--
-- BEGIN;
--
-- ALTER TABLE content_calendar_slots
--   DROP CONSTRAINT IF EXISTS content_calendar_slots_planned_format_check;
-- ALTER TABLE content_calendar_slots
--   ADD CONSTRAINT content_calendar_slots_planned_format_check
--   CHECK (planned_format IN (
--     'counsel_note',
--     'clause_in_the_margin',
--     'decision_tool',
--     'counsel_letter'
--   ));
--
-- ALTER TABLE content_pieces
--   DROP CONSTRAINT IF EXISTS content_pieces_format_check;
-- ALTER TABLE content_pieces
--   ADD CONSTRAINT content_pieces_format_check
--   CHECK (format IN (
--     'counsel_note',
--     'clause_in_the_margin',
--     'decision_tool',
--     'counsel_letter'
--   ));
--
-- COMMIT;
--
-- If the rollback transaction errors with "new row violates check constraint",
-- a row slipped past the preflight. Roll back the transaction (no rows are
-- harmed) and rerun the preflight queries.
