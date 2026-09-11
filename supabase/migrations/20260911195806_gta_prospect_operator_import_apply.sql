-- Operator-reviewed GTA public-research imports.
--
-- This is a narrow, service-role-only extension of the existing append-only
-- research ledger. It does not create CRM contacts, send outreach, or expose
-- any browser-callable write capability.

ALTER TABLE public.gta_prospect_import_audit
  DROP CONSTRAINT IF EXISTS gta_prospect_import_audit_action_state_check;
ALTER TABLE public.gta_prospect_import_audit
  ADD CONSTRAINT gta_prospect_import_audit_action_state_check
  CHECK (action_state IN ('created', 'updated', 'already_present', 'rejected'));

-- Return a replay-safe receipt for the operator UI without changing the
-- historical CLI contract of begin_gta_prospect_import_batch.
CREATE OR REPLACE FUNCTION public.begin_gta_prospect_operator_import_batch(
  p_source_name text,
  p_source_sha256 text,
  p_source_record_count integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE batch public.gta_prospect_import_batches%ROWTYPE;
BEGIN
  IF p_source_name !~ '^[-_a-z0-9]{1,200}$'
     OR p_source_sha256 !~ '^[0-9a-f]{64}$'
     OR p_source_record_count < 0
  THEN
    RAISE EXCEPTION 'invalid batch arguments';
  END IF;

  INSERT INTO public.gta_prospect_import_batches(source_name, source_sha256, source_record_count)
  VALUES (p_source_name, p_source_sha256, p_source_record_count)
  ON CONFLICT (source_name, source_sha256) DO NOTHING
  RETURNING * INTO batch;
  IF FOUND THEN
    RETURN jsonb_build_object('state', 'ready', 'batch_id', batch.id);
  END IF;

  SELECT * INTO batch
  FROM public.gta_prospect_import_batches
  WHERE source_name = p_source_name AND source_sha256 = p_source_sha256
  FOR UPDATE;
  IF batch.source_record_count IS DISTINCT FROM p_source_record_count THEN
    RAISE EXCEPTION 'source name and hash already belong to a different record count';
  END IF;
  IF batch.state = 'applied' THEN
    RETURN jsonb_build_object('state', 'already_applied', 'batch_id', batch.id);
  END IF;
  IF batch.state = 'staged' THEN
    RAISE EXCEPTION 'batch is already staged';
  END IF;
  UPDATE public.gta_prospect_import_batches
  SET state = 'staged', applied_at = NULL
  WHERE id = batch.id;
  RETURN jsonb_build_object('state', 'ready', 'batch_id', batch.id);
END;
$$;

-- Correct cross-batch source-key handling. The prior function correctly
-- guarded an individual batch but labelled every reuse of a source key as
-- "created" and did not refresh the current firm projection. This version:
--   * serializes one stable source key across all batches;
--   * emits created, updated, or already_present accurately;
--   * preserves a prior website when an update omits it; and
--   * retains every changed observation as append-only evidence.
CREATE OR REPLACE FUNCTION public.apply_gta_prospect_operator_import_record(
  p_batch_id uuid,
  p_record jsonb,
  p_record_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  f uuid;
  r record;
  ev record;
  canonical jsonb;
  computed_hash text;
  prior_hash text;
  batch public.gta_prospect_import_batches%ROWTYPE;
  action text;
BEGIN
  SELECT * INTO batch
  FROM public.gta_prospect_import_batches
  WHERE id = p_batch_id
  FOR UPDATE;
  IF NOT FOUND OR batch.state <> 'staged' THEN
    RAISE EXCEPTION 'batch is not staged for record application';
  END IF;

  canonical := public.gta_prospect_research_canonical(p_record);
  computed_hash := encode(extensions.digest(convert_to(canonical::text, 'utf8'), 'sha256'), 'hex');
  IF p_record_sha256 <> computed_hash THEN
    RAISE EXCEPTION 'record hash does not match canonical record';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('gta-prospect-source-key:' || (canonical->>'sourceRecordKey'), 20260911195806)
  );

  -- A retry of the same staged batch is idempotent. Different content under a
  -- batch/key pair is an error rather than an implicit overwrite.
  SELECT audit.source_record_sha256 INTO prior_hash
  FROM public.gta_prospect_import_audit AS audit
  WHERE audit.import_batch_id = p_batch_id
    AND audit.source_record_key = canonical->>'sourceRecordKey';
  IF FOUND THEN
    IF prior_hash <> computed_hash THEN
      RAISE EXCEPTION 'record hash differs for existing batch/source key; start a new batch';
    END IF;
    SELECT audit.firm_id INTO f
    FROM public.gta_prospect_import_audit AS audit
    WHERE audit.import_batch_id = p_batch_id
      AND audit.source_record_key = canonical->>'sourceRecordKey';
    RETURN jsonb_build_object('state', 'already_applied', 'firm_id', f);
  END IF;

  SELECT * INTO r
  FROM jsonb_to_record(canonical) AS x(
    "sourceRecordKey" text, "firmName" text, "normalizedFirmName" text,
    city text, "practiceAreas" jsonb, "legacyCrosswalk" jsonb,
    "legacyClusterLawyerCount" jsonb, "websiteUrl" text, "officeCities" jsonb,
    roster jsonb, reconciliation jsonb, evidence jsonb
  );

  SELECT audit.source_record_sha256, audit.firm_id
    INTO prior_hash, f
  FROM public.gta_prospect_import_audit AS audit
  JOIN public.gta_prospect_import_batches AS prior_batch
    ON prior_batch.id = audit.import_batch_id
   AND prior_batch.state = 'applied'
  WHERE audit.source_record_key = r."sourceRecordKey"
    AND audit.validation_state = 'accepted'
  ORDER BY prior_batch.applied_at DESC, audit.created_at DESC
  LIMIT 1;

  IF f IS NULL THEN
    INSERT INTO public.gta_prospect_firms(
      source_record_key, display_name, normalized_display_name, website_url, reconciliation_status
    ) VALUES (
      r."sourceRecordKey", r."firmName", r."normalizedFirmName", r."websiteUrl", r.reconciliation->>'status'
    ) ON CONFLICT (source_record_key) DO NOTHING
    RETURNING id INTO f;
    IF f IS NULL THEN
      SELECT id INTO f
      FROM public.gta_prospect_firms
      WHERE source_record_key = r."sourceRecordKey"
      FOR UPDATE;
    END IF;
    action := 'created';
  ELSIF prior_hash = computed_hash THEN
    action := 'already_present';
  ELSE
    action := 'updated';
  END IF;

  -- A failed earlier batch can leave a source-key shell. Treat the first
  -- completed observation as created, while still retaining that original
  -- row's stable identity.
  IF action = 'created' OR action = 'updated' THEN
    UPDATE public.gta_prospect_firms
    SET display_name = r."firmName",
        normalized_display_name = r."normalizedFirmName",
        website_url = COALESCE(r."websiteUrl", website_url),
        reconciliation_status = r.reconciliation->>'status'
    WHERE id = f;
  END IF;

  IF action <> 'already_present' THEN
    INSERT INTO public.gta_prospect_aliases(
      firm_id, alias_kind, alias_value, normalized_alias_value, source_type, source_url, observed_on
    ) VALUES
      (f, 'brand_name', r."firmName", r."normalizedFirmName", 'import_source', r.roster->>'sourceUrl', (r.roster->>'observedOn')::date),
      (f, 'source_identifier', r."sourceRecordKey", r."sourceRecordKey", 'import_source', r.roster->>'sourceUrl', (r.roster->>'observedOn')::date)
    ON CONFLICT DO NOTHING;
    INSERT INTO public.gta_prospect_offices(firm_id, city, province, source_type, source_url, observed_on)
      SELECT f, value, 'ON', 'import_source', r.roster->>'sourceUrl', (r.roster->>'observedOn')::date
      FROM jsonb_array_elements_text(r."officeCities")
    ON CONFLICT DO NOTHING;
    IF r."websiteUrl" IS NOT NULL THEN
      INSERT INTO public.gta_prospect_domains(
        firm_id, domain_value, normalized_domain_value, source_type, source_url, observed_on
      ) VALUES (
        f,
        lower(split_part(regexp_replace(r."websiteUrl", '^https?://', '', 'i'), '/', 1)),
        lower(split_part(regexp_replace(r."websiteUrl", '^https?://', '', 'i'), '/', 1)),
        'import_source', r."websiteUrl", (r.roster->>'observedOn')::date
      ) ON CONFLICT DO NOTHING;
    END IF;
    FOR ev IN SELECT value FROM jsonb_array_elements(r.evidence) LOOP
      INSERT INTO public.gta_prospect_evidence_links(
        firm_id, import_batch_id, evidence_type, source_type, source_url, observed_on, raw_value
      ) VALUES (
        f, p_batch_id, ev.value->>'type', 'import_source', ev.value->>'sourceUrl',
        (ev.value->>'observedOn')::date, ev.value->>'value'
      ) ON CONFLICT DO NOTHING;
    END LOOP;
    INSERT INTO public.gta_prospect_roster_observations(
      firm_id, import_batch_id, source_type, source_url, observed_on,
      observed_lawyer_count, count_qualifier, count_display, canonical_observation
    ) VALUES (
      f, p_batch_id, 'import_source', r.roster->>'sourceUrl', (r.roster->>'observedOn')::date,
      NULLIF(r.roster->>'lawyerCount', '')::integer, r.roster->>'qualifier', r.roster->>'display',
      jsonb_build_object('roster', r.roster)
    );
    INSERT INTO public.gta_prospect_identity_adjudications(
      firm_id, import_batch_id, decision, review_method, adjudication_basis, source_type, source_url, observed_on
    ) VALUES (
      f, p_batch_id, r.reconciliation->>'status', 'manual_review', r.reconciliation->>'basis',
      'import_source', r.roster->>'sourceUrl', (r.roster->>'observedOn')::date
    );
  END IF;

  INSERT INTO public.gta_prospect_import_audit(
    import_batch_id, source_record_key, source_record_sha256, validation_state,
    action_state, firm_id, validation_errors, canonical_record
  ) VALUES (
    p_batch_id, r."sourceRecordKey", computed_hash, 'accepted', action, f, '[]', canonical
  );
  RETURN jsonb_build_object('state', action, 'firm_id', f);
END;
$$;

-- Preserve the established public-research RPC response contract for scripts
-- and its existing real-Postgres integration test. The operator-only writer
-- below consumes the detailed action receipt instead.
CREATE OR REPLACE FUNCTION public.apply_gta_prospect_research_record(
  p_batch_id uuid,
  p_record jsonb,
  p_record_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE applied jsonb;
BEGIN
  applied := public.apply_gta_prospect_operator_import_record(p_batch_id, p_record, p_record_sha256);
  IF applied->>'state' = 'already_applied' THEN
    RETURN applied;
  END IF;
  RETURN jsonb_build_object('state', 'applied', 'firm_id', applied->'firm_id');
END;
$$;

-- Keep public-contact imports on the detailed operator path so the server
-- receipt can accurately distinguish created, updated, and already-present
-- firm research records while retaining append-only contact observations.
CREATE OR REPLACE FUNCTION public.apply_gta_prospect_research_record_with_contacts(
  p_batch_id uuid,
  p_record jsonb,
  p_record_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE contacts jsonb; base_record jsonb; base_hash text; full_canonical jsonb; full_hash text; applied jsonb; firm uuid; item jsonb;
BEGIN
  IF jsonb_typeof(p_record) <> 'object' OR NOT (p_record ? 'publicContacts') THEN
    RAISE EXCEPTION 'record must include publicContacts';
  END IF;
  contacts := public.gta_prospect_research_public_contacts_canonical(p_record->'publicContacts');
  base_record := public.gta_prospect_research_canonical(p_record - 'publicContacts');
  full_canonical := base_record || jsonb_build_object('publicContacts', contacts);
  full_hash := encode(extensions.digest(convert_to(full_canonical::text, 'utf8'), 'sha256'), 'hex');
  IF p_record_sha256 <> full_hash THEN RAISE EXCEPTION 'record hash does not match canonical record'; END IF;
  base_hash := public.gta_prospect_research_record_sha256(base_record);
  applied := public.apply_gta_prospect_operator_import_record(p_batch_id, base_record, base_hash);
  firm := (applied->>'firm_id')::uuid;
  FOR item IN SELECT value FROM jsonb_array_elements(contacts) LOOP
    INSERT INTO public.gta_prospect_public_contact_observations(
      firm_id, import_batch_id, contact_name, relationship, public_email, email_kind, source_url, observed_on
    ) VALUES (
      firm, p_batch_id, item->>'name', item->>'relationship', item->>'email', item->>'emailKind', item->>'sourceUrl', (item->>'observedAt')::date
    ) ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN applied || jsonb_build_object('public_contacts', jsonb_array_length(contacts));
END;
$$;

REVOKE ALL ON FUNCTION public.begin_gta_prospect_operator_import_batch(text, text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.begin_gta_prospect_operator_import_batch(text, text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.apply_gta_prospect_operator_import_record(uuid, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_gta_prospect_operator_import_record(uuid, jsonb, text) TO service_role;

COMMENT ON FUNCTION public.begin_gta_prospect_operator_import_batch(text, text, integer) IS
  'Service-only replay-safe start for a reviewed GTA public-research import. Returns already_applied for an exact completed replay; it performs no CRM or outreach action.';
COMMENT ON FUNCTION public.apply_gta_prospect_research_record(uuid, jsonb, text) IS
  'Compatibility public-research writer. It preserves the established applied receipt while delegating to the source-key-safe operator writer.';
COMMENT ON FUNCTION public.apply_gta_prospect_operator_import_record(uuid, jsonb, text) IS
  'Service-only append-only GTA research writer for the operator import workflow. Stable source keys serialize across batches, blank website updates preserve a prior website, and audit actions distinguish created, updated, and already_present.';

NOTIFY pgrst, 'reload schema';
