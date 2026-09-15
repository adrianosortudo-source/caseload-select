-- Private staging for externally researched GTA prospect packages.
-- This table is intentionally not an import path. Only an authenticated
-- operator route may later promote a freshly revalidated draft through the
-- existing operator-import service.

CREATE TABLE public.gta_prospect_agent_import_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by text NOT NULL CHECK (submitted_by ~ '^[-_a-z0-9]{1,120}$'),
  source_name text NOT NULL CHECK (source_name ~ '^[-_a-z0-9]{1,200}$'),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[-_A-Za-z0-9]{16,200}$'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  review_sha256 text NOT NULL CHECK (review_sha256 ~ '^[a-f0-9]{64}$'),
  import_source_sha256 text NOT NULL CHECK (import_source_sha256 ~ '^[a-f0-9]{64}$'),
  record_count integer NOT NULL CHECK (record_count BETWEEN 1 AND 2000),
  records jsonb NOT NULL CHECK (jsonb_typeof(records) = 'array'),
  review_records jsonb NOT NULL CHECK (jsonb_typeof(review_records) = 'array'),
  review_summary jsonb NOT NULL CHECK (jsonb_typeof(review_summary) = 'object'),
  state text NOT NULL CHECK (state IN ('ready_for_operator', 'review_required', 'applied')),
  apply_receipts jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  UNIQUE (submitted_by, idempotency_key),
  UNIQUE (source_name, payload_sha256),
  CHECK (jsonb_array_length(records) = record_count)
);

CREATE INDEX gta_prospect_agent_import_drafts_operator_queue_idx
  ON public.gta_prospect_agent_import_drafts (state, created_at DESC, id DESC);

ALTER TABLE public.gta_prospect_agent_import_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_agent_import_drafts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gta_prospect_agent_import_drafts FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.stage_gta_prospect_agent_import_draft(
  p_submitted_by text,
  p_source_name text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_review_sha256 text,
  p_import_source_sha256 text,
  p_record_count integer,
  p_records jsonb,
  p_review_records jsonb,
  p_review_summary jsonb,
  p_state text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_existing public.gta_prospect_agent_import_drafts%ROWTYPE;
DECLARE v_new public.gta_prospect_agent_import_drafts%ROWTYPE;
BEGIN
  IF coalesce(p_submitted_by, '') !~ '^[-_a-z0-9]{1,120}$'
     OR coalesce(p_source_name, '') !~ '^[-_a-z0-9]{1,200}$'
     OR coalesce(p_idempotency_key, '') !~ '^[-_A-Za-z0-9]{16,200}$'
     OR coalesce(p_payload_sha256, '') !~ '^[a-f0-9]{64}$'
     OR coalesce(p_review_sha256, '') !~ '^[a-f0-9]{64}$'
     OR coalesce(p_import_source_sha256, '') !~ '^[a-f0-9]{64}$'
     OR p_record_count NOT BETWEEN 1 AND 2000
     OR jsonb_typeof(p_records) <> 'array' OR jsonb_array_length(p_records) <> p_record_count
     OR jsonb_typeof(p_review_records) <> 'array' OR jsonb_typeof(p_review_summary) <> 'object'
     OR p_state NOT IN ('ready_for_operator', 'review_required')
  THEN
    RAISE EXCEPTION 'invalid GTA prospect agent draft arguments';
  END IF;

  SELECT * INTO v_existing
  FROM public.gta_prospect_agent_import_drafts
  WHERE submitted_by = p_submitted_by AND idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.source_name <> p_source_name OR v_existing.payload_sha256 <> p_payload_sha256 THEN
      RAISE EXCEPTION 'idempotency key belongs to a different GTA prospect draft';
    END IF;
    RETURN jsonb_build_object('state', 'already_present', 'draft_id', v_existing.id, 'payload_sha256', v_existing.payload_sha256);
  END IF;

  SELECT * INTO v_existing
  FROM public.gta_prospect_agent_import_drafts
  WHERE source_name = p_source_name AND payload_sha256 = p_payload_sha256
  FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('state', 'already_present', 'draft_id', v_existing.id, 'payload_sha256', v_existing.payload_sha256);
  END IF;

  INSERT INTO public.gta_prospect_agent_import_drafts (
    submitted_by, source_name, idempotency_key, payload_sha256, review_sha256,
    import_source_sha256, record_count, records, review_records, review_summary, state
  ) VALUES (
    p_submitted_by, p_source_name, p_idempotency_key, p_payload_sha256, p_review_sha256,
    p_import_source_sha256, p_record_count, p_records, p_review_records, p_review_summary, p_state
  ) RETURNING * INTO v_new;
  RETURN jsonb_build_object('state', 'created', 'draft_id', v_new.id, 'payload_sha256', v_new.payload_sha256);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_gta_prospect_agent_import_drafts_for_operator(
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  draft_id uuid,
  source_name text,
  submitted_by text,
  payload_sha256 text,
  record_count integer,
  review_records jsonb,
  review_summary jsonb,
  state text,
  created_at timestamptz,
  applied_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT id, source_name, submitted_by, payload_sha256, record_count,
    review_records, review_summary, state, created_at, applied_at
  FROM public.gta_prospect_agent_import_drafts
  WHERE p_limit BETWEEN 1 AND 200
  ORDER BY created_at DESC, id DESC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.read_gta_prospect_agent_import_draft_for_operator(p_draft_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT jsonb_build_object(
    'draftId', id, 'sourceName', source_name, 'payloadSha256', payload_sha256,
    'reviewSha256', review_sha256, 'importSourceSha256', import_source_sha256,
    'recordCount', record_count, 'records', records, 'reviewRecords', review_records,
    'reviewSummary', review_summary, 'state', state, 'appliedAt', applied_at
  ) FROM public.gta_prospect_agent_import_drafts WHERE id = p_draft_id;
$$;

CREATE OR REPLACE FUNCTION public.refresh_gta_prospect_agent_import_draft_review(
  p_draft_id uuid,
  p_review_sha256 text,
  p_import_source_sha256 text,
  p_review_records jsonb,
  p_review_summary jsonb,
  p_state text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_row public.gta_prospect_agent_import_drafts%ROWTYPE;
BEGIN
  IF coalesce(p_review_sha256, '') !~ '^[a-f0-9]{64}$'
     OR coalesce(p_import_source_sha256, '') !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(p_review_records) <> 'array' OR jsonb_typeof(p_review_summary) <> 'object'
     OR p_state NOT IN ('ready_for_operator', 'review_required')
  THEN RAISE EXCEPTION 'invalid GTA prospect agent draft review'; END IF;
  UPDATE public.gta_prospect_agent_import_drafts
  SET review_sha256 = p_review_sha256, import_source_sha256 = p_import_source_sha256,
      review_records = p_review_records, review_summary = p_review_summary,
      state = p_state, updated_at = now()
  WHERE id = p_draft_id AND state <> 'applied'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'GTA prospect agent draft is missing or already applied'; END IF;
  RETURN jsonb_build_object('state', 'refreshed', 'draft_id', v_row.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_gta_prospect_agent_import_draft(
  p_draft_id uuid,
  p_apply_receipts jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_row public.gta_prospect_agent_import_drafts%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_apply_receipts) <> 'array' THEN RAISE EXCEPTION 'GTA prospect agent draft receipts must be an array'; END IF;
  UPDATE public.gta_prospect_agent_import_drafts
  SET state = 'applied', apply_receipts = p_apply_receipts, applied_at = now(), updated_at = now()
  WHERE id = p_draft_id AND state <> 'applied'
  RETURNING * INTO v_row;
  IF FOUND THEN RETURN jsonb_build_object('state', 'applied', 'draft_id', v_row.id); END IF;
  SELECT * INTO v_row FROM public.gta_prospect_agent_import_drafts WHERE id = p_draft_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'GTA prospect agent draft does not exist'; END IF;
  RETURN jsonb_build_object('state', 'already_applied', 'draft_id', v_row.id);
END;
$$;

REVOKE ALL ON FUNCTION public.stage_gta_prospect_agent_import_draft(text, text, text, text, text, text, integer, jsonb, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_gta_prospect_agent_import_drafts_for_operator(integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_gta_prospect_agent_import_draft_for_operator(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.refresh_gta_prospect_agent_import_draft_review(uuid, text, text, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_gta_prospect_agent_import_draft(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stage_gta_prospect_agent_import_draft(text, text, text, text, text, text, integer, jsonb, jsonb, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_gta_prospect_agent_import_drafts_for_operator(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_gta_prospect_agent_import_draft_for_operator(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_gta_prospect_agent_import_draft_review(uuid, text, text, jsonb, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_gta_prospect_agent_import_draft(uuid, jsonb) TO service_role;

COMMENT ON TABLE public.gta_prospect_agent_import_drafts IS
  'Private, receipt-backed staging for validated public GTA research packages. Staging never creates firms, contacts, CRM records, messages, forms, chats, or outreach.';
COMMENT ON FUNCTION public.stage_gta_prospect_agent_import_draft(text, text, text, text, text, text, integer, jsonb, jsonb, jsonb, text) IS
  'Service-only draft staging. An external AI credential reaches this only through the bounded app route and cannot apply a canonical import.';

NOTIFY pgrst, 'reload schema';
