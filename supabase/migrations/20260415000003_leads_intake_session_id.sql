-- Add intake_session_id to leads for intake → pipeline bridge.
-- Allows idempotent lead promotion from CaseLoad Screen sessions.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS intake_session_id UUID REFERENCES intake_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_intake_session_id ON leads(intake_session_id);
