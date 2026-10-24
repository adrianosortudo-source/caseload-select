-- Transactional Resend webhook reconciliation and shared contactability stops.
-- Push this migration before applying it. Never apply it to the linked
-- production project from a local worktree.

ALTER TABLE public.agency_followup_messages
  ADD COLUMN provider_delivery_status text NOT NULL DEFAULT 'unknown'
    CHECK (provider_delivery_status IN (
      'unknown', 'accepted', 'delivered', 'failed', 'bounced', 'complained', 'unsubscribed'
    )),
  ADD COLUMN provider_delivery_status_at timestamptz NULL,
  ADD COLUMN provider_recipient_email_sha256 text NULL
    CHECK (provider_recipient_email_sha256 IS NULL OR provider_recipient_email_sha256 ~ '^[a-f0-9]{64}$'),
  ADD COLUMN provider_delivered_at timestamptz NULL,
  ADD COLUMN provider_bounced_at timestamptz NULL,
  ADD COLUMN provider_complained_at timestamptz NULL,
  ADD COLUMN provider_unsubscribed_at timestamptz NULL;

-- Provider ids are matched with the exact recipient fingerprint. This keeps
-- prior synthetic provider fixtures intact while preventing duplicate real
-- message/recipient identities from being correlated ambiguously.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.agency_followup_messages
    WHERE provider_message_id IS NOT NULL
      AND provider_recipient_email_sha256 IS NOT NULL
    GROUP BY provider_message_id, provider_recipient_email_sha256
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate Agency follow-up provider message and recipient identities prevent safe webhook mapping';
  END IF;
END;
$$;

CREATE UNIQUE INDEX agency_followup_messages_provider_message_recipient_unique
  ON public.agency_followup_messages (provider_message_id, provider_recipient_email_sha256)
  WHERE provider_message_id IS NOT NULL AND provider_recipient_email_sha256 IS NOT NULL;

-- Stores only normalized provider metadata and hashes. In particular, no raw
-- webhook body, recipient address, subject, or message body is persisted here.
CREATE TABLE public.agency_followup_provider_events (
  provider_event_id text PRIMARY KEY
    CHECK (char_length(btrim(provider_event_id)) BETWEEN 1 AND 500),
  provider_message_id text NULL
    CHECK (provider_message_id IS NULL OR char_length(btrim(provider_message_id)) BETWEEN 1 AND 500),
  event_type text NOT NULL CHECK (event_type IN (
    'email.sent', 'email.delivered', 'email.delivery_delayed', 'email.failed',
    'email.bounced', 'email.complained', 'email.unsubscribed', 'email.opened', 'email.clicked', 'contact.updated'
  )),
  contact_status text NULL CHECK (contact_status IS NULL OR contact_status = 'unsubscribed'),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  recipient_sha256 text NULL CHECK (recipient_sha256 IS NULL OR recipient_sha256 ~ '^[a-f0-9]{64}$'),
  message_id uuid NULL REFERENCES public.agency_followup_messages(id) ON DELETE RESTRICT,
  enrollment_id uuid NULL REFERENCES public.agency_followup_enrollments(id) ON DELETE RESTRICT,
  conversation_id uuid NULL REFERENCES public.prospect_conversations(id) ON DELETE RESTRICT,
  source_link_id uuid NULL REFERENCES public.prospect_source_links(id) ON DELETE RESTRICT,
  processing_result text NOT NULL CHECK (processing_result IN (
    'matched', 'unmatched_message', 'unmatched_recipient', 'unmatched_source', 'ambiguous_source'
  )),
  CHECK ((message_id IS NULL AND enrollment_id IS NULL) OR (message_id IS NOT NULL AND enrollment_id IS NOT NULL)),
  CHECK ((conversation_id IS NULL AND source_link_id IS NULL) OR (conversation_id IS NOT NULL AND source_link_id IS NOT NULL)),
  CHECK ((processing_result = 'matched' AND message_id IS NOT NULL AND conversation_id IS NOT NULL)
      OR processing_result <> 'matched'),
  CHECK ((event_type = 'contact.updated' AND contact_status = 'unsubscribed' AND provider_message_id IS NULL)
      OR (event_type <> 'contact.updated' AND contact_status IS NULL)),
  FOREIGN KEY (conversation_id, source_link_id)
    REFERENCES public.prospect_conversation_sources(conversation_id, source_link_id) ON DELETE RESTRICT
);
CREATE INDEX agency_followup_provider_events_message_idx
  ON public.agency_followup_provider_events (message_id, occurred_at DESC)
  WHERE message_id IS NOT NULL;

-- Application rows are separate from immutable inbox evidence so an event
-- received before the sender saves provider acceptance can be reconciled later.
CREATE TABLE public.agency_followup_provider_event_applications (
  provider_event_id text PRIMARY KEY
    REFERENCES public.agency_followup_provider_events(provider_event_id) ON DELETE RESTRICT,
  message_id uuid NOT NULL REFERENCES public.agency_followup_messages(id) ON DELETE RESTRICT,
  enrollment_id uuid NOT NULL REFERENCES public.agency_followup_enrollments(id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL,
  source_link_id uuid NOT NULL,
  applied_result text NOT NULL DEFAULT 'matched' CHECK (applied_result = 'matched'),
  applied_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_id, source_link_id)
    REFERENCES public.prospect_conversation_sources(conversation_id, source_link_id) ON DELETE RESTRICT
);
COMMENT ON COLUMN public.agency_followup_provider_events.processing_result IS
  'Immutable result of first receipt; a later successful replay is recorded in agency_followup_provider_event_applications.';
COMMENT ON TABLE public.agency_followup_provider_event_applications IS
  'Exactly-once application record and authoritative resolved message/source binding for immutable provider inbox events.';
CREATE INDEX agency_followup_provider_event_applications_message_idx
  ON public.agency_followup_provider_event_applications (message_id, applied_at DESC);

CREATE OR REPLACE FUNCTION public.reject_agency_followup_provider_application_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Agency follow-up provider event applications are append-only';
END;
$$;
CREATE TRIGGER agency_followup_provider_event_applications_no_mutation
  BEFORE UPDATE OR DELETE ON public.agency_followup_provider_event_applications
  FOR EACH ROW EXECUTE FUNCTION public.reject_agency_followup_provider_application_mutation();

CREATE OR REPLACE FUNCTION public.reject_agency_followup_provider_event_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Agency follow-up provider events are append-only';
END;
$$;
CREATE TRIGGER agency_followup_provider_events_no_mutation
  BEFORE UPDATE OR DELETE ON public.agency_followup_provider_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_agency_followup_provider_event_mutation();

-- Source identity is recorded with each provider suppression. This lets the
-- shared conversation stay suppressed while preventing a match-by-email from
-- spreading the stop to a different CRM source record.
CREATE TABLE public.prospect_contactability_provider_suppressions (
  provider_event_id text PRIMARY KEY
    REFERENCES public.agency_followup_provider_events(provider_event_id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL,
  source_link_id uuid NOT NULL,
  suppression_reason text NOT NULL CHECK (suppression_reason IN (
    'resend_email_bounced', 'resend_email_complaint', 'resend_email_unsubscribed'
  )),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_id, source_link_id)
    REFERENCES public.prospect_conversation_sources(conversation_id, source_link_id) ON DELETE RESTRICT
);
CREATE INDEX prospect_contactability_provider_suppressions_conversation_idx
  ON public.prospect_contactability_provider_suppressions (conversation_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.reject_prospect_contactability_provider_suppression_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'provider contactability suppressions are append-only';
END;
$$;
CREATE TRIGGER prospect_contactability_provider_suppressions_no_mutation
  BEFORE UPDATE OR DELETE ON public.prospect_contactability_provider_suppressions
  FOR EACH ROW EXECUTE FUNCTION public.reject_prospect_contactability_provider_suppression_mutation();

-- Preserve the existing operator actor and add explicit provider provenance.
-- Exactly one actor is required for a newly active suppression; the audit
-- relation above retains every provider event even when an older suppression
-- was already active.
ALTER TABLE public.prospect_contactability
  ADD COLUMN suppressed_by_provider_event_id text NULL
    REFERENCES public.agency_followup_provider_events(provider_event_id) ON DELETE RESTRICT;
ALTER TABLE public.prospect_contactability
  DROP CONSTRAINT prospect_contactability_check,
  ADD CONSTRAINT prospect_contactability_suppression_provenance_check CHECK (
    (state = 'suppressed'
      AND reason IS NOT NULL AND suppressed_at IS NOT NULL
      AND num_nonnulls(suppressed_by_operator_id, suppressed_by_provider_event_id) = 1)
    OR state <> 'suppressed'
  );

CREATE OR REPLACE FUNCTION public.validate_prospect_contactability_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.state = 'suppressed' THEN
    -- Preserve compatibility with operator controls that predate provider
    -- provenance, including an operator re-suppressing a previously lifted row.
    IF NEW.suppressed_by_operator_id IS NOT NULL THEN
      NEW.suppressed_by_provider_event_id := NULL;
    ELSIF NEW.suppressed_by_provider_event_id IS NOT NULL THEN
      NEW.suppressed_by_operator_id := NULL;
    END IF;
    IF NEW.reason IS NULL OR NEW.suppressed_at IS NULL
       OR num_nonnulls(NEW.suppressed_by_operator_id, NEW.suppressed_by_provider_event_id) <> 1 THEN
      RAISE EXCEPTION 'suppressed contactability requires exactly one auditable actor';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.state = 'suppressed'
       AND (NEW.reason IS DISTINCT FROM OLD.reason
            OR NEW.suppressed_at IS DISTINCT FROM OLD.suppressed_at
            OR NEW.suppressed_by_operator_id IS DISTINCT FROM OLD.suppressed_by_operator_id
            OR NEW.suppressed_by_provider_event_id IS DISTINCT FROM OLD.suppressed_by_provider_event_id) THEN
      RAISE EXCEPTION 'active suppression provenance is immutable';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.state = 'suppressed'
     AND (NEW.reason IS DISTINCT FROM OLD.reason
          OR NEW.suppressed_at IS DISTINCT FROM OLD.suppressed_at
          OR NEW.suppressed_by_operator_id IS DISTINCT FROM OLD.suppressed_by_operator_id
          OR NEW.suppressed_by_provider_event_id IS DISTINCT FROM OLD.suppressed_by_provider_event_id) THEN
    RAISE EXCEPTION 'lifting suppression must preserve its provenance';
  END IF;
  RETURN NEW;
END;
$$;

-- This worker write is one transaction: it validates the current lease, changes
-- the message exactly once, and records the matching append-only audit event.
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
           'eligibility_evidence_missing', 'contactability_unknown', 'contactability_blocked',
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

-- Inserts a verified Resend event and applies its shared stop atomically. The
-- signature is verified by the HTTP adapter before this RPC is invoked. Source
-- correlation is restricted to the exact enrollment prospect UUID and the
-- single canonical Agency source link for the approved recipient.
CREATE OR REPLACE FUNCTION public.persist_agency_followup_resend_event(
  p_provider_event_id text,
  p_provider_message_id text,
  p_event_type text,
  p_contact_status text,
  p_occurred_at timestamptz,
  p_recipient_email text,
  p_recipient_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_message_id uuid;
  v_enrollment_id uuid;
  v_prospect_id uuid;
  v_message_count integer;
  v_source_count integer;
  v_source_system text;
  v_source_link_id uuid;
  v_conversation_id uuid;
  v_processing_result text;
  v_inserted_event_id text;
  v_application_event_id text;
  v_existing_event public.agency_followup_provider_events%ROWTYPE;
  v_suppression_reason text;
  v_delivery_status text;
  v_old_status text;
  v_agency_event_type text;
  v_agency_event_key text;
  v_candidate_count integer;
BEGIN
  IF p_provider_event_id IS NULL OR char_length(btrim(p_provider_event_id)) NOT BETWEEN 1 AND 500
     OR p_event_type IS NULL OR p_event_type NOT IN (
       'email.sent', 'email.delivered', 'email.delivery_delayed', 'email.failed',
       'email.bounced', 'email.complained', 'email.unsubscribed', 'email.opened', 'email.clicked', 'contact.updated'
     )
     OR p_occurred_at IS NULL
     OR (p_recipient_sha256 IS NOT NULL AND p_recipient_sha256 !~ '^[a-f0-9]{64}$') THEN
    RAISE EXCEPTION 'invalid verified provider event';
  END IF;

  IF p_event_type = 'contact.updated' THEN
    IF p_contact_status IS DISTINCT FROM 'unsubscribed'
       OR p_provider_message_id IS NOT NULL
       OR p_recipient_email IS NULL
       OR p_recipient_sha256 IS NOT NULL
       OR char_length(btrim(p_recipient_email)) NOT BETWEEN 3 AND 320 THEN
      RAISE EXCEPTION 'contact.updated is accepted only for an unsubscribed contact with an email';
    END IF;

    -- Contact updates have no email_id. Use the address transiently, never
    -- persist it, and require one accepted Agency source/conversation binding.
    WITH candidates AS (
      SELECT DISTINCT enrollment.prospect_id,
             source_link.id AS source_link_id, association.conversation_id
      FROM public.agency_followup_messages AS message
      JOIN public.agency_followup_enrollments AS enrollment ON enrollment.id = message.enrollment_id
      JOIN public.agency_prospects AS prospect ON prospect.id = enrollment.prospect_id
      JOIN public.prospect_source_links AS source_link
        ON source_link.source_record_key = enrollment.prospect_id::text
       AND source_link.source_system = CASE
         WHEN EXISTS (
           SELECT 1 FROM public.prospect_source_links AS contact_source
           WHERE contact_source.source_system = 'agency_crm_contact'
             AND contact_source.source_record_key = enrollment.prospect_id::text
         ) THEN 'agency_crm_contact'
         ELSE 'agency_crm'
       END
      JOIN public.prospect_conversation_sources AS association ON association.source_link_id = source_link.id
      JOIN public.prospect_conversations AS conversation
        ON conversation.id = association.conversation_id
       AND conversation.organization_id = source_link.organization_id
       AND conversation.person_id IS NOT DISTINCT FROM source_link.person_id
      WHERE message.state = 'accepted'
        AND message.provider_accepted_at IS NOT NULL
        AND lower(btrim(message.recipient_email_snapshot)) = lower(btrim(p_recipient_email))
        AND lower(btrim(prospect.contact_email)) = lower(btrim(p_recipient_email))
    )
    SELECT count(*) INTO v_candidate_count FROM candidates;

    IF v_candidate_count = 1 THEN
      WITH candidates AS (
        SELECT message.id AS message_id, enrollment.id AS enrollment_id,
               enrollment.prospect_id, source_link.id AS source_link_id,
               association.conversation_id, message.provider_accepted_at
        FROM public.agency_followup_messages AS message
        JOIN public.agency_followup_enrollments AS enrollment ON enrollment.id = message.enrollment_id
        JOIN public.agency_prospects AS prospect ON prospect.id = enrollment.prospect_id
        JOIN public.prospect_source_links AS source_link
          ON source_link.source_record_key = enrollment.prospect_id::text
         AND source_link.source_system = CASE
           WHEN EXISTS (
             SELECT 1 FROM public.prospect_source_links AS contact_source
             WHERE contact_source.source_system = 'agency_crm_contact'
               AND contact_source.source_record_key = enrollment.prospect_id::text
           ) THEN 'agency_crm_contact'
           ELSE 'agency_crm'
         END
        JOIN public.prospect_conversation_sources AS association ON association.source_link_id = source_link.id
        JOIN public.prospect_conversations AS conversation
          ON conversation.id = association.conversation_id
         AND conversation.organization_id = source_link.organization_id
         AND conversation.person_id IS NOT DISTINCT FROM source_link.person_id
        WHERE message.state = 'accepted'
          AND message.provider_accepted_at IS NOT NULL
          AND lower(btrim(message.recipient_email_snapshot)) = lower(btrim(p_recipient_email))
          AND lower(btrim(prospect.contact_email)) = lower(btrim(p_recipient_email))
      )
      SELECT candidate.message_id, candidate.enrollment_id, candidate.prospect_id,
             candidate.source_link_id, candidate.conversation_id
      INTO v_message_id, v_enrollment_id, v_prospect_id, v_source_link_id, v_conversation_id
      FROM candidates AS candidate
      ORDER BY candidate.provider_accepted_at DESC, candidate.message_id
      LIMIT 1;
      v_processing_result := 'matched';
    ELSIF v_candidate_count > 1 THEN
      v_processing_result := 'ambiguous_source';
    ELSE
      v_processing_result := 'unmatched_recipient';
    END IF;
  ELSE
    IF p_contact_status IS NOT NULL OR p_provider_message_id IS NULL
       OR char_length(btrim(p_provider_message_id)) NOT BETWEEN 1 AND 500
       OR p_recipient_email IS NULL
       OR p_recipient_sha256 IS NULL
       OR char_length(btrim(p_recipient_email)) NOT BETWEEN 3 AND 320 THEN
      RAISE EXCEPTION 'message provider event requires a provider message id and no contact status';
    END IF;
    SELECT count(*) INTO v_message_count
    FROM public.agency_followup_messages AS message
    WHERE message.provider_message_id = btrim(p_provider_message_id)
      AND message.provider_recipient_email_sha256 = p_recipient_sha256
      AND message.state = 'accepted'
      AND message.provider_accepted_at IS NOT NULL;

    IF v_message_count = 1 THEN
      SELECT message.id, message.enrollment_id, enrollment.prospect_id
      INTO v_message_id, v_enrollment_id, v_prospect_id
      FROM public.agency_followup_messages AS message
      JOIN public.agency_followup_enrollments AS enrollment ON enrollment.id = message.enrollment_id
      JOIN public.agency_prospects AS prospect ON prospect.id = enrollment.prospect_id
      WHERE message.provider_message_id = btrim(p_provider_message_id)
        AND message.provider_recipient_email_sha256 = p_recipient_sha256
        AND lower(btrim(message.recipient_email_snapshot)) = lower(btrim(p_recipient_email))
        AND lower(btrim(message.recipient_email_snapshot)) = lower(btrim(prospect.contact_email));
      IF NOT FOUND THEN
        v_message_id := NULL;
        v_enrollment_id := NULL;
        v_prospect_id := NULL;
        v_processing_result := 'unmatched_recipient';
      END IF;
    ELSE
      v_message_id := NULL;
      v_enrollment_id := NULL;
      v_prospect_id := NULL;
      v_processing_result := 'unmatched_message';
    END IF;
  END IF;

  IF v_message_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.prospect_source_links AS source_link
      WHERE source_link.source_system = 'agency_crm_contact'
        AND source_link.source_record_key = v_prospect_id::text
    ) THEN
      v_source_system := 'agency_crm_contact';
    ELSE
      v_source_system := 'agency_crm';
    END IF;

    SELECT count(*) INTO v_source_count
    FROM public.prospect_source_links AS source_link
    JOIN public.prospect_conversation_sources AS association
      ON association.source_link_id = source_link.id
    JOIN public.prospect_conversations AS conversation
      ON conversation.id = association.conversation_id
     AND conversation.organization_id = source_link.organization_id
     AND conversation.person_id IS NOT DISTINCT FROM source_link.person_id
    WHERE source_link.source_system = v_source_system
      AND source_link.source_record_key = v_prospect_id::text;

    IF v_source_count = 1 THEN
      SELECT source_link.id, association.conversation_id
      INTO v_source_link_id, v_conversation_id
      FROM public.prospect_source_links AS source_link
      JOIN public.prospect_conversation_sources AS association
        ON association.source_link_id = source_link.id
      JOIN public.prospect_conversations AS conversation
        ON conversation.id = association.conversation_id
       AND conversation.organization_id = source_link.organization_id
       AND conversation.person_id IS NOT DISTINCT FROM source_link.person_id
      WHERE source_link.source_system = v_source_system
        AND source_link.source_record_key = v_prospect_id::text;
      v_processing_result := 'matched';
    ELSE
      v_processing_result := CASE WHEN v_source_count = 0 THEN 'unmatched_source' ELSE 'ambiguous_source' END;
      v_source_link_id := NULL;
      v_conversation_id := NULL;
    END IF;
  END IF;

  INSERT INTO public.agency_followup_provider_events (
    provider_event_id, provider_message_id, event_type, contact_status, occurred_at, recipient_sha256,
    message_id, enrollment_id, conversation_id, source_link_id, processing_result
  ) VALUES (
    btrim(p_provider_event_id), NULLIF(btrim(p_provider_message_id), ''), p_event_type,
    p_contact_status, p_occurred_at,
    p_recipient_sha256, v_message_id, v_enrollment_id, v_conversation_id, v_source_link_id,
    coalesce(v_processing_result, 'unmatched_message')
  ) ON CONFLICT (provider_event_id) DO NOTHING
  RETURNING provider_event_id INTO v_inserted_event_id;
  IF v_inserted_event_id IS NULL THEN
    -- An unmatched message event may be delivered before the dispatch worker
    -- commits the provider acceptance. Keep its first inbox row immutable, but
    -- allow an identical signed retry to rematch once acceptance is present.
    SELECT * INTO v_existing_event
    FROM public.agency_followup_provider_events AS provider_event
    WHERE provider_event.provider_event_id = btrim(p_provider_event_id)
    FOR UPDATE;
    IF NOT FOUND
       OR v_existing_event.provider_message_id IS DISTINCT FROM NULLIF(btrim(p_provider_message_id), '')
       OR v_existing_event.event_type IS DISTINCT FROM p_event_type
       OR v_existing_event.contact_status IS DISTINCT FROM p_contact_status
       OR v_existing_event.occurred_at IS DISTINCT FROM p_occurred_at
       OR v_existing_event.recipient_sha256 IS DISTINCT FROM p_recipient_sha256 THEN
      RAISE EXCEPTION 'provider event id was replayed with different content';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.agency_followup_provider_event_applications AS application
      WHERE application.provider_event_id = btrim(p_provider_event_id)
    ) THEN
      RETURN jsonb_build_object('result', 'duplicate');
    END IF;
    v_inserted_event_id := btrim(p_provider_event_id);
  END IF;
  IF v_processing_result IS DISTINCT FROM 'matched' THEN
    RETURN jsonb_build_object('result', coalesce(v_processing_result, 'unmatched_message'));
  END IF;

  -- Claim application separately from immutable inbox evidence. This makes
  -- suppression and delivery side effects exactly-once across webhook retries.
  INSERT INTO public.agency_followup_provider_event_applications (
    provider_event_id, message_id, enrollment_id, conversation_id, source_link_id
  ) VALUES (
    v_inserted_event_id, v_message_id, v_enrollment_id, v_conversation_id, v_source_link_id
  ) ON CONFLICT (provider_event_id) DO NOTHING
  RETURNING provider_event_id INTO v_application_event_id;
  IF v_application_event_id IS NULL THEN
    RETURN jsonb_build_object('result', 'duplicate');
  END IF;

  IF p_event_type IN ('email.bounced', 'email.complained', 'email.unsubscribed', 'contact.updated') THEN
    v_suppression_reason := CASE p_event_type
      WHEN 'email.bounced' THEN 'resend_email_bounced'
      WHEN 'email.complained' THEN 'resend_email_complaint'
      ELSE 'resend_email_unsubscribed'
    END;

    INSERT INTO public.prospect_contactability_provider_suppressions (
      provider_event_id, conversation_id, source_link_id, suppression_reason, occurred_at
    ) VALUES (
      v_inserted_event_id, v_conversation_id, v_source_link_id, v_suppression_reason, p_occurred_at
    );

    UPDATE public.prospect_contactability AS contactability
    SET state = 'suppressed', reason = v_suppression_reason,
        suppressed_at = p_occurred_at,
        suppressed_by_operator_id = NULL,
        suppressed_by_provider_event_id = v_inserted_event_id,
        updated_at = now()
    WHERE contactability.conversation_id = v_conversation_id
      AND contactability.state <> 'suppressed';

    IF p_event_type = 'email.bounced' THEN
      INSERT INTO public.prospect_activities (
        conversation_id, organization_id, person_id, source_link_id,
        kind, channel, direction, occurred_at, delivery_status, response_kind,
        reply_disposition, provenance_system, external_event_id, idempotency_key
      )
      SELECT v_conversation_id, conversation.organization_id, conversation.person_id, v_source_link_id,
             'bounce', 'email', 'inbound', p_occurred_at, 'bounced', 'none',
             'unknown', 'resend', v_inserted_event_id, 'resend-event:' || v_inserted_event_id
      FROM public.prospect_conversations AS conversation
      WHERE conversation.id = v_conversation_id;
    END IF;

    v_agency_event_type := CASE p_event_type
      WHEN 'email.bounced' THEN 'bounce_observed'
      WHEN 'email.complained' THEN 'complaint_observed'
      ELSE 'unsubscribe_observed'
    END;
  ELSIF p_event_type = 'email.sent' THEN
    v_agency_event_type := 'provider_accepted';
  ELSIF p_event_type = 'email.failed' THEN
    v_agency_event_type := 'provider_failed';
  ELSIF p_event_type = 'email.delivered' THEN
    v_agency_event_type := 'provider_delivered';
  ELSE
    v_agency_event_type := NULL;
  END IF;

  IF v_agency_event_type IS NOT NULL THEN
    v_agency_event_key := 'resend-event:' || v_inserted_event_id;
    INSERT INTO public.agency_followup_events (
      enrollment_id, message_id, event_type, idempotency_key, event_payload, occurred_at
    ) VALUES (
      v_enrollment_id, v_message_id, v_agency_event_type, v_agency_event_key,
      jsonb_build_object('providerEventId', v_inserted_event_id, 'providerEventType', p_event_type,
                         'providerMessageId', btrim(p_provider_message_id)),
      p_occurred_at
    );
  END IF;

  v_delivery_status := CASE p_event_type
    WHEN 'email.sent' THEN 'accepted'
    WHEN 'email.delivered' THEN 'delivered'
    WHEN 'email.failed' THEN 'failed'
    WHEN 'email.bounced' THEN 'bounced'
    WHEN 'email.complained' THEN 'complained'
    WHEN 'email.unsubscribed' THEN 'unsubscribed'
    WHEN 'contact.updated' THEN 'unsubscribed'
    ELSE NULL
  END;
  IF v_delivery_status IS NOT NULL THEN
    SELECT message.provider_delivery_status INTO v_old_status
    FROM public.agency_followup_messages AS message
    WHERE message.id = v_message_id
    FOR UPDATE;

    IF (CASE v_delivery_status
          WHEN 'unknown' THEN 0 WHEN 'accepted' THEN 1 WHEN 'failed' THEN 2
          WHEN 'delivered' THEN 3 WHEN 'bounced' THEN 4 WHEN 'complained' THEN 5
          WHEN 'unsubscribed' THEN 6 ELSE 0 END)
       > (CASE v_old_status
          WHEN 'unknown' THEN 0 WHEN 'accepted' THEN 1 WHEN 'failed' THEN 2
          WHEN 'delivered' THEN 3 WHEN 'bounced' THEN 4 WHEN 'complained' THEN 5
          WHEN 'unsubscribed' THEN 6 ELSE 0 END)
       OR ((CASE v_delivery_status
             WHEN 'unknown' THEN 0 WHEN 'accepted' THEN 1 WHEN 'failed' THEN 2
             WHEN 'delivered' THEN 3 WHEN 'bounced' THEN 4 WHEN 'complained' THEN 5
             WHEN 'unsubscribed' THEN 6 ELSE 0 END)
           = (CASE v_old_status
             WHEN 'unknown' THEN 0 WHEN 'accepted' THEN 1 WHEN 'failed' THEN 2
             WHEN 'delivered' THEN 3 WHEN 'bounced' THEN 4 WHEN 'complained' THEN 5
             WHEN 'unsubscribed' THEN 6 ELSE 0 END)
           AND p_occurred_at >= coalesce((
             SELECT message.provider_delivery_status_at
             FROM public.agency_followup_messages AS message WHERE message.id = v_message_id
           ), '-infinity'::timestamptz)) THEN
      UPDATE public.agency_followup_messages AS message
      SET provider_delivery_status = v_delivery_status,
          provider_delivery_status_at = p_occurred_at,
          provider_delivered_at = CASE WHEN v_delivery_status = 'delivered' THEN p_occurred_at ELSE message.provider_delivered_at END,
          provider_bounced_at = CASE WHEN v_delivery_status = 'bounced' THEN p_occurred_at ELSE message.provider_bounced_at END,
          provider_complained_at = CASE WHEN v_delivery_status = 'complained' THEN p_occurred_at ELSE message.provider_complained_at END,
          provider_unsubscribed_at = CASE WHEN v_delivery_status = 'unsubscribed' THEN p_occurred_at ELSE message.provider_unsubscribed_at END,
          updated_at = now()
      WHERE message.id = v_message_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('result', 'matched', 'messageId', v_message_id,
                            'conversationId', v_conversation_id,
                            'suppressed', p_event_type IN ('email.bounced', 'email.complained', 'email.unsubscribed', 'contact.updated'));
END;
$$;

-- Extend the existing event vocabulary only for a distinct delivery receipt.
ALTER TABLE public.agency_followup_events
  DROP CONSTRAINT agency_followup_events_event_type_check,
  ADD CONSTRAINT agency_followup_events_event_type_check CHECK (event_type IN (
    'journey_created', 'journey_activated', 'journey_retired', 'template_created', 'template_approved',
    'enrolled', 'eligibility_changed', 'released', 'paused', 'resumed', 'stopped', 'cancelled',
    'message_changed', 'message_approved', 'message_scheduled', 'message_blocked', 'message_claimed',
    'provider_attempted', 'provider_accepted', 'provider_delivered', 'provider_failed', 'provider_unknown',
    'reply_observed', 'booking_observed', 'unsubscribe_observed', 'bounce_observed',
    'complaint_observed', 'suppression_resolved'
  ));

ALTER TABLE public.agency_followup_provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_followup_provider_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agency_followup_provider_event_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_followup_provider_event_applications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_contactability_provider_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_contactability_provider_suppressions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.agency_followup_provider_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.agency_followup_provider_event_applications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.prospect_contactability_provider_suppressions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.agency_followup_provider_events TO service_role;
GRANT SELECT, INSERT ON public.agency_followup_provider_event_applications TO service_role;
GRANT SELECT, INSERT ON public.prospect_contactability_provider_suppressions TO service_role;
GRANT EXECUTE ON FUNCTION public.persist_agency_followup_disposition(uuid, uuid, text, integer, jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION public.persist_agency_followup_disposition(uuid, uuid, text, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_agency_followup_resend_event(text, text, text, text, timestamptz, text, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.persist_agency_followup_resend_event(text, text, text, text, timestamptz, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_agency_followup_provider_event_mutation(),
  public.reject_agency_followup_provider_application_mutation(),
  public.reject_prospect_contactability_provider_suppression_mutation()
  FROM PUBLIC, anon, authenticated;
