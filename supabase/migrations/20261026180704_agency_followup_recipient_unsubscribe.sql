-- Durable recipient-requested opt-out for Agency follow-up emails sent through
-- Resend's /emails API. The signed URL is verified by the application before
-- this service-role-only RPC is called. Store only the recipient hash and the
-- message/enrollment identity; never persist the bearer token or raw address.

BEGIN;

CREATE TABLE public.agency_followup_recipient_unsubscribes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_prospect_id uuid NOT NULL
    REFERENCES public.agency_prospects(id) ON DELETE RESTRICT,
  enrollment_id uuid NOT NULL
    REFERENCES public.agency_followup_enrollments(id) ON DELETE RESTRICT,
  message_id uuid NOT NULL
    REFERENCES public.agency_followup_messages(id) ON DELETE RESTRICT,
  recipient_email_sha256 text NOT NULL
    CHECK (recipient_email_sha256 ~ '^[a-f0-9]{64}$'),
  token_sha256 text NOT NULL UNIQUE
    CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (recorded_at IS NOT NULL)
);

CREATE INDEX agency_followup_recipient_unsubscribes_scope_idx
  ON public.agency_followup_recipient_unsubscribes (
    agency_prospect_id, recipient_email_sha256, recorded_at DESC, id DESC
  );
CREATE INDEX agency_followup_recipient_unsubscribes_email_idx
  ON public.agency_followup_recipient_unsubscribes (recipient_email_sha256);

ALTER TABLE public.agency_followup_recipient_unsubscribes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_followup_recipient_unsubscribes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.agency_followup_recipient_unsubscribes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.agency_followup_recipient_unsubscribes TO service_role;

CREATE OR REPLACE FUNCTION public.lock_agency_followup_unsubscribe_recipient(
  p_recipient_email_sha256 text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_recipient_email_sha256 IS NULL
     OR p_recipient_email_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid Agency follow-up unsubscribe recipient hash';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('agency-followup-unsubscribe-recipient:' || p_recipient_email_sha256, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lock_agency_followup_unsubscribe_recipient(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_agency_followup_unsubscribe_recipient(text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.lock_agency_followup_recipient_unsubscribe_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.lock_agency_followup_identity(NEW.agency_prospect_id);
  PERFORM public.lock_agency_followup_unsubscribe_recipient(NEW.recipient_email_sha256);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_agency_followup_recipient_unsubscribe_before_insert()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER agency_followup_recipient_unsubscribes_lock_identity
  BEFORE INSERT ON public.agency_followup_recipient_unsubscribes
  FOR EACH ROW EXECUTE FUNCTION public.lock_agency_followup_recipient_unsubscribe_before_insert();

CREATE TRIGGER agency_followup_recipient_unsubscribes_no_mutation
  BEFORE UPDATE OR DELETE ON public.agency_followup_recipient_unsubscribes
  FOR EACH ROW EXECUTE FUNCTION public.block_append_only_mutation();

CREATE OR REPLACE FUNCTION public.record_agency_followup_recipient_unsubscribe(
  p_message_id uuid,
  p_enrollment_id uuid,
  p_recipient_email_sha256 text,
  p_token_sha256 text
)
RETURNS TABLE (event_id uuid, replayed boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_prospect_id uuid;
  v_inserted_id uuid;
  v_existing public.agency_followup_recipient_unsubscribes%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_message_id IS NULL OR p_enrollment_id IS NULL
     OR p_recipient_email_sha256 IS NULL OR p_recipient_email_sha256 !~ '^[a-f0-9]{64}$'
     OR p_token_sha256 IS NULL OR p_token_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid Agency follow-up unsubscribe request';
  END IF;

  SELECT enrollment.prospect_id INTO v_prospect_id
  FROM public.agency_followup_messages AS message
  JOIN public.agency_followup_enrollments AS enrollment ON enrollment.id = message.enrollment_id
  WHERE message.id = p_message_id
    AND message.enrollment_id = p_enrollment_id
    AND public.agency_followup_email_sha256(message.recipient_email_snapshot) = p_recipient_email_sha256
    AND public.agency_followup_email_sha256(enrollment.recipient_email_snapshot) = p_recipient_email_sha256
    AND message.attempt_count > 0
    AND message.state IN ('claimed', 'accepted', 'unknown', 'failed');
  IF v_prospect_id IS NULL THEN
    RAISE EXCEPTION 'Agency follow-up unsubscribe does not match an attempted message';
  END IF;

  -- Serialize the opt-out with provider handoff and all other contact changes.
  PERFORM public.lock_agency_followup_identity(v_prospect_id);

  SELECT enrollment.prospect_id INTO v_prospect_id
  FROM public.agency_followup_messages AS message
  JOIN public.agency_followup_enrollments AS enrollment ON enrollment.id = message.enrollment_id
  WHERE message.id = p_message_id
    AND message.enrollment_id = p_enrollment_id
    AND public.agency_followup_email_sha256(message.recipient_email_snapshot) = p_recipient_email_sha256
    AND public.agency_followup_email_sha256(enrollment.recipient_email_snapshot) = p_recipient_email_sha256
    AND message.attempt_count > 0
    AND message.state IN ('claimed', 'accepted', 'unknown', 'failed')
  FOR UPDATE OF message, enrollment;
  IF v_prospect_id IS NULL THEN
    RAISE EXCEPTION 'Agency follow-up unsubscribe message changed during processing';
  END IF;

  INSERT INTO public.agency_followup_recipient_unsubscribes (
    agency_prospect_id, enrollment_id, message_id,
    recipient_email_sha256, token_sha256, recorded_at
  ) VALUES (
    v_prospect_id, p_enrollment_id, p_message_id,
    p_recipient_email_sha256, p_token_sha256, v_now
  )
  ON CONFLICT (token_sha256) DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NOT NULL THEN
    INSERT INTO public.agency_followup_events (
      enrollment_id, message_id, event_type, idempotency_key, event_payload, occurred_at
    ) VALUES (
      p_enrollment_id, p_message_id, 'unsubscribe_observed',
      'agency-followup-unsubscribe:' || p_token_sha256,
      jsonb_build_object(
        'recipientEmailSha256', p_recipient_email_sha256,
        'source', 'recipient_one_click_link'
      ),
      v_now
    );
    RETURN QUERY SELECT v_inserted_id, false;
    RETURN;
  END IF;

  SELECT * INTO v_existing
  FROM public.agency_followup_recipient_unsubscribes AS unsubscribe_event
  WHERE unsubscribe_event.token_sha256 = p_token_sha256;
  IF NOT FOUND
     OR v_existing.agency_prospect_id IS DISTINCT FROM v_prospect_id
     OR v_existing.enrollment_id IS DISTINCT FROM p_enrollment_id
     OR v_existing.message_id IS DISTINCT FROM p_message_id
     OR v_existing.recipient_email_sha256 IS DISTINCT FROM p_recipient_email_sha256 THEN
    RAISE EXCEPTION 'Agency follow-up unsubscribe idempotency key was reused for another target';
  END IF;

  RETURN QUERY SELECT v_existing.id, true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_agency_followup_recipient_unsubscribe(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_agency_followup_recipient_unsubscribe(uuid, uuid, text, text)
  TO service_role;

-- Apply first-party one-click opt-outs in the same final dispatch gate used by
-- workers. The recipient-level advisory lock makes a just-recorded opt-out
-- visible before another prospect row with the same email can be authorized.
DO $agency_followup_recipient_unsubscribe_handoff_gate$
DECLARE
  v_function_definition text;
  v_anchor text := 'recipient_hash:=public.agency_followup_recipient_sha256(p.id::text,p.firm_name,p.contact_name,p.contact_email);';
  v_marker text := 'agency_followup_recipient_unsubscribe_handoff_gate';
  v_insertion text := $insertion$IF hash_email_now IS NOT NULL THEN
  PERFORM public.lock_agency_followup_unsubscribe_recipient(hash_email_now);
  IF EXISTS (
    SELECT 1
    FROM public.agency_followup_recipient_unsubscribes AS recipient_unsubscribe
    WHERE recipient_unsubscribe.recipient_email_sha256=hash_email_now
  ) THEN
    blockers:=pg_catalog.array_append(blockers,'contactability_blocked');
  END IF;
END IF; -- agency_followup_recipient_unsubscribe_handoff_gate$insertion$;
  v_anchor_count integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.authorize_agency_followup_provider_handoff(uuid,uuid,text,integer,integer,integer)'::regprocedure
  ) INTO v_function_definition;

  IF v_function_definition IS NULL OR pg_catalog.strpos(v_function_definition, v_marker) > 0 THEN
    RAISE EXCEPTION 'Agency follow-up recipient unsubscribe gate cannot be patched';
  END IF;

  v_anchor_count := (
    pg_catalog.length(v_function_definition) -
    pg_catalog.length(pg_catalog.replace(v_function_definition, v_anchor, ''))
  ) / pg_catalog.length(v_anchor);
  IF v_anchor_count <> 1 THEN
    RAISE EXCEPTION 'Expected one Agency follow-up recipient identity hash, found %', v_anchor_count;
  END IF;

  EXECUTE pg_catalog.replace(
    v_function_definition,
    v_anchor,
    v_insertion || E'\n  ' || v_anchor
  );
END;
$agency_followup_recipient_unsubscribe_handoff_gate$;

COMMENT ON TABLE public.agency_followup_recipient_unsubscribes IS
  'Append-only recipient opt-out evidence for Agency follow-up; stores only exact contact hashes and message/enrollment IDs.';

COMMIT;
