-- Firm asset ownership register (DR-111). A current-state diagnostic,
-- distinct from ACTS_Day1_OwnershipMatrix (the go-forward decision of which
-- of three modes CaseLoad Select and the firm use for a surface during the
-- engagement). This table is the BEFORE snapshot: does the firm currently
-- control the marketing assets its growth depends on. Re-run at onboarding
-- and again at offboarding, keyed by review_phase.
--
-- Born exposed per the Database Access Invariant: RLS is enabled and forced
-- and every grant to anon, authenticated, and PUBLIC is revoked in this same
-- file. The app reads and writes through the service role only.
--
-- No password, backup code, or credential column exists on this table by
-- design (DR-111). It records who controls each asset and what must be
-- transferred, documented, or repaired, never a secret.

CREATE TABLE IF NOT EXISTS firm_asset_ownership (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id          uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,
  review_phase     text NOT NULL DEFAULT 'onboarding' CHECK (review_phase IN ('onboarding', 'offboarding')),
  asset_key        text NOT NULL,
  category         text NOT NULL,
  status           text NOT NULL DEFAULT 'unknown' CHECK (status IN ('firm_controlled', 'shared_access', 'provider_controlled', 'unknown')),
  account_holder   text,
  account_email    text,
  billing_owner    text,
  firm_has_admin   boolean,
  evidence_url     text,
  evidence_note    text,
  action           text,
  action_done      boolean NOT NULL DEFAULT false,
  notes            text,
  last_reviewed_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firm_id, review_phase, asset_key)
);

CREATE INDEX IF NOT EXISTS idx_firm_asset_ownership_firm ON firm_asset_ownership (firm_id);
CREATE INDEX IF NOT EXISTS idx_firm_asset_ownership_firm_phase ON firm_asset_ownership (firm_id, review_phase);

ALTER TABLE firm_asset_ownership ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_asset_ownership FORCE ROW LEVEL SECURITY;
REVOKE ALL ON firm_asset_ownership FROM anon, authenticated, PUBLIC;

COMMENT ON TABLE firm_asset_ownership IS
  'Current-state marketing asset ownership register (DR-111). One row per (firm, review_phase, asset_key). No credential columns. Service-role access only.';

CREATE OR REPLACE FUNCTION set_firm_asset_ownership_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_firm_asset_ownership_updated_at ON firm_asset_ownership;
CREATE TRIGGER trg_firm_asset_ownership_updated_at
  BEFORE UPDATE ON firm_asset_ownership
  FOR EACH ROW
  EXECUTE FUNCTION set_firm_asset_ownership_updated_at();
