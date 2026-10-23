-- Live dispatch may claim only scheduled messages belonging to explicitly
-- allowlisted enrollments. Keep the unrestricted claim RPC for synthetic use.
CREATE OR REPLACE FUNCTION public.claim_agency_followup_live_messages(
  p_worker_id text,
  p_now timestamptz,
  p_lease_seconds integer,
  p_limit integer,
  p_allowed_enrollment_ids uuid[]
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
  IF p_now IS NULL THEN RAISE EXCEPTION 'claim time is required'; END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 900 THEN
    RAISE EXCEPTION 'invalid lease duration';
  END IF;
  IF p_limit IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'live mode may claim exactly one message'; END IF;
  IF p_allowed_enrollment_ids IS NULL OR cardinality(p_allowed_enrollment_ids) NOT BETWEEN 1 AND 100
     OR array_position(p_allowed_enrollment_ids, NULL::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'live enrollment allowlist is invalid';
  END IF;

  -- Do not quarantine expired claims from enrollments outside this invocation's
  -- allowlist; those rows are outside the live dispatcher scope.
  WITH expired AS (
    UPDATE public.agency_followup_messages
    SET state = 'unknown', unknown_since = p_now, last_error_code = 'lease_expired_outcome_unknown',
        lease_owner = NULL, lease_until = NULL, updated_at = p_now
    WHERE state = 'claimed' AND lease_until <= p_now
      AND enrollment_id = ANY(p_allowed_enrollment_ids)
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
      AND message.enrollment_id = ANY(p_allowed_enrollment_ids)
    ORDER BY message.scheduled_at, message.created_at, message.id
    FOR UPDATE OF message SKIP LOCKED
    LIMIT 1
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

REVOKE ALL ON FUNCTION public.claim_agency_followup_live_messages(text, timestamptz, integer, integer, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_agency_followup_live_messages(text, timestamptz, integer, integer, uuid[]) TO service_role;
