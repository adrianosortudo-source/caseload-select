-- =============================================================================
-- S8 Phase 1 · client_matters: signed-matter state machine
-- =============================================================================
-- One row per signed matter. Created on Band A take from the triage queue.
-- The matter is the canonical entity that everything in the client portal
-- (messages, files, explainers, embed) hangs off.
--
-- Distinct from screened_leads, which is the inbound triage artifact. A
-- screened lead in status='taken' becomes the source for at most one
-- client_matters row (FK source_screened_lead_id). The two tables are not
-- merged because their lifecycles, scoring shapes, and downstream consumers
-- differ: see docs/architecture/S8-Phase1-architecture.md section 1.3.
--
-- State machine (DR-040 proposed):
--   intake → retainer_pending → active → closing → closed
-- Forward-only. Reverse transitions are not exposed in the UI; the operator
-- unlocks manually if required.
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_matters (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identification
  firm_id                  uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,
  source_screened_lead_id  uuid REFERENCES screened_leads(id) ON DELETE SET NULL,

  -- Routing snapshot at take time (DR-040 proposed). Snapshotted from
  -- intake_firms.default_lead_by_practice_area and default_assignees so
  -- subsequent config changes do not retroactively re-route existing matters.
  lead_id                  uuid REFERENCES firm_lawyers(id) ON DELETE SET NULL,
  assignee_ids             jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- State machine
  matter_stage             text NOT NULL DEFAULT 'intake',
  matter_stage_changed_at  timestamptz NOT NULL DEFAULT now(),

  -- Matter facts (snapshotted from the source screened lead)
  matter_type              text NOT NULL,
  practice_area            text NOT NULL,

  -- Primary contact (snapshotted from screened_leads contact fields)
  primary_name             text NOT NULL,
  primary_email            text,
  primary_phone            text,

  -- Welcome draft (Story 8, DR-042 proposed)
  welcome_draft_html       text,
  welcome_draft_plain_text text,
  welcome_draft_edited_html text,    -- lawyer's edits before send; null if draft was sent unedited
  welcome_draft_sent_at    timestamptz,
  welcome_draft_sent_body  text,     -- the final body that was sent, preserved for audit

  -- Embed (Story 16, DR-043 proposed)
  embed_url                text,

  -- Audit
  closed_at                timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_matters_stage_check'
      AND conrelid = 'public.client_matters'::regclass
  ) THEN
    ALTER TABLE client_matters
      ADD CONSTRAINT client_matters_stage_check
      CHECK (matter_stage IN ('intake', 'retainer_pending', 'active', 'closing', 'closed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_matters_assignees_array_check'
      AND conrelid = 'public.client_matters'::regclass
  ) THEN
    ALTER TABLE client_matters
      ADD CONSTRAINT client_matters_assignees_array_check
      CHECK (jsonb_typeof(assignee_ids) = 'array');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_matters_contact_check'
      AND conrelid = 'public.client_matters'::regclass
  ) THEN
    -- Contact-capture doctrine (DR-038): at least one reachable channel.
    ALTER TABLE client_matters
      ADD CONSTRAINT client_matters_contact_check
      CHECK (primary_email IS NOT NULL OR primary_phone IS NOT NULL);
  END IF;
END $$;

-- Active-matters queue (lawyer home, Story 5)
CREATE INDEX IF NOT EXISTS idx_client_matters_firm_stage
  ON client_matters (firm_id, matter_stage, updated_at DESC);

-- Lookups (deep-link from triage, from email)
CREATE INDEX IF NOT EXISTS idx_client_matters_source_lead
  ON client_matters (source_screened_lead_id);

CREATE INDEX IF NOT EXISTS idx_client_matters_lead_lawyer
  ON client_matters (firm_id, lead_id, updated_at DESC);

-- Idempotency: a Band A take can only produce one matter per screened lead.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uniq_client_matters_source_lead'
  ) THEN
    CREATE UNIQUE INDEX uniq_client_matters_source_lead
      ON client_matters (source_screened_lead_id)
      WHERE source_screened_lead_id IS NOT NULL;
  END IF;
END $$;

-- updated_at maintenance
DROP TRIGGER IF EXISTS trg_touch_client_matters_updated_at ON client_matters;
CREATE TRIGGER trg_touch_client_matters_updated_at
  BEFORE UPDATE ON client_matters
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- RLS: service-role only. Application gates via portal session role.
ALTER TABLE client_matters ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_matters FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- matter_stage_events: append-only audit of stage transitions
-- =============================================================================

CREATE TABLE IF NOT EXISTS matter_stage_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id       uuid NOT NULL REFERENCES client_matters(id) ON DELETE CASCADE,
  firm_id         uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,
  from_stage      text,
  to_stage        text NOT NULL,
  actor_role      text NOT NULL,
  actor_id        uuid REFERENCES firm_lawyers(id) ON DELETE SET NULL,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matter_stage_events_to_stage_check'
      AND conrelid = 'public.matter_stage_events'::regclass
  ) THEN
    ALTER TABLE matter_stage_events
      ADD CONSTRAINT matter_stage_events_to_stage_check
      CHECK (to_stage IN ('intake', 'retainer_pending', 'active', 'closing', 'closed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matter_stage_events_actor_role_check'
      AND conrelid = 'public.matter_stage_events'::regclass
  ) THEN
    ALTER TABLE matter_stage_events
      ADD CONSTRAINT matter_stage_events_actor_role_check
      CHECK (actor_role IN ('admin', 'staff', 'operator', 'system'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_matter_stage_events_matter
  ON matter_stage_events (matter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_matter_stage_events_firm
  ON matter_stage_events (firm_id, created_at DESC);

ALTER TABLE matter_stage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE matter_stage_events FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE client_matters IS
  'One row per signed matter. Phase 1 S8 Story 3. DR-040 proposed.';

COMMENT ON TABLE matter_stage_events IS
  'Append-only audit of matter-stage transitions. Phase 1 S8 Story 3.';

NOTIFY pgrst, 'reload schema';
