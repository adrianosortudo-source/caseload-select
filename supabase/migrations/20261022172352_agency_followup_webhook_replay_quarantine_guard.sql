-- Preserve first-result quarantine for ambiguous or unmatched source/recipient events.
-- Only unmatched_message is replay-rematchable after provider acceptance commits.

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
    -- Only the provider-acceptance race is safe to rematch on an identical
    -- signed retry. Preserve all other first-result quarantines even if source
    -- mappings later become unique; those require operator reconciliation.
    IF v_existing_event.processing_result IS DISTINCT FROM 'unmatched_message' THEN
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
REVOKE ALL ON FUNCTION public.persist_agency_followup_resend_event(text, text, text, text, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_agency_followup_resend_event(text, text, text, text, timestamptz, text, text) TO service_role;