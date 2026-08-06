-- =============================================================================
-- firm_decline_templates — three-layer decline copy storage
-- =============================================================================
-- The Pass action (and the OOS / backstop auto-decline paths) need to email
-- the lead a graceful decline. Per CRM Bible v5, decline copy is configured
-- per firm with optional per-practice-area variants, plus an optional
-- per-lead override stored on screened_leads.status_note.
--
-- Resolution order at the moment of decline (decline-resolver.ts):
--   1. screened_leads.status_note      (per-lead override)
--   2. firm_decline_templates row       where (firm_id, practice_area)
--   3. firm_decline_templates row       where (firm_id, practice_area IS NULL)
--   4. system fallback                  (hard-coded in lib/decline-resolver.ts)
--
-- The unique partial indexes enforce: one default per firm, one variant per
-- (firm, area) pair. NULLS NOT DISTINCT (PG 15+) handles the NULL=default
-- semantic cleanly without a separate constraint.
-- =============================================================================

CREATE TABLE IF NOT EXISTS firm_decline_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id         uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,
  practice_area   text,
  subject         text,
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_firm_decline_templates_pair
  ON firm_decline_templates (firm_id, practice_area)
  NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_firm_decline_templates_lookup
  ON firm_decline_templates (firm_id, practice_area);

DROP TRIGGER IF EXISTS trg_touch_firm_decline_templates_updated_at ON firm_decline_templates;
CREATE TRIGGER trg_touch_firm_decline_templates_updated_at
  BEFORE UPDATE ON firm_decline_templates
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE firm_decline_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_decline_templates FORCE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
