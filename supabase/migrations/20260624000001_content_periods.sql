-- Content plan: weekly periods that group deliverables by an editorial theme,
-- plus a per-deliverable format label. Powers the content-plan landing where a
-- firm sees the week's theme + rationale and the pieces grouped by format
-- (Counsel Note, Clause in the Margin, Decision Tool, Google Business Profile),
-- each with its approval status.
--
-- Service-role only (the app access model). RLS forced + anon/authenticated/
-- PUBLIC revoked in the same migration, per the Database Access Invariant: new
-- public tables are otherwise born exposed.

CREATE TABLE IF NOT EXISTS content_periods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id         uuid NOT NULL,
  starts_on       date NOT NULL,
  ends_on         date NOT NULL,
  theme           text,
  details         text,
  rationale       text,
  sort_index      integer NOT NULL DEFAULT 0,
  created_by_role text,
  created_by_id   uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_periods_firm
  ON content_periods (firm_id, starts_on DESC);

ALTER TABLE content_deliverables
  ADD COLUMN IF NOT EXISTS period_id uuid REFERENCES content_periods(id) ON DELETE SET NULL;
ALTER TABLE content_deliverables
  ADD COLUMN IF NOT EXISTS format text;

CREATE INDEX IF NOT EXISTS idx_content_deliverables_period
  ON content_deliverables (period_id);

ALTER TABLE content_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_periods FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON content_periods FROM anon, authenticated, PUBLIC;

NOTIFY pgrst, 'reload schema';
