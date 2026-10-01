-- Keep protected registration RPCs within their bounded request window.
-- Candidate projection builds full-text indexes and can exceed the default
-- 8-second authenticator timeout on the existing production search index.
BEGIN;

ALTER FUNCTION public.register_prospect_enrichment_manifest_chunk_v1(text,jsonb,boolean)
  SET statement_timeout = '30s';

-- Manifest rows are append-only. The run row is already locked FOR UPDATE by
-- this function, which serializes registration against other chunks and the
-- finalization update. Locking the manifest row itself requires UPDATE
-- privilege, which the service_role correctly does not have.
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
SET statement_timeout = '30s'
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

  -- The immutable manifest entry needs no row lock: all writers serialize on
  -- the parent run row above, and SELECT FOR UPDATE requires UPDATE privilege.
  SELECT * INTO entry_row FROM public.prospect_enrichment_run_manifest_items
    WHERE run_id = p_run_id AND entry_id = p_entry_id;
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

COMMIT;
