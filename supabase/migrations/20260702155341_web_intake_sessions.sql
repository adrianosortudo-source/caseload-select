-- Web intake session persistence (qualification audit F2/F6/item 5,
-- 2026-07-02). The web widget is client-side only: today, a lead who
-- abandons before contact capture leaves zero trace. Meta channels
-- already get this via channel_intake_sessions, but that table and its
-- MetaChannel-coupled finalize path (Send-API closing messages) don't fit
-- the web widget's shape, so this is a dedicated, purpose-built table
-- rather than a forced widen of the Meta table.
--
-- Lifecycle: the widget POSTs a checkpoint after every answered turn
-- (POST /api/intake-v2/checkpoint), keyed on (firm_id, lead_id). A
-- successful final submission to /api/intake-v2 marks the row
-- finalized=true with screened_lead_id set. An hourly sweep
-- (/api/cron/expire-web-intake-sessions) resolves rows whose expires_at
-- has passed: contact-complete sessions get a thin brief in
-- screened_leads (DR-038: a reachable lead must reach the lawyer),
-- everything else moves to unconfirmed_inquiries with reason='abandoned',
-- same doctrine as the Meta-channel sweep.
CREATE TABLE IF NOT EXISTS web_intake_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,
  lead_id text NOT NULL,
  engine_state jsonb NOT NULL,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  referrer text,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  finalized boolean NOT NULL DEFAULT false,
  screened_lead_id uuid REFERENCES screened_leads(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One open session per (firm, lead_id). A checkpoint after finalization
-- (a late-arriving request from a tab that already submitted) must not
-- resurrect a closed row, so the route reads-then-writes rather than
-- relying on an ON CONFLICT upsert; this index just makes the common
-- lookup path cheap.
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_intake_sessions_open
  ON web_intake_sessions (firm_id, lead_id) WHERE NOT finalized;

CREATE INDEX IF NOT EXISTS idx_web_intake_sessions_expiry_sweep
  ON web_intake_sessions (expires_at) WHERE NOT finalized;

-- Standing rule: every new public table is born exposed. Lock it down in
-- the same migration.
ALTER TABLE web_intake_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_intake_sessions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON web_intake_sessions FROM anon, authenticated, PUBLIC;
