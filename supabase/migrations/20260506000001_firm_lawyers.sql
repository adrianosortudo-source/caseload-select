-- =============================================================================
-- firm_lawyers — multi-lawyer per firm + operator role tier
-- =============================================================================
-- Replaces the single intake_firms.branding.lawyer_email field with a proper
-- table. Each row is one human who can sign in to a firm's portal. The
-- branding.lawyer_email field stays in place for backward compatibility;
-- the resolver checks firm_lawyers first, then falls back if no row matches.
--
-- Roles:
--   lawyer    - normal firm-scoped portal user (default)
--   operator  - cross-firm access; unlocks /admin/* routes
--
-- Why a separate table (vs. lawyer_emails text[]):
--   1. Per-lawyer activity (last_signed_in_at, invitation status)
--   2. Per-lawyer assignment in future (lead routing within a 2-lawyer firm)
--   3. Per-lawyer notes/preferences land cleanly later
--   4. Add/remove lawyers without rewriting JSONB
-- =============================================================================

CREATE TABLE IF NOT EXISTS firm_lawyers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id              uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,
  email                text NOT NULL,
  name                 text,
  role                 text NOT NULL DEFAULT 'lawyer',
  invitation_sent_at   timestamptz,
  last_signed_in_at    timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_firm_lawyers_firm_email
  ON firm_lawyers (firm_id, lower(email));

CREATE INDEX IF NOT EXISTS idx_firm_lawyers_email_lookup
  ON firm_lawyers (lower(email), last_signed_in_at DESC);

CREATE INDEX IF NOT EXISTS idx_firm_lawyers_operators
  ON firm_lawyers (role)
  WHERE role = 'operator';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'firm_lawyers_role_check'
      AND conrelid = 'public.firm_lawyers'::regclass
  ) THEN
    ALTER TABLE firm_lawyers
      ADD CONSTRAINT firm_lawyers_role_check
      CHECK (role IN ('lawyer', 'operator'));
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_touch_firm_lawyers_updated_at ON firm_lawyers;
CREATE TRIGGER trg_touch_firm_lawyers_updated_at
  BEFORE UPDATE ON firm_lawyers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE firm_lawyers ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_lawyers FORCE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
