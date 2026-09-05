-- Durable operator-recovery queue for Voice AI calls which must not silently
-- disappear merely because they did not become a screened lead.  This is
-- service-role only: the public webhook writes through the server and the
-- operator APIs apply their own session gate.

CREATE TABLE IF NOT EXISTS public.voice_recovery_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.intake_firms(id) ON DELETE CASCADE,

  -- This is the unique GHL call/event identifier, never the GHL contact id.
  -- Legacy webhook deliveries use a deterministic `legacy:` fallback so
  -- byte-identical retries remain idempotent without treating a contact as a
  -- call.
  ghl_call_event_id text NOT NULL,
  ghl_contact_id text,

  disposition text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  urgency text NOT NULL DEFAULT 'normal',
  owner_name text,
  sla_due_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by text,
  acknowledgement_sla_escalated_at timestamptz,
  acknowledgement_sla_escalation_attempts integer NOT NULL DEFAULT 0,
  acknowledgement_sla_escalation_error text,

  caller_name text,
  name_source text,
  observed_caller_id text,
  spoken_callback_number text,
  callback_number_verified boolean NOT NULL DEFAULT false,

  sms_consent boolean,
  whatsapp_consent boolean,
  messaging_consent_provenance text,
  messaging_consent_at timestamptz,

  message_excerpt text NOT NULL DEFAULT '',
  raw_transcript text,
  transcript_source text NOT NULL DEFAULT 'none',
  recording_url text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,

  alert_status text NOT NULL DEFAULT 'pending',
  alert_sent_at timestamptz,
  delivery_state text NOT NULL DEFAULT 'not_requested',
  follow_up_state text NOT NULL DEFAULT 'not_started',
  follow_up_count integer NOT NULL DEFAULT 0,
  last_follow_up_at timestamptz,
  last_follow_up_summary text,

  promoted_screened_lead_id uuid REFERENCES public.screened_leads(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT voice_recovery_cases_event_unique UNIQUE (firm_id, ghl_call_event_id),
  CONSTRAINT voice_recovery_cases_disposition_check CHECK (disposition IN (
    'existing_client', 'admin', 'court_or_counsel', 'vendor', 'wrong_number',
    'unclear', 'caller_declined', 'incomplete', 'transcript_partial'
  )),
  CONSTRAINT voice_recovery_cases_status_check CHECK (status IN ('open', 'acknowledged', 'resolved')),
  CONSTRAINT voice_recovery_cases_urgency_check CHECK (urgency IN ('normal', 'urgent')),
  CONSTRAINT voice_recovery_cases_alert_check CHECK (alert_status IN ('pending', 'sent', 'failed', 'not_required')),
  CONSTRAINT voice_recovery_cases_delivery_check CHECK (delivery_state IN ('not_requested', 'queued', 'sent', 'failed', 'suppressed')),
  CONSTRAINT voice_recovery_cases_follow_up_check CHECK (follow_up_state IN ('not_started', 'scheduled', 'attempted', 'completed', 'not_needed')),
  CONSTRAINT voice_recovery_cases_follow_up_count_check CHECK (follow_up_count >= 0),
  CONSTRAINT voice_recovery_cases_sla_attempts_check CHECK (acknowledgement_sla_escalation_attempts >= 0)
);

CREATE INDEX IF NOT EXISTS idx_voice_recovery_cases_queue
  ON public.voice_recovery_cases (firm_id, status, sla_due_at NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_recovery_cases_open
  ON public.voice_recovery_cases (status, urgency, created_at DESC)
  WHERE status <> 'resolved';

DROP TRIGGER IF EXISTS trg_touch_voice_recovery_cases_updated_at ON public.voice_recovery_cases;
CREATE TRIGGER trg_touch_voice_recovery_cases_updated_at
  BEFORE UPDATE ON public.voice_recovery_cases
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.voice_recovery_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_recovery_cases FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE public.voice_recovery_cases IS
  'Service-role-only, durable operator recovery queue for Voice AI calls that were not safely promoted to screened_leads.';
COMMENT ON COLUMN public.voice_recovery_cases.ghl_call_event_id IS
  'Actual per-call/event GHL identifier. The GHL contact identifier is stored separately in ghl_contact_id.';
COMMENT ON COLUMN public.voice_recovery_cases.acknowledgement_sla_escalated_at IS
  'Set only after the acknowledgement-SLA escalation email dispatch succeeds. Null keeps the case eligible for a safe retry.';

NOTIFY pgrst, 'reload schema';
