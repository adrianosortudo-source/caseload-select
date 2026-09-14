-- Private, restart-safe queue for public GTA prospect research.
-- It has no CRM, contact, conversation, form-submission, or outreach relation.

CREATE TABLE public.gta_prospect_research_work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system text NOT NULL CHECK (source_system ~ '^[-_a-z0-9]{1,120}$'),
  source_payload_sha256 text NOT NULL CHECK (source_payload_sha256 ~ '^[0-9a-f]{64}$'),
  source_record_key text NOT NULL CHECK (char_length(source_record_key) BETWEEN 1 AND 240),
  candidate_name text NOT NULL CHECK (char_length(candidate_name) BETWEEN 1 AND 500),
  canonical_domain text NULL CHECK (canonical_domain IS NULL OR char_length(canonical_domain) <= 253),
  candidate_address text NULL CHECK (candidate_address IS NULL OR char_length(candidate_address) <= 1000),
  source_urls jsonb NOT NULL CHECK (jsonb_typeof(source_urls) = 'array' AND jsonb_array_length(source_urls) BETWEEN 1 AND 12),
  candidate_snapshot jsonb NOT NULL CHECK (jsonb_typeof(candidate_snapshot) = 'object'),
  candidate_snapshot_sha256 text NOT NULL CHECK (candidate_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 10000),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'leased', 'retry', 'resolved')),
  lease_owner text NULL CHECK (lease_owner IS NULL OR lease_owner ~ '^[-_a-z0-9]{1,120}$'),
  lease_expires_at timestamptz NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NULL,
  last_error text NULL CHECK (last_error IS NULL OR char_length(last_error) <= 2000),
  resolution text NULL CHECK (resolution IS NULL OR resolution IN ('imported', 'already_present', 'duplicate_or_identity_hold', 'outside_plan41', 'not_a_firm', 'insufficient_evidence')),
  canonical_firm_id uuid NULL REFERENCES public.gta_prospect_firms(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, source_record_key),
  CHECK (
    (state IN ('pending', 'retry') AND lease_owner IS NULL AND lease_expires_at IS NULL AND resolution IS NULL)
    OR (state = 'leased' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND resolution IS NULL)
    OR (state = 'resolved' AND lease_owner IS NULL AND lease_expires_at IS NULL AND resolution IS NOT NULL)
  ),
  CHECK (
    (state <> 'resolved' AND canonical_firm_id IS NULL)
    OR (state = 'resolved' AND resolution IN ('imported', 'already_present') AND canonical_firm_id IS NOT NULL)
    OR (state = 'resolved' AND resolution NOT IN ('imported', 'already_present') AND canonical_firm_id IS NULL)
  )
);

CREATE TABLE public.gta_prospect_research_work_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.gta_prospect_research_work_items(id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  event_type text NOT NULL CHECK (event_type IN ('claimed', 'renewed', 'lease_expired', 'deferred', 'resolved')),
  worker_id text NULL CHECK (worker_id IS NULL OR worker_id ~ '^[-_a-z0-9]{1,120}$'),
  note text NULL CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX gta_prospect_research_work_items_ready_idx
  ON public.gta_prospect_research_work_items (priority DESC, next_attempt_at, created_at, id)
  WHERE state IN ('pending', 'retry');
CREATE INDEX gta_prospect_research_work_items_expired_idx
  ON public.gta_prospect_research_work_items (lease_expires_at)
  WHERE state = 'leased';
CREATE INDEX gta_prospect_research_work_attempts_sequence_idx
  ON public.gta_prospect_research_work_attempts (work_item_id, attempt_number, event_type);

ALTER TABLE public.gta_prospect_research_work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_research_work_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_research_work_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_research_work_attempts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gta_prospect_research_work_items FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.gta_prospect_research_work_attempts FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.seed_gta_prospect_research_work_items(
  p_source_system text,
  p_payload_sha256 text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  item jsonb;
  inserted_count integer := 0;
  existing_count integer := 0;
  snapshot_hash text;
BEGIN
  IF coalesce(p_source_system, '') !~ '^[-_a-z0-9]{1,120}$'
    OR coalesce(p_payload_sha256, '') !~ '^[0-9a-f]{64}$'
    OR p_items IS NULL
    OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'invalid GTA prospect research queue seed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS candidate(value)
    WHERE jsonb_typeof(candidate.value) <> 'object'
      OR NOT (candidate.value ?& ARRAY['source_record_key', 'candidate_name', 'canonical_domain', 'candidate_address', 'source_urls', 'priority', 'candidate_snapshot'])
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS candidate(value)
    GROUP BY candidate.value->>'source_record_key'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'GTA prospect research queue seed contains invalid or duplicate items';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF coalesce(item->>'source_record_key', '') = ''
      OR coalesce(item->>'candidate_name', '') = ''
      OR jsonb_typeof(item->'source_urls') <> 'array'
      OR jsonb_array_length(item->'source_urls') NOT BETWEEN 1 AND 12
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(item->'source_urls') AS source_url(value)
        WHERE jsonb_typeof(source_url.value) <> 'string'
          OR (source_url.value #>> '{}') !~ '^https?://'
      )
      OR jsonb_typeof(item->'candidate_snapshot') <> 'object'
      OR (
        nullif(item->>'canonical_domain', '') IS NOT NULL
        AND (
          item->>'canonical_domain' !~ '^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$'
          OR item->>'canonical_domain' LIKE 'www.%'
          OR item->>'canonical_domain' LIKE '%.%.'
          OR strpos(item->>'canonical_domain', '..') > 0
        )
      )
      OR coalesce(item->>'priority', '') !~ '^[0-9]+$'
      OR (item->>'priority')::numeric NOT BETWEEN 0 AND 10000 THEN
      RAISE EXCEPTION 'GTA prospect research queue seed contains invalid item values';
    END IF;

    snapshot_hash := encode(extensions.digest(convert_to((item->'candidate_snapshot')::text, 'utf8'), 'sha256'), 'hex');
    INSERT INTO public.gta_prospect_research_work_items (
      source_system, source_payload_sha256, source_record_key, candidate_name,
      canonical_domain, candidate_address, source_urls, candidate_snapshot,
      candidate_snapshot_sha256, priority
    ) VALUES (
      p_source_system, p_payload_sha256, item->>'source_record_key', item->>'candidate_name',
      nullif(item->>'canonical_domain', ''), nullif(item->>'candidate_address', ''),
      item->'source_urls', item->'candidate_snapshot', snapshot_hash, (item->>'priority')::integer
    ) ON CONFLICT (source_system, source_record_key) DO NOTHING;

    IF FOUND THEN
      inserted_count := inserted_count + 1;
    ELSE
      IF NOT EXISTS (
        SELECT 1 FROM public.gta_prospect_research_work_items AS queue
        WHERE queue.source_system = p_source_system
          AND queue.source_record_key = item->>'source_record_key'
          AND queue.source_payload_sha256 = p_payload_sha256
          AND queue.candidate_snapshot_sha256 = snapshot_hash
      ) THEN
        RAISE EXCEPTION 'immutable GTA prospect research queue conflict for source record %', item->>'source_record_key';
      END IF;
      existing_count := existing_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'state', CASE WHEN inserted_count = 0 THEN 'already_seeded' ELSE 'seeded' END,
    'item_count', jsonb_array_length(p_items),
    'inserted', inserted_count,
    'already_seeded', existing_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_gta_prospect_research_work_items(
  p_worker_id text,
  p_limit integer,
  p_lease_minutes integer DEFAULT 120
)
RETURNS TABLE (
  id uuid, source_system text, source_record_key text, candidate_name text,
  canonical_domain text, candidate_address text, source_urls jsonb, candidate_snapshot jsonb, priority integer,
  state text, lease_owner text, lease_expires_at timestamptz, attempt_count integer,
  next_attempt_at timestamptz, last_error text, resolution text, canonical_firm_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE item public.gta_prospect_research_work_items%ROWTYPE;
BEGIN
  IF coalesce(p_worker_id, '') !~ '^[-_a-z0-9]{1,120}$'
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25
    OR p_lease_minutes IS NULL OR p_lease_minutes NOT BETWEEN 15 AND 480 THEN
    RAISE EXCEPTION 'invalid GTA prospect research queue claim';
  END IF;

  FOR item IN
    SELECT queue.*
    FROM public.gta_prospect_research_work_items AS queue
    WHERE (queue.state IN ('pending', 'retry') AND (queue.next_attempt_at IS NULL OR queue.next_attempt_at <= now()))
       OR (queue.state = 'leased' AND queue.lease_expires_at <= now())
    ORDER BY queue.priority DESC, queue.created_at, queue.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  LOOP
    IF item.state = 'leased' THEN
      INSERT INTO public.gta_prospect_research_work_attempts (work_item_id, attempt_number, event_type, worker_id, note)
      VALUES (item.id, item.attempt_count, 'lease_expired', item.lease_owner, 'Lease expired before resolution.');
    END IF;
    UPDATE public.gta_prospect_research_work_items AS queue
    SET state = 'leased', lease_owner = p_worker_id, lease_expires_at = now() + make_interval(mins => p_lease_minutes),
        attempt_count = item.attempt_count + 1, next_attempt_at = NULL, last_error = NULL, updated_at = now()
    WHERE queue.id = item.id
    RETURNING queue.id, queue.source_system, queue.source_record_key, queue.candidate_name,
      queue.canonical_domain, queue.candidate_address, queue.source_urls, queue.candidate_snapshot, queue.priority,
      queue.state, queue.lease_owner, queue.lease_expires_at, queue.attempt_count,
      queue.next_attempt_at, queue.last_error, queue.resolution, queue.canonical_firm_id
    INTO id, source_system, source_record_key, candidate_name, canonical_domain,
      candidate_address, source_urls, candidate_snapshot, priority, state, lease_owner, lease_expires_at,
      attempt_count, next_attempt_at, last_error, resolution, canonical_firm_id;
    INSERT INTO public.gta_prospect_research_work_attempts (work_item_id, attempt_number, event_type, worker_id)
    VALUES (id, attempt_count, 'claimed', p_worker_id);
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_gta_prospect_research_work_item_lease(
  p_item_id uuid, p_worker_id text, p_lease_minutes integer DEFAULT 120
)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  item public.gta_prospect_research_work_items%ROWTYPE;
  renewed_until timestamptz;
BEGIN
  SELECT * INTO item FROM public.gta_prospect_research_work_items AS queue WHERE queue.id = p_item_id FOR UPDATE;
  IF NOT FOUND OR item.state <> 'leased' OR item.lease_owner IS DISTINCT FROM p_worker_id
    OR item.lease_expires_at < now() OR p_lease_minutes IS NULL OR p_lease_minutes NOT BETWEEN 15 AND 480 THEN
    RAISE EXCEPTION 'invalid owned GTA prospect research queue lease';
  END IF;
  UPDATE public.gta_prospect_research_work_items
  SET lease_expires_at = now() + make_interval(mins => p_lease_minutes), updated_at = now()
  WHERE id = p_item_id
  RETURNING lease_expires_at INTO renewed_until;
  INSERT INTO public.gta_prospect_research_work_attempts (work_item_id, attempt_number, event_type, worker_id, note)
  VALUES (p_item_id, item.attempt_count, 'renewed', p_worker_id, format('Lease renewed for %s minutes.', p_lease_minutes));
  RETURN renewed_until;
END;
$$;

CREATE OR REPLACE FUNCTION public.defer_gta_prospect_research_work_item(
  p_item_id uuid, p_worker_id text, p_error text, p_retry_at timestamptz
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE item public.gta_prospect_research_work_items%ROWTYPE;
BEGIN
  SELECT * INTO item FROM public.gta_prospect_research_work_items AS queue WHERE queue.id = p_item_id FOR UPDATE;
  IF NOT FOUND OR item.state <> 'leased' OR item.lease_owner IS DISTINCT FROM p_worker_id
    OR item.lease_expires_at < now() OR char_length(coalesce(p_error, '')) NOT BETWEEN 1 AND 2000
    OR p_retry_at IS NULL OR p_retry_at < now() THEN
    RAISE EXCEPTION 'invalid owned GTA prospect research queue lease';
  END IF;
  UPDATE public.gta_prospect_research_work_items
  SET state = 'retry', lease_owner = NULL, lease_expires_at = NULL,
      next_attempt_at = p_retry_at, last_error = p_error, updated_at = now()
  WHERE id = p_item_id;
  INSERT INTO public.gta_prospect_research_work_attempts (work_item_id, attempt_number, event_type, worker_id, note)
  VALUES (p_item_id, item.attempt_count, 'deferred', p_worker_id, p_error);
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_gta_prospect_research_work_item(
  p_item_id uuid, p_worker_id text, p_resolution text, p_note text, p_canonical_firm_id uuid DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE item public.gta_prospect_research_work_items%ROWTYPE;
BEGIN
  SELECT * INTO item FROM public.gta_prospect_research_work_items AS queue WHERE queue.id = p_item_id FOR UPDATE;
  IF NOT FOUND OR item.state <> 'leased' OR item.lease_owner IS DISTINCT FROM p_worker_id
    OR item.lease_expires_at < now()
    OR p_resolution NOT IN ('imported', 'already_present', 'duplicate_or_identity_hold', 'outside_plan41', 'not_a_firm', 'insufficient_evidence')
    OR ((p_resolution IN ('imported', 'already_present')) IS DISTINCT FROM (p_canonical_firm_id IS NOT NULL))
    OR char_length(coalesce(p_note, '')) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'invalid owned GTA prospect research queue lease';
  END IF;
  UPDATE public.gta_prospect_research_work_items
  SET state = 'resolved', lease_owner = NULL, lease_expires_at = NULL,
      resolution = p_resolution, canonical_firm_id = p_canonical_firm_id, last_error = NULL, updated_at = now()
  WHERE id = p_item_id;
  INSERT INTO public.gta_prospect_research_work_attempts (work_item_id, attempt_number, event_type, worker_id, note)
  VALUES (p_item_id, item.attempt_count, 'resolved', p_worker_id, p_note);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_gta_prospect_research_work_queue_for_operator(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 100000 THEN
    RAISE EXCEPTION 'invalid GTA prospect research queue page';
  END IF;
  RETURN (
    SELECT jsonb_build_object(
    'counts', jsonb_build_object(
      'pending', (SELECT count(*) FROM public.gta_prospect_research_work_items WHERE state = 'pending'),
      'leased', (SELECT count(*) FROM public.gta_prospect_research_work_items WHERE state = 'leased'),
      'retry', (SELECT count(*) FROM public.gta_prospect_research_work_items WHERE state = 'retry'),
      'resolved', (SELECT count(*) FROM public.gta_prospect_research_work_items WHERE state = 'resolved')
    ),
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'source_system', source_system, 'source_record_key', source_record_key,
        'candidate_name', candidate_name, 'canonical_domain', canonical_domain,
        'candidate_address', candidate_address, 'source_urls', source_urls,
        'priority', priority, 'state', state, 'lease_owner', lease_owner,
        'lease_expires_at', lease_expires_at, 'attempt_count', attempt_count,
        'next_attempt_at', next_attempt_at, 'last_error', last_error, 'resolution', resolution,
        'canonical_firm_id', canonical_firm_id
      ) ORDER BY priority DESC, created_at, id)
      FROM (
        SELECT * FROM public.gta_prospect_research_work_items
        ORDER BY priority DESC, created_at, id
        LIMIT p_limit OFFSET p_offset
      ) AS page
    ), '[]'::jsonb)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_gta_prospect_research_work_items(text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_gta_prospect_research_work_items(text, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.renew_gta_prospect_research_work_item_lease(uuid, text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.defer_gta_prospect_research_work_item(uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_gta_prospect_research_work_item(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_gta_prospect_research_work_queue_for_operator(integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.seed_gta_prospect_research_work_items(text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_gta_prospect_research_work_items(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_gta_prospect_research_work_item_lease(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.defer_gta_prospect_research_work_item(uuid, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_gta_prospect_research_work_item(uuid, text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_gta_prospect_research_work_queue_for_operator(integer, integer) TO service_role;

COMMENT ON TABLE public.gta_prospect_research_work_items IS 'Private durable queue for public GTA prospect research candidate snapshots. No CRM, contact, conversation, form-submission, or outreach relation.';
COMMENT ON TABLE public.gta_prospect_research_work_attempts IS 'Append-only history for queue claims, lease expiry, deferrals, and resolutions.';
NOTIFY pgrst, 'reload schema';
