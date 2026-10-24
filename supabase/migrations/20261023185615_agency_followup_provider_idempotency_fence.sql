-- Reserve the stable Resend idempotency key before the first real provider handoff.
-- Resend retains keys for 24 hours; stop safely after 23 hours to leave margin.
ALTER TABLE public.agency_followup_messages
  ADD COLUMN provider_idempotency_first_used_at timestamptz NULL;

COMMENT ON COLUMN public.agency_followup_messages.provider_idempotency_first_used_at IS
  'Database timestamp of the first real Resend handoff reservation for this immutable logical message key; never reset.';

-- Recover retry timestamps only from persisted provider-attempt events whose
-- exact Resend error codes prove a provider handoff was attempted.
WITH first_resend_attempt AS (
  SELECT event.message_id, min(event.occurred_at) AS first_used_at
  FROM public.agency_followup_events AS event
  WHERE event.message_id IS NOT NULL
    AND event.event_type = 'provider_attempted'
    AND event.event_payload->>'errorCode' IN (
      'resend_concurrent_idempotent_requests',
      'resend_rate_limit_exceeded'
    )
  GROUP BY event.message_id
)
UPDATE public.agency_followup_messages AS message
SET provider_idempotency_first_used_at = first_resend_attempt.first_used_at
FROM first_resend_attempt
WHERE message.id = first_resend_attempt.message_id
  AND message.provider_idempotency_first_used_at IS NULL;

-- Retryable rows without trustworthy timing, or beyond the safe provider
-- retention window, cannot safely be sent again with the same key.
WITH quarantined AS (
  UPDATE public.agency_followup_messages AS message
  SET state = 'unknown',
      scheduled_at = NULL,
      lease_owner = NULL,
      lease_until = NULL,
      unknown_since = clock_timestamp(),
      last_error_code = CASE
        WHEN message.provider_idempotency_first_used_at IS NULL
          THEN 'provider_idempotency_window_unverifiable'
        ELSE 'resend_idempotency_window_expired'
      END,
      updated_at = clock_timestamp()
  WHERE message.state = 'scheduled'
    AND message.last_error_code IN (
      'resend_concurrent_idempotent_requests',
      'resend_rate_limit_exceeded'
    )
    AND (message.provider_idempotency_first_used_at IS NULL
      OR message.provider_idempotency_first_used_at <= clock_timestamp() - interval '23 hours')
  RETURNING message.id, message.enrollment_id, message.last_error_code, message.unknown_since
)
INSERT INTO public.agency_followup_events (
  enrollment_id, message_id, event_type, idempotency_key, event_payload, occurred_at
)
SELECT quarantined.enrollment_id, quarantined.id, 'provider_unknown',
       'resend-window-migration:' || quarantined.id::text,
       jsonb_build_object('detail', quarantined.last_error_code, 'automaticRetry', false,
                          'reconciledAtMigration', true),
       quarantined.unknown_since
FROM quarantined
ON CONFLICT (idempotency_key) DO NOTHING;

-- The first-use timestamp is monotonic and cannot be cleared or moved forward.
CREATE OR REPLACE FUNCTION public.preserve_agency_followup_provider_idempotency_first_use()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A caller may seed a historical value only to shorten the safe window;
    -- future values are clamped so inserts cannot extend provider retention.
    IF NEW.provider_idempotency_first_used_at IS NOT NULL THEN
      NEW.provider_idempotency_first_used_at := LEAST(
        NEW.provider_idempotency_first_used_at,
        clock_timestamp()
      );
    END IF;
  ELSIF OLD.provider_idempotency_first_used_at IS NULL
        AND NEW.provider_idempotency_first_used_at IS NOT NULL THEN
    -- Never let a caller extend the window by choosing a future timestamp.
    NEW.provider_idempotency_first_used_at := LEAST(
      NEW.provider_idempotency_first_used_at,
      clock_timestamp()
    );
  ELSIF OLD.provider_idempotency_first_used_at IS NOT NULL
        AND NEW.provider_idempotency_first_used_at IS DISTINCT FROM OLD.provider_idempotency_first_used_at THEN
    RAISE EXCEPTION 'provider idempotency first-use timestamp is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agency_followup_provider_idempotency_first_use_immutable
  BEFORE INSERT OR UPDATE OF provider_idempotency_first_used_at ON public.agency_followup_messages
  FOR EACH ROW EXECUTE FUNCTION public.preserve_agency_followup_provider_idempotency_first_use();

-- Return ready only for the current unexpired lease. The function commits its
-- timestamp reservation before application code can call Resend.
CREATE OR REPLACE FUNCTION public.prepare_agency_followup_provider_attempt(
  p_message_id uuid,
  p_enrollment_id uuid,
  p_lease_owner text,
  p_attempt_count integer,
  p_lease_seconds integer DEFAULT 120,
  p_max_idempotency_age_seconds integer DEFAULT 82800
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_message public.agency_followup_messages%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_detail text;
BEGIN
  IF p_message_id IS NULL OR p_enrollment_id IS NULL
     OR p_lease_owner IS NULL OR char_length(btrim(p_lease_owner)) NOT BETWEEN 1 AND 200
     OR p_attempt_count IS NULL OR p_attempt_count < 1
     OR p_lease_seconds NOT BETWEEN 10 AND 900
     OR p_max_idempotency_age_seconds NOT BETWEEN 3600 AND 82800 THEN
    RAISE EXCEPTION 'invalid Agency follow-up provider handoff request';
  END IF;

  SELECT message.* INTO v_message
  FROM public.agency_followup_messages AS message
  WHERE message.id = p_message_id
    AND message.enrollment_id = p_enrollment_id
    AND message.state = 'claimed'
    AND message.lease_owner = btrim(p_lease_owner)
    AND message.attempt_count = p_attempt_count
    AND message.lease_until > v_now
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  -- SELECT FOR UPDATE may have waited behind another transaction. Use fresh
  -- database time after obtaining the lock, not the timestamp from call entry.
  v_now := clock_timestamp();
  IF v_message.lease_until <= v_now THEN RETURN 'stale'; END IF;

  IF v_message.provider_idempotency_first_used_at IS NULL THEN
    UPDATE public.agency_followup_messages AS message
    SET provider_idempotency_first_used_at = v_now,
        lease_until = GREATEST(message.lease_until, v_now + make_interval(secs => p_lease_seconds)),
        updated_at = v_now
    WHERE message.id = p_message_id
      AND message.enrollment_id = p_enrollment_id
      AND message.state = 'claimed'
      AND message.lease_owner = btrim(p_lease_owner)
      AND message.attempt_count = p_attempt_count
      AND message.lease_until > clock_timestamp()
    RETURNING message.* INTO v_message;
  ELSE
    UPDATE public.agency_followup_messages AS message
    SET lease_until = GREATEST(message.lease_until, v_now + make_interval(secs => p_lease_seconds)),
        updated_at = v_now
    WHERE message.id = p_message_id
      AND message.enrollment_id = p_enrollment_id
      AND message.state = 'claimed'
      AND message.lease_owner = btrim(p_lease_owner)
      AND message.attempt_count = p_attempt_count
      AND message.lease_until > clock_timestamp()
    RETURNING message.* INTO v_message;
  END IF;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  v_now := clock_timestamp();
  IF v_message.lease_until <= v_now THEN RETURN 'stale'; END IF;

  IF v_now >= v_message.provider_idempotency_first_used_at
                 + make_interval(secs => p_max_idempotency_age_seconds) THEN
    v_detail := 'resend_idempotency_window_expired';
    UPDATE public.agency_followup_messages AS message
    SET state = 'unknown', scheduled_at = NULL, lease_owner = NULL, lease_until = NULL,
        unknown_since = v_now, last_error_code = v_detail, updated_at = v_now
    WHERE message.id = p_message_id
      AND message.enrollment_id = p_enrollment_id
      AND message.state = 'claimed'
      AND message.lease_owner = btrim(p_lease_owner)
      AND message.attempt_count = p_attempt_count;
    IF NOT FOUND THEN RETURN 'stale'; END IF;

    INSERT INTO public.agency_followup_events (
      enrollment_id, message_id, event_type, idempotency_key, event_payload, occurred_at
    ) VALUES (
      p_enrollment_id, p_message_id, 'provider_unknown',
      'resend-window-expired:' || p_message_id::text,
      jsonb_build_object('detail', v_detail, 'automaticRetry', false,
                         'firstProviderUseAt', v_message.provider_idempotency_first_used_at),
      v_now
    ) ON CONFLICT (idempotency_key) DO NOTHING;
    RETURN 'expired';
  END IF;

  RETURN 'ready';
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_agency_followup_provider_attempt(uuid, uuid, text, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_agency_followup_provider_attempt(uuid, uuid, text, integer, integer, integer)
  TO service_role;
