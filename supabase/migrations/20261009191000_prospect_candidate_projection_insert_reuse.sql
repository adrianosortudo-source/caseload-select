-- Scoped projection write repair. No reader, identity, grant, lock, timeout or index changes.
-- Existing functions must exist; replacing them preserves their signatures and ACLs.
DO $guard$ BEGIN
  PERFORM 'prospect_candidate_private.record_history(uuid,bigint,text,text,text,uuid,text,uuid,jsonb,text,jsonb,jsonb,uuid)'::regprocedure;
  PERFORM 'prospect_candidate_private.store_revision_content(uuid)'::regprocedure;
END $guard$;

CREATE OR REPLACE FUNCTION prospect_candidate_private.store_revision_content(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE content text; digest_value text; row_value public.prospect_research_candidate_history%ROWTYPE;
BEGIN
 SELECT * INTO STRICT row_value FROM public.prospect_research_candidate_history WHERE id=p_id;
 -- Fixed field members have a stable canonical key order. Serialize them directly
 -- rather than recursively reconstructing thousands of identical object shapes.
 -- Non-scalar values and source IDs still use the existing canonical serializer.
 WITH field_text AS (
   SELECT '['||coalesce(string_agg(
     '{"observedAt":'||coalesce(to_json(f.observed_at)::text,'null')||
     ',"pointer":'||to_json(f.pointer)::text||
     ',"retrievedAt":'||coalesce(to_json(f.retrieved_at)::text,'null')||
     ',"scalarType":'||to_json(f.scalar_type)::text||
     ',"sourceIds":'||public.prospect_enrichment_stable_json_v1(f.source_ids)||
     ',"sourceItemId":'||coalesce(to_json(f.source_item_id)::text,'null')||
     ',"validationState":'||to_json(f.validation_state)::text||
     ',"value":'||CASE WHEN jsonb_typeof(f.value_json) IN ('object','array')
       THEN public.prospect_enrichment_stable_json_v1(f.value_json) ELSE f.value_json::text END||'}',
     ',' ORDER BY f.pointer),'')||']' AS value
   FROM public.prospect_research_candidate_fields f WHERE f.revision_id=p_id
 ), members AS (
   SELECT key,public.prospect_enrichment_stable_json_v1(value) AS value
   -- Preserve the exact history-item header without first aggregating discarded fields.
   FROM jsonb_each((SELECT jsonb_build_object(
  'id',h.id,'candidateId',h.candidate_id,'itemKind',h.item_kind,'runId',h.run_id,'entryId',h.entry_id,'packageId',h.package_id,
  'originalStatus',h.original_status,'selectionDisposition',h.selection_disposition,'processingDisposition',h.processing_disposition,
  'qualificationState',h.qualification_state,'sourceRoot',h.source_root,'relativePath',h.relative_path,'sourcePointer',h.source_pointer,
  'sourceFileSha256',h.source_file_sha256,'payloadSha256',h.payload_sha256,'originalJsonSha256',h.original_json_sha256,'contentDeferred',false,'originalJson',h.original_json,'unmappedPaths',h.unmapped_paths,
  'observedAt',h.observed_at,'retrievedAt',h.retrieved_at,'recordedAt',h.recorded_at,'readWarnings',h.read_warnings||coalesce((SELECT jsonb_build_array(i.code) FROM public.prospect_research_candidate_projection_issues i WHERE i.revision_id=h.id),'[]')||CASE WHEN EXISTS(SELECT 1 FROM public.prospect_research_candidate_fields f WHERE f.revision_id=h.id AND ((f.observed_at IS NOT NULL AND prospect_candidate_private.source_date(f.observed_at) IS NULL) OR (f.retrieved_at IS NOT NULL AND prospect_candidate_private.source_date(f.retrieved_at) IS NULL))) THEN '["invalid_source_date"]'::jsonb ELSE '[]'::jsonb END) FROM public.prospect_research_candidate_history h WHERE h.id=p_id))
   UNION ALL SELECT 'fields',value FROM field_text
 )
 SELECT '{'||string_agg(to_json(key)::text||':'||value,',' ORDER BY key COLLATE "C")||'}'
 INTO content FROM members;
 digest_value:=encode(extensions.digest(convert_to(content,'UTF8'),'sha256'),'hex');
 INSERT INTO public.prospect_research_candidate_content_chunks(revision_id,candidate_id,coverage_revision,chunk_offset,chunk,total_characters,content_sha256)
 SELECT p_id,row_value.candidate_id,row_value.coverage_revision,n,substring(content FROM n+1 FOR 65536),char_length(content),digest_value
 FROM generate_series(0,greatest(0,char_length(content)-1),65536) n;
END $function$
;

CREATE OR REPLACE FUNCTION prospect_candidate_private.record_history(p_candidate uuid, p_coverage bigint, p_kind text, p_table text, p_key text, p_run uuid, p_entry text, p_package uuid, p_json jsonb, p_hash text, p_meta jsonb, p_warnings jsonb DEFAULT '[]'::jsonb, p_firm uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE row_id uuid; recorded timestamptz;
BEGIN
  SELECT recorded_at INTO recorded FROM public.prospect_research_candidate_coverage WHERE revision=p_coverage;
  INSERT INTO public.prospect_research_candidate_history(
    candidate_id,coverage_revision,item_kind,source_table,source_key,run_id,entry_id,package_id,
    original_status,selection_disposition,processing_disposition,qualification_state,
    source_root,relative_path,source_pointer,source_file_sha256,payload_sha256,original_json,original_json_sha256,
    unmapped_paths,observed_at,retrieved_at,recorded_at,read_warnings,verified_firm_id)
  VALUES(p_candidate,p_coverage,p_kind,p_table,p_key,p_run,p_entry,p_package,
    p_meta->>'originalStatus',p_meta->>'selectionDisposition',p_meta->>'processingDisposition',p_meta->>'qualificationState',
    p_meta->>'sourceRoot',p_meta->>'relativePath',p_meta->>'sourcePointer',p_meta->>'sourceFileSha256',p_hash,p_json,prospect_candidate_private.hash_json(p_json),
    coalesce(p_meta->'unmappedPaths','[]'),p_meta->>'observedAt',p_meta->>'retrievedAt',recorded,p_warnings,p_firm)
  ON CONFLICT(candidate_id,source_table,source_key,payload_sha256) DO NOTHING RETURNING id INTO row_id;
  IF row_id IS NULL THEN RETURN; END IF;
  BEGIN
  -- Materialize exact leaves once; hash each distinct inherited URL array once.
  WITH walked AS MATERIALIZED (
    SELECT * FROM prospect_candidate_private.walk_fields(p_json,'',p_meta->>'sourceItemId','[]','{}',p_meta->>'observedAt',p_meta->>'retrievedAt')
  ), url_arrays AS MATERIALIZED (SELECT DISTINCT source_urls COLLATE "C" AS source_urls FROM walked),
  url_hashes AS MATERIALIZED (
    SELECT source_urls,ARRAY(SELECT md5(url) FROM unnest(source_urls) url) AS hashes FROM url_arrays
  ), inserted_fields AS (
  INSERT INTO public.prospect_research_candidate_fields(
    revision_id,candidate_id,coverage_revision,pointer,pointer_sha256,scalar_type,value_json,searchable_text,
    source_item_id,source_ids,source_urls,source_url_hashes,observed_at,retrieved_at,validation_state,observed_day,retrieved_day)
  SELECT row_id,p_candidate,p_coverage,f.pointer,encode(extensions.digest(convert_to(f.pointer,'UTF8'),'sha256'),'hex'),f.scalar_type,f.value_json,
    f.pointer||' '||CASE WHEN f.scalar_type='string' THEN f.value_json#>>'{}' ELSE f.value_json::text END,
    f.source_item_id,f.source_ids,f.source_urls,coalesce(u.hashes,'{}'::text[]),f.observed_at,f.retrieved_at,
    CASE WHEN p_warnings='[]'::jsonb THEN 'retained' ELSE 'held' END,
    prospect_candidate_private.source_date(f.observed_at),prospect_candidate_private.source_date(f.retrieved_at)
  FROM walked f LEFT JOIN url_hashes u ON (u.source_urls COLLATE "C")=(f.source_urls COLLATE "C")
  RETURNING revision_id,pointer_sha256,searchable_text
  )
  -- Separate bounded documents retain search coverage for a large raw source
  -- string without PostgreSQL's one-megabyte tsvector limit. The exact scalar
  -- remains untouched in value_json. Overlap preserves boundary words.
  INSERT INTO public.prospect_research_candidate_search_chunks(revision_id,pointer_sha256,chunk_ordinal,candidate_id,coverage_revision,search_document)
    SELECT f.revision_id,f.pointer_sha256,n,p_candidate,p_coverage,
      to_tsvector('simple'::regconfig,substring(f.searchable_text FROM greatest(1,n-2048) FOR 36864))
    FROM inserted_fields f
    CROSS JOIN LATERAL generate_series(1,greatest(1,char_length(f.searchable_text)),32768) n
    ;
  EXCEPTION WHEN program_limit_exceeded THEN
    -- Retain the immutable raw revision if an already accepted source exceeds
    -- the recursive projection engine. The failed index subtransaction rolls
    -- back atomically; no partial field set is misreported as complete.
    INSERT INTO public.prospect_research_candidate_projection_issues(revision_id,code) VALUES(row_id,'field_projection_requires_raw_review');
  END;
  PERFORM prospect_candidate_private.store_revision_content(row_id);
END $function$
;
