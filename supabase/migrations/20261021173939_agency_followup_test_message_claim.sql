-- Test mode must claim only the explicitly allowlisted message/enrollment pairs.
-- The regular dispatcher claim is intentionally left unrestricted for live mode.
CREATE OR REPLACE FUNCTION public.claim_agency_followup_test_messages(
  p_worker_id text,
  p_now timestamptz,
  p_lease_seconds integer,
  p_limit integer,
  p_allowed_targets jsonb
)
RETURNS SETOF public.agency_followup_messages
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_worker_id IS NULL OR char_length(btrim(p_worker_id)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'worker id is required';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 900 THEN RAISE EXCEPTION 'invalid lease duration'; END IF;
  IF p_limit IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'test mode may claim exactly one message'; END IF;
  IF p_allowed_targets IS NULL OR jsonb_typeof(p_allowed_targets) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'test allowlist is invalid';
  END IF;
  IF jsonb_array_length(p_allowed_targets) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'test allowlist size is invalid';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_allowed_targets) AS allowed(target)
    WHERE jsonb_typeof(allowed.target) IS DISTINCT FROM 'object'
       OR jsonb_typeof(allowed.target -> 'enrollmentId') IS DISTINCT FROM 'string'
       OR jsonb_typeof(allowed.target -> 'messageId') IS DISTINCT FROM 'string'
       OR jsonb_typeof(allowed.target -> 'recipientEmail') IS DISTINCT FROM 'string'
       OR nullif(btrim(allowed.target ->> 'enrollmentId'), '') IS NULL
       OR nullif(btrim(allowed.target ->> 'messageId'), '') IS NULL
       OR nullif(btrim(allowed.target ->> 'recipientEmail'), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'test allowlist target is invalid';
  END IF;

  -- Preserve expired-lease quarantine only for the explicitly allowlisted test target.
  WITH expired AS (
    UPDATE public.agency_followup_messages
    SET state = 'unknown', unknown_since = p_now, last_error_code = 'lease_expired_outcome_unknown',
        lease_owner = NULL, lease_until = NULL, updated_at = p_now
    WHERE state = 'claimed' AND lease_until <= p_now
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_allowed_targets) AS allowed(target)
        WHERE public.agency_followup_messages.id::text = allowed.target ->> 'messageId'
          AND public.agency_followup_messages.enrollment_id::text = allowed.target ->> 'enrollmentId'
          AND public.agency_followup_messages.recipient_email_snapshot = allowed.target ->> 'recipientEmail'
      )
    RETURNING id, enrollment_id
  )
  INSERT INTO public.agency_followup_events (enrollment_id, message_id, event_type, idempotency_key, event_payload)
  SELECT expired.enrollment_id, expired.id, 'provider_unknown', 'lease-expired:' || expired.id::text,
         jsonb_build_object('reason', 'lease_expired_outcome_unknown', 'observedAt', p_now)
  FROM expired
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN QUERY
  WITH candidates AS (
    SELECT message.id
    FROM public.agency_followup_messages AS message
    WHERE message.state = 'scheduled' AND message.scheduled_at <= p_now
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_allowed_targets) AS allowed(target)
        WHERE message.id::text = allowed.target ->> 'messageId'
          AND message.enrollment_id::text = allowed.target ->> 'enrollmentId'
          AND message.recipient_email_snapshot = allowed.target ->> 'recipientEmail'
      )
    ORDER BY message.scheduled_at, message.created_at, message.id
    FOR UPDATE OF message SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.agency_followup_messages AS message
  SET state = 'claimed', lease_owner = btrim(p_worker_id),
      lease_until = p_now + make_interval(secs => p_lease_seconds),
      attempt_count = message.attempt_count + 1, updated_at = p_now
  FROM candidates
  WHERE message.id = candidates.id
  RETURNING message.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_agency_followup_test_messages(text, timestamptz, integer, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_agency_followup_test_messages(text, timestamptz, integer, integer, jsonb) TO service_role;
