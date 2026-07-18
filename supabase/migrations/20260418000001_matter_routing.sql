-- Matter Routing Config
-- Per-firm table mapping practice area sub-type → GHL pipeline/stage/staff.
-- Read exclusively server-side via supabaseAdmin (service-role). No anon exposure.
--
-- Usage (all server-side through supabaseAdmin):
--   src/lib/matter-routing.ts            - read during finalize
--   src/app/api/admin/routing/**         - admin CRUD
--
-- A missing row means fall through to the default band→stage mapping.
--
-- ghl_pipeline_id:      GHL pipeline UUID. null = use firm's default pipeline.
-- ghl_stage:            Override stage name. null = use standard band→stage mapping.
-- assigned_staff_id:    GHL user/staff UUID for auto-assignment. null = unassigned.
-- assigned_staff_email: Staff email for reference/notification. null = unassigned.

CREATE TABLE IF NOT EXISTS matter_routing (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id              uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,
  sub_type             text NOT NULL,
  ghl_pipeline_id      text,
  ghl_stage            text,
  assigned_staff_id    text,
  assigned_staff_email text,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now(),
  UNIQUE (firm_id, sub_type)
);

CREATE INDEX IF NOT EXISTS idx_matter_routing_firm
  ON matter_routing (firm_id, sub_type);

-- Keep updated_at current on row updates. search_path locked to match the
-- hardening sweep pattern (function-level security).
CREATE OR REPLACE FUNCTION set_matter_routing_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS matter_routing_updated_at ON matter_routing;
CREATE TRIGGER matter_routing_updated_at
  BEFORE UPDATE ON matter_routing
  FOR EACH ROW EXECUTE FUNCTION set_matter_routing_updated_at();

-- Hardening pattern: enable + force RLS, strip anon/authenticated/PUBLIC grants.
-- No policies needed - service-role bypasses RLS and is the only caller.
ALTER TABLE matter_routing ENABLE ROW LEVEL SECURITY;
ALTER TABLE matter_routing FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON TABLE matter_routing FROM anon;
REVOKE ALL ON TABLE matter_routing FROM authenticated;
REVOKE ALL ON TABLE matter_routing FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
