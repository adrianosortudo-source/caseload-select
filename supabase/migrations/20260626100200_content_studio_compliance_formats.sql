-- Reconstructed 2026-07-27 from the production ledger's own statements column
-- (supabase_migrations.schema_migrations, version 20260626100200) by the
-- migration-lineage remediation. Classified GENUINELY_UNTRACEABLE by the
-- 2026-07-18 investigation, which searched git -- the SQL was in the ledger's
-- statements column the whole time. Content below is the recorded SQL,
-- verbatim; only this header was added.

-- Content Studio compliance-format extensions.
--
-- Widens the planned_format and format CHECK constraints to add four new
-- compliance-driven formats that the P0 delta batch (2026-06-26) requires:
--   - paid_traffic_landing       (L7 seven-element law-firm landing page)
--   - canonical_service_page     (B3 + C3 + C6 author-entity practice page)
--   - review_request             (C8 + L8 compliant review-request copy)
--   - review_response            (L8 TEARS skeleton with confidentiality cut)
--
-- Anchors:
--   - 06_Clients/DRGLaw/03_Authority/Strategy/Book_Extractions/L7_Conversion_law.md
--   - 06_Clients/DRGLaw/03_Authority/Strategy/Book_Extractions/L8_Reviews_Retention_law.md
--   - 06_Clients/DRGLaw/03_Authority/Strategy/Book_Extractions/C8_Retention_Referrals_web.md
--   - 06_Clients/DRGLaw/03_Authority/Strategy/Book_Extractions/C6_Authority_Positioning_web.md
--
-- Authored:   2026-06-26
-- Applies after: 20260626_content_studio_format_taxonomy.sql and
--                20260626_content_studio_doctrine_p0.sql

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
    'landing_page',
    'paid_traffic_landing',
    'canonical_service_page',
    'review_request',
    'review_response'
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
    'landing_page',
    'paid_traffic_landing',
    'canonical_service_page',
    'review_request',
    'review_response'
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
--  WHERE format IN ('paid_traffic_landing', 'canonical_service_page', 'review_request', 'review_response');
-- SELECT id, firm_id, planned_format, status, week_of FROM content_calendar_slots
--  WHERE planned_format IN ('paid_traffic_landing', 'canonical_service_page', 'review_request', 'review_response');
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
--     'counsel_letter',
--     'checklist',
--     'landing_page'
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
--     'counsel_letter',
--     'checklist',
--     'landing_page'
--   ));
--
-- COMMIT;
--
-- If the rollback transaction errors with "new row violates check constraint",
-- a row slipped past the preflight. Roll back the transaction (no rows are
-- harmed) and rerun the preflight queries.
