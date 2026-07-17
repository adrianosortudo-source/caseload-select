-- screened_leads.contact_postal_code: STORED generated column derived from the
-- captured postal slot (slot_answers.slots.client_postal_code).
--
-- Root cause this fixes (launch-critical, hit by DRG's lawyer 2026-06-25):
-- the triage queue read path treats contact_postal_code as a first-class
-- contact column, a sibling of contact_name / contact_phone / contact_email.
-- It is referenced by the triage page SELECT, TriageQueueCard, triage-search,
-- and triage-queue-filter. But no migration ever created the column and no
-- insert path writes it, so the queue query failed at the database with
-- "column screened_leads.contact_postal_code does not exist" and the lawyer
-- portal showed "Could not load the queue".
--
-- Modelled as a generated column rather than a plain column plus insert wiring
-- so it stays in lockstep with the one source of truth: the engine's
-- client_postal_code slot, persisted inside the serialized EngineState under
-- slot_answers -> 'slots'. Auto-populates every existing and future row with no
-- insert-path change and no backfill.
--
-- Applied to prod 2026-06-25 via Supabase MCP as a hotfix; this file makes the
-- schema change tracked and reproducible for fresh environments. Idempotent.

ALTER TABLE screened_leads
  ADD COLUMN IF NOT EXISTS contact_postal_code text
  GENERATED ALWAYS AS (slot_answers->'slots'->>'client_postal_code') STORED;

COMMENT ON COLUMN screened_leads.contact_postal_code IS
  'STORED generated from slot_answers->slots->>client_postal_code (the captured postal slot inside the serialized EngineState). Surfaces postal as a first-class contact field for the triage queue card, search, and filter, matching contact_name/phone/email. Never insert/update directly (generated); set the client_postal_code slot instead.';
