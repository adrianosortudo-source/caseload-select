-- Agency-specific explicit email opt-in evidence for live follow-up.
-- Empty history is ineligible. These rows are operator attestations that reference
-- consent evidence; the referenced artifact must be reviewed before a live dispatch.

CREATE TABLE public.agency_followup_opt_in_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_prospect_id uuid NOT NULL
    REFERENCES public.agency_prospects(id) ON DELETE RESTRICT,
  source_link_id uuid NOT NULL
    REFERENCES public.prospect_source_links(id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL
    REFERENCES public.prospect_conversations(id) ON DELETE RESTRICT,
  recipient_email_sha256 text NOT NULL
    CHECK (recipient_email_sha256 ~ '^[a-f0-9]{64}$'),
  channel text NOT NULL DEFAULT 'email' CHECK (channel = 'email'),
  purpose text NOT NULL DEFAULT 'agency_followup_email'
    CHECK (purpose = 'agency_followup_email'),
  event_type text NOT NULL CHECK (event_type IN ('opt_in_granted', 'opt_in_withdrawn')),
  captured_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  capture_source text NOT NULL CHECK (capture_source IN (
    'subject_web_form', 'subject_email', 'signed_document', 'recorded_verbal_consent', 'other_verified_evidence'
  )),
  consent_text_version text NOT NULL
    CHECK (char_length(btrim(consent_text_version)) BETWEEN 1 AND 200),
  consent_text_sha256 text NOT NULL
    CHECK (consent_text_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_reference text NOT NULL
    CHECK (char_length(btrim(evidence_reference)) BETWEEN 1 AND 2000),
  evidence_sha256 text NOT NULL
    CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  actor_operator_id uuid NOT NULL
    REFERENCES public.firm_lawyers(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL
    CHECK (idempotency_key = btrim(idempotency_key)
      AND char_length(idempotency_key) BETWEEN 1 AND 500),
  CONSTRAINT agency_followup_opt_in_events_source_conversation_fk
    FOREIGN KEY (conversation_id, source_link_id)
    REFERENCES public.prospect_conversation_sources (conversation_id, source_link_id)
    ON DELETE RESTRICT,
  CONSTRAINT agency_followup_opt_in_events_recorded_after_capture
    CHECK (recorded_at >= captured_at)
);

CREATE UNIQUE INDEX agency_followup_opt_in_events_idempotency_unique
  ON public.agency_followup_opt_in_events (btrim(idempotency_key));

CREATE INDEX agency_followup_opt_in_events_current_idx
  ON public.agency_followup_opt_in_events (
    agency_prospect_id, source_link_id, conversation_id,
    recipient_email_sha256, purpose, recorded_at DESC, id DESC
  );

-- Validate the evidence row against the exact current Agency contact and the
-- shared prospect identity graph. A firm-only source or ambiguous/mismatched
-- source-to-conversation mapping cannot record an opt-in event.
CREATE OR REPLACE FUNCTION public.validate_agency_followup_opt_in_event_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_valid_identity_count bigint;
  v_source_association_count bigint;
BEGIN
  NEW.recorded_at := clock_timestamp();
  IF NEW.captured_at > NEW.recorded_at THEN
    RAISE EXCEPTION 'Agency follow-up opt-in capture time cannot be in the future';
  END IF;

  SELECT count(*) INTO v_source_association_count
  FROM public.prospect_conversation_sources AS association
  WHERE association.source_link_id = NEW.source_link_id;
  IF v_source_association_count <> 1 THEN
    RAISE EXCEPTION 'Agency follow-up opt-in requires one unambiguous source conversation';
  END IF;

  SELECT count(DISTINCT (source_link.id, conversation.id, person.id))
    INTO v_valid_identity_count
  FROM public.agency_prospects AS agency_prospect
  JOIN public.prospect_source_links AS source_link
    ON source_link.id = NEW.source_link_id
  JOIN public.prospect_conversation_sources AS association
    ON association.source_link_id = source_link.id
   AND association.conversation_id = NEW.conversation_id
  JOIN public.prospect_conversations AS conversation
    ON conversation.id = association.conversation_id
  JOIN public.prospect_people AS person
    ON person.id = source_link.person_id
  JOIN public.prospect_person_firm_roles AS role
    ON role.organization_id = source_link.organization_id
   AND role.person_id = source_link.person_id
   AND role.active
  WHERE agency_prospect.id = NEW.agency_prospect_id
    AND source_link.source_record_key = agency_prospect.id::text
    AND source_link.source_system = CASE
      WHEN EXISTS (
        SELECT 1 FROM public.prospect_source_links AS preferred_contact_source
        WHERE preferred_contact_source.source_system = 'agency_crm_contact'
          AND preferred_contact_source.source_record_key = agency_prospect.id::text
      ) THEN 'agency_crm_contact'
      ELSE 'agency_crm'
    END
    AND (
      SELECT count(*)
      FROM public.prospect_source_links AS selected_source
      WHERE selected_source.source_system = CASE
        WHEN EXISTS (
          SELECT 1 FROM public.prospect_source_links AS preferred_contact_source
          WHERE preferred_contact_source.source_system = 'agency_crm_contact'
            AND preferred_contact_source.source_record_key = agency_prospect.id::text
        ) THEN 'agency_crm_contact'
        ELSE 'agency_crm'
      END
        AND selected_source.source_record_key = agency_prospect.id::text
        AND selected_source.active
        AND selected_source.organization_id IS NOT NULL
        AND selected_source.person_id IS NOT NULL
    ) = 1
    AND source_link.active
    AND source_link.person_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.firm_lawyers AS actor
      WHERE actor.id = NEW.actor_operator_id
        AND actor.role = 'operator'
        AND actor.disabled = false
    )
    AND conversation.organization_id = source_link.organization_id
    AND conversation.person_id = source_link.person_id
    AND person.primary_email IS NOT NULL
    AND agency_prospect.contact_email IS NOT NULL
    AND lower(btrim(person.primary_email)) = lower(btrim(agency_prospect.contact_email))
    AND encode(extensions.digest(convert_to(lower(btrim(person.primary_email)), 'UTF8'), 'sha256'), 'hex')
      = NEW.recipient_email_sha256;

  IF v_valid_identity_count <> 1 THEN
    RAISE EXCEPTION 'Agency follow-up opt-in does not match the exact active contact, source, conversation, and recipient';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER agency_followup_opt_in_events_validate_insert
  BEFORE INSERT ON public.agency_followup_opt_in_events
  FOR EACH ROW EXECUTE FUNCTION public.validate_agency_followup_opt_in_event_insert();
REVOKE ALL ON FUNCTION public.validate_agency_followup_opt_in_event_insert()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER agency_followup_opt_in_events_no_mutation
  BEFORE UPDATE OR DELETE ON public.agency_followup_opt_in_events
  FOR EACH ROW EXECUTE FUNCTION public.block_append_only_mutation();

-- Current state is the newest recorded event for the complete opt-in scope.
-- Consumers must require event_type='opt_in_granted' and revalidate the exact
-- live source/contact identity immediately before dispatch.
CREATE VIEW public.agency_followup_current_opt_ins
WITH (security_invoker = true) AS
SELECT DISTINCT ON (
  agency_prospect_id, source_link_id, conversation_id,
  recipient_email_sha256, purpose
)
  id, agency_prospect_id, source_link_id, conversation_id,
  recipient_email_sha256, channel, purpose, event_type, captured_at,
  recorded_at, capture_source, consent_text_version, consent_text_sha256,
  evidence_reference, evidence_sha256, actor_operator_id, idempotency_key
FROM public.agency_followup_opt_in_events
ORDER BY
  agency_prospect_id, source_link_id, conversation_id,
  recipient_email_sha256, purpose, recorded_at DESC, id DESC;

ALTER TABLE public.agency_followup_opt_in_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_followup_opt_in_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.agency_followup_opt_in_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.agency_followup_opt_in_events TO service_role;
REVOKE ALL ON public.agency_followup_current_opt_ins FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.agency_followup_current_opt_ins TO service_role;

-- Preserve the existing least-privilege RPC while allowing fail-closed opt-in blockers.
CREATE OR REPLACE FUNCTION public.persist_agency_followup_disposition(
  p_message_id uuid,
  p_enrollment_id uuid,
  p_lease_owner text,
  p_attempt_count integer,
  p_disposition jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_state text;
  v_event_type text;
  v_at timestamptz;
  v_scheduled_at timestamptz;
  v_accepted_at timestamptz;
  v_provider_message_id text;
  v_recipient_email_sha256 text;
  v_error_code text;
  v_blockers jsonb;
  v_enrollment_id uuid;
  v_payload jsonb;
BEGIN
  IF p_message_id IS NULL OR p_enrollment_id IS NULL
     OR p_lease_owner IS NULL OR char_length(btrim(p_lease_owner)) NOT BETWEEN 1 AND 200
     OR p_attempt_count IS NULL OR p_attempt_count < 1
     OR p_disposition IS NULL OR jsonb_typeof(p_disposition) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid Agency follow-up disposition request';
  END IF;
  v_state := p_disposition->>'state';
  IF v_state IS NULL OR v_state NOT IN ('blocked', 'accepted', 'scheduled', 'failed', 'unknown') THEN
    RAISE EXCEPTION 'unsupported Agency follow-up disposition state';
  END IF;
  v_at := (p_disposition->>'at')::timestamptz;
  IF v_at IS NULL THEN RAISE EXCEPTION 'disposition timestamp is required'; END IF;

  IF v_state = 'blocked' THEN
    IF p_disposition - ARRAY['state', 'blockers', 'at']::text[] <> '{}'::jsonb
       OR jsonb_typeof(p_disposition->'blockers') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid blocked disposition';
    END IF;
    IF jsonb_array_length(p_disposition->'blockers') NOT BETWEEN 1 AND 30
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(p_disposition->'blockers') AS blocker(value)
         WHERE blocker.value NOT IN (
           'prospect_mismatch', 'recipient_identity_missing', 'recipient_email_invalid',
           'eligibility_pending', 'eligibility_unknown', 'eligibility_not_approved',
           'eligibility_evidence_missing', 'explicit_opt_in_missing',
           'explicit_opt_in_withdrawn', 'contactability_unknown', 'contactability_blocked',
           'conversation_stopped', 'prospect_status_stopped', 'sequence_not_released',
           'message_not_approved', 'approval_missing', 'approval_invalid_reviewer_or_time',
           'approval_stale_content', 'approval_stale_recipient', 'cancelled', 'invalid_schedule',
           'not_due', 'minimum_spacing_not_elapsed', 'outside_send_window',
           'send_mode_off', 'resend_api_key_missing', 'resend_webhook_secret_missing',
           'followup_sender_missing_or_unverified',
           'followup_reply_to_missing_or_unverified', 'test_recipient_allowlist_empty',
           'test_record_allowlist_empty_or_invalid', 'live_enrollment_allowlist_empty',
           'send_config_not_ready', 'logical_message_identity_invalid', 'send_target_invalid',
           'test_recipient_not_allowlisted', 'test_enrollment_message_recipient_not_allowlisted',
           'live_enrollment_not_allowlisted', 'followup_sender_or_reply_to_missing'
         )
       ) THEN RAISE EXCEPTION 'invalid blocked disposition'; END IF;
    v_event_type := 'message_blocked';
    v_blockers := p_disposition->'blockers';
    v_payload := jsonb_build_object('blockers', v_blockers, 'checkedAt', v_at);
  ELSIF v_state = 'accepted' THEN
    IF p_disposition - ARRAY['state', 'providerMessageId', 'recipientEmailHash', 'acceptedAt', 'at']::text[] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'invalid accepted disposition fields';
    END IF;
    v_provider_message_id := btrim(p_disposition->>'providerMessageId');
    IF char_length(v_provider_message_id) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid provider message id'; END IF;
    v_recipient_email_sha256 := p_disposition->>'recipientEmailHash';
    IF v_recipient_email_sha256 IS NULL OR v_recipient_email_sha256 !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'invalid recipient email fingerprint';
    END IF;
    v_accepted_at := (p_disposition->>'acceptedAt')::timestamptz;
    v_event_type := 'provider_accepted';
    v_payload := jsonb_build_object('providerMessageId', v_provider_message_id,
                                    'recipientEmailHash', v_recipient_email_sha256,
                                    'acceptedAt', v_accepted_at);
  ELSIF v_state = 'scheduled' THEN
    IF p_disposition - ARRAY['state', 'retryAt', 'errorCode', 'at']::text[] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'invalid scheduled disposition fields';
    END IF;
    v_scheduled_at := (p_disposition->>'retryAt')::timestamptz;
    v_error_code := p_disposition->>'errorCode';
    IF v_error_code IS NULL OR char_length(v_error_code) NOT BETWEEN 1 AND 300
       OR v_error_code !~ '^[A-Za-z0-9_.:-]+$' THEN RAISE EXCEPTION 'invalid retry error code'; END IF;
    v_event_type := 'provider_attempted';
    v_payload := jsonb_build_object('retryAt', v_scheduled_at, 'errorCode', v_error_code, 'sameIdempotencyKey', true);
  ELSIF v_state = 'failed' THEN
    IF p_disposition - ARRAY['state', 'errorCode', 'at']::text[] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'invalid failed disposition fields';
    END IF;
    v_error_code := p_disposition->>'errorCode';
    IF v_error_code IS NULL OR char_length(v_error_code) NOT BETWEEN 1 AND 300
       OR v_error_code !~ '^[A-Za-z0-9_.:-]+$' THEN RAISE EXCEPTION 'invalid failure error code'; END IF;
    v_event_type := 'provider_failed';
    v_payload := jsonb_build_object('errorCode', v_error_code);
  ELSE
    IF p_disposition - ARRAY['state', 'detail', 'at']::text[] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'invalid unknown disposition fields';
    END IF;
    v_error_code := p_disposition->>'detail';
    IF v_error_code IS NULL OR char_length(v_error_code) NOT BETWEEN 1 AND 300
       OR v_error_code !~ '^[A-Za-z0-9_.:-]+$' THEN RAISE EXCEPTION 'unknown disposition detail must be a sanitized code'; END IF;
    v_event_type := 'provider_unknown';
    v_payload := jsonb_build_object('detail', v_error_code, 'automaticRetry', false);
  END IF;

  UPDATE public.agency_followup_messages AS message
  SET state = v_state,
      scheduled_at = CASE WHEN v_state = 'scheduled' THEN v_scheduled_at
                          WHEN v_state IN ('blocked', 'failed', 'unknown') THEN NULL
                          ELSE message.scheduled_at END,
      provider_message_id = CASE WHEN v_state = 'accepted' THEN v_provider_message_id ELSE message.provider_message_id END,
      provider_accepted_at = CASE WHEN v_state = 'accepted' THEN v_accepted_at ELSE message.provider_accepted_at END,
      provider_recipient_email_sha256 = CASE WHEN v_state = 'accepted' THEN v_recipient_email_sha256 ELSE message.provider_recipient_email_sha256 END,
      provider_delivery_status = CASE WHEN v_state = 'accepted' THEN 'accepted' ELSE message.provider_delivery_status END,
      provider_delivery_status_at = CASE WHEN v_state = 'accepted' THEN v_accepted_at ELSE message.provider_delivery_status_at END,
      last_error_code = CASE WHEN v_state = 'blocked' THEN 'blocked_by_current_policy'
                             WHEN v_state IN ('scheduled', 'failed') THEN v_error_code
                             WHEN v_state = 'unknown' THEN v_error_code ELSE NULL END,
      unknown_since = CASE WHEN v_state = 'unknown' THEN v_at ELSE NULL END,
      lease_owner = NULL,
      lease_until = NULL,
      updated_at = v_at
  WHERE message.id = p_message_id
    AND message.enrollment_id = p_enrollment_id
    AND message.state = 'claimed'
    AND message.lease_owner = btrim(p_lease_owner)
    AND message.lease_until > clock_timestamp()
    AND message.attempt_count = p_attempt_count
  RETURNING message.enrollment_id INTO v_enrollment_id;
  IF NOT FOUND THEN RETURN false; END IF;

  v_payload := v_payload || jsonb_build_object('attemptCount', p_attempt_count, 'workerId', btrim(p_lease_owner));
  INSERT INTO public.agency_followup_events (
    enrollment_id, message_id, event_type, idempotency_key, event_payload, occurred_at
  ) VALUES (
    v_enrollment_id, p_message_id, v_event_type,
    'worker:' || p_message_id::text || ':' || p_attempt_count::text || ':' || v_event_type,
    v_payload, v_at
  );
  RETURN true;
END;
$$;

-- Safe append retries return the original row only when the complete immutable
-- event payload matches; reusing a key for different evidence is rejected.
CREATE OR REPLACE FUNCTION public.record_agency_followup_opt_in_event(
  p_agency_prospect_id uuid,
  p_source_link_id uuid,
  p_conversation_id uuid,
  p_recipient_email_sha256 text,
  p_event_type text,
  p_captured_at timestamptz,
  p_capture_source text,
  p_consent_text_version text,
  p_consent_text_sha256 text,
  p_evidence_reference text,
  p_evidence_sha256 text,
  p_actor_operator_id uuid,
  p_idempotency_key text
)
RETURNS TABLE (event_id uuid, replayed boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_inserted_id uuid;
  v_existing public.agency_followup_opt_in_events%ROWTYPE;
BEGIN
  INSERT INTO public.agency_followup_opt_in_events (
    agency_prospect_id, source_link_id, conversation_id, recipient_email_sha256,
    event_type, captured_at, capture_source, consent_text_version,
    consent_text_sha256, evidence_reference, evidence_sha256,
    actor_operator_id, idempotency_key
  ) VALUES (
    p_agency_prospect_id, p_source_link_id, p_conversation_id, p_recipient_email_sha256,
    p_event_type, p_captured_at, p_capture_source, p_consent_text_version,
    p_consent_text_sha256, p_evidence_reference, p_evidence_sha256,
    p_actor_operator_id, p_idempotency_key
  )
  ON CONFLICT ((btrim(idempotency_key))) DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NOT NULL THEN
    RETURN QUERY SELECT v_inserted_id, false;
    RETURN;
  END IF;

  SELECT * INTO v_existing
  FROM public.agency_followup_opt_in_events AS event
  WHERE event.idempotency_key = p_idempotency_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agency follow-up opt-in idempotent event could not be read';
  END IF;
  IF v_existing.agency_prospect_id IS DISTINCT FROM p_agency_prospect_id
     OR v_existing.source_link_id IS DISTINCT FROM p_source_link_id
     OR v_existing.conversation_id IS DISTINCT FROM p_conversation_id
     OR v_existing.recipient_email_sha256 IS DISTINCT FROM p_recipient_email_sha256
     OR v_existing.channel IS DISTINCT FROM 'email'
     OR v_existing.purpose IS DISTINCT FROM 'agency_followup_email'
     OR v_existing.event_type IS DISTINCT FROM p_event_type
     OR v_existing.captured_at IS DISTINCT FROM p_captured_at
     OR v_existing.capture_source IS DISTINCT FROM p_capture_source
     OR v_existing.consent_text_version IS DISTINCT FROM p_consent_text_version
     OR v_existing.consent_text_sha256 IS DISTINCT FROM p_consent_text_sha256
     OR v_existing.evidence_reference IS DISTINCT FROM p_evidence_reference
     OR v_existing.evidence_sha256 IS DISTINCT FROM p_evidence_sha256
     OR v_existing.actor_operator_id IS DISTINCT FROM p_actor_operator_id THEN
    RAISE EXCEPTION 'Agency follow-up opt-in idempotency key was reused with different event content';
  END IF;

  RETURN QUERY SELECT v_existing.id, true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_agency_followup_opt_in_event(
  uuid, uuid, uuid, text, text, timestamptz, text, text, text, text, text, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_agency_followup_opt_in_event(
  uuid, uuid, uuid, text, text, timestamptz, text, text, text, text, text, uuid, text
) TO service_role;

COMMENT ON TABLE public.agency_followup_opt_in_events IS 'Append-only operator attestations referencing exact-recipient and exact-source Agency CRM email opt-in/withdrawal evidence. Review the referenced artifact before live dispatch; empty history is ineligible.';
COMMENT ON VIEW public.agency_followup_current_opt_ins IS 'Latest append-only opt-in attestation per Agency prospect, exact source/conversation tuple, recipient hash and purpose, ordered by database recorded_at and id. Dispatch may proceed only when the latest event_type is opt_in_granted and current identity still matches.';
