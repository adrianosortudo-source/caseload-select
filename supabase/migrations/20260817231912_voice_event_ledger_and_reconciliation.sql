-- Voice recovery long-term evidence model.
-- All source, receipt and audit tables are append-only. The delivery outbox
-- is intentionally mutable because it tracks retry state; every attempted
-- delivery receives its own immutable evidence row.

CREATE TABLE public.voice_call_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.intake_firms(id) ON DELETE CASCADE,
  ghl_call_event_id text NOT NULL,
  ghl_contact_id text,
  event_id_source text NOT NULL CHECK (event_id_source IN ('ghl', 'legacy_body_hash')),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  webhook_signature_mode text NOT NULL,
  integration_mode text,
  workflow_version text,
  prompt_version text,
  schema_version text,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voice_call_events_firm_event_unique UNIQUE (firm_id, ghl_call_event_id)
);

CREATE TABLE public.voice_call_event_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voice_call_event_id uuid NOT NULL REFERENCES public.voice_call_events(id) ON DELETE RESTRICT,
  outcome text NOT NULL CHECK (outcome IN (
    'screened_lead', 'recovery_case', 'unconfirmed', 'duplicate', 'quarantined',
    'technical_failure', 'no_usable_transcript', 'disconnected', 'integration_error'
  )),
  recovery_case_id uuid REFERENCES public.voice_recovery_cases(id) ON DELETE SET NULL,
  screened_lead_id uuid REFERENCES public.screened_leads(id) ON DELETE SET NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voice_call_event_receipts_event_unique UNIQUE (voice_call_event_id)
);

-- The source event itself remains immutable. This separate, mutable lease is
-- the replay fence: an interrupted worker can be retried after its lease
-- expires, while a concurrent webhook cannot process the same event twice.
CREATE TABLE public.voice_call_event_processing_claims (
  voice_call_event_id uuid PRIMARY KEY REFERENCES public.voice_call_events(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'retryable', 'completed')),
  lease_token uuid NOT NULL DEFAULT gen_random_uuid(),
  lease_acquired_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  last_failure text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.voice_recovery_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_case_id uuid NOT NULL REFERENCES public.voice_recovery_cases(id) ON DELETE RESTRICT,
  voice_call_event_id uuid REFERENCES public.voice_call_events(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'created', 'acknowledged', 'assigned', 'follow_up', 'resolved', 'promoted',
    'sla_escalation_queued', 'sla_escalated', 'sla_escalation_failed', 'reconciled'
  )),
  actor_type text NOT NULL CHECK (actor_type IN ('system', 'operator', 'cron')),
  actor_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.voice_recovery_cases
  ADD COLUMN recovery_reason text NOT NULL DEFAULT 'unknown'
  CHECK (recovery_reason IN (
    'unknown', 'non_intake', 'no_contact_provided', 'technical_failure',
    'no_usable_transcript', 'disconnected', 'integration_error'
  ));

CREATE TABLE public.voice_delivery_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_case_id uuid NOT NULL REFERENCES public.voice_recovery_cases(id) ON DELETE CASCADE,
  delivery_type text NOT NULL CHECK (delivery_type IN ('acknowledgement_sla')),
  recipient text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  failed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.voice_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES public.voice_delivery_outbox(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  outcome text NOT NULL CHECK (outcome IN ('sent', 'failed', 'skipped')),
  provider_message_id text,
  error text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voice_delivery_attempts_unique UNIQUE (delivery_id, attempt_number)
);

CREATE INDEX idx_voice_call_events_firm_received ON public.voice_call_events (firm_id, received_at DESC);
CREATE INDEX idx_voice_call_event_receipts_created ON public.voice_call_event_receipts (created_at DESC);
CREATE INDEX idx_voice_call_event_processing_retry ON public.voice_call_event_processing_claims (status, lease_expires_at)
  WHERE status IN ('processing', 'retryable');
CREATE INDEX idx_voice_recovery_audit_case_created ON public.voice_recovery_audit_events (recovery_case_id, created_at DESC);
CREATE INDEX idx_voice_delivery_outbox_due ON public.voice_delivery_outbox (status, next_attempt_at) WHERE status IN ('queued', 'sending');
CREATE INDEX idx_voice_delivery_attempts_delivery ON public.voice_delivery_attempts (delivery_id, attempted_at DESC);

CREATE OR REPLACE FUNCTION public.reject_voice_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'voice evidence ledgers are append-only';
END;
$$;

-- Atomically obtains a processing lease. A terminal receipt always wins; an
-- active lease returns in_progress; an expired or explicitly retryable lease
-- is safely acquired by one worker only. It runs as SECURITY INVOKER: only
-- the explicitly granted service_role may execute it.
CREATE OR REPLACE FUNCTION public.claim_voice_call_event_processing(
  p_voice_call_event_id uuid,
  p_lease_seconds integer DEFAULT 120
)
RETURNS TABLE (
  claim_state text,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer,
  receipt_outcome text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := now();
  v_token uuid := gen_random_uuid();
  v_receipt text;
  v_attempt_count integer;
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION 'voice event lease must be between 30 and 900 seconds';
  END IF;

  SELECT outcome INTO v_receipt
  FROM public.voice_call_event_receipts
  WHERE voice_call_event_id = p_voice_call_event_id;
  IF FOUND THEN
    RETURN QUERY SELECT 'completed'::text, NULL::uuid, NULL::timestamptz, NULL::integer, v_receipt;
    RETURN;
  END IF;

  INSERT INTO public.voice_call_event_processing_claims (
    voice_call_event_id, lease_token, lease_acquired_at, lease_expires_at
  ) VALUES (
    p_voice_call_event_id, v_token, v_now, v_now + make_interval(secs => p_lease_seconds)
  ) ON CONFLICT (voice_call_event_id) DO NOTHING;

  IF FOUND THEN
    RETURN QUERY SELECT 'acquired'::text, v_token, v_now + make_interval(secs => p_lease_seconds), 1, NULL::text;
    RETURN;
  END IF;

  UPDATE public.voice_call_event_processing_claims
  SET status = 'processing', lease_token = v_token, lease_acquired_at = v_now,
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      attempt_count = attempt_count + 1, updated_at = v_now
  WHERE voice_call_event_id = p_voice_call_event_id
    AND (status = 'retryable' OR lease_expires_at <= v_now)
  RETURNING attempt_count INTO v_attempt_count;

  IF FOUND THEN
    RETURN QUERY SELECT 'acquired'::text, v_token, v_now + make_interval(secs => p_lease_seconds), v_attempt_count, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 'in_progress'::text, c.lease_token, c.lease_expires_at, c.attempt_count, NULL::text
  FROM public.voice_call_event_processing_claims c
  WHERE c.voice_call_event_id = p_voice_call_event_id;
END;
$$;

-- A worker may finalize only while it still owns the unexpired lease. Receipt
-- insertion and claim completion are one transaction, preventing an expired
-- worker from winning the terminal-receipt unique constraint after a retry.
CREATE OR REPLACE FUNCTION public.complete_voice_call_event_processing(
  p_voice_call_event_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_recovery_case_id uuid DEFAULT NULL,
  p_screened_lead_id uuid DEFAULT NULL,
  p_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.voice_call_event_receipts
    WHERE voice_call_event_id = p_voice_call_event_id
  ) THEN
    RETURN false;
  END IF;

  UPDATE public.voice_call_event_processing_claims
  SET status = 'completed', last_failure = NULL, updated_at = now()
  WHERE voice_call_event_id = p_voice_call_event_id
    AND status = 'processing'
    AND lease_token = p_lease_token
    AND lease_expires_at > now();
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.voice_call_event_receipts (
    voice_call_event_id, outcome, recovery_case_id, screened_lead_id, detail
  ) VALUES (
    p_voice_call_event_id, p_outcome, p_recovery_case_id, p_screened_lead_id, p_detail
  );
  RETURN true;
END;
$$;

CREATE TRIGGER trg_voice_call_events_immutable
  BEFORE UPDATE OR DELETE ON public.voice_call_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_voice_immutable_mutation();
CREATE TRIGGER trg_voice_call_event_receipts_immutable
  BEFORE UPDATE OR DELETE ON public.voice_call_event_receipts
  FOR EACH ROW EXECUTE FUNCTION public.reject_voice_immutable_mutation();
CREATE TRIGGER trg_voice_recovery_audit_events_immutable
  BEFORE UPDATE OR DELETE ON public.voice_recovery_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_voice_immutable_mutation();
CREATE TRIGGER trg_voice_delivery_attempts_immutable
  BEFORE UPDATE OR DELETE ON public.voice_delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION public.reject_voice_immutable_mutation();
DROP TRIGGER IF EXISTS trg_touch_voice_call_event_processing_claims_updated_at ON public.voice_call_event_processing_claims;
CREATE TRIGGER trg_touch_voice_call_event_processing_claims_updated_at
  BEFORE UPDATE ON public.voice_call_event_processing_claims
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS trg_touch_voice_delivery_outbox_updated_at ON public.voice_delivery_outbox;
CREATE TRIGGER trg_touch_voice_delivery_outbox_updated_at
  BEFORE UPDATE ON public.voice_delivery_outbox
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.voice_call_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_call_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.voice_call_event_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_call_event_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.voice_call_event_processing_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_call_event_processing_claims FORCE ROW LEVEL SECURITY;
ALTER TABLE public.voice_recovery_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_recovery_audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.voice_delivery_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_delivery_outbox FORCE ROW LEVEL SECURITY;
ALTER TABLE public.voice_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_delivery_attempts FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.voice_call_events FROM anon, authenticated;
REVOKE ALL ON public.voice_call_event_receipts FROM anon, authenticated;
REVOKE ALL ON public.voice_call_event_processing_claims FROM anon, authenticated;
REVOKE ALL ON public.voice_recovery_audit_events FROM anon, authenticated;
REVOKE ALL ON public.voice_delivery_outbox FROM anon, authenticated;
REVOKE ALL ON public.voice_delivery_attempts FROM anon, authenticated;
REVOKE ALL ON public.voice_recovery_cases FROM anon, authenticated;
GRANT ALL ON public.voice_call_events TO service_role;
GRANT ALL ON public.voice_call_event_receipts TO service_role;
GRANT ALL ON public.voice_call_event_processing_claims TO service_role;
GRANT ALL ON public.voice_recovery_audit_events TO service_role;
GRANT ALL ON public.voice_delivery_outbox TO service_role;
GRANT ALL ON public.voice_delivery_attempts TO service_role;
GRANT ALL ON public.voice_recovery_cases TO service_role;
REVOKE ALL ON FUNCTION public.reject_voice_immutable_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_voice_immutable_mutation() TO service_role;
REVOKE ALL ON FUNCTION public.claim_voice_call_event_processing(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_voice_call_event_processing(uuid, integer) TO service_role;
REVOKE ALL ON FUNCTION public.complete_voice_call_event_processing(uuid, uuid, text, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_voice_call_event_processing(uuid, uuid, text, uuid, uuid, jsonb) TO service_role;

COMMENT ON TABLE public.voice_call_events IS 'Immutable accepted Voice AI webhook ledger, unique on firm plus true GHL call event id.';
COMMENT ON TABLE public.voice_call_event_processing_claims IS 'Mutable, short-lived processing lease for replay-safe Voice AI webhook handling.';
COMMENT ON TABLE public.voice_recovery_audit_events IS 'Immutable operator and system activity history for a recovery case.';
COMMENT ON TABLE public.voice_delivery_outbox IS 'Mutable retry queue for recovery notifications; immutable evidence is in voice_delivery_attempts.';

NOTIFY pgrst, 'reload schema';
