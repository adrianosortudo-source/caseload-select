-- Provider handoff clock refresh and privacy-preserving contact-level unsubscribe reconciliation.
-- This is additive; production remains untouched until separately authorized.
ALTER TABLE public.agency_followup_provider_events
  DROP CONSTRAINT agency_followup_provider_events_processing_result_check,
  DROP CONSTRAINT agency_followup_provider_events_check2,
  ADD CONSTRAINT agency_followup_provider_events_processing_result_check
    CHECK (processing_result IN ('matched','matched_contact','unmatched_message','unmatched_recipient','unmatched_source','ambiguous_source')),
  ADD CONSTRAINT agency_followup_provider_events_match_shape_check CHECK (
    (processing_result='matched'
      AND message_id IS NOT NULL AND enrollment_id IS NOT NULL
      AND conversation_id IS NOT NULL AND source_link_id IS NOT NULL)
    OR (processing_result='matched_contact'
      AND event_type='contact.updated' AND contact_status='unsubscribed'
      AND provider_message_id IS NULL AND recipient_sha256 IS NOT NULL
      AND message_id IS NULL AND enrollment_id IS NULL
      AND conversation_id IS NOT NULL AND source_link_id IS NOT NULL
      AND signed_agency_followup_message_id IS NULL
      AND signed_agency_followup_enrollment_id IS NULL
      AND signed_agency_followup_tags_recorded)
    OR processing_result NOT IN ('matched','matched_contact')
  ),
  ADD CONSTRAINT agency_followup_provider_events_contact_application_identity_key
    UNIQUE (provider_event_id,event_type,processing_result);

CREATE TABLE public.agency_followup_provider_contact_applications (
  provider_event_id text PRIMARY KEY,
  event_type text NOT NULL DEFAULT 'contact.updated' CHECK (event_type='contact.updated'),
  processing_result text NOT NULL DEFAULT 'matched_contact' CHECK (processing_result='matched_contact'),
  conversation_id uuid NOT NULL,
  source_link_id uuid NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (provider_event_id,event_type,processing_result)
    REFERENCES public.agency_followup_provider_events(provider_event_id,event_type,processing_result) ON DELETE RESTRICT,
  FOREIGN KEY (conversation_id,source_link_id)
    REFERENCES public.prospect_conversation_sources(conversation_id,source_link_id) ON DELETE RESTRICT
);
CREATE INDEX agency_followup_provider_contact_applications_conversation_idx
  ON public.agency_followup_provider_contact_applications (conversation_id,applied_at DESC);
CREATE TRIGGER agency_followup_provider_contact_applications_no_mutation
  BEFORE UPDATE OR DELETE ON public.agency_followup_provider_contact_applications
  FOR EACH ROW EXECUTE FUNCTION public.reject_agency_followup_provider_application_mutation();
ALTER TABLE public.agency_followup_provider_contact_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_followup_provider_contact_applications FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.agency_followup_provider_contact_applications FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.agency_followup_provider_contact_applications TO service_role;
CREATE OR REPLACE FUNCTION public.authorize_agency_followup_provider_handoff(
 p_message_id uuid,p_enrollment_id uuid,p_lease_owner text,p_attempt_count integer,p_lease_seconds integer DEFAULT 120,p_max_idempotency_age_seconds integer DEFAULT 82800)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
 m public.agency_followup_messages%ROWTYPE; e public.agency_followup_enrollments%ROWTYPE; p public.agency_prospects%ROWTYPE;
 j public.agency_followup_journeys%ROWTYPE; s public.agency_followup_steps%ROWTYPE; t public.agency_followup_template_versions%ROWTYPE;
 src public.prospect_source_links%ROWTYPE; cv public.prospect_conversations%ROWTYPE; person public.prospect_people%ROWTYPE; ca public.prospect_contactability%ROWTYPE; reviewer public.firm_lawyers%ROWTYPE;
 src_system text; nsrc integer:=0; nassoc integer:=0; cid uuid; identity_prospect_id uuid; association_invalid boolean:=false; hash_email_now text; recipient_hash text; prior_at timestamptz; first_used timestamptz; retry_at timestamptz; spacing_at timestamptz; prior_unresolved boolean:=false; prior_pending boolean:=false; now_at timestamptz; local_now timestamp without time zone; blockers text[]:=ARRAY[]::text[];
BEGIN
 IF p_message_id IS NULL OR p_enrollment_id IS NULL OR p_lease_owner IS NULL OR char_length(btrim(p_lease_owner)) NOT BETWEEN 1 AND 200 OR p_attempt_count IS NULL OR p_attempt_count<1 OR p_lease_seconds NOT BETWEEN 10 AND 900 OR p_max_idempotency_age_seconds NOT BETWEEN 3600 AND 82800 THEN RAISE EXCEPTION 'invalid Agency follow-up provider handoff request'; END IF;
 -- Nonlocking lookup only derives the broad identity lock. Re-read all facts under locks.
 PERFORM public.lock_agency_followup_mapping_catalog();
 SELECT en.prospect_id INTO identity_prospect_id FROM public.agency_followup_enrollments en JOIN public.agency_followup_messages msg ON msg.enrollment_id=en.id WHERE en.id=p_enrollment_id AND msg.id=p_message_id;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result','stale'); END IF;
 PERFORM public.lock_agency_followup_identity(identity_prospect_id);
 SELECT * INTO p FROM public.agency_prospects WHERE id=identity_prospect_id FOR SHARE;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result','blocked','blockers',pg_catalog.jsonb_build_array('contactability_unknown')); END IF;
 SELECT * INTO e FROM public.agency_followup_enrollments WHERE id=p_enrollment_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result','stale'); END IF;
 IF e.prospect_id IS DISTINCT FROM identity_prospect_id THEN RETURN pg_catalog.jsonb_build_object('result','blocked','blockers',pg_catalog.jsonb_build_array('contactability_unknown')); END IF;
 src_system:=CASE WHEN EXISTS(SELECT 1 FROM public.prospect_source_links x WHERE x.source_system='agency_crm_contact' AND x.source_record_key=identity_prospect_id::text) THEN 'agency_crm_contact' ELSE 'agency_crm' END;
 PERFORM 1 FROM public.prospect_source_links x WHERE x.source_system=src_system AND x.source_record_key=identity_prospect_id::text ORDER BY x.id FOR SHARE;
 SELECT count(*) INTO nsrc FROM public.prospect_source_links x WHERE x.source_system=src_system AND x.source_record_key=identity_prospect_id::text AND x.active AND x.person_id IS NOT NULL;
 IF nsrc=1 THEN
  SELECT * INTO src FROM public.prospect_source_links x WHERE x.source_system=src_system AND x.source_record_key=identity_prospect_id::text AND x.active AND x.person_id IS NOT NULL;
  PERFORM 1 FROM public.prospect_conversation_sources a WHERE a.source_link_id=src.id ORDER BY a.conversation_id FOR SHARE;
  SELECT count(*) INTO nassoc FROM public.prospect_conversation_sources a WHERE a.source_link_id=src.id;
  IF nassoc=1 THEN SELECT a.conversation_id INTO cid FROM public.prospect_conversation_sources a WHERE a.source_link_id=src.id; ELSE association_invalid:=true; END IF;
 ELSE association_invalid:=true;
 END IF;
 IF nsrc=1 AND nassoc=1 THEN
  SELECT * INTO src FROM public.prospect_source_links WHERE id=src.id FOR SHARE;
  SELECT * INTO person FROM public.prospect_people WHERE id=src.person_id FOR SHARE;
  PERFORM 1 FROM public.prospect_person_firm_roles r WHERE r.organization_id=src.organization_id AND r.person_id=src.person_id AND r.active ORDER BY r.id FOR SHARE;
  SELECT * INTO cv FROM public.prospect_conversations WHERE id=cid FOR SHARE;
  SELECT * INTO ca FROM public.prospect_contactability WHERE conversation_id=cid FOR NO KEY UPDATE;
 END IF;
 SELECT * INTO m FROM public.agency_followup_messages WHERE id=p_message_id AND enrollment_id=p_enrollment_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result','stale'); END IF;
 IF association_invalid THEN RETURN pg_catalog.jsonb_build_object('result','blocked','blockers',pg_catalog.jsonb_build_array('contactability_unknown')); END IF;
 SELECT * INTO p FROM public.agency_prospects WHERE id=e.prospect_id;
 SELECT * INTO j FROM public.agency_followup_journeys WHERE id=e.journey_id FOR SHARE;
 SELECT * INTO s FROM public.agency_followup_steps WHERE id=m.step_id FOR SHARE;
 SELECT * INTO t FROM public.agency_followup_template_versions WHERE id=m.template_version_id FOR SHARE;
 IF m.reviewed_by_operator_id IS NOT NULL THEN SELECT * INTO reviewer FROM public.firm_lawyers WHERE id=m.reviewed_by_operator_id FOR SHARE; END IF;
 hash_email_now:=public.agency_followup_email_sha256(p.contact_email);
 IF nsrc<>1 OR nassoc<>1 OR src.id IS NULL OR cv.id IS NULL OR src.active IS DISTINCT FROM true OR src.source_system IS DISTINCT FROM src_system OR src.source_record_key IS DISTINCT FROM e.prospect_id::text OR src.organization_id IS NULL OR src.person_id IS NULL OR person.id IS NULL OR person.primary_email IS NULL OR p.contact_email IS NULL OR public.agency_followup_email_sha256(person.primary_email) IS DISTINCT FROM hash_email_now OR cv.organization_id IS DISTINCT FROM src.organization_id OR cv.person_id IS DISTINCT FROM src.person_id OR NOT EXISTS(SELECT 1 FROM public.prospect_person_firm_roles r WHERE r.organization_id=src.organization_id AND r.person_id=src.person_id AND r.active) THEN blockers:=pg_catalog.array_append(blockers,'contactability_unknown'); END IF;
 IF ca.conversation_id IS NULL THEN blockers:=pg_catalog.array_append(blockers,'contactability_unknown'); ELSIF ca.state IS DISTINCT FROM 'eligible' THEN blockers:=pg_catalog.array_append(blockers,'contactability_blocked'); END IF;
 IF cv.id IS NOT NULL AND EXISTS(SELECT 1 FROM public.prospect_contactability_provider_suppressions x WHERE x.conversation_id=cv.id) THEN blockers:=pg_catalog.array_append(blockers,'contactability_blocked'); END IF;
 IF cv.status IN('replied','unreachable','declined','meeting_scheduled','completed') OR (cv.id IS NOT NULL AND EXISTS(SELECT 1 FROM public.prospect_activities a WHERE a.conversation_id=cv.id AND a.kind IN('human_reply','meeting','bounce'))) THEN blockers:=pg_catalog.array_append(blockers,'conversation_stopped'); END IF;
 IF p.stage IN('won','lost') THEN blockers:=pg_catalog.array_append(blockers,'prospect_status_stopped'); END IF;
 IF e.state IS DISTINCT FROM 'active' OR e.released_at IS NULL OR e.released_by_operator_id IS NULL OR nullif(btrim(e.release_basis),'') IS NULL THEN blockers:=pg_catalog.array_append(blockers,'sequence_not_released'); END IF;
 IF e.eligibility_state IS DISTINCT FROM 'eligible' THEN blockers:=pg_catalog.array_append(blockers,'eligibility_not_approved'); END IF;
 IF nullif(btrim(e.eligibility_evidence_ref),'') IS NULL THEN blockers:=pg_catalog.array_append(blockers,'eligibility_evidence_missing'); END IF;
 IF p.contact_email IS NULL OR p.contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN blockers:=pg_catalog.array_append(blockers,'recipient_email_invalid'); END IF;
 IF p.id IS NULL OR nullif(public.agency_followup_js_collapse(p.firm_name),'') IS NULL THEN blockers:=pg_catalog.array_append(blockers,'recipient_identity_missing'); END IF;
 IF src.id IS NOT NULL AND cv.id IS NOT NULL AND hash_email_now IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.agency_followup_current_opt_ins o WHERE o.agency_prospect_id=p.id AND o.source_link_id=src.id AND o.conversation_id=cv.id AND o.recipient_email_sha256=hash_email_now AND o.purpose='agency_followup_email' AND o.event_type='opt_in_granted') THEN
   IF EXISTS(SELECT 1 FROM public.agency_followup_current_opt_ins o WHERE o.agency_prospect_id=p.id AND o.source_link_id=src.id AND o.conversation_id=cv.id AND o.recipient_email_sha256=hash_email_now AND o.purpose='agency_followup_email' AND o.event_type='opt_in_withdrawn') THEN blockers:=pg_catalog.array_append(blockers,'explicit_opt_in_withdrawn'); ELSE blockers:=pg_catalog.array_append(blockers,'explicit_opt_in_missing'); END IF;
  END IF;
 ELSE blockers:=pg_catalog.array_append(blockers,'explicit_opt_in_missing'); END IF;
 recipient_hash:=public.agency_followup_recipient_sha256(p.id::text,p.firm_name,p.contact_name,p.contact_email);
 IF m.recipient_email_snapshot IS DISTINCT FROM e.recipient_email_snapshot OR public.agency_followup_email_sha256(m.recipient_email_snapshot) IS DISTINCT FROM hash_email_now OR m.recipient_name_snapshot IS DISTINCT FROM e.recipient_name_snapshot OR m.recipient_name_snapshot IS DISTINCT FROM p.contact_name OR m.recipient_sha256 IS DISTINCT FROM recipient_hash OR e.recipient_sha256 IS DISTINCT FROM recipient_hash OR m.approved_recipient_sha256 IS DISTINCT FROM recipient_hash THEN blockers:=pg_catalog.array_append(blockers,'approval_stale_recipient'); END IF;
 IF m.reviewed_by_operator_id IS NULL OR m.reviewed_at IS NULL THEN blockers:=pg_catalog.array_append(blockers,'approval_missing'); END IF;
 IF reviewer.id IS NULL OR reviewer.role IS DISTINCT FROM 'operator' OR reviewer.disabled IS DISTINCT FROM false OR m.reviewed_at IS NULL THEN blockers:=pg_catalog.array_append(blockers,'approval_invalid_reviewer_or_time'); END IF;
 IF m.approved_content_sha256 IS NULL OR m.approved_content_sha256 IS DISTINCT FROM m.content_sha256 THEN blockers:=pg_catalog.array_append(blockers,'approval_stale_content'); END IF;
 IF s.id IS NULL OR j.id IS NULL OR t.id IS NULL OR s.journey_id IS DISTINCT FROM j.id OR s.template_version_id IS DISTINCT FROM t.id OR s.step_number IS DISTINCT FROM m.step_number OR t.channel IS DISTINCT FROM 'email' OR t.state IS DISTINCT FROM 'approved' OR t.approved_by_operator_id IS NULL OR t.approved_at IS NULL OR jsonb_typeof(m.content_snapshot) IS DISTINCT FROM 'object' OR jsonb_typeof(m.content_snapshot->'channel') IS DISTINCT FROM 'string' OR jsonb_typeof(m.content_snapshot->'subject') IS DISTINCT FROM 'string' OR jsonb_typeof(m.content_snapshot->'body') IS DISTINCT FROM 'string' OR m.content_snapshot-ARRAY['channel','subject','body']::text[]<>'{}'::jsonb OR m.content_snapshot->>'channel' IS DISTINCT FROM t.channel OR m.content_snapshot->>'subject' IS DISTINCT FROM t.subject OR m.content_snapshot->>'body' IS DISTINCT FROM t.body OR m.content_sha256 IS DISTINCT FROM public.agency_followup_content_sha256(m.content_snapshot->>'channel',m.content_snapshot->>'subject',m.content_snapshot->>'body') OR t.content_sha256 IS DISTINCT FROM m.content_sha256 THEN blockers:=pg_catalog.array_append(blockers,'approval_stale_content'); END IF;
 PERFORM 1 FROM public.agency_followup_messages pm WHERE pm.enrollment_id=e.id AND pm.step_number<m.step_number ORDER BY pm.step_number,pm.id FOR SHARE;
 -- Capture the decision time only after every potentially blocking row lock.
 now_at:=clock_timestamp();
 IF m.state IS DISTINCT FROM 'claimed' OR m.lease_owner IS DISTINCT FROM btrim(p_lease_owner) OR m.attempt_count IS DISTINCT FROM p_attempt_count OR m.lease_until IS NULL OR m.lease_until<=now_at THEN RETURN pg_catalog.jsonb_build_object('result','stale'); END IF;
 IF m.reviewed_at IS NOT NULL AND m.reviewed_at>now_at THEN blockers:=pg_catalog.array_append(blockers,'approval_invalid_reviewer_or_time'); END IF;

 SELECT coalesce(bool_or(pm.id IS NULL OR (pm.state='accepted' AND pm.provider_accepted_at IS NULL) OR (pm.state='scheduled' AND pm.scheduled_at IS NULL) OR (pm.state='claimed' AND (pm.lease_until IS NULL OR pm.lease_until<=now_at)) OR pm.state NOT IN('accepted','scheduled','claimed')),false),
        coalesce(bool_or(pm.state='scheduled' OR (pm.state='claimed' AND pm.lease_until>now_at)),false),
        max(CASE WHEN pm.state='scheduled' THEN pm.scheduled_at WHEN pm.state='claimed' THEN pm.lease_until END)
 INTO prior_unresolved,prior_pending,retry_at
 FROM public.agency_followup_steps ps LEFT JOIN public.agency_followup_messages pm ON pm.enrollment_id=e.id AND pm.step_id=ps.id
 WHERE ps.journey_id=j.id AND ps.step_number<s.step_number;
 IF prior_unresolved THEN blockers:=pg_catalog.array_append(blockers,'previous_step_unresolved'); END IF;
 SELECT max(pm.provider_accepted_at) INTO prior_at FROM public.agency_followup_messages pm WHERE pm.enrollment_id=e.id AND pm.step_number<m.step_number AND pm.state='accepted' AND pm.provider_accepted_at IS NOT NULL;
 IF m.scheduled_at IS NULL THEN blockers:=pg_catalog.array_append(blockers,'invalid_schedule'); ELSIF m.scheduled_at>now_at THEN blockers:=pg_catalog.array_append(blockers,'not_due'); END IF;
 IF j.timezone IS NULL OR j.timezone='' OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name=j.timezone) OR cardinality(j.business_days) NOT BETWEEN 1 AND 7 OR j.local_window_end<=j.local_window_start THEN blockers:=pg_catalog.array_append(blockers,'invalid_schedule'); ELSE local_now:=now_at AT TIME ZONE j.timezone; IF NOT(extract(isodow FROM local_now)::integer=ANY(j.business_days)) OR local_now::time<j.local_window_start OR local_now::time>=j.local_window_end THEN blockers:=pg_catalog.array_append(blockers,'outside_send_window'); END IF; END IF;
 IF prior_at IS NOT NULL THEN IF j.minimum_spacing_hours<0 THEN blockers:=pg_catalog.array_append(blockers,'invalid_schedule'); ELSIF now_at<prior_at+pg_catalog.make_interval(hours=>j.minimum_spacing_hours) THEN blockers:=pg_catalog.array_append(blockers,'minimum_spacing_not_elapsed'); END IF; END IF;
 IF prior_pending AND blockers <@ ARRAY['not_due','minimum_spacing_not_elapsed']::text[] THEN
  spacing_at:=CASE WHEN prior_at IS NOT NULL AND j.minimum_spacing_hours>=0 THEN prior_at+pg_catalog.make_interval(hours=>j.minimum_spacing_hours) END;
  retry_at:=greatest(coalesce(retry_at,now_at+interval '1 second'),coalesce(spacing_at,now_at),coalesce(m.scheduled_at,now_at));

  RETURN pg_catalog.jsonb_build_object('result','deferred','blocker','previous_step_pending','retryAt',retry_at);
 END IF;
 IF blockers <@ ARRAY['not_due','minimum_spacing_not_elapsed']::text[] AND cardinality(blockers)>0 AND 'minimum_spacing_not_elapsed'=ANY(blockers) THEN
  retry_at:=prior_at+pg_catalog.make_interval(hours=>j.minimum_spacing_hours);

  RETURN pg_catalog.jsonb_build_object('result','deferred','blocker','minimum_spacing_not_elapsed','retryAt',retry_at);
 END IF;
 IF cardinality(blockers)=1 AND blockers[1]='not_due' THEN
  RETURN pg_catalog.jsonb_build_object('result','deferred','blocker','not_due','retryAt',m.scheduled_at);
 END IF;
 IF cardinality(blockers)>0 THEN
  SELECT pg_catalog.array_agg(DISTINCT b ORDER BY b) INTO blockers FROM pg_catalog.unnest(blockers) b;

  RETURN pg_catalog.jsonb_build_object('result','blocked','blockers',pg_catalog.to_jsonb(blockers));
 END IF;
 first_used:=coalesce(m.provider_idempotency_first_used_at,now_at);
 IF now_at>=first_used+pg_catalog.make_interval(secs=>p_max_idempotency_age_seconds) THEN
  UPDATE public.agency_followup_messages SET state='unknown',scheduled_at=NULL,lease_owner=NULL,lease_until=NULL,unknown_since=now_at,last_error_code='resend_idempotency_window_expired',updated_at=now_at WHERE id=p_message_id AND enrollment_id=p_enrollment_id AND state='claimed' AND lease_owner=btrim(p_lease_owner) AND attempt_count=p_attempt_count AND lease_until>now_at;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result','stale'); END IF;
  INSERT INTO public.agency_followup_events(enrollment_id,message_id,event_type,idempotency_key,event_payload,occurred_at) VALUES(p_enrollment_id,p_message_id,'provider_unknown','resend-window-expired:'||p_message_id::text,pg_catalog.jsonb_build_object('detail','resend_idempotency_window_expired','automaticRetry',false,'firstProviderUseAt',first_used),now_at) ON CONFLICT(idempotency_key) DO NOTHING;
  RETURN pg_catalog.jsonb_build_object('result','expired','code','resend_idempotency_window_expired');
 END IF;
 UPDATE public.agency_followup_messages SET provider_idempotency_first_used_at=coalesce(provider_idempotency_first_used_at,now_at),lease_until=greatest(lease_until,now_at+pg_catalog.make_interval(secs=>p_lease_seconds)),updated_at=now_at WHERE id=p_message_id AND enrollment_id=p_enrollment_id AND state='claimed' AND lease_owner=btrim(p_lease_owner) AND attempt_count=p_attempt_count AND lease_until>now_at RETURNING provider_idempotency_first_used_at INTO first_used;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result','stale'); END IF;
 RETURN pg_catalog.jsonb_build_object('result','ready','request',pg_catalog.jsonb_build_object('idempotencyKey',m.provider_idempotency_key,'recipientEmail',p.contact_email,'subject',m.content_snapshot->>'subject','body',m.content_snapshot->>'body'),'messageId',m.id,'enrollmentId',e.id,'attemptCount',m.attempt_count,'recipientEmailHash',hash_email_now,'preparedAt',now_at,'firstProviderUseAt',first_used);
END $$;
CREATE OR REPLACE FUNCTION public.lock_agency_followup_provider_event_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE prospect_id uuid;
BEGIN
 IF NEW.processing_result NOT IN ('matched','matched_contact') OR NEW.conversation_id IS NULL OR NEW.source_link_id IS NULL THEN RETURN NEW; END IF;
 PERFORM public.lock_agency_followup_mapping_catalog();
 SELECT prospect.id INTO prospect_id
 FROM public.prospect_source_links source_link
 JOIN public.agency_prospects prospect ON prospect.id::text=source_link.source_record_key
 WHERE source_link.id=NEW.source_link_id
   AND source_link.source_system IN ('agency_crm','agency_crm_contact');
 IF prospect_id IS NOT NULL THEN PERFORM public.lock_agency_followup_identity(prospect_id); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.lock_agency_followup_provider_event_before_insert() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lock_agency_followup_provider_event_before_insert() TO service_role;
CREATE OR REPLACE FUNCTION public.persist_agency_followup_resend_contact_event(
  p_provider_event_id text,
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
  v_prospect_count integer;
  v_candidate_count integer;
  v_prospect_id uuid;
  v_source_link_id uuid;
  v_conversation_id uuid;
  v_processing_result text;
  v_inserted_event_id text;
  v_existing_event public.agency_followup_provider_events%ROWTYPE;
  v_application_event_id text;
BEGIN
  IF p_provider_event_id IS NULL OR char_length(btrim(p_provider_event_id)) NOT BETWEEN 1 AND 500
     OR p_occurred_at IS NULL
     OR p_recipient_email IS NULL OR char_length(btrim(p_recipient_email)) NOT BETWEEN 3 AND 320
     OR p_recipient_sha256 IS NULL OR p_recipient_sha256 !~ '^[a-f0-9]{64}$'
     OR public.agency_followup_email_sha256(p_recipient_email) IS DISTINCT FROM p_recipient_sha256 THEN
    RAISE EXCEPTION 'invalid verified Agency contact unsubscribe event';
  END IF;

  -- Mapping writes and this resolution share a catalog lock. Raw email is used
  -- only to verify the supplied digest; the inbox stores the digest alone.
  PERFORM public.lock_agency_followup_mapping_catalog();

  SELECT * INTO v_existing_event
  FROM public.agency_followup_provider_events
  WHERE provider_event_id=btrim(p_provider_event_id)
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_event.event_type IS DISTINCT FROM 'contact.updated'
       OR v_existing_event.provider_message_id IS NOT NULL
       OR v_existing_event.contact_status IS DISTINCT FROM 'unsubscribed'
       OR v_existing_event.occurred_at IS DISTINCT FROM p_occurred_at
       OR v_existing_event.signed_agency_followup_message_id IS NOT NULL
       OR v_existing_event.signed_agency_followup_enrollment_id IS NOT NULL THEN
      RAISE EXCEPTION 'provider event id was replayed with different content';
    END IF;
    -- Historical contact.updated rows stored no recipient hash. Preserve them
    -- as unresolved evidence; never infer identity from the replayed address.
    IF v_existing_event.recipient_sha256 IS NULL THEN
      RETURN jsonb_build_object('result','legacy_unmatched');
    END IF;
    IF v_existing_event.recipient_sha256 IS DISTINCT FROM p_recipient_sha256 THEN
      RAISE EXCEPTION 'provider event id was replayed with different content';
    END IF;
    RETURN jsonb_build_object('result','duplicate');
  END IF;

  SELECT count(*) INTO v_prospect_count
  FROM public.agency_prospects AS prospect
  WHERE public.agency_followup_email_sha256(prospect.contact_email)=p_recipient_sha256;

  WITH candidates AS (
    SELECT DISTINCT prospect.id AS prospect_id,
           source_link.id AS source_link_id,
           association.conversation_id
    FROM public.agency_prospects AS prospect
    JOIN LATERAL (
      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM public.prospect_source_links AS preferred
          WHERE preferred.source_system='agency_crm_contact'
            AND preferred.source_record_key=prospect.id::text
            AND preferred.active
            AND preferred.person_id IS NOT NULL
        ) THEN 'agency_crm_contact'
        ELSE 'agency_crm'
      END AS source_system
    ) AS preferred_system ON true
    JOIN public.prospect_source_links AS source_link
      ON source_link.source_system=preferred_system.source_system
     AND source_link.source_record_key=prospect.id::text
     AND source_link.active
     AND source_link.person_id IS NOT NULL
    JOIN public.prospect_person_firm_roles AS person_role
      ON person_role.organization_id=source_link.organization_id
     AND person_role.person_id=source_link.person_id
     AND person_role.active
    JOIN public.prospect_conversation_sources AS association
      ON association.source_link_id=source_link.id
    JOIN public.prospect_conversations AS conversation
      ON conversation.id=association.conversation_id
     AND conversation.organization_id=source_link.organization_id
     AND conversation.person_id IS NOT DISTINCT FROM source_link.person_id
    WHERE public.agency_followup_email_sha256(prospect.contact_email)=p_recipient_sha256
  )
  SELECT count(*) INTO v_candidate_count FROM candidates;

  IF v_candidate_count=1 AND v_prospect_count=1 THEN
    WITH candidates AS (
      SELECT DISTINCT prospect.id AS prospect_id,
             source_link.id AS source_link_id,
             association.conversation_id
      FROM public.agency_prospects AS prospect
      JOIN LATERAL (
        SELECT CASE
          WHEN EXISTS (
            SELECT 1 FROM public.prospect_source_links AS preferred
            WHERE preferred.source_system='agency_crm_contact'
              AND preferred.source_record_key=prospect.id::text
              AND preferred.active
              AND preferred.person_id IS NOT NULL
          ) THEN 'agency_crm_contact'
          ELSE 'agency_crm'
        END AS source_system
      ) AS preferred_system ON true
      JOIN public.prospect_source_links AS source_link
        ON source_link.source_system=preferred_system.source_system
       AND source_link.source_record_key=prospect.id::text
       AND source_link.active
       AND source_link.person_id IS NOT NULL
      JOIN public.prospect_person_firm_roles AS person_role
        ON person_role.organization_id=source_link.organization_id
       AND person_role.person_id=source_link.person_id
       AND person_role.active
      JOIN public.prospect_conversation_sources AS association
        ON association.source_link_id=source_link.id
      JOIN public.prospect_conversations AS conversation
        ON conversation.id=association.conversation_id
       AND conversation.organization_id=source_link.organization_id
       AND conversation.person_id IS NOT DISTINCT FROM source_link.person_id
      WHERE public.agency_followup_email_sha256(prospect.contact_email)=p_recipient_sha256
    )
    SELECT candidate.prospect_id,candidate.source_link_id,candidate.conversation_id
    INTO v_prospect_id,v_source_link_id,v_conversation_id
    FROM candidates AS candidate
    LIMIT 1;

    PERFORM public.lock_agency_followup_identity(v_prospect_id);
    PERFORM 1 FROM public.prospect_contactability
    WHERE conversation_id=v_conversation_id
    FOR NO KEY UPDATE;
    IF NOT FOUND THEN
      v_processing_result := 'unmatched_source';
    ELSE
      v_processing_result := 'matched_contact';
    END IF;
  ELSIF v_candidate_count>1 OR v_prospect_count>1 THEN
    v_processing_result := 'ambiguous_source';
  ELSIF v_prospect_count=1 THEN
    v_processing_result := 'unmatched_source';
  ELSE
    v_processing_result := 'unmatched_recipient';
  END IF;

  INSERT INTO public.agency_followup_provider_events (
    provider_event_id,provider_message_id,event_type,contact_status,occurred_at,recipient_sha256,
    message_id,enrollment_id,conversation_id,source_link_id,processing_result,
    signed_agency_followup_message_id,signed_agency_followup_enrollment_id,signed_agency_followup_tags_recorded
  ) VALUES (
    btrim(p_provider_event_id),NULL,'contact.updated','unsubscribed',p_occurred_at,p_recipient_sha256,
    NULL,NULL,v_conversation_id,v_source_link_id,v_processing_result,NULL,NULL,true
  ) ON CONFLICT (provider_event_id) DO NOTHING
  RETURNING provider_event_id INTO v_inserted_event_id;

  IF v_inserted_event_id IS NULL THEN
    SELECT * INTO v_existing_event
    FROM public.agency_followup_provider_events
    WHERE provider_event_id=btrim(p_provider_event_id)
    FOR UPDATE;
    IF NOT FOUND
       OR v_existing_event.event_type IS DISTINCT FROM 'contact.updated'
       OR v_existing_event.provider_message_id IS NOT NULL
       OR v_existing_event.contact_status IS DISTINCT FROM 'unsubscribed'
       OR v_existing_event.occurred_at IS DISTINCT FROM p_occurred_at
       OR v_existing_event.recipient_sha256 IS DISTINCT FROM p_recipient_sha256
       OR v_existing_event.signed_agency_followup_message_id IS NOT NULL
       OR v_existing_event.signed_agency_followup_enrollment_id IS NOT NULL THEN
      RAISE EXCEPTION 'provider event id was replayed with different content';
    END IF;
    RETURN jsonb_build_object('result','duplicate');
  END IF;

  IF v_processing_result IS DISTINCT FROM 'matched_contact' THEN
    RETURN jsonb_build_object('result',v_processing_result);
  END IF;

  -- Contact-only application has its own typed append-only ledger; the
  -- message/enrollment application table remains unchanged.
  INSERT INTO public.agency_followup_provider_contact_applications (
    provider_event_id,conversation_id,source_link_id
  ) VALUES (
    v_inserted_event_id,v_conversation_id,v_source_link_id
  ) ON CONFLICT (provider_event_id) DO NOTHING
  RETURNING provider_event_id INTO v_application_event_id;
  IF v_application_event_id IS NULL THEN
    RETURN jsonb_build_object('result','duplicate');
  END IF;

  INSERT INTO public.prospect_contactability_provider_suppressions (
    provider_event_id,conversation_id,source_link_id,suppression_reason,occurred_at
  ) VALUES (
    v_inserted_event_id,v_conversation_id,v_source_link_id,'resend_email_unsubscribed',p_occurred_at
  );

  UPDATE public.prospect_contactability AS contactability
  SET state='suppressed',reason='resend_email_unsubscribed',
      suppressed_at=p_occurred_at,suppressed_by_operator_id=NULL,
      suppressed_by_provider_event_id=v_inserted_event_id,updated_at=clock_timestamp()
  WHERE contactability.conversation_id=v_conversation_id
    AND contactability.state<>'suppressed';

  RETURN jsonb_build_object('result','matched_contact','conversationId',v_conversation_id,'suppressed',true);
END;
$$;

REVOKE ALL ON FUNCTION public.persist_agency_followup_resend_contact_event(text,timestamptz,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persist_agency_followup_resend_contact_event(text,timestamptz,text,text)
  TO service_role;