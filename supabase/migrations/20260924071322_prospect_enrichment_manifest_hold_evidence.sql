-- Keep package-less candidate evidence durable and require complete run linkage.
-- This file is intentionally additive: the earlier migration may already exist
-- on shared branches and must remain immutable.
BEGIN;

CREATE TABLE public.prospect_enrichment_manifest_hold_evidence (
  run_id uuid NOT NULL,
  entry_id text NOT NULL,
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object' AND octet_length(evidence::text) <= 9000000),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, entry_id),
  FOREIGN KEY (run_id, entry_id)
    REFERENCES public.prospect_enrichment_run_manifest_items(run_id, entry_id) ON DELETE RESTRICT
);

ALTER TABLE public.prospect_enrichment_manifest_hold_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_enrichment_manifest_hold_evidence FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.prospect_enrichment_manifest_hold_evidence FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.prospect_enrichment_manifest_hold_evidence TO service_role;

CREATE OR REPLACE FUNCTION public.reject_prospect_enrichment_hold_evidence_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'prospect enrichment held evidence is append-only';
END;
$$;

CREATE TRIGGER prospect_enrichment_manifest_hold_evidence_append_only
  BEFORE UPDATE OR DELETE ON public.prospect_enrichment_manifest_hold_evidence
  FOR EACH ROW EXECUTE FUNCTION public.reject_prospect_enrichment_hold_evidence_mutation_v1();

CREATE OR REPLACE FUNCTION public.record_prospect_enrichment_manifest_hold_evidence_v1(
  p_submitted_by text,
  p_run_key text,
  p_entry_id text,
  p_evidence jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  run_row public.prospect_enrichment_runs%ROWTYPE;
  entry_row public.prospect_enrichment_run_manifest_items%ROWTYPE;
  prior_row public.prospect_enrichment_manifest_hold_evidence%ROWTYPE;
  p_run_id uuid;
  evidence_hash text;
  original_json jsonb;
  outcome text;
  inserted_count integer;
BEGIN
  IF p_submitted_by IS NULL OR char_length(btrim(p_submitted_by)) NOT BETWEEN 1 AND 200 OR
     p_run_key IS NULL OR char_length(btrim(p_run_key)) NOT BETWEEN 1 AND 200 OR p_entry_id IS NULL OR char_length(btrim(p_entry_id)) NOT BETWEEN 1 AND 200 OR
     jsonb_typeof(p_evidence) <> 'object' OR octet_length(p_evidence::text) > 9000000 OR
     (SELECT count(*) FROM jsonb_object_keys(p_evidence)) <> 8 OR NOT (p_evidence ?& ARRAY[
       'schemaVersion','runId','entryId','researchKey','source','originalJson','issues','evidenceSha256'
     ]) OR p_evidence->>'schemaVersion' <> 'prospect-enrichment-held-candidate-evidence/v1' OR
     p_evidence->>'entryId' IS DISTINCT FROM p_entry_id OR
     jsonb_typeof(p_evidence->'researchKey') <> 'string' OR
     jsonb_typeof(p_evidence->'source') <> 'object' OR jsonb_typeof(p_evidence->'originalJson') <> 'string' OR
     (SELECT count(*) FROM jsonb_object_keys(p_evidence->'source')) <> 4 OR NOT (p_evidence->'source' ?& ARRAY[
       'sourceRoot','relativePath','sourcePointer','fileSha256'
     ]) OR jsonb_typeof(p_evidence->'issues') <> 'array' OR jsonb_array_length(p_evidence->'issues') > 500 OR
     p_evidence->>'evidenceSha256' !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid held candidate evidence';
  END IF;
  BEGIN
    original_json := (p_evidence->>'originalJson')::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'invalid held candidate original JSON';
  END;
  evidence_hash := encode(extensions.digest(convert_to(public.prospect_enrichment_stable_json_v1(p_evidence - 'evidenceSha256' - 'runId'), 'utf8'), 'sha256'), 'hex');
  IF evidence_hash IS DISTINCT FROM p_evidence->>'evidenceSha256' THEN RAISE EXCEPTION 'held evidence hash mismatch'; END IF;

  SELECT * INTO run_row FROM public.prospect_enrichment_runs WHERE submitted_by = p_submitted_by AND run_key = p_run_key FOR UPDATE;
  IF NOT FOUND OR run_row.submitted_by IS DISTINCT FROM p_submitted_by OR run_row.manifest_state <> 'open' OR
     run_row.manifest_sha256 IS NULL OR p_evidence->>'runId' IS DISTINCT FROM run_row.run_key THEN
    RAISE EXCEPTION 'held evidence run is missing, finalized or mismatched';
  END IF;
  p_run_id := run_row.id;
  SELECT * INTO entry_row FROM public.prospect_enrichment_run_manifest_items
    WHERE run_id = p_run_id AND entry_id = p_entry_id FOR UPDATE;
  IF NOT FOUND OR entry_row.client_package_id IS NOT NULL OR entry_row.research_key IS DISTINCT FROM p_evidence->>'researchKey' OR
     NOT (entry_row.error_codes @> jsonb_build_array('__held_evidence_sha256:' || evidence_hash)) OR
     entry_row.source_root IS DISTINCT FROM p_evidence #>> '{source,sourceRoot}' OR
     entry_row.relative_path IS DISTINCT FROM p_evidence #>> '{source,relativePath}' OR
     entry_row.source_pointer IS DISTINCT FROM p_evidence #>> '{source,sourcePointer}' OR
     entry_row.file_sha256 IS DISTINCT FROM p_evidence #>> '{source,fileSha256}' THEN
    RAISE EXCEPTION 'held evidence does not match its exact manifest entry';
  END IF;

  INSERT INTO public.prospect_enrichment_manifest_hold_evidence(run_id,entry_id,evidence_sha256,evidence)
  VALUES (p_run_id,p_entry_id,evidence_hash,p_evidence) ON CONFLICT (run_id,entry_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  SELECT * INTO prior_row FROM public.prospect_enrichment_manifest_hold_evidence
    WHERE run_id = p_run_id AND entry_id = p_entry_id;
  outcome := CASE WHEN prior_row.evidence_sha256 = evidence_hash AND prior_row.evidence = p_evidence
    THEN CASE WHEN inserted_count = 1 THEN 'held_evidence_recorded' ELSE 'held_evidence_replayed' END
    ELSE 'held_evidence_conflict' END;
  RETURN jsonb_build_object('outcome',outcome,'runId',run_row.run_key,'entryId',p_entry_id,'evidenceSha256',prior_row.evidence_sha256);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_prospect_enrichment_manifest_hold_evidence_v1(
  p_run_id uuid,
  p_entry_ids text[]
)
RETURNS TABLE (entry_id text, evidence_sha256 text, evidence jsonb)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT held.entry_id,held.evidence_sha256,held.evidence
  FROM public.prospect_enrichment_manifest_hold_evidence held
  WHERE held.run_id = p_run_id AND held.entry_id = ANY(p_entry_ids)
  ORDER BY held.entry_id;
$$;

CREATE OR REPLACE FUNCTION public.summarize_prospect_enrichment_manifest_hold_evidence_v1(p_run_id uuid)
RETURNS TABLE (expected_evidence_count bigint, recorded_evidence_count bigint, mismatched_evidence_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH candidates AS (
    SELECT item.entry_id,
      count(code.value) FILTER (WHERE left(code.value,23) = '__held_evidence_sha256:') AS marker_count,
      max(substring(code.value FROM 24)) FILTER (WHERE code.value ~ '^__held_evidence_sha256:[a-f0-9]{64}$') AS marker_hash
    FROM public.prospect_enrichment_run_manifest_items item
    LEFT JOIN LATERAL jsonb_array_elements_text(item.error_codes) AS code(value) ON true
    WHERE item.run_id = p_run_id AND item.client_package_id IS NULL AND item.research_key IS NOT NULL
    GROUP BY item.entry_id
  ), checked AS (
    SELECT candidate.marker_count,candidate.marker_hash,held.evidence_sha256,held.evidence->>'evidenceSha256' AS document_hash
    FROM candidates candidate
    LEFT JOIN public.prospect_enrichment_manifest_hold_evidence held
      ON held.run_id = p_run_id AND held.entry_id = candidate.entry_id
  )
  SELECT count(*)::bigint,
    count(*) FILTER (WHERE checked.evidence_sha256 IS NOT NULL)::bigint,
    count(*) FILTER (WHERE checked.marker_count <> 1 OR checked.marker_hash IS NULL OR
      checked.evidence_sha256 IS DISTINCT FROM checked.marker_hash OR checked.document_hash IS DISTINCT FROM checked.marker_hash)::bigint
  FROM checked;
$$;

CREATE OR REPLACE FUNCTION public.guard_prospect_enrichment_manifest_hold_evidence_complete_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.manifest_state = 'finalized' AND OLD.manifest_state <> 'finalized' AND EXISTS (
    SELECT 1 FROM public.prospect_enrichment_run_manifest_items item
    LEFT JOIN public.prospect_enrichment_manifest_hold_evidence held
      ON held.run_id = item.run_id AND held.entry_id = item.entry_id
    WHERE item.run_id = NEW.id AND item.client_package_id IS NULL AND item.research_key IS NOT NULL
      AND ((SELECT count(*) FROM jsonb_array_elements_text(item.error_codes) AS code(value)
            WHERE left(code.value,23) = '__held_evidence_sha256:') <> 1
        OR NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(item.error_codes) AS code(value)
          WHERE left(code.value,23) = '__held_evidence_sha256:'
            AND code.value ~ '^__held_evidence_sha256:[a-f0-9]{64}$'
            AND substring(code.value FROM 24) = held.evidence_sha256
        ) OR held.evidence->>'evidenceSha256' IS DISTINCT FROM held.evidence_sha256)
  ) THEN
    RAISE EXCEPTION 'manifest cannot finalize before every package-less candidate has durable held evidence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prospect_enrichment_runs_required_hold_evidence
  BEFORE UPDATE OF manifest_state ON public.prospect_enrichment_runs
  FOR EACH ROW EXECUTE FUNCTION public.guard_prospect_enrichment_manifest_hold_evidence_complete_v1();

REVOKE ALL ON FUNCTION public.reject_prospect_enrichment_hold_evidence_mutation_v1() FROM PUBLIC, anon, authenticated, service_role;
  REVOKE ALL ON FUNCTION public.record_prospect_enrichment_manifest_hold_evidence_v1(text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_prospect_enrichment_manifest_hold_evidence_v1(uuid,text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.summarize_prospect_enrichment_manifest_hold_evidence_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_prospect_enrichment_manifest_hold_evidence_complete_v1() FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.record_prospect_enrichment_manifest_hold_evidence_v1(text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_prospect_enrichment_manifest_hold_evidence_v1(uuid,text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.summarize_prospect_enrichment_manifest_hold_evidence_v1(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.stage_prospect_enrichment_package_v1(
  p_submitted_by text,
  p_run_key text,
  p_source_system text,
  p_source_name text,
  p_client_package_id text,
  p_idempotency_key text,
  p_raw_body text,
  p_raw_body_sha256 text,
  p_payload jsonb,
  p_payload_sha256 text,
  p_research_key text,
  p_identity_state text,
  p_items jsonb,
  p_sources jsonb,
  p_supersedes_package_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  run_row public.prospect_enrichment_runs%ROWTYPE;
  package_row public.prospect_enrichment_packages%ROWTYPE;
  existing_row public.prospect_enrichment_packages%ROWTYPE;
  manifest_row public.prospect_enrichment_run_manifest_items%ROWTYPE;
  firm_row public.gta_prospect_firms%ROWTYPE;
  source_input jsonb;
  item_input jsonb;
  item_data jsonb;
  lineage_item jsonb;
  expected_source_ids jsonb;
  source_content jsonb;
  retraction_source_content jsonb;
  semantic_content jsonb;
  expected_semantic_sha256 text;
  expected_event_key text;
  actual_sources jsonb := '[]'::jsonb;
  actual_items jsonb := '[]'::jsonb;
  actual_lineage jsonb := '[]'::jsonb;
  payload_items jsonb := '[]'::jsonb;
  event_row record;
  lock_key text;
  existing_source_event public.prospect_enrichment_source_events%ROWTYPE;
  source_event_id uuid;
  source_id text;
  predecessor_id uuid;
  payload_firm_id uuid;
  computed_raw_sha256 text;
  computed_payload_sha256 text;
  computed_idempotency_key text;
  state_value text;
  observation_count integer;
  assessment_count integer;
  source_count integer;
  item_count integer;
  received_at timestamptz;
BEGIN
  IF p_submitted_by IS NULL OR char_length(btrim(p_submitted_by)) NOT BETWEEN 1 AND 200 OR
     p_run_key IS NULL OR char_length(btrim(p_run_key)) NOT BETWEEN 1 AND 200 OR
     p_source_system IS NULL OR char_length(btrim(p_source_system)) NOT BETWEEN 1 AND 200 OR
     p_source_name IS NULL OR char_length(btrim(p_source_name)) NOT BETWEEN 1 AND 200 OR
     p_client_package_id IS NULL OR p_client_package_id !~ '^[a-z0-9][a-z0-9._-]{0,119}$' OR
     p_raw_body IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR
     jsonb_typeof(p_items) <> 'array' OR jsonb_typeof(p_sources) <> 'array' OR
     p_research_key IS NULL OR char_length(p_research_key) NOT BETWEEN 1 AND 2000 OR
     p_identity_state NOT IN ('resolved','unresolved','conflict') OR
     p_raw_body_sha256 !~ '^[a-f0-9]{64}$' OR p_payload_sha256 !~ '^[a-f0-9]{64}$' OR
     p_idempotency_key !~ '^pe-v1-[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid prospect enrichment stage request';
  END IF;

  IF p_payload->>'schemaVersion' IS DISTINCT FROM 'prospect-enrichment/v1' OR
     p_payload->>'runId' IS DISTINCT FROM p_run_key OR
     p_payload->>'packageId' IS DISTINCT FROM p_client_package_id OR
     p_payload->>'sourceSystem' IS DISTINCT FROM p_source_system OR
     p_payload->>'sourceName' IS DISTINCT FROM p_source_name OR
     p_payload #>> '{subject,researchKey}' IS DISTINCT FROM p_research_key OR
     p_payload #>> '{subject,identityState}' IS DISTINCT FROM p_identity_state OR
     nullif(p_payload->>'supersedesPackageId','null') IS DISTINCT FROM p_supersedes_package_id OR
     jsonb_typeof(p_payload->'sources') <> 'array' OR
     jsonb_typeof(p_payload->'observations') <> 'array' OR
     jsonb_typeof(p_payload->'controls') <> 'object' OR
     p_payload #>> '{controls,contactFormsSubmitted}' IS DISTINCT FROM 'false' OR
     p_payload #>> '{controls,chatSessionsStarted}' IS DISTINCT FROM 'false' OR
     p_payload #>> '{controls,outreachSent}' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'stage request does not match immutable package payload';
  END IF;

  computed_raw_sha256 := encode(extensions.digest(convert_to(p_raw_body,'utf8'),'sha256'),'hex');
  computed_payload_sha256 := encode(extensions.digest(
    convert_to(public.prospect_enrichment_stable_json_v1(p_payload),'utf8'),'sha256'),'hex');
  computed_idempotency_key := 'pe-v1-' || encode(extensions.digest(
    convert_to(p_source_system || E'\n' || p_run_key || E'\n' || p_client_package_id,'utf8'),'sha256'),'hex');
  IF computed_raw_sha256 <> p_raw_body_sha256 OR computed_payload_sha256 <> p_payload_sha256 OR
     computed_idempotency_key <> p_idempotency_key THEN
    RAISE EXCEPTION 'stage request hash or idempotency key mismatch';
  END IF;

  source_count := jsonb_array_length(p_sources);
  observation_count := (SELECT count(*) FROM jsonb_array_elements(p_items) AS items(item) WHERE item->>'itemKind' = 'observation');
  assessment_count := (SELECT count(*) FROM jsonb_array_elements(p_items) AS items(item) WHERE item->>'itemKind' = 'assessment');
  item_count := source_count + jsonb_array_length(p_items);
  IF source_count > 500 OR observation_count > 500 OR assessment_count > 1 OR item_count > 1001 OR
     jsonb_array_length(p_items) <> observation_count + assessment_count THEN
    RAISE EXCEPTION 'stage item counts exceed prospect enrichment limits';
  END IF;

  SELECT coalesce(jsonb_agg(source_json->'data' ORDER BY ordinality),'[]'::jsonb)
    INTO actual_sources
  FROM jsonb_array_elements(p_sources) WITH ORDINALITY AS source_rows(source_json,ordinality);
  IF actual_sources IS DISTINCT FROM p_payload->'sources' THEN
    RAISE EXCEPTION 'staged sources must exactly match the package payload';
  END IF;
  SELECT coalesce(jsonb_agg(item->'data' ORDER BY ordinality),'[]'::jsonb)
    INTO actual_items
  FROM jsonb_array_elements(p_items) WITH ORDINALITY AS item_rows(item,ordinality);
  payload_items := p_payload->'observations' || CASE WHEN p_payload->'assessment' = 'null'::jsonb
    THEN '[]'::jsonb ELSE jsonb_build_array(p_payload->'assessment') END;
  IF actual_items IS DISTINCT FROM payload_items THEN
    RAISE EXCEPTION 'staged observations and assessment must exactly match the package payload';
  END IF;

  FOR source_input IN SELECT value FROM jsonb_array_elements(p_sources) AS rows(value) LOOP
    IF jsonb_typeof(source_input) <> 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(source_input)) <> 8 OR
       NOT (source_input ?& ARRAY['sourceId','clientItemId','sourceEventKey','semanticSha256','data','observedAt','observedOn','provenanceState']) OR
       jsonb_typeof(source_input->'data') <> 'object' OR
       source_input->>'sourceId' IS DISTINCT FROM source_input #>> '{data,sourceId}' OR
       source_input->>'clientItemId' IS DISTINCT FROM 'src:' || (source_input->>'sourceId') OR
       source_input->>'provenanceState' NOT IN ('complete','partial','legacy_unknown') OR
       source_input->'observedAt' IS DISTINCT FROM source_input #> '{data,observedAt}' OR
       source_input->'observedOn' IS DISTINCT FROM source_input #> '{data,observedOn}' THEN
      RAISE EXCEPTION 'invalid staged source item';
    END IF;
    expected_event_key := 'source:' || encode(extensions.digest(convert_to(
      public.prospect_enrichment_stable_json_v1(jsonb_build_array(p_research_key,source_input->>'clientItemId')),'utf8'),'sha256'),'hex');
    semantic_content := (source_input->'data') - 'sourceId'::text;
    expected_semantic_sha256 := encode(extensions.digest(convert_to(public.prospect_enrichment_stable_json_v1(
      jsonb_build_object('itemKind','source','researchKey',p_research_key,'semanticContent',semantic_content,'sourceSystem',p_source_system)
    ),'utf8'),'sha256'),'hex');
    IF source_input->>'sourceEventKey' IS DISTINCT FROM expected_event_key OR
       source_input->>'semanticSha256' IS DISTINCT FROM expected_semantic_sha256 OR
       char_length(coalesce(source_input->>'sourceId','')) NOT BETWEEN 1 AND 120 OR
       source_input->>'sourceId' !~ '^[a-z0-9][a-z0-9._-]{0,119}$' OR
       source_input->>'semanticSha256' !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'staged source lineage hash or identity mismatch';
    END IF;
    actual_lineage := actual_lineage || jsonb_build_array(jsonb_build_object(
      'clientItemId',source_input->>'clientItemId','itemKind','source',
      'sourceEventKey',source_input->>'sourceEventKey','semanticSha256',source_input->>'semanticSha256'
    ));
  END LOOP;

  FOR item_input IN SELECT value FROM jsonb_array_elements(p_items) AS rows(value) LOOP
    item_data := item_input->'data';
    IF jsonb_typeof(item_input) <> 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(item_input)) <> 9 OR
       NOT (item_input ?& ARRAY['clientItemId','itemKind','sourceEventKey','semanticSha256','data','sourceIds','observedAt','observedOn','provenanceState']) OR
       jsonb_typeof(item_data) <> 'object' OR jsonb_typeof(item_input->'sourceIds') <> 'array' OR
       item_input->'sourceIds' IS DISTINCT FROM item_data->'sourceIds' OR
       item_input->>'provenanceState' NOT IN ('complete','partial','legacy_unknown') OR
       item_input->>'itemKind' NOT IN ('observation','assessment') THEN
      RAISE EXCEPTION 'invalid staged observation or assessment item';
    END IF;
    IF item_input->>'itemKind' = 'observation' THEN
      IF item_input->>'clientItemId' IS DISTINCT FROM 'obs:' || (item_data->>'observationId') OR
         item_input->'observedAt' IS DISTINCT FROM item_data->'observedAt' OR
         item_input->'observedOn' IS DISTINCT FROM item_data->'observedOn' OR
         jsonb_typeof(item_data->'retractionSourceIds') <> 'array' THEN
        RAISE EXCEPTION 'observation lineage does not match its immutable item data';
      END IF;
      SELECT coalesce(jsonb_agg((source.value->'data') - 'sourceId'::text ORDER BY referenced.ordinality),'[]'::jsonb)
        INTO source_content
      FROM jsonb_array_elements_text(item_data->'sourceIds') WITH ORDINALITY AS referenced(source_id,ordinality)
      JOIN jsonb_array_elements(p_sources) AS source(value) ON source.value->>'sourceId' = referenced.source_id;
      SELECT coalesce(jsonb_agg((source.value->'data') - 'sourceId'::text ORDER BY referenced.ordinality),'[]'::jsonb)
        INTO retraction_source_content
      FROM jsonb_array_elements_text(item_data->'retractionSourceIds') WITH ORDINALITY AS referenced(source_id,ordinality)
      JOIN jsonb_array_elements(p_sources) AS source(value) ON source.value->>'sourceId' = referenced.source_id;
      IF jsonb_array_length(source_content) <> jsonb_array_length(item_data->'sourceIds') OR
         jsonb_array_length(retraction_source_content) <> jsonb_array_length(item_data->'retractionSourceIds') THEN
        RAISE EXCEPTION 'observation lineage references a missing source';
      END IF;
      semantic_content := (item_data - 'observationId'::text - 'existingRecord'::text) || jsonb_build_object(
        'sourceContent',source_content,'retractionSourceContent',retraction_source_content
      );
    ELSE
      IF item_input->>'clientItemId' IS DISTINCT FROM 'assessment:' || (item_data->>'assessmentId') OR
         item_input->'observedAt' IS DISTINCT FROM item_data->'assessedAt' OR
         item_input->'observedOn' IS DISTINCT FROM item_data->'assessedOn' THEN
        RAISE EXCEPTION 'assessment lineage does not match its immutable item data';
      END IF;
      SELECT coalesce(jsonb_agg((source.value->'data') - 'sourceId'::text ORDER BY referenced.ordinality),'[]'::jsonb)
        INTO source_content
      FROM jsonb_array_elements_text(item_data->'sourceIds') WITH ORDINALITY AS referenced(source_id,ordinality)
      JOIN jsonb_array_elements(p_sources) AS source(value) ON source.value->>'sourceId' = referenced.source_id;
      IF jsonb_array_length(source_content) <> jsonb_array_length(item_data->'sourceIds') THEN
        RAISE EXCEPTION 'assessment lineage references a missing source';
      END IF;
      semantic_content := (item_data - 'assessmentId'::text - 'existingRecord'::text) || jsonb_build_object('sourceContent',source_content);
    END IF;
    expected_event_key := item_input->>'itemKind' || ':' || encode(extensions.digest(convert_to(
      public.prospect_enrichment_stable_json_v1(jsonb_build_array(p_research_key,item_input->>'clientItemId')),'utf8'),'sha256'),'hex');
    expected_semantic_sha256 := encode(extensions.digest(convert_to(public.prospect_enrichment_stable_json_v1(
      jsonb_build_object('itemKind',item_input->>'itemKind','researchKey',p_research_key,'semanticContent',semantic_content,'sourceSystem',p_source_system)
    ),'utf8'),'sha256'),'hex');
    IF item_input->>'sourceEventKey' IS DISTINCT FROM expected_event_key OR
       item_input->>'semanticSha256' IS DISTINCT FROM expected_semantic_sha256 OR
       item_input->>'semanticSha256' !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'staged item lineage hash mismatch';
    END IF;
    actual_lineage := actual_lineage || jsonb_build_array(jsonb_build_object(
      'clientItemId',item_input->>'clientItemId','itemKind',item_input->>'itemKind',
      'sourceEventKey',item_input->>'sourceEventKey','semanticSha256',item_input->>'semanticSha256'
    ));
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(actual_lineage) AS lineages(item)
    GROUP BY item->>'clientItemId' HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(actual_lineage) AS lineages(item)
    GROUP BY item->>'sourceEventKey' HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'stage package contains duplicate immutable item identities'; END IF;

  IF p_identity_state = 'resolved' THEN
    IF nullif(p_payload #>> '{subject,databaseFirmId}','') IS NULL OR
       p_payload #>> '{subject,databaseFirmId}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'resolved package identity requires a valid database firm id';
    END IF;
    payload_firm_id := (p_payload #>> '{subject,databaseFirmId}')::uuid;
    SELECT * INTO firm_row FROM public.gta_prospect_firms WHERE id = payload_firm_id FOR KEY SHARE;
    IF NOT FOUND OR firm_row.source_record_key IS DISTINCT FROM p_payload #>> '{subject,sourceRecordKey}' THEN
      RAISE EXCEPTION 'resolved package identity does not match the current prospect firm';
    END IF;
    IF p_payload #>> '{subject,stableFirmId}' IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.gta_prospect_stable_identity_registry registry
      WHERE registry.firm_id = payload_firm_id AND registry.stable_firm_id = p_payload #>> '{subject,stableFirmId}'
        AND registry.canonical_domain = p_payload #>> '{subject,canonicalDomain}'
    ) THEN RAISE EXCEPTION 'resolved stable identity does not match the authoritative registry'; END IF;
  ELSE
    payload_firm_id := NULL;
  END IF;

  IF p_supersedes_package_id IS NOT NULL THEN
    IF p_supersedes_package_id = p_client_package_id THEN RAISE EXCEPTION 'package cannot supersede itself'; END IF;
    SELECT predecessor.id INTO predecessor_id
    FROM public.prospect_enrichment_packages predecessor
    WHERE predecessor.submitted_by = p_submitted_by AND predecessor.client_package_id = p_supersedes_package_id
      AND predecessor.payload->>'sourceSystem' = p_source_system
      AND predecessor.research_key = p_research_key
    FOR KEY SHARE;
    IF predecessor_id IS NULL THEN RAISE EXCEPTION 'superseded package must exist for this actor, source, and research identity'; END IF;
  END IF;

  FOR lock_key IN
    SELECT lock_value FROM (VALUES
      ('package-id:' || p_submitted_by || ':' || p_client_package_id),
      ('idempotency:' || p_submitted_by || ':' || p_idempotency_key)
    ) locks(lock_value) ORDER BY lock_value
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('prospect-enrichment:' || lock_key, 620260923));
  END LOOP;

  INSERT INTO public.prospect_enrichment_runs(submitted_by,run_key,source_system,source_name)
  VALUES (p_submitted_by,p_run_key,p_source_system,p_source_name)
  ON CONFLICT (submitted_by,run_key) DO NOTHING;
  SELECT * INTO run_row FROM public.prospect_enrichment_runs
  WHERE submitted_by = p_submitted_by AND run_key = p_run_key FOR UPDATE;
  IF run_row.source_system IS DISTINCT FROM p_source_system OR run_row.source_name IS DISTINCT FROM p_source_name THEN
    RETURN jsonb_build_object('outcome','run_conflict');
  END IF;

  IF run_row.manifest_sha256 IS NULL OR run_row.manifest_state <> 'finalized' THEN
    RETURN jsonb_build_object('outcome','manifest_required');
  END IF;

  IF run_row.manifest_sha256 IS NOT NULL THEN
    IF run_row.manifest_state <> 'finalized' THEN RETURN jsonb_build_object('outcome','run_conflict'); END IF;
    SELECT * INTO manifest_row FROM public.prospect_enrichment_run_manifest_items entry
    WHERE entry.run_id = run_row.id AND entry.client_package_id = p_client_package_id;
    IF NOT FOUND OR manifest_row.expected_payload_sha256 IS DISTINCT FROM p_payload_sha256 OR
       manifest_row.research_key IS DISTINCT FROM p_research_key OR
       manifest_row.client_items IS DISTINCT FROM actual_lineage THEN
      RETURN jsonb_build_object('outcome','package_conflict');
    END IF;
  END IF;

  SELECT * INTO existing_row FROM public.prospect_enrichment_packages package
  WHERE package.submitted_by = p_submitted_by AND package.idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF existing_row.run_id = run_row.id AND existing_row.client_package_id = p_client_package_id AND
       existing_row.raw_body = p_raw_body AND existing_row.raw_body_sha256 = p_raw_body_sha256 AND
       existing_row.payload = p_payload AND existing_row.payload_sha256 = p_payload_sha256 AND
       existing_row.research_key = p_research_key AND existing_row.identity_state = p_identity_state AND
       existing_row.firm_id IS NOT DISTINCT FROM payload_firm_id AND
       existing_row.supersedes_package_id IS NOT DISTINCT FROM predecessor_id THEN
      RETURN jsonb_build_object(
        'outcome','replayed','packageId',existing_row.id,'clientPackageId',existing_row.client_package_id,
        'runId',p_run_key,'serverRunId',run_row.id,'payloadSha256',existing_row.payload_sha256,
        'state',existing_row.state,'identityState',existing_row.identity_state,
        'counts',jsonb_build_object('sources',source_count,'observations',observation_count,'assessments',assessment_count,'items',item_count),
        'receivedAt',existing_row.created_at
      );
    END IF;
    RETURN jsonb_build_object('outcome','idempotency_conflict');
  END IF;
  SELECT * INTO existing_row FROM public.prospect_enrichment_packages package
  WHERE package.submitted_by = p_submitted_by AND package.client_package_id = p_client_package_id FOR UPDATE;
  IF FOUND THEN RETURN jsonb_build_object('outcome','package_conflict'); END IF;

  FOR lock_key IN
    SELECT DISTINCT p_source_system || ':' || (lineage->>'sourceEventKey')
    FROM jsonb_array_elements(actual_lineage) AS lineages(lineage)
    ORDER BY 1
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('prospect-enrichment:event:' || lock_key, 620260923));
  END LOOP;
  FOR event_row IN
    SELECT lineage.value->>'sourceEventKey' AS event_key,lineage.value->>'semanticSha256' AS semantic_sha256
    FROM jsonb_array_elements(actual_lineage) AS lineage(value)
    ORDER BY lineage.value->>'sourceEventKey'
  LOOP
    SELECT * INTO existing_source_event FROM public.prospect_enrichment_source_events event
    WHERE event.source_system = p_source_system AND event.source_event_key = event_row.event_key;
    IF FOUND AND existing_source_event.semantic_sha256 IS DISTINCT FROM event_row.semantic_sha256 THEN
      RETURN jsonb_build_object('outcome','source_event_conflict');
    END IF;
  END LOOP;

  state_value := CASE
    WHEN p_identity_state <> 'resolved' THEN 'identity_hold'
    WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(p_sources) AS source_rows(item) WHERE item->>'provenanceState' <> 'complete') OR
         EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) AS item_rows(item) WHERE item->>'provenanceState' <> 'complete') THEN 'evidence_hold'
    ELSE 'ready_for_review'
  END;
  INSERT INTO public.prospect_enrichment_packages(
    run_id,client_package_id,submitted_by,idempotency_key,raw_body,raw_body_sha256,payload,payload_sha256,
    schema_version,research_key,firm_id,supersedes_package_id,identity_state,state
  ) VALUES (
    run_row.id,p_client_package_id,p_submitted_by,p_idempotency_key,p_raw_body,p_raw_body_sha256,p_payload,p_payload_sha256,
    p_payload->>'schemaVersion',p_research_key,payload_firm_id,predecessor_id,p_identity_state,state_value
  ) RETURNING * INTO package_row;

  FOR source_input IN SELECT value FROM jsonb_array_elements(p_sources) AS rows(value) LOOP
    INSERT INTO public.prospect_enrichment_source_events(source_system,source_event_key,semantic_sha256,first_package_id)
    VALUES (p_source_system,source_input->>'sourceEventKey',source_input->>'semanticSha256',package_row.id)
    ON CONFLICT (source_system,source_event_key) DO NOTHING;
    SELECT event.id INTO source_event_id FROM public.prospect_enrichment_source_events event
    WHERE event.source_system = p_source_system AND event.source_event_key = source_input->>'sourceEventKey';
    INSERT INTO public.prospect_enrichment_items(
      package_id,source_event_id,client_item_id,item_kind,normalized_sha256,data,source_ids,
      observed_at,observed_on,provenance_state
    ) VALUES (
      package_row.id,source_event_id,source_input->>'clientItemId','source',source_input->>'semanticSha256',
      source_input->'data','[]'::jsonb,nullif(source_input->>'observedAt','null')::timestamptz,
      nullif(source_input->>'observedOn','null')::date,source_input->>'provenanceState'
    );
  END LOOP;
  FOR item_input IN SELECT value FROM jsonb_array_elements(p_items) AS rows(value) LOOP
    INSERT INTO public.prospect_enrichment_source_events(source_system,source_event_key,semantic_sha256,first_package_id)
    VALUES (p_source_system,item_input->>'sourceEventKey',item_input->>'semanticSha256',package_row.id)
    ON CONFLICT (source_system,source_event_key) DO NOTHING;
    SELECT event.id INTO source_event_id FROM public.prospect_enrichment_source_events event
    WHERE event.source_system = p_source_system AND event.source_event_key = item_input->>'sourceEventKey';
    INSERT INTO public.prospect_enrichment_items(
      package_id,source_event_id,client_item_id,item_kind,normalized_sha256,data,source_ids,
      observed_at,observed_on,provenance_state
    ) VALUES (
      package_row.id,source_event_id,item_input->>'clientItemId',
      CASE WHEN item_input->>'itemKind' = 'assessment' THEN 'assessment' ELSE item_input #>> '{data,kind}' END,
      item_input->>'semanticSha256',item_input->'data',item_input->'sourceIds',
      nullif(item_input->>'observedAt','null')::timestamptz,nullif(item_input->>'observedOn','null')::date,
      item_input->>'provenanceState'
    );
  END LOOP;
  INSERT INTO public.prospect_enrichment_events(package_id,event_key,event_type,actor,details)
  VALUES (package_row.id,'received:' || p_payload_sha256,'received',p_submitted_by,jsonb_build_object(
    'runId',p_run_key,'clientPackageId',p_client_package_id,'payloadSha256',p_payload_sha256,
    'sourceCount',source_count,'itemCount',item_count
  ));

  RETURN jsonb_build_object(
    'outcome','created','packageId',package_row.id,'clientPackageId',package_row.client_package_id,
    'runId',p_run_key,'serverRunId',run_row.id,'payloadSha256',package_row.payload_sha256,
    'state',package_row.state,'identityState',package_row.identity_state,
    'counts',jsonb_build_object('sources',source_count,'observations',observation_count,'assessments',assessment_count,'items',item_count),
    'receivedAt',package_row.created_at
  );
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
