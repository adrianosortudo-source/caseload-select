-- Operator-service persistence for reviewed, HighLevel-derived archive events.
-- This is an archive writer only: it has no network calls and cannot mutate
-- HighLevel, source identity, person identity, or contactability.

CREATE TABLE public.prospect_provider_event_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_link_id uuid NOT NULL REFERENCES public.prospect_source_links(id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL REFERENCES public.prospect_conversations(id) ON DELETE RESTRICT,
  activity_id uuid NOT NULL REFERENCES public.prospect_activities(id) ON DELETE RESTRICT,
  provider_system text NOT NULL CHECK (provider_system = 'highlevel'),
  provider_event_id text NOT NULL CHECK (char_length(btrim(provider_event_id)) BETWEEN 1 AND 500),
  event_digest text NOT NULL CHECK (event_digest ~ '^[0-9a-f]{64}$'),
  -- Retain the exact server-projected event so a reused provider ID cannot
  -- quietly become a "replay" by reusing an old digest.
  event_payload jsonb NOT NULL CHECK (jsonb_typeof(event_payload) = 'object'),
  provider_observed_at timestamptz NOT NULL,
  applied_by_operator_id uuid NOT NULL REFERENCES public.firm_lawyers(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_system, btrim(provider_event_id)),
  UNIQUE (activity_id)
);
CREATE INDEX prospect_provider_event_observations_conversation_idx
  ON public.prospect_provider_event_observations (conversation_id, provider_observed_at DESC, id DESC);
CREATE INDEX prospect_provider_event_observations_source_idx
  ON public.prospect_provider_event_observations (source_link_id, provider_observed_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.reject_prospect_provider_event_observation_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'provider event observations are append-only';
END;
$$;
CREATE TRIGGER prospect_provider_event_observations_no_mutation
  BEFORE UPDATE OR DELETE ON public.prospect_provider_event_observations
  FOR EACH ROW EXECUTE FUNCTION public.reject_prospect_provider_event_observation_mutation();

-- Preserve a meaningful response or meeting state if a subsequently observed
-- delivery event has a later provider timestamp. Older events still enter the
-- immutable history but do not change the current conversation state.
CREATE OR REPLACE FUNCTION public.apply_prospect_activity_to_conversation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_status text;
  v_last_activity_at timestamptz;
BEGIN
  SELECT status, last_activity_at INTO v_status, v_last_activity_at
  FROM public.prospect_conversations WHERE id = NEW.conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prospect conversation not found'; END IF;

  IF v_last_activity_at IS NULL OR NEW.occurred_at >= v_last_activity_at THEN
    IF NEW.kind = 'meeting' THEN
      v_status := CASE WHEN NEW.meeting_outcome IS NULL THEN 'meeting_scheduled' ELSE 'completed' END;
    ELSIF v_status NOT IN ('meeting_scheduled', 'completed', 'replied', 'declined') THEN
      IF NEW.kind = 'message_sent' THEN v_status := 'awaiting_reply';
      ELSIF NEW.kind = 'bounce' THEN v_status := 'unreachable';
      ELSIF NEW.kind = 'human_reply' THEN
        v_status := CASE WHEN NEW.reply_disposition = 'declined' THEN 'declined' ELSE 'replied' END;
      END IF;
    END IF;
  END IF;

  UPDATE public.prospect_conversations
  SET status = v_status,
      last_activity_at = greatest(coalesce(last_activity_at, NEW.occurred_at), NEW.occurred_at),
      updated_at = now()
  WHERE id = NEW.conversation_id;
  -- HighLevel archive sync is evidence-only. It must never alter the source
  -- registry or contactability decision state. Other first-party activity
  -- paths retain the pre-existing history-coverage behavior.
  IF NEW.provenance_system <> 'highlevel' THEN
    UPDATE public.prospect_source_links AS sl
    SET history_coverage = 'evidenced_activity', updated_at = now()
    FROM public.prospect_conversation_sources AS cs
    WHERE cs.conversation_id = NEW.conversation_id AND cs.source_link_id = sl.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_prospect_archive_sync_batch(
  p_bundle jsonb,
  p_operator_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_event jsonb;
  v_payload jsonb;
  v_source public.prospect_source_links%ROWTYPE;
  v_conversation public.prospect_conversations%ROWTYPE;
  v_activity public.prospect_activities%ROWTYPE;
  v_existing public.prospect_provider_event_observations%ROWTYPE;
  v_event_count integer := 0;
  v_inserted_count integer := 0;
  v_replayed_count integer := 0;
  v_location_id text;
  v_cls_record_id text;
  v_arm text;
  v_contact_id text;
  v_conversation_id uuid;
  v_kind text;
  v_channel text;
  v_direction text;
  v_occurred_at timestamptz;
  v_delivery_status text;
  v_response_kind text;
  v_reply_disposition text;
  v_provider_event_id text;
  v_event_digest text;
  v_provider_observed_at timestamptz;
  v_to_endpoints jsonb;
  v_meeting_outcome text;
  v_event_payload jsonb;
BEGIN
  IF p_bundle IS NULL OR jsonb_typeof(p_bundle) <> 'object' THEN
    RAISE EXCEPTION 'archive sync bundle must be an object';
  END IF;
  IF p_bundle->>'schema_version' <> 'prospect-archive-sync-apply.v1'
     OR p_bundle->>'provider' <> 'highlevel' THEN
    RAISE EXCEPTION 'unsupported archive sync bundle schema or provider';
  END IF;
  IF jsonb_typeof(p_bundle->'events') <> 'array'
     OR jsonb_array_length(p_bundle->'events') > 5000 THEN
    RAISE EXCEPTION 'archive sync bundle must contain at most 5000 events';
  END IF;
  v_location_id := NULLIF(btrim(p_bundle->>'highlevel_location_id'), '');
  IF v_location_id IS NULL OR char_length(v_location_id) > 200 THEN
    RAISE EXCEPTION 'archive sync bundle location is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.firm_lawyers
    WHERE id = p_operator_id AND role = 'operator' AND disabled = false
  ) THEN
    RAISE EXCEPTION 'active operator identity is required';
  END IF;

  FOR v_event IN SELECT value FROM jsonb_array_elements(p_bundle->'events') LOOP
    v_event_count := v_event_count + 1;
    IF jsonb_typeof(v_event) <> 'object' THEN RAISE EXCEPTION 'archive sync event % must be an object', v_event_count; END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(v_event) AS key
      WHERE key NOT IN (
        'cls_record_id', 'arm', 'highlevel_contact_id', 'conversation_id',
        'kind', 'channel', 'occurred_at', 'subject', 'body', 'from_endpoint',
        'to_endpoints', 'delivery_status', 'response_kind', 'reply_disposition',
        'meeting_outcome', 'external_event_id', 'idempotency_key',
        'provider_observed_at', 'event_digest'
      )
    ) THEN RAISE EXCEPTION 'archive sync event % contains unsupported fields', v_event_count; END IF;

    v_cls_record_id := NULLIF(btrim(v_event->>'cls_record_id'), '');
    v_arm := NULLIF(btrim(v_event->>'arm'), '');
    v_contact_id := NULLIF(btrim(v_event->>'highlevel_contact_id'), '');
    v_conversation_id := NULLIF(btrim(v_event->>'conversation_id'), '')::uuid;
    v_kind := NULLIF(btrim(v_event->>'kind'), '');
    v_channel := NULLIF(btrim(v_event->>'channel'), '');
    v_occurred_at := NULLIF(btrim(v_event->>'occurred_at'), '')::timestamptz;
    v_delivery_status := NULLIF(btrim(v_event->>'delivery_status'), '');
    v_response_kind := NULLIF(btrim(v_event->>'response_kind'), '');
    v_reply_disposition := NULLIF(btrim(v_event->>'reply_disposition'), '');
    v_provider_event_id := NULLIF(btrim(v_event->>'external_event_id'), '');
    v_event_digest := NULLIF(btrim(v_event->>'event_digest'), '');
    v_provider_observed_at := NULLIF(btrim(v_event->>'provider_observed_at'), '')::timestamptz;
    v_to_endpoints := coalesce(v_event->'to_endpoints', '[]'::jsonb);
    v_meeting_outcome := NULLIF(btrim(v_event->>'meeting_outcome'), '');
    v_event_payload := v_event - 'event_digest';

    IF v_arm = 'KS' THEN
      RAISE EXCEPTION 'KS records are frozen and cannot enter archive sync';
    END IF;
    IF v_cls_record_id IS NULL OR char_length(v_cls_record_id) > 300
       OR v_arm NOT IN ('BA', 'AE') OR v_contact_id IS NULL OR char_length(v_contact_id) > 500
       OR v_conversation_id IS NULL OR v_kind NOT IN ('message_sent', 'human_reply', 'automated_reply', 'bounce', 'meeting')
       OR v_channel NOT IN ('email', 'linkedin', 'phone', 'video', 'other')
       OR v_occurred_at IS NULL OR v_delivery_status NOT IN ('unknown', 'sent', 'delivered', 'bounced', 'failed')
       OR v_response_kind NOT IN ('none', 'human', 'automated')
       OR v_reply_disposition NOT IN ('unknown', 'positive', 'neutral', 'declined')
       OR v_provider_event_id IS NULL OR char_length(v_provider_event_id) > 500
       OR v_event_digest IS NULL OR v_event_digest !~ '^[0-9a-f]{64}$'
       OR v_provider_observed_at IS NULL OR jsonb_typeof(v_to_endpoints) <> 'array'
       OR NULLIF(btrim(v_event->>'idempotency_key'), '') IS DISTINCT FROM 'highlevel:' || v_provider_event_id
    THEN RAISE EXCEPTION 'archive sync event % is invalid', v_event_count; END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_to_endpoints) AS endpoint(value)
      WHERE jsonb_typeof(endpoint.value) <> 'string'
         OR char_length(btrim(endpoint.value #>> '{}')) NOT BETWEEN 1 AND 320
    ) THEN RAISE EXCEPTION 'archive sync event % has invalid endpoints', v_event_count; END IF;

    v_direction := CASE
      WHEN v_kind = 'message_sent' THEN 'outbound'
      WHEN v_kind IN ('human_reply', 'automated_reply', 'bounce') THEN 'inbound'
      WHEN v_kind = 'meeting' THEN 'internal'
      ELSE NULL
    END;
    IF (v_kind = 'message_sent' AND (v_response_kind <> 'none' OR v_delivery_status NOT IN ('unknown', 'sent', 'delivered')))
       OR (v_kind = 'human_reply' AND v_response_kind <> 'human')
       OR (v_kind = 'automated_reply' AND v_response_kind <> 'automated')
       OR (v_kind = 'bounce' AND (v_response_kind <> 'none' OR v_delivery_status NOT IN ('bounced', 'failed')))
       OR (v_kind <> 'human_reply' AND v_reply_disposition <> 'unknown')
    THEN RAISE EXCEPTION 'archive sync event % has an invalid activity classification', v_event_count; END IF;

    -- Serialize an exact provider event ID before reading it. This makes a
    -- concurrent replay deterministic without inventing a fallback ID.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('highlevel:' || v_provider_event_id, 20260910161644)
    );
    SELECT * INTO v_existing
    FROM public.prospect_provider_event_observations
    WHERE provider_system = 'highlevel' AND provider_event_id = v_provider_event_id;
    IF FOUND THEN
      IF v_existing.event_digest = v_event_digest
         AND v_existing.event_payload = v_event_payload THEN
        v_replayed_count := v_replayed_count + 1;
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'conflicting HighLevel provider event ID %', v_provider_event_id;
    END IF;

    SELECT * INTO v_source
    FROM public.prospect_source_links
    WHERE source_system = 'prospecting_control_plane'
      AND source_record_key = v_cls_record_id
      AND active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'archive sync source % is not an active BA/AE Control Plane record', v_cls_record_id; END IF;
    v_payload := coalesce(v_source.source_payload->'providedSourcePayload', v_source.source_payload);
    IF upper(coalesce(v_payload->>'arm', '')) <> v_arm
       OR v_payload #>> '{highlevel,location_id}' IS DISTINCT FROM v_location_id
       OR v_payload #>> '{highlevel,contact_id}' IS DISTINCT FROM v_contact_id
    THEN RAISE EXCEPTION 'archive sync source % does not match its immutable BA/AE HighLevel identity', v_cls_record_id; END IF;

    SELECT conversation.* INTO v_conversation
    FROM public.prospect_conversations AS conversation
    JOIN public.prospect_conversation_sources AS association ON association.conversation_id = conversation.id
    WHERE association.source_link_id = v_source.id
      AND association.is_primary = true
      AND conversation.id = v_conversation_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'archive sync source % does not match its conversation', v_cls_record_id; END IF;

    IF EXISTS (
      SELECT 1 FROM public.prospect_activities
      WHERE provenance_system = 'highlevel' AND external_event_id = v_provider_event_id
    ) THEN RAISE EXCEPTION 'HighLevel provider event % exists without an observation receipt', v_provider_event_id; END IF;

    INSERT INTO public.prospect_activities(
      conversation_id, organization_id, person_id, source_link_id, kind, channel, direction,
      occurred_at, subject, body, from_endpoint, to_endpoints, delivery_status,
      response_kind, reply_disposition, meeting_outcome, provenance_system,
      external_event_id, idempotency_key, created_by_operator_id
    ) VALUES (
      v_conversation.id, v_conversation.organization_id, v_conversation.person_id, v_source.id,
      v_kind, v_channel, v_direction, v_occurred_at,
      NULLIF(v_event->>'subject', ''), NULLIF(v_event->>'body', ''), NULLIF(v_event->>'from_endpoint', ''),
      v_to_endpoints, v_delivery_status, v_response_kind, v_reply_disposition, v_meeting_outcome,
      'highlevel', v_provider_event_id, 'highlevel:' || v_provider_event_id, p_operator_id
    ) RETURNING * INTO v_activity;

    INSERT INTO public.prospect_provider_event_observations(
      source_link_id, conversation_id, activity_id, provider_system, provider_event_id,
      event_digest, event_payload, provider_observed_at, applied_by_operator_id
    ) VALUES (
      v_source.id, v_conversation.id, v_activity.id, 'highlevel', v_provider_event_id,
      v_event_digest, v_event_payload, v_provider_observed_at, p_operator_id
    );
    v_inserted_count := v_inserted_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'schema_version', 'prospect-archive-sync-apply-receipt.v1',
    'provider', 'highlevel',
    'transaction_scope', 'single_batch',
    'events_received', v_event_count,
    'events_inserted', v_inserted_count,
    'events_replayed', v_replayed_count,
    'highlevel_writes', 0
  );
END;
$$;

ALTER TABLE public.prospect_provider_event_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_provider_event_observations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.prospect_provider_event_observations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.prospect_provider_event_observations TO service_role;
REVOKE ALL ON FUNCTION public.reject_prospect_provider_event_observation_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_prospect_archive_sync_batch(jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_prospect_archive_sync_batch(jsonb, uuid) TO service_role;

COMMENT ON TABLE public.prospect_provider_event_observations IS
  'Append-only HighLevel provider-event receipts. Every row is linked to one immutable activity and prevents duplicate or conflicting replay.';
COMMENT ON FUNCTION public.apply_prospect_archive_sync_batch(jsonb, uuid) IS
  'Service-only application of one server-validated, reviewed archive-sync batch. No HighLevel calls or mutations; one RPC transaction only.';

NOTIFY pgrst, 'reload schema';
