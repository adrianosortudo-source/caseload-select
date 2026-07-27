-- Voice callback requests: non-intake calls on the public voice line.
--
-- DR-054 candidate: the published voice line is a multi-intent front desk.
-- New matters still land in screened_leads. Contact-missing intake attempts
-- still land in unconfirmed_inquiries. Existing-client/admin/court/vendor/
-- wrong-number calls land here for operator-only routing.

CREATE TABLE IF NOT EXISTS voice_callback_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id        uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,
  call_id        text,
  branch         text NOT NULL,
  urgency        text NOT NULL DEFAULT 'normal',
  caller_name    text,
  caller_phone   text,
  organization   text,
  message        text NOT NULL DEFAULT '',
  raw_transcript text NOT NULL,
  voice_meta     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  notified_at    timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'voice_callback_requests_branch_check'
      AND conrelid = 'public.voice_callback_requests'::regclass
  ) THEN
    ALTER TABLE voice_callback_requests
      ADD CONSTRAINT voice_callback_requests_branch_check
      CHECK (branch IN ('existing_client', 'admin', 'court_or_counsel', 'vendor', 'wrong_number', 'unclear'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'voice_callback_requests_urgency_check'
      AND conrelid = 'public.voice_callback_requests'::regclass
  ) THEN
    ALTER TABLE voice_callback_requests
      ADD CONSTRAINT voice_callback_requests_urgency_check
      CHECK (urgency IN ('normal', 'urgent'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_voice_callback_requests_firm_created
  ON voice_callback_requests (firm_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_callback_requests_branch
  ON voice_callback_requests (branch);

CREATE INDEX IF NOT EXISTS idx_voice_callback_requests_urgency
  ON voice_callback_requests (urgency);

-- RLS posture matches unconfirmed_inquiries for v1: service-role only.
-- Future operator UI can add firm-scoped read policies when the surface ships.
ALTER TABLE voice_callback_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_callback_requests FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE voice_callback_requests IS
  'Operator-only queue for public voice-line calls that are not new-matter leads: existing client, admin, court/counsel, vendor, wrong number, or unclear.';

COMMENT ON COLUMN voice_callback_requests.branch IS
  'existing_client | admin | court_or_counsel | vendor | wrong_number | unclear';

COMMENT ON COLUMN voice_callback_requests.urgency IS
  'normal | urgent. Urgent is a routing flag, not a legal determination.';

COMMENT ON COLUMN voice_callback_requests.voice_meta IS
  'GHL call metadata, app classifier result, agent marker, reconciliation reason, urgency triggers, and operator-review flag.';

NOTIFY pgrst, 'reload schema';
