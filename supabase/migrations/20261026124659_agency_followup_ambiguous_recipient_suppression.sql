-- Resend contact unsubscribes and Agency-tagged message unsubscribes apply to
-- the mailbox even when identity is ambiguous, acceptance is in flight, or a
-- signed event recipient mismatches its tagged message. Store recipients as hashes.
CREATE INDEX agency_followup_provider_recipient_unsubscribe_hash_idx
  ON public.agency_followup_provider_events (recipient_sha256)
  WHERE recipient_sha256 IS NOT NULL
    AND (
      (event_type='contact.updated' AND contact_status='unsubscribed')
      OR (
        event_type='email.unsubscribed'
        AND (
          processing_result='matched'
          OR (
            processing_result IN ('unmatched_message','unmatched_source','ambiguous_source')
            AND (
              (message_id IS NOT NULL AND enrollment_id IS NOT NULL)
              OR (
                signed_agency_followup_tags_recorded IS TRUE
                AND signed_agency_followup_message_id IS NOT NULL
                AND signed_agency_followup_enrollment_id IS NOT NULL
              )
            )
          )
          OR (
            processing_result='unmatched_recipient'
            AND signed_agency_followup_tags_recorded IS TRUE
            AND signed_agency_followup_message_id IS NOT NULL
            AND signed_agency_followup_enrollment_id IS NOT NULL
          )
        )
      )
    );

DO $agency_followup_ambiguous_unsubscribe_gate$
DECLARE
  v_function_definition text;
  v_anchor text := $anchor$IF cv.id IS NOT NULL AND EXISTS(SELECT 1 FROM public.prospect_contactability_provider_suppressions x WHERE x.conversation_id=cv.id) THEN blockers:=pg_catalog.array_append(blockers,'contactability_blocked'); END IF;$anchor$;
  v_marker text := 'recipient_unsubscribe_event.recipient_sha256=hash_email_now';
  v_insertion text := $insertion$IF hash_email_now IS NOT NULL AND EXISTS(
  SELECT 1
  FROM public.agency_followup_provider_events AS recipient_unsubscribe_event
  WHERE recipient_unsubscribe_event.recipient_sha256=hash_email_now
    AND (
      (recipient_unsubscribe_event.event_type='contact.updated'
       AND recipient_unsubscribe_event.contact_status='unsubscribed')
      OR (
        recipient_unsubscribe_event.event_type='email.unsubscribed'
        AND (
          recipient_unsubscribe_event.processing_result='matched'
          OR (
            recipient_unsubscribe_event.processing_result IN ('unmatched_message','unmatched_source','ambiguous_source')
            AND (
              (recipient_unsubscribe_event.message_id IS NOT NULL AND recipient_unsubscribe_event.enrollment_id IS NOT NULL)
              OR (
                recipient_unsubscribe_event.signed_agency_followup_tags_recorded IS TRUE
                AND recipient_unsubscribe_event.signed_agency_followup_message_id IS NOT NULL
                AND recipient_unsubscribe_event.signed_agency_followup_enrollment_id IS NOT NULL
              )
            )
          )
          OR (
            recipient_unsubscribe_event.processing_result='unmatched_recipient'
            AND recipient_unsubscribe_event.signed_agency_followup_tags_recorded IS TRUE
            AND recipient_unsubscribe_event.signed_agency_followup_message_id IS NOT NULL
            AND recipient_unsubscribe_event.signed_agency_followup_enrollment_id IS NOT NULL
          )
        )
      )
    )
) THEN blockers:=pg_catalog.array_append(blockers,'contactability_blocked'); END IF;$insertion$;
  v_anchor_count integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.authorize_agency_followup_provider_handoff(uuid,uuid,text,integer,integer,integer)'::regprocedure
  ) INTO v_function_definition;

  IF v_function_definition IS NULL THEN
    RAISE EXCEPTION 'Agency follow-up provider handoff function is missing';
  END IF;
  IF pg_catalog.strpos(v_function_definition, v_marker) > 0 THEN
    RAISE EXCEPTION 'Agency follow-up unsubscribe gate patch is already present';
  END IF;

  v_anchor_count := (
    pg_catalog.length(v_function_definition) -
    pg_catalog.length(pg_catalog.replace(v_function_definition, v_anchor, ''))
  ) / pg_catalog.length(v_anchor);
  IF v_anchor_count <> 1 THEN
    RAISE EXCEPTION 'Expected one Agency follow-up conversation suppression check, found %', v_anchor_count;
  END IF;

  EXECUTE pg_catalog.replace(
    v_function_definition,
    v_anchor,
    v_anchor || E'\n  ' || v_insertion
  );
END;
$agency_followup_ambiguous_unsubscribe_gate$;
