-- Conflict Check System
-- Blocks consultation_scheduled stage move when a conflict of interest exists.
--
-- conflict_register: historical client/matter data (source of truth for checks)
-- conflict_checks:   per-lead check results with override support
--
-- Run this in the Supabase SQL Editor.

-- ── conflict_register ──────────────────────────────────────────────────────────
-- Stores known clients and opposing parties for each firm.
-- Populated three ways:
--   1. Automatically on client_won (source = 'caseload_select')
--   2. CSV import on onboarding (source = 'csv_import')
--   3. Future Clio sync (source = 'clio_sync')

CREATE TABLE IF NOT EXISTS conflict_register (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  law_firm_id     uuid REFERENCES law_firm_clients(id) ON DELETE CASCADE,
  client_name     text NOT NULL,
  opposing_party  text,
  matter_type     text,
  email           text,
  phone           text,
  source          text NOT NULL DEFAULT 'caseload_select',
  clio_matter_id  text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conflict_register_firm
  ON conflict_register (law_firm_id);

CREATE INDEX IF NOT EXISTS idx_conflict_register_email
  ON conflict_register (law_firm_id, email)
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conflict_register_phone
  ON conflict_register (law_firm_id, phone)
  WHERE phone IS NOT NULL;

-- ── conflict_checks ────────────────────────────────────────────────────────────
-- One row per check run. A lead may have multiple rows (re-checks after override).
-- The latest row by checked_at is the authoritative result.

CREATE TABLE IF NOT EXISTS conflict_checks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid REFERENCES leads(id) ON DELETE CASCADE,
  law_firm_id     uuid REFERENCES law_firm_clients(id) ON DELETE CASCADE,
  result          text NOT NULL CHECK (result IN ('clear', 'potential_conflict', 'confirmed_conflict')),
  matches         jsonb NOT NULL DEFAULT '[]',
  checked_via     text NOT NULL CHECK (checked_via IN ('clio', 'register', 'none')),
  checked_at      timestamptz DEFAULT now(),
  override_reason text,
  reviewed_by     text
);

CREATE INDEX IF NOT EXISTS idx_conflict_checks_lead
  ON conflict_checks (lead_id, checked_at DESC);
