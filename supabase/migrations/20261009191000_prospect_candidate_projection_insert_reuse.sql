-- Scoped projection write repair. Reuses fields returned by the history insert for search chunks.
-- Existing function signature, ACL, security mode, search path and content serializer are preserved.
DO $guard$ BEGIN
  PERFORM 'prospect_candidate_private.record_history(uuid,bigint,text,text,text,uuid,text,uuid,jsonb,text,jsonb,jsonb,uuid)'::regprocedure;
END $guard$;

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
  WITH inserted_fields AS (
    INSERT INTO public.prospect_research_candidate_fields(
      revision_id,candidate_id,coverage_revision,pointer,pointer_sha256,scalar_type,value_json,searchable_text,
      source_item_id,source_ids,source_urls,source_url_hashes,observed_at,retrieved_at,validation_state,observed_day,retrieved_day)
    SELECT row_id,p_candidate,p_coverage,f.pointer,encode(extensions.digest(convert_to(f.pointer,'UTF8'),'sha256'),'hex'),f.scalar_type,f.value_json,
      f.pointer||' '||CASE WHEN f.scalar_type='string' THEN f.value_json#>>'{}' ELSE f.value_json::text END,
      f.source_item_id,f.source_ids,f.source_urls,ARRAY(SELECT md5(url) FROM unnest(f.source_urls) url),f.observed_at,f.retrieved_at,
      CASE WHEN p_warnings='[]'::jsonb THEN 'retained' ELSE 'held' END,
      prospect_candidate_private.source_date(f.observed_at),prospect_candidate_private.source_date(f.retrieved_at)
    FROM prospect_candidate_private.walk_fields(p_json,'',p_meta->>'sourceItemId','[]','{}',p_meta->>'observedAt',p_meta->>'retrievedAt') f
    RETURNING revision_id,pointer_sha256,searchable_text
  )
  -- Separate bounded documents retain search coverage for large raw source strings.
  INSERT INTO public.prospect_research_candidate_search_chunks(revision_id,pointer_sha256,chunk_ordinal,candidate_id,coverage_revision,search_document)
    SELECT f.revision_id,f.pointer_sha256,n,p_candidate,p_coverage,
      to_tsvector('simple'::regconfig,substring(f.searchable_text FROM greatest(1,n-2048) FOR 36864))
    FROM inserted_fields f
    CROSS JOIN LATERAL generate_series(1,greatest(1,char_length(f.searchable_text)),32768) n;
  EXCEPTION WHEN program_limit_exceeded THEN
    -- Retain the immutable raw revision if an already accepted source exceeds
    -- the recursive projection engine. The failed index subtransaction rolls
    -- back atomically; no partial field set is misreported as complete.
    INSERT INTO public.prospect_research_candidate_projection_issues(revision_id,code) VALUES(row_id,'field_projection_requires_raw_review');
  END;
  PERFORM prospect_candidate_private.store_revision_content(row_id);
END $function$
;
