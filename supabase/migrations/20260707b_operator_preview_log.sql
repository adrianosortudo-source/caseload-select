-- Operator preview audit log (DR-084)
--
-- One append-only row per time an operator opens a preview of a firm's lawyer
-- portal or an end-client's matter portal. The client-matter preview surfaces
-- real client PII inside the client shell, so opening it is recorded the way any
-- sensitive read is.
--
-- Service-role only (Database Access Invariant): RLS is enabled with no policy,
-- so anon and authenticated reach nothing; the service role bypasses RLS and is
-- the only writer, matching content_deliverables and the other portal tables.

CREATE TABLE IF NOT EXISTS operator_preview_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid,
  operator_email text,
  firm_id uuid NOT NULL,
  matter_id uuid,                       -- set only for target = 'client'
  target text NOT NULL CHECK (target IN ('lawyer', 'client')),
  opened_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operator_preview_log_firm
  ON operator_preview_log(firm_id, opened_at DESC);

ALTER TABLE operator_preview_log ENABLE ROW LEVEL SECURITY;
-- Intentionally no policy: service-role only.
