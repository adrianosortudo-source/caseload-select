-- Candidate identity is independent of qualification and of a firm UUID.
-- Apply only from a reviewed, pushed release. No existing research row is rewritten.
BEGIN;

CREATE SCHEMA prospect_candidate_private;
REVOKE ALL ON SCHEMA prospect_candidate_private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA prospect_candidate_private TO service_role;
CREATE SEQUENCE prospect_candidate_private.coverage_seq AS bigint MAXVALUE 9007199254740991;
REVOKE ALL ON SEQUENCE prospect_candidate_private.coverage_seq FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.prospect_research_candidate_coverage (
  revision bigint PRIMARY KEY,
  source_table text NOT NULL,
  source_key text NOT NULL,
  source_sha256 text NOT NULL,
  snapshot jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(source_table, source_key, source_sha256)
);
CREATE TABLE public.prospect_research_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_namespace text NOT NULL,
  identity_key text NOT NULL,
  identity_namespace_sha256 text NOT NULL,
  identity_key_sha256 text NOT NULL,
  created_revision bigint NOT NULL REFERENCES public.prospect_research_candidate_coverage(revision),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(identity_namespace_sha256, identity_key_sha256)
);
CREATE TABLE public.prospect_research_candidate_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.prospect_research_candidates(id),
  coverage_revision bigint NOT NULL REFERENCES public.prospect_research_candidate_coverage(revision),
  item_kind text NOT NULL CHECK (item_kind IN ('research_revision','provenance_revision','package_event','identity_link','profile_choice')),
  source_table text NOT NULL,
  source_key text NOT NULL,
  run_id uuid NULL REFERENCES public.prospect_enrichment_runs(id),
  entry_id text NULL,
  package_id uuid NULL REFERENCES public.prospect_enrichment_packages(id),
  original_status text NULL,
  selection_disposition text NULL,
  processing_disposition text NULL,
  qualification_state text NULL,
  source_root text NULL,
  relative_path text NULL,
  source_pointer text NULL,
  source_file_sha256 text NULL,
  payload_sha256 text NOT NULL,
  original_json jsonb NOT NULL,
  original_json_sha256 text NOT NULL,
  unmapped_paths jsonb NOT NULL DEFAULT '[]',
  observed_at text NULL,
  retrieved_at text NULL,
  recorded_at timestamptz NOT NULL,
  read_warnings jsonb NOT NULL DEFAULT '[]',
  verified_firm_id uuid NULL REFERENCES public.gta_prospect_firms(id),
  UNIQUE(candidate_id,source_table,source_key,payload_sha256)
);
CREATE INDEX prospect_candidate_history_page ON public.prospect_research_candidate_history(candidate_id,id,coverage_revision);
CREATE INDEX prospect_candidate_history_coverage ON public.prospect_research_candidate_history(coverage_revision);
CREATE INDEX prospect_candidate_history_package ON public.prospect_research_candidate_history(package_id,source_table);
CREATE TABLE public.prospect_research_candidate_fields (
  revision_id uuid NOT NULL REFERENCES public.prospect_research_candidate_history(id),
  candidate_id uuid NOT NULL REFERENCES public.prospect_research_candidates(id),
  coverage_revision bigint NOT NULL REFERENCES public.prospect_research_candidate_coverage(revision),
  pointer text NOT NULL,
  pointer_sha256 text NOT NULL,
  scalar_type text NOT NULL CHECK (scalar_type IN ('string','number','boolean','null','array','object')),
  value_json jsonb NOT NULL,
  searchable_text text NOT NULL,
  source_item_id text NULL,
  source_ids jsonb NOT NULL,
  source_urls text[] NOT NULL DEFAULT '{}',
  source_url_hashes text[] NOT NULL DEFAULT '{}',
  observed_at text NULL,
  retrieved_at text NULL,
  validation_state text NOT NULL,
  observed_day date NULL,
  retrieved_day date NULL,
  PRIMARY KEY(revision_id,pointer_sha256),
  CHECK (jsonb_typeof(value_json)=scalar_type),
  CHECK (scalar_type NOT IN ('array','object') OR value_json IN ('[]'::jsonb,'{}'::jsonb))
);
CREATE TABLE public.prospect_research_candidate_search_chunks (
  revision_id uuid NOT NULL,
  pointer_sha256 text NOT NULL,
  chunk_ordinal integer NOT NULL,
  candidate_id uuid NOT NULL REFERENCES public.prospect_research_candidates(id),
  coverage_revision bigint NOT NULL REFERENCES public.prospect_research_candidate_coverage(revision),
  search_document tsvector NOT NULL,
  PRIMARY KEY(revision_id,pointer_sha256,chunk_ordinal),
  FOREIGN KEY(revision_id,pointer_sha256) REFERENCES public.prospect_research_candidate_fields(revision_id,pointer_sha256)
);
CREATE INDEX prospect_candidate_field_search ON public.prospect_research_candidate_search_chunks USING gin(search_document);
CREATE INDEX prospect_candidate_search_coverage ON public.prospect_research_candidate_search_chunks(candidate_id,coverage_revision);
-- Hashing only narrows the equality lookup; JSONB equality is always rechecked.
-- Wide source strings must not exceed the btree entry-size limit.
CREATE INDEX prospect_candidate_field_exact ON public.prospect_research_candidate_fields(md5(pointer),md5(value_json::text),candidate_id);
CREATE INDEX prospect_candidate_field_sources ON public.prospect_research_candidate_fields USING gin(source_url_hashes);
CREATE INDEX prospect_candidate_field_dates ON public.prospect_research_candidate_fields(candidate_id,observed_day,retrieved_day);
CREATE INDEX prospect_candidate_field_coverage ON public.prospect_research_candidate_fields(candidate_id,coverage_revision);

CREATE TABLE public.prospect_research_candidate_content_chunks (
 revision_id uuid NOT NULL REFERENCES public.prospect_research_candidate_history(id),
 candidate_id uuid NOT NULL REFERENCES public.prospect_research_candidates(id),
 coverage_revision bigint NOT NULL REFERENCES public.prospect_research_candidate_coverage(revision),
 chunk_offset integer NOT NULL CHECK(chunk_offset>=0 AND chunk_offset%65536=0),
 chunk text NOT NULL CHECK(char_length(chunk)<=65536),
 total_characters integer NOT NULL CHECK(total_characters>=0),
 content_sha256 text NOT NULL,
 PRIMARY KEY(revision_id,chunk_offset)
);

CREATE TABLE public.prospect_research_candidate_projection_issues (
 revision_id uuid PRIMARY KEY REFERENCES public.prospect_research_candidate_history(id),
 code text NOT NULL
);

CREATE FUNCTION prospect_candidate_private.reject_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'candidate research history is append-only'; END;
$$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['prospect_research_candidate_coverage','prospect_research_candidates','prospect_research_candidate_history','prospect_research_candidate_fields','prospect_research_candidate_search_chunks','prospect_research_candidate_content_chunks','prospect_research_candidate_projection_issues'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',t);
    EXECUTE format('CREATE TRIGGER candidate_append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION prospect_candidate_private.reject_mutation()',t);
  END LOOP;
END $$;

CREATE FUNCTION prospect_candidate_private.hash_json(p_value jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(extensions.digest(convert_to(public.prospect_enrichment_stable_json_v1(p_value),'UTF8'),'sha256'),'hex')
$$;

CREATE FUNCTION prospect_candidate_private.journal(p_table text,p_key text,p_hash text,p_snapshot jsonb)
RETURNS bigint LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE n bigint;
BEGIN
  -- A sequence without this transaction lock does NOT produce a safe read cutoff:
  -- a transaction could otherwise commit an older allocated number after a page.
  PERFORM pg_advisory_xact_lock(20260924,314);
  SELECT revision INTO n FROM public.prospect_research_candidate_coverage
    WHERE source_table=p_table AND source_key=p_key AND source_sha256=p_hash;
  IF FOUND THEN RETURN n; END IF;
  n := nextval('prospect_candidate_private.coverage_seq');
  INSERT INTO public.prospect_research_candidate_coverage(revision,source_table,source_key,source_sha256,snapshot)
    VALUES(n,p_table,p_key,p_hash,p_snapshot);
  RETURN n;
END $$;

CREATE FUNCTION prospect_candidate_private.walk_fields(
 p_value jsonb,p_pointer text,p_item text,p_sources jsonb,p_urls text[],
 p_observed text,p_retrieved text)
RETURNS TABLE(pointer text,scalar_type text,value_json jsonb,source_item_id text,source_ids jsonb,source_urls text[],observed_at text,retrieved_at text)
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v record; kind text := jsonb_typeof(p_value); part text;
  item_value text := p_item; sources_value jsonb := p_sources; urls_value text[] := p_urls;
  observed_value text := p_observed; retrieved_value text := p_retrieved;
BEGIN
  IF kind='object' THEN
    IF p_value ?| ARRAY['observedAt','observedOn','observed_at','observed_on','assessedAt','assessedOn'] THEN
      observed_value := coalesce(p_value->>'observedAt',p_value->>'observedOn',p_value->>'observed_at',p_value->>'observed_on',p_value->>'assessedAt',p_value->>'assessedOn');
    END IF;
    IF p_value ?| ARRAY['retrievedAt','retrieved_at'] THEN retrieved_value := coalesce(p_value->>'retrievedAt',p_value->>'retrieved_at'); END IF;
    item_value := coalesce(p_value->>'sourceId',p_value->>'observationId',p_value->>'assessmentId',item_value);
    IF p_value ? 'sourceIds' THEN sources_value := p_value->'sourceIds';
    ELSIF p_value ? 'sourceId' THEN sources_value := jsonb_build_array(p_value->'sourceId'); END IF;
    SELECT coalesce(array_agg(DISTINCT x),'{}'::text[]) INTO urls_value FROM unnest(
      urls_value || ARRAY[p_value->>'url',p_value->>'sourceUrl',p_value->>'pageUrl',p_value->>'requestedUrl',p_value->>'finalUrl']
    ) x WHERE x IS NOT NULL;
  END IF;
  IF kind NOT IN ('object','array') OR p_value IN ('{}'::jsonb,'[]'::jsonb) THEN
    RETURN QUERY SELECT p_pointer,kind,p_value,item_value,sources_value,urls_value,observed_value,retrieved_value;
  ELSIF kind='object' THEN
    FOR v IN SELECT key,value FROM jsonb_each(p_value) ORDER BY key LOOP
      part := replace(replace(v.key,'~','~0'),'/','~1');
      RETURN QUERY SELECT * FROM prospect_candidate_private.walk_fields(v.value,p_pointer||'/'||part,item_value,sources_value,urls_value,observed_value,retrieved_value);
    END LOOP;
  ELSE
    FOR v IN SELECT value,ordinality FROM jsonb_array_elements(p_value) WITH ORDINALITY LOOP
      RETURN QUERY SELECT * FROM prospect_candidate_private.walk_fields(v.value,p_pointer||'/'||(v.ordinality-1)::text,item_value,sources_value,urls_value,observed_value,retrieved_value);
    END LOOP;
  END IF;
END $$;

CREATE FUNCTION prospect_candidate_private.source_date(p_value text)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_value IS NULL THEN RETURN NULL; END IF;
  IF p_value ~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN p_value::date; END IF;
  IF p_value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' THEN
    RETURN (p_value::timestamptz AT TIME ZONE 'UTC')::date;
  END IF;
  RETURN NULL;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RETURN NULL;
END $$;


CREATE FUNCTION prospect_candidate_private.record_history(
 p_candidate uuid,p_coverage bigint,p_kind text,p_table text,p_key text,p_run uuid,p_entry text,p_package uuid,
 p_json jsonb,p_hash text,p_meta jsonb,p_warnings jsonb DEFAULT '[]',p_firm uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
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
  INSERT INTO public.prospect_research_candidate_fields(
    revision_id,candidate_id,coverage_revision,pointer,pointer_sha256,scalar_type,value_json,searchable_text,
    source_item_id,source_ids,source_urls,source_url_hashes,observed_at,retrieved_at,validation_state,observed_day,retrieved_day)
  SELECT row_id,p_candidate,p_coverage,f.pointer,encode(extensions.digest(convert_to(f.pointer,'UTF8'),'sha256'),'hex'),f.scalar_type,f.value_json,
    f.pointer||' '||CASE WHEN f.scalar_type='string' THEN f.value_json#>>'{}' ELSE f.value_json::text END,
    f.source_item_id,f.source_ids,f.source_urls,ARRAY(SELECT md5(url) FROM unnest(f.source_urls) url),f.observed_at,f.retrieved_at,
    CASE WHEN p_warnings='[]'::jsonb THEN 'retained' ELSE 'held' END,
    prospect_candidate_private.source_date(f.observed_at),prospect_candidate_private.source_date(f.retrieved_at)
  FROM prospect_candidate_private.walk_fields(p_json,'',p_meta->>'sourceItemId','[]','{}',p_meta->>'observedAt',p_meta->>'retrievedAt') f;
  -- Separate bounded documents retain search coverage for a large raw source
  -- string without PostgreSQL's one-megabyte tsvector limit. The exact scalar
  -- remains untouched in value_json. Overlap preserves boundary words.
  INSERT INTO public.prospect_research_candidate_search_chunks(revision_id,pointer_sha256,chunk_ordinal,candidate_id,coverage_revision,search_document)
    SELECT f.revision_id,f.pointer_sha256,n,p_candidate,p_coverage,
      to_tsvector('simple'::regconfig,substring(f.searchable_text FROM greatest(1,n-2048) FOR 36864))
    FROM public.prospect_research_candidate_fields f
    CROSS JOIN LATERAL generate_series(1,greatest(1,char_length(f.searchable_text)),32768) n
    WHERE f.revision_id=row_id;
  EXCEPTION WHEN program_limit_exceeded THEN
    -- Retain the immutable raw revision if an already accepted source exceeds
    -- the recursive projection engine. The failed index subtransaction rolls
    -- back atomically; no partial field set is misreported as complete.
    INSERT INTO public.prospect_research_candidate_projection_issues(revision_id,code) VALUES(row_id,'field_projection_requires_raw_review');
  END;
  PERFORM prospect_candidate_private.store_revision_content(row_id);
END $$;

CREATE FUNCTION prospect_candidate_private.candidate_for(p_run uuid,p_key text,p_entry text,p_coverage bigint)
RETURNS uuid LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE ns text; identity_value text; result uuid; ns_hash text; key_hash text;
BEGIN
  IF p_key IS NOT NULL AND btrim(p_key)<>'' THEN
    SELECT 'source:'||source_system INTO ns FROM public.prospect_enrichment_runs WHERE id=p_run;
    identity_value := p_key;
  ELSE
    ns := 'run:'||p_run::text;
    identity_value := p_entry;
  END IF;
  IF ns IS NULL OR identity_value IS NULL THEN RAISE EXCEPTION 'candidate identity provenance missing'; END IF;
  ns_hash:=encode(extensions.digest(convert_to(ns,'UTF8'),'sha256'),'hex');
  key_hash:=encode(extensions.digest(convert_to(identity_value,'UTF8'),'sha256'),'hex');
  INSERT INTO public.prospect_research_candidates(identity_namespace,identity_key,identity_namespace_sha256,identity_key_sha256,created_revision)
    VALUES(ns,identity_value,ns_hash,key_hash,p_coverage) ON CONFLICT(identity_namespace_sha256,identity_key_sha256) DO NOTHING;
  SELECT id INTO result FROM public.prospect_research_candidates WHERE identity_namespace_sha256=ns_hash AND identity_key_sha256=key_hash AND identity_namespace=ns AND identity_key=identity_value;
  IF result IS NULL THEN RAISE EXCEPTION 'candidate identity digest collision'; END IF;
  RETURN result;
END $$;


CREATE FUNCTION prospect_candidate_private.index_depth_supported(p_json jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 WITH RECURSIVE nodes(value,depth) AS (
   SELECT p_json,0
   UNION ALL
   SELECT child.value,n.depth+1 FROM nodes n
   CROSS JOIN LATERAL (
     SELECT value FROM jsonb_each(CASE WHEN jsonb_typeof(n.value)='object' THEN n.value ELSE '{}'::jsonb END)
     UNION ALL
     SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(n.value)='array' THEN n.value ELSE '[]'::jsonb END)
   ) child WHERE n.depth<32
 )
 SELECT NOT EXISTS(SELECT 1 FROM nodes WHERE depth=32 AND jsonb_typeof(value) IN ('object','array') AND value NOT IN ('{}','[]'))
$$;

CREATE FUNCTION prospect_candidate_private.project(p_table text,p_row jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  run_value uuid; package_value uuid; entry_value text; key_value text; candidate uuid; coverage bigint;
  source_key text; hash_value text; raw_value jsonb; meta jsonb := '{}'; warnings jsonb := '[]';
  kind_value text := 'research_revision'; entry_row public.prospect_enrichment_run_manifest_items%ROWTYPE;
  package_row public.prospect_enrichment_packages%ROWTYPE; receipt jsonb; state_json jsonb; linked record; choice_row record; status_key text;
BEGIN
  IF p_table NOT IN ('prospect_enrichment_runs','prospect_enrichment_run_manifest_items','prospect_enrichment_manifest_hold_evidence',
     'prospect_enrichment_packages','prospect_enrichment_items','prospect_enrichment_events','prospect_enrichment_item_targets','prospect_enrichment_profile_choices') THEN
    RAISE EXCEPTION 'unsupported candidate projection source';
  END IF;
  PERFORM pg_advisory_xact_lock(20260924,314);
  IF p_table IN ('prospect_enrichment_runs','prospect_enrichment_profile_choices') THEN
    -- Global immutable snapshots keep run completeness and selected choices frozen at the cursor.
    coverage:=prospect_candidate_private.journal(p_table,p_row->>'id',prospect_candidate_private.hash_json(p_row),p_row);
    IF p_table='prospect_enrichment_profile_choices' THEN
      FOR linked IN SELECT DISTINCT h.candidate_id FROM public.prospect_research_candidate_history h
        WHERE (h.item_kind='identity_link' AND h.verified_firm_id=(p_row->>'firm_id')::uuid)
          OR (h.package_id=(p_row->>'package_id')::uuid AND h.source_table='prospect_enrichment_packages') LOOP
        PERFORM prospect_candidate_private.record_history(linked.candidate_id,coverage,'profile_choice',p_table,p_row->>'id',NULL,NULL,
          (p_row->>'package_id')::uuid,p_row,prospect_candidate_private.hash_json(p_row),'{}','[]');
      END LOOP;
    END IF;
    RETURN;
  END IF;
  IF p_table IN ('prospect_enrichment_run_manifest_items','prospect_enrichment_manifest_hold_evidence') THEN
    run_value := (p_row->>'run_id')::uuid; entry_value := p_row->>'entry_id';
    SELECT * INTO entry_row FROM public.prospect_enrichment_run_manifest_items WHERE run_id=run_value AND entry_id=entry_value;
    key_value := entry_row.research_key; source_key := run_value::text||'/'||entry_value;
    raw_value := CASE WHEN p_table='prospect_enrichment_run_manifest_items' THEN p_row->'manifest_entry' ELSE p_row->'evidence' END;
    kind_value := 'provenance_revision';
    IF p_table='prospect_enrichment_manifest_hold_evidence' THEN
      BEGIN
        raw_value := jsonb_build_object('envelope',p_row->'evidence','research',(p_row#>>'{evidence,originalJson}')::jsonb);
        IF NOT prospect_candidate_private.index_depth_supported(raw_value) THEN RAISE SQLSTATE '54000' USING MESSAGE='held evidence requires raw depth review'; END IF;
        PERFORM prospect_candidate_private.hash_json(raw_value);
        kind_value := 'research_revision';
      EXCEPTION WHEN invalid_text_representation OR program_limit_exceeded THEN
        raw_value:=p_row->'evidence';
        warnings := warnings||'["held_original_json_requires_raw_review"]'::jsonb;
      END;
    END IF;
    IF key_value IS NULL OR btrim(key_value)='' THEN warnings:=warnings||'["missing_research_key"]'::jsonb; END IF;
    IF entry_row.initial_disposition IN ('source_root_unavailable','source_read_failed','source_changed_during_snapshot','reference_out_of_scope','reference_provenance_only','provenance_only','hold_schema') THEN
      warnings:=warnings||jsonb_build_array(entry_row.initial_disposition);
    END IF;
  ELSE
    IF p_table='prospect_enrichment_packages' THEN package_value:=(p_row->>'id')::uuid;
    ELSIF p_table='prospect_enrichment_item_targets' THEN
      SELECT package_id INTO package_value FROM public.prospect_enrichment_items WHERE id=(p_row->>'item_id')::uuid;
    ELSE package_value:=(p_row->>'package_id')::uuid; END IF;
    SELECT * INTO package_row FROM public.prospect_enrichment_packages WHERE id=package_value;
    IF NOT FOUND THEN RAISE EXCEPTION 'candidate projection package missing'; END IF;
    run_value:=package_row.run_id; key_value:=package_row.research_key;
    SELECT * INTO entry_row FROM public.prospect_enrichment_run_manifest_items
      WHERE run_id=run_value AND client_package_id=package_row.client_package_id;
    entry_value:=entry_row.entry_id;
    IF entry_value IS NULL THEN warnings:=warnings||'["package_manifest_link_missing"]'::jsonb; END IF;
    source_key:=CASE WHEN p_table='prospect_enrichment_item_targets' THEN (p_row->>'item_id')||'/'||(p_row->>'target_table')||'/'||(p_row->>'target_id') ELSE p_row->>'id' END;
    IF p_table='prospect_enrichment_packages' THEN raw_value:=p_row->'payload';
    ELSIF p_table='prospect_enrichment_items' THEN raw_value:=p_row->'data';
    ELSE raw_value:=p_row; kind_value:='package_event'; END IF;
  END IF;
  meta := jsonb_build_object(
    'sourceRoot',entry_row.source_root,'relativePath',entry_row.relative_path,
    'sourcePointer',entry_row.source_pointer,'sourceFileSha256',entry_row.file_sha256,
    'processingDisposition',CASE WHEN p_table IN ('prospect_enrichment_packages','prospect_enrichment_items') THEN package_row.state ELSE entry_row.initial_disposition END,
    'unmappedPaths',coalesce(raw_value#>'{originalResearch,unmappedPaths}','[]'),
    'sourceItemId',CASE WHEN p_table='prospect_enrichment_items' THEN p_row->>'id' ELSE NULL END,
    'observedAt',coalesce(raw_value->>'observedAt',raw_value->>'observedOn',raw_value->>'assessedAt',raw_value->>'assessedOn',raw_value#>>'{research,observedAt}',raw_value#>>'{research,observedOn}'),
    'retrievedAt',coalesce(raw_value->>'retrievedAt',raw_value#>>'{research,retrievedAt}'),
    'originalStatus',CASE WHEN p_table='prospect_enrichment_manifest_hold_evidence' THEN coalesce(raw_value#>>'{research,originalStatus}',raw_value#>>'{research,status}',raw_value#>>'{research,databaseDecision}',raw_value#>>'{research,disposition}')
      WHEN p_table='prospect_enrichment_packages' THEN coalesce(raw_value#>>'{originalResearch,content,originalStatus}',raw_value#>>'{originalResearch,content,status}',raw_value#>>'{originalResearch,content,databaseDecision}',raw_value#>>'{originalResearch,content,disposition}',raw_value#>>'{assessment,legacyCriteria,originalStatus}')
      WHEN p_table='prospect_enrichment_items' AND p_row->>'item_kind'='assessment' THEN raw_value#>>'{legacyCriteria,originalStatus}' ELSE NULL END,
    'selectionDisposition',CASE WHEN p_table='prospect_enrichment_manifest_hold_evidence' THEN raw_value#>>'{research,selectionDisposition}'
      WHEN p_table='prospect_enrichment_packages' THEN raw_value#>>'{assessment,selectionDisposition}'
      WHEN p_table='prospect_enrichment_items' AND p_row->>'item_kind'='assessment' THEN raw_value->>'selectionDisposition' ELSE NULL END,
    'qualificationState',CASE WHEN p_table='prospect_enrichment_manifest_hold_evidence' THEN raw_value#>>'{research,qualificationState}'
      WHEN p_table='prospect_enrichment_packages' THEN raw_value#>>'{originalResearch,content,qualificationState}'
      WHEN p_table='prospect_enrichment_items' AND p_row->>'item_kind'='assessment' THEN raw_value->>'qualificationState' ELSE NULL END
  );
  FOREACH status_key IN ARRAY ARRAY['originalStatus','selectionDisposition','qualificationState'] LOOP
    IF jsonb_typeof(meta->status_key)='string' AND btrim(meta->>status_key)='' THEN
      meta:=jsonb_set(meta,ARRAY[status_key],'null'); warnings:=warnings||'["blank_status_retained"]'::jsonb;
    END IF;
  END LOOP;
  hash_value:=CASE WHEN p_table='prospect_enrichment_packages' THEN package_row.payload_sha256
    WHEN p_table='prospect_enrichment_manifest_hold_evidence' THEN p_row->>'evidence_sha256'
    ELSE prospect_candidate_private.hash_json(raw_value) END;
  coverage:=prospect_candidate_private.journal(p_table,source_key,hash_value,
    jsonb_build_object('runId',run_value,'entryId',entry_value,'packageId',package_value));
  candidate:=prospect_candidate_private.candidate_for(run_value,key_value,entry_value,coverage);
  PERFORM prospect_candidate_private.record_history(candidate,coverage,kind_value,p_table,source_key,run_value,entry_value,package_value,raw_value,hash_value,meta,warnings);
  IF p_table='prospect_enrichment_packages' THEN
    state_json:=jsonb_build_object('state',package_row.state,'firmId',package_row.firm_id,
      'reviewJson',package_row.review_json,'reviewSha256',package_row.review_sha256,'applyReceipt',package_row.apply_receipt);
    hash_value:=prospect_candidate_private.hash_json(state_json);
    coverage:=prospect_candidate_private.journal('package_lifecycle',source_key,hash_value,jsonb_build_object('packageId',package_value,'state',package_row.state));
    PERFORM prospect_candidate_private.record_history(candidate,coverage,'package_event','package_lifecycle',source_key,run_value,entry_value,package_value,
      state_json,hash_value,meta||jsonb_build_object('processingDisposition',package_row.state),'[]');
    receipt:=package_row.apply_receipt;
    IF package_row.state='applied' AND package_row.firm_id IS NOT NULL AND package_row.review_json IS NOT NULL
      AND receipt->>'schemaVersion'='prospect-enrichment-apply-receipt/v1'
      AND receipt->>'packageId'=package_value::text AND receipt->>'firmId'=package_row.firm_id::text
      AND receipt->>'payloadSha256'=package_row.payload_sha256 AND receipt->>'reviewSha256'=package_row.review_sha256
      AND ((package_row.review_json#>>'{identity,choice}'='existing' AND package_row.review_json#>>'{identity,firmId}'=package_row.firm_id::text)
        OR (package_row.review_json#>>'{identity,choice}'='new' AND jsonb_typeof(package_row.review_json#>'{identity,coreInput}')='object'))
      AND receipt->>'appliedBy' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND EXISTS(SELECT 1 FROM public.prospect_enrichment_events e WHERE e.package_id=package_value
        AND e.event_type IN ('reviewed','review_changed') AND e.details->>'reviewSha256'=package_row.review_sha256
        AND e.details->>'payloadSha256'=package_row.payload_sha256
        AND e.actor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN
      hash_value:=prospect_candidate_private.hash_json(receipt);
      coverage:=prospect_candidate_private.journal('verified_identity',source_key,hash_value,jsonb_build_object('packageId',package_value,'firmId',package_row.firm_id));
      PERFORM prospect_candidate_private.record_history(candidate,coverage,'identity_link','verified_identity',source_key,run_value,entry_value,package_value,
        jsonb_build_object('receipt',receipt,'review',package_row.review_json),hash_value,meta,'[]',package_row.firm_id);
      FOR choice_row IN SELECT c.snapshot FROM public.prospect_research_candidate_coverage c
        WHERE c.source_table='prospect_enrichment_profile_choices' AND c.snapshot->>'firm_id'=package_row.firm_id::text LOOP
        PERFORM prospect_candidate_private.record_history(candidate,coverage,'profile_choice','prospect_enrichment_profile_choices',
          choice_row.snapshot->>'id',NULL,NULL,(choice_row.snapshot->>'package_id')::uuid,
          choice_row.snapshot,prospect_candidate_private.hash_json(choice_row.snapshot),'{}','[]');
      END LOOP;
    END IF;
  ELSIF p_table='prospect_enrichment_events' AND p_row->>'event_type' IN ('reviewed','review_changed','applied') THEN
    PERFORM prospect_candidate_private.project('prospect_enrichment_packages',to_jsonb(package_row));
  END IF;
END $$;

CREATE FUNCTION prospect_candidate_private.project_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN PERFORM prospect_candidate_private.project(TG_TABLE_NAME,to_jsonb(NEW)); RETURN NEW; END $$;

-- Source writes and this projection commit in the same transaction. No accepted
-- manifest/package/held row can commit without an accounted candidate revision.
CREATE TRIGGER candidate_run_projection AFTER INSERT OR UPDATE ON public.prospect_enrichment_runs
 FOR EACH ROW EXECUTE FUNCTION prospect_candidate_private.project_trigger();
CREATE TRIGGER candidate_manifest_projection AFTER INSERT ON public.prospect_enrichment_run_manifest_items
 FOR EACH ROW EXECUTE FUNCTION prospect_candidate_private.project_trigger();
CREATE TRIGGER candidate_hold_projection AFTER INSERT ON public.prospect_enrichment_manifest_hold_evidence
 FOR EACH ROW EXECUTE FUNCTION prospect_candidate_private.project_trigger();
CREATE TRIGGER candidate_package_projection AFTER INSERT OR UPDATE ON public.prospect_enrichment_packages
 FOR EACH ROW EXECUTE FUNCTION prospect_candidate_private.project_trigger();
CREATE TRIGGER candidate_item_projection AFTER INSERT ON public.prospect_enrichment_items
 FOR EACH ROW EXECUTE FUNCTION prospect_candidate_private.project_trigger();
CREATE TRIGGER candidate_event_projection AFTER INSERT ON public.prospect_enrichment_events
 FOR EACH ROW EXECUTE FUNCTION prospect_candidate_private.project_trigger();
CREATE TRIGGER candidate_target_projection AFTER INSERT ON public.prospect_enrichment_item_targets
 FOR EACH ROW EXECUTE FUNCTION prospect_candidate_private.project_trigger();
CREATE TRIGGER candidate_choice_projection AFTER INSERT ON public.prospect_enrichment_profile_choices
 FOR EACH ROW EXECUTE FUNCTION prospect_candidate_private.project_trigger();


CREATE FUNCTION prospect_candidate_private.cutoff(p_revision bigint)
RETURNS bigint LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE latest bigint;
BEGIN
  SELECT coalesce(max(revision),0) INTO latest FROM public.prospect_research_candidate_coverage;
  IF p_revision IS NULL THEN RETURN latest; END IF;
  IF p_revision<0 OR p_revision>latest OR (p_revision<>0 AND NOT EXISTS(
    SELECT 1 FROM public.prospect_research_candidate_coverage WHERE revision=p_revision)) THEN
    RAISE EXCEPTION 'invalid candidate coverage revision';
  END IF;
  RETURN p_revision;
END $$;


CREATE FUNCTION prospect_candidate_private.coverage_warnings(p_cutoff bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE warnings jsonb:='[]'; n bigint;
BEGIN
  WITH latest AS (
    SELECT DISTINCT ON(source_key) snapshot FROM public.prospect_research_candidate_coverage
    WHERE source_table='prospect_enrichment_runs' AND revision<=p_cutoff ORDER BY source_key,revision DESC
  )
  SELECT count(*) INTO n FROM latest r WHERE
    r.snapshot->>'manifest_state'<>'finalized' OR r.snapshot->>'manifest_expected_entry_count' IS NULL
    OR (r.snapshot->>'manifest_expected_entry_count')::bigint <>
      (SELECT count(*) FROM public.prospect_research_candidate_history h
       WHERE h.run_id=(r.snapshot->>'id')::uuid AND h.source_table='prospect_enrichment_run_manifest_items' AND h.coverage_revision<=p_cutoff);
  IF n>0 THEN warnings:=warnings||jsonb_build_array('run_manifest_incomplete:'||n); END IF;
  SELECT count(*) INTO n FROM public.prospect_research_candidate_history m
    WHERE m.source_table='prospect_enrichment_run_manifest_items' AND m.coverage_revision<=p_cutoff
    AND m.original_json->>'clientPackageId' IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM public.prospect_research_candidate_history p WHERE
      p.source_table='prospect_enrichment_packages' AND p.run_id=m.run_id AND p.entry_id=m.entry_id AND p.coverage_revision<=p_cutoff);
  IF n>0 THEN warnings:=warnings||jsonb_build_array('manifest_package_missing:'||n); END IF;
  SELECT count(*) INTO n FROM public.prospect_research_candidate_history m
    WHERE m.source_table='prospect_enrichment_run_manifest_items' AND m.coverage_revision<=p_cutoff
    AND m.original_json->>'clientPackageId' IS NULL
    AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(m.original_json->'errorCodes','[]')) e WHERE e LIKE '__held_evidence_sha256:%')
    AND NOT EXISTS(SELECT 1 FROM public.prospect_research_candidate_history h WHERE h.source_table='prospect_enrichment_manifest_hold_evidence'
      AND h.run_id=m.run_id AND h.entry_id=m.entry_id AND h.coverage_revision<=p_cutoff);
  IF n>0 THEN warnings:=warnings||jsonb_build_array('manifest_hold_body_missing:'||n); END IF;
  SELECT count(*) INTO n FROM public.prospect_research_candidate_history m
    WHERE m.source_table='prospect_enrichment_run_manifest_items' AND m.coverage_revision<=p_cutoff
    AND coalesce((m.original_json->>'itemCount')::integer,0) <>
      (SELECT count(*) FROM public.prospect_research_candidate_history i WHERE i.source_table='prospect_enrichment_items'
       AND i.run_id=m.run_id AND i.entry_id=m.entry_id AND i.coverage_revision<=p_cutoff);
  IF n>0 THEN warnings:=warnings||jsonb_build_array('manifest_item_accounting_incomplete:'||n); END IF;
  -- This detects damaged/disabled projection paths as well as pre-existing orphan rows.
  -- Rows which have a newer journal entry are outside the cutoff, not missing.
  SELECT
    (SELECT count(*) FROM public.prospect_enrichment_run_manifest_items s WHERE NOT EXISTS(
       SELECT 1 FROM public.prospect_research_candidate_coverage c WHERE c.source_table='prospect_enrichment_run_manifest_items' AND c.source_key=s.run_id::text||'/'||s.entry_id))+
    (SELECT count(*) FROM public.prospect_enrichment_packages s WHERE NOT EXISTS(
       SELECT 1 FROM public.prospect_research_candidate_coverage c WHERE c.source_table='prospect_enrichment_packages' AND c.source_key=s.id::text))+
    (SELECT count(*) FROM public.prospect_enrichment_manifest_hold_evidence s WHERE NOT EXISTS(
       SELECT 1 FROM public.prospect_research_candidate_coverage c WHERE c.source_table='prospect_enrichment_manifest_hold_evidence' AND c.source_key=s.run_id::text||'/'||s.entry_id))+
    (SELECT count(*) FROM public.prospect_enrichment_items s WHERE NOT EXISTS(
       SELECT 1 FROM public.prospect_research_candidate_coverage c WHERE c.source_table='prospect_enrichment_items' AND c.source_key=s.id::text))+
    (SELECT count(*) FROM public.prospect_enrichment_events s WHERE NOT EXISTS(
       SELECT 1 FROM public.prospect_research_candidate_coverage c WHERE c.source_table='prospect_enrichment_events' AND c.source_key=s.id::text))+
    (SELECT count(*) FROM public.prospect_enrichment_item_targets s WHERE NOT EXISTS(
       SELECT 1 FROM public.prospect_research_candidate_coverage c WHERE c.source_table='prospect_enrichment_item_targets' AND c.source_key=s.item_id::text||'/'||s.target_table||'/'||s.target_id::text))+
    (SELECT count(*) FROM public.prospect_enrichment_profile_choices s WHERE NOT EXISTS(
       SELECT 1 FROM public.prospect_research_candidate_coverage c WHERE c.source_table='prospect_enrichment_profile_choices' AND c.source_key=s.id::text))+
    (SELECT count(*) FROM public.prospect_enrichment_runs s WHERE NOT EXISTS(
       SELECT 1 FROM public.prospect_research_candidate_coverage c WHERE c.source_table='prospect_enrichment_runs' AND c.source_key=s.id::text))
    INTO n;
  IF n>0 THEN warnings:=warnings||jsonb_build_array('unregistered_source_rows:'||n); END IF;
  SELECT count(*) INTO n FROM public.prospect_research_candidate_history h
    WHERE h.coverage_revision<=p_cutoff AND h.read_warnings<>'[]'::jsonb;
  IF n>0 THEN warnings:=warnings||jsonb_build_array('retained_source_warnings:'||n); END IF;
  SELECT count(DISTINCT revision_id) INTO n FROM public.prospect_research_candidate_fields f
    WHERE f.coverage_revision<=p_cutoff AND ((f.observed_at IS NOT NULL AND prospect_candidate_private.source_date(f.observed_at) IS NULL)
      OR (f.retrieved_at IS NOT NULL AND prospect_candidate_private.source_date(f.retrieved_at) IS NULL));
  IF n>0 THEN warnings:=warnings||jsonb_build_array('invalid_source_date:'||n); END IF;
  SELECT count(*) INTO n FROM public.prospect_research_candidate_projection_issues i JOIN public.prospect_research_candidate_history h ON h.id=i.revision_id WHERE h.coverage_revision<=p_cutoff;
  IF n>0 THEN warnings:=warnings||jsonb_build_array('field_projection_requires_raw_review:'||n); END IF;
  RETURN warnings;
END $$;

CREATE FUNCTION prospect_candidate_private.full_summary(p_candidate uuid,p_cutoff bigint)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
 WITH candidate AS (SELECT * FROM public.prospect_research_candidates WHERE id=p_candidate AND created_revision<=p_cutoff),
 history AS (SELECT * FROM public.prospect_research_candidate_history WHERE candidate_id=p_candidate AND coverage_revision<=p_cutoff),
 fields AS (SELECT f.* FROM public.prospect_research_candidate_fields f JOIN history h ON h.id=f.revision_id
   WHERE h.item_kind IN ('research_revision','provenance_revision')),
 identities AS (SELECT count(DISTINCT verified_firm_id) AS n,min(verified_firm_id::text) AS firm FROM history WHERE item_kind='identity_link'),
 statuses AS (
   SELECT coalesce(jsonb_agg(DISTINCT original_status) FILTER(WHERE original_status IS NOT NULL),'[]') AS original,
     coalesce(jsonb_agg(DISTINCT selection_disposition) FILTER(WHERE selection_disposition IS NOT NULL),'[]') AS selection,
     coalesce(jsonb_agg(DISTINCT qualification_state) FILTER(WHERE qualification_state IS NOT NULL),'[]') AS qualification
   FROM history WHERE item_kind IN ('research_revision','provenance_revision')
 )
 SELECT jsonb_build_object(
   'id',c.id,'identityNamespace',c.identity_namespace,'identityKey',c.identity_key,
   'displayName',coalesce(
      (SELECT f.value_json#>>'{}' FROM fields f WHERE f.scalar_type='string'
       AND f.pointer ~ '/(displayName|firmName|firm_name)$' AND btrim(f.value_json#>>'{}')<>''
       ORDER BY f.coverage_revision DESC,f.pointer LIMIT 1),c.identity_key),
   'verifiedFirmId',CASE WHEN i.n=1 THEN i.firm ELSE NULL END,
   'identityState',CASE WHEN i.n>1 THEN 'conflict' WHEN i.n=1 THEN 'resolved' ELSE 'unresolved' END,
   'revisionCount',(SELECT count(*) FROM history WHERE item_kind IN ('research_revision','provenance_revision')),
   'originalStatuses',s.original,'selectionDispositions',s.selection,
   'processingDispositions',(SELECT coalesce(jsonb_agg(DISTINCT processing_disposition) FILTER(WHERE processing_disposition IS NOT NULL),'[]') FROM history),
   'qualificationStates',s.qualification,
   'latestRecordedAt',(SELECT max(recorded_at) FROM history),
   'readWarnings',(SELECT coalesce(jsonb_agg(DISTINCT w),'[]') FROM (
     SELECT jsonb_array_elements_text(read_warnings) w FROM history
     UNION SELECT issue.code FROM public.prospect_research_candidate_projection_issues issue JOIN history h ON h.id=issue.revision_id
     UNION SELECT 'identity_conflict' WHERE i.n>1
     UNION SELECT 'invalid_source_date' WHERE EXISTS (SELECT 1 FROM fields f
       WHERE (f.observed_at IS NOT NULL AND prospect_candidate_private.source_date(f.observed_at) IS NULL)
         OR (f.retrieved_at IS NOT NULL AND prospect_candidate_private.source_date(f.retrieved_at) IS NULL))
   ) warning_rows)
 ) FROM candidate c CROSS JOIN identities i CROSS JOIN statuses s
$$;



CREATE FUNCTION prospect_candidate_private.bounded_text(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT CASE WHEN char_length(p_value)<=2048 THEN p_value ELSE NULL END
$$;

CREATE FUNCTION prospect_candidate_private.summary(p_candidate uuid,p_cutoff bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE data jsonb; k text; bounded jsonb; n bigint; warnings jsonb;
BEGIN
 data:=prospect_candidate_private.full_summary(p_candidate,p_cutoff);
 IF data IS NULL THEN RETURN NULL; END IF;
 warnings:=data->'readWarnings';
 IF char_length(data->>'displayName')>2048 THEN
   data:=jsonb_set(data,'{displayName}',to_jsonb(data->>'identityKey'));
   warnings:=warnings||'["summary_display_name_deferred"]'::jsonb;
 END IF;
 FOREACH k IN ARRAY ARRAY['originalStatuses','selectionDispositions','processingDispositions','qualificationStates'] LOOP
   SELECT coalesce(jsonb_agg(v ORDER BY v),'[]'),count(*) INTO bounded,n FROM (
     SELECT value v FROM jsonb_array_elements(data->k) WHERE char_length(value#>>'{}')<=2048 ORDER BY value LIMIT 16
   ) visible;
   IF n<jsonb_array_length(data->k) THEN warnings:=warnings||jsonb_build_array('summary_statuses_deferred:'||k); END IF;
   data:=jsonb_set(data,ARRAY[k],bounded);
 END LOOP;
 RETURN jsonb_set(data,'{readWarnings}',warnings);
END $$;

CREATE FUNCTION prospect_candidate_private.check_filters(p_filters jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE k text; value jsonb; d date;
BEGIN
 IF p_filters IS NULL OR jsonb_typeof(p_filters)<>'object' OR octet_length(p_filters::text)>32768 OR
  p_filters-ARRAY['text','originalStatus','selectionDisposition','processingDisposition','qualificationState','identityState','fieldPointer','fieldValue','fieldRefRevision','fieldRefPointerSha256','sourceUrl','observedFrom','observedTo','retrievedFrom','retrievedTo','observedUnknown','retrievedUnknown']::text[]<>'{}'::jsonb THEN
   RAISE EXCEPTION 'invalid candidate filters';
 END IF;
 FOR k,value IN SELECT pair.key,pair.value FROM jsonb_each(p_filters) pair LOOP
  IF k IN ('observedUnknown','retrievedUnknown') THEN
    IF jsonb_typeof(value)<>'boolean' THEN RAISE EXCEPTION 'invalid unknown-date filter'; END IF;
  ELSIF k='fieldValue' THEN
    IF jsonb_typeof(value) IN ('array','object') AND value NOT IN ('[]','{}') THEN RAISE EXCEPTION 'invalid typed field filter'; END IF;
  ELSE
    IF jsonb_typeof(value)<>'string' OR char_length(value#>>'{}')>4000 THEN RAISE EXCEPTION 'invalid text filter'; END IF;
  END IF;
  IF k IN ('observedFrom','observedTo','retrievedFrom','retrievedTo') THEN
    d:=prospect_candidate_private.source_date(value#>>'{}');
    IF d IS NULL OR (value#>>'{}')!~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'invalid candidate date range'; END IF;
  END IF;
 END LOOP;
 IF p_filters ? 'fieldValue' AND NOT p_filters ? 'fieldPointer' THEN RAISE EXCEPTION 'typed value requires field pointer'; END IF;
 IF (p_filters ? 'fieldRefRevision')<>(p_filters ? 'fieldRefPointerSha256') OR
   (p_filters ? 'fieldRefRevision' AND p_filters ?| ARRAY['fieldPointer','fieldValue']) THEN RAISE EXCEPTION 'invalid candidate field reference'; END IF;
 IF p_filters ? 'fieldRefRevision' AND (
   p_filters->>'fieldRefRevision' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   OR p_filters->>'fieldRefPointerSha256' !~ '^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'invalid candidate field reference'; END IF;
 IF p_filters ? 'identityState' AND p_filters->>'identityState' NOT IN ('unresolved','resolved','conflict') THEN RAISE EXCEPTION 'invalid identity filter'; END IF;
 IF p_filters->>'observedFrom'>p_filters->>'observedTo' OR p_filters->>'retrievedFrom'>p_filters->>'retrievedTo' THEN RAISE EXCEPTION 'inverted candidate date range'; END IF;
 IF (p_filters->>'observedUnknown'='true' AND p_filters ?| ARRAY['observedFrom','observedTo']) OR
    (p_filters->>'retrievedUnknown'='true' AND p_filters ?| ARRAY['retrievedFrom','retrievedTo']) THEN RAISE EXCEPTION 'unknown date cannot have date range'; END IF;
END $$;

CREATE FUNCTION prospect_candidate_private.matches(p_id uuid,p_summary jsonb,p_filters jsonb,p_cutoff bigint)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT
 (NOT p_filters ? 'identityState' OR p_summary->>'identityState'=p_filters->>'identityState')
 AND NOT EXISTS (
   SELECT 1 FROM (VALUES ('originalStatus'),('selectionDisposition'),('processingDisposition'),('qualificationState')) x(filter_key)
   WHERE p_filters ? x.filter_key AND NOT (
     CASE WHEN p_filters->>x.filter_key='__unknown__' THEN NOT EXISTS(
       SELECT 1 FROM public.prospect_research_candidate_history h WHERE h.candidate_id=p_id AND h.coverage_revision<=p_cutoff
         AND CASE x.filter_key WHEN 'originalStatus' THEN h.original_status WHEN 'selectionDisposition' THEN h.selection_disposition
           WHEN 'processingDisposition' THEN h.processing_disposition ELSE h.qualification_state END IS NOT NULL)
     ELSE EXISTS(SELECT 1 FROM public.prospect_research_candidate_history h WHERE h.candidate_id=p_id AND h.coverage_revision<=p_cutoff
         AND CASE x.filter_key WHEN 'originalStatus' THEN h.original_status WHEN 'selectionDisposition' THEN h.selection_disposition
           WHEN 'processingDisposition' THEN h.processing_disposition ELSE h.qualification_state END=p_filters->>x.filter_key) END)
 )
 AND (NOT p_filters ? 'text' OR btrim(p_filters->>'text')='' OR NOT EXISTS (
   SELECT 1 FROM regexp_split_to_table(p_filters->>'text','\s+') term
   WHERE numnode(plainto_tsquery('simple'::regconfig,term))>0
     AND NOT EXISTS (SELECT 1 FROM public.prospect_research_candidate_search_chunks f
       WHERE f.candidate_id=p_id AND f.coverage_revision<=p_cutoff
       AND f.search_document @@ plainto_tsquery('simple'::regconfig,term))
     AND NOT EXISTS(SELECT 1 FROM public.prospect_research_candidate_history h JOIN public.prospect_research_candidate_projection_issues i ON i.revision_id=h.id
       WHERE h.candidate_id=p_id AND h.coverage_revision<=p_cutoff AND strpos(lower(h.original_json::text),lower(term))>0)
     AND NOT (to_tsvector('simple'::regconfig,coalesce(p_summary->>'displayName','')||' '||coalesce(p_summary->>'identityKey',''))
       @@ plainto_tsquery('simple'::regconfig,term))
 ))
 AND (NOT p_filters ? 'fieldPointer' OR EXISTS (
   SELECT 1 FROM public.prospect_research_candidate_fields f WHERE f.candidate_id=p_id AND f.coverage_revision<=p_cutoff
   AND md5(f.pointer)=md5(p_filters->>'fieldPointer') AND f.pointer=p_filters->>'fieldPointer'
   AND (NOT p_filters ? 'fieldValue' OR (md5(f.value_json::text)=md5((p_filters->'fieldValue')::text) AND f.value_json=p_filters->'fieldValue'))
 ))
 AND (NOT p_filters ? 'fieldRefRevision' OR EXISTS(
   SELECT 1 FROM public.prospect_research_candidate_fields reference_field JOIN public.prospect_research_candidate_fields f
     ON f.pointer_sha256=reference_field.pointer_sha256 AND f.pointer=reference_field.pointer
       AND md5(f.value_json::text)=md5(reference_field.value_json::text)
       AND f.value_json=reference_field.value_json AND f.scalar_type=reference_field.scalar_type
   WHERE reference_field.revision_id=(p_filters->>'fieldRefRevision')::uuid
     AND reference_field.pointer_sha256=p_filters->>'fieldRefPointerSha256'
     AND reference_field.coverage_revision<=p_cutoff AND f.candidate_id=p_id AND f.coverage_revision<=p_cutoff
 ))
 AND (NOT p_filters ? 'sourceUrl' OR EXISTS (
   SELECT 1 FROM public.prospect_research_candidate_fields f WHERE f.candidate_id=p_id AND f.coverage_revision<=p_cutoff
     AND f.source_url_hashes @> ARRAY[md5(p_filters->>'sourceUrl')] AND f.source_urls @> ARRAY[p_filters->>'sourceUrl']
 ))
 AND (NOT p_filters ?| ARRAY['observedFrom','observedTo','observedUnknown'] OR EXISTS (
   SELECT 1 FROM public.prospect_research_candidate_fields f WHERE f.candidate_id=p_id AND f.coverage_revision<=p_cutoff
     AND (NOT p_filters ? 'observedUnknown' OR ((prospect_candidate_private.source_date(f.observed_at) IS NULL)=(p_filters->>'observedUnknown')::boolean))
     AND (NOT p_filters ? 'observedFrom' OR f.observed_day>=(p_filters->>'observedFrom')::date)
     AND (NOT p_filters ? 'observedTo' OR f.observed_day<=(p_filters->>'observedTo')::date)
 ))
 AND (NOT p_filters ?| ARRAY['retrievedFrom','retrievedTo','retrievedUnknown'] OR EXISTS (
   SELECT 1 FROM public.prospect_research_candidate_fields f WHERE f.candidate_id=p_id AND f.coverage_revision<=p_cutoff
     AND (NOT p_filters ? 'retrievedUnknown' OR ((prospect_candidate_private.source_date(f.retrieved_at) IS NULL)=(p_filters->>'retrievedUnknown')::boolean))
     AND (NOT p_filters ? 'retrievedFrom' OR f.retrieved_day>=(p_filters->>'retrievedFrom')::date)
     AND (NOT p_filters ? 'retrievedTo' OR f.retrieved_day<=(p_filters->>'retrievedTo')::date)
 ))
$$;

CREATE FUNCTION prospect_candidate_private.list_candidates(p_filters jsonb,p_limit integer,p_after_id uuid,p_coverage_revision bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cutoff bigint; warnings jsonb; result jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid candidate page size'; END IF;
 IF p_after_id IS NOT NULL AND p_coverage_revision IS NULL THEN RAISE EXCEPTION 'candidate cursor requires coverage revision'; END IF;
 PERFORM prospect_candidate_private.check_filters(p_filters);
 cutoff:=prospect_candidate_private.cutoff(p_coverage_revision); warnings:=prospect_candidate_private.coverage_warnings(cutoff);
 IF p_filters ? 'fieldRefRevision' AND NOT EXISTS(SELECT 1 FROM public.prospect_research_candidate_fields f
   WHERE f.revision_id=(p_filters->>'fieldRefRevision')::uuid AND f.pointer_sha256=p_filters->>'fieldRefPointerSha256'
     AND f.coverage_revision<=cutoff) THEN RAISE EXCEPTION 'invalid candidate field reference'; END IF;
 WITH inventory AS MATERIALIZED (
   SELECT c.id,prospect_candidate_private.summary(c.id,cutoff) data FROM public.prospect_research_candidates c WHERE c.created_revision<=cutoff
 ), filtered AS MATERIALIZED (
   SELECT * FROM inventory i WHERE prospect_candidate_private.matches(i.id,i.data,p_filters,cutoff)
 ), sized AS (
   SELECT *,row_number() OVER(ORDER BY id) ordinal,sum(octet_length(data::text)) OVER(ORDER BY id) bytes
   FROM filtered WHERE p_after_id IS NULL OR id>p_after_id
 ), page AS (
   SELECT * FROM sized WHERE ordinal<=p_limit AND bytes<=1040000 ORDER BY id
 )
 SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(data ORDER BY id) FROM page),'[]'),
   'nextAfterId',CASE WHEN EXISTS(SELECT 1 FROM filtered WHERE id>(SELECT max(id::text)::uuid FROM page))
      THEN (SELECT max(id::text) FROM page) ELSE NULL END,
   'inventoryCount',(SELECT count(*) FROM inventory),'filteredCount',(SELECT count(*) FROM filtered),
   'coverageRevision',cutoff,'readWarnings',warnings,'complete',warnings='[]'::jsonb) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION prospect_candidate_private.get_candidate(p_candidate_id uuid,p_coverage_revision bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cutoff bigint; data jsonb; choices jsonb; warnings jsonb; firm text; choice_total bigint; choice_count bigint;
BEGIN
 cutoff:=prospect_candidate_private.cutoff(p_coverage_revision);
 data:=prospect_candidate_private.summary(p_candidate_id,cutoff);
 IF data IS NULL THEN RETURN NULL; END IF;
 warnings:=prospect_candidate_private.coverage_warnings(cutoff)||(data->'readWarnings'); firm:=data->>'verifiedFirmId';
 WITH current_choices AS (
 SELECT c.revision,c.snapshot FROM public.prospect_research_candidate_coverage c
 WHERE c.source_table='prospect_enrichment_profile_choices' AND c.revision<=cutoff AND c.snapshot->>'firm_id'=firm
 AND NOT EXISTS(SELECT 1 FROM public.prospect_research_candidate_coverage successor
   WHERE successor.source_table='prospect_enrichment_profile_choices' AND successor.revision<=cutoff AND successor.snapshot->>'supersedes_choice_id'=c.source_key)
 ), sized AS (SELECT *,sum(octet_length(snapshot::text)) OVER(ORDER BY revision) bytes FROM current_choices)
 SELECT coalesce(jsonb_agg(snapshot ORDER BY revision) FILTER(WHERE bytes<=262144),'[]'),count(*),count(*) FILTER(WHERE bytes<=262144)
 INTO choices,choice_total,choice_count FROM sized;
 IF choice_count<choice_total THEN warnings:=warnings||'["profile_choices_deferred_to_history"]'::jsonb; END IF;
 RETURN jsonb_build_object('candidate',data,'profileChoices',choices,'coverageRevision',cutoff,'readWarnings',warnings,'complete',warnings='[]'::jsonb);
END $$;

CREATE FUNCTION prospect_candidate_private.history_item(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT jsonb_build_object(
  'id',h.id,'candidateId',h.candidate_id,'itemKind',h.item_kind,'runId',h.run_id,'entryId',h.entry_id,'packageId',h.package_id,
  'originalStatus',h.original_status,'selectionDisposition',h.selection_disposition,'processingDisposition',h.processing_disposition,
  'qualificationState',h.qualification_state,'sourceRoot',h.source_root,'relativePath',h.relative_path,'sourcePointer',h.source_pointer,
  'sourceFileSha256',h.source_file_sha256,'payloadSha256',h.payload_sha256,'originalJsonSha256',h.original_json_sha256,'contentDeferred',false,'originalJson',h.original_json,'unmappedPaths',h.unmapped_paths,
  'observedAt',h.observed_at,'retrievedAt',h.retrieved_at,'recordedAt',h.recorded_at,'readWarnings',h.read_warnings||coalesce((SELECT jsonb_build_array(i.code) FROM public.prospect_research_candidate_projection_issues i WHERE i.revision_id=h.id),'[]')||CASE WHEN EXISTS(SELECT 1 FROM public.prospect_research_candidate_fields f WHERE f.revision_id=h.id AND ((f.observed_at IS NOT NULL AND prospect_candidate_private.source_date(f.observed_at) IS NULL) OR (f.retrieved_at IS NOT NULL AND prospect_candidate_private.source_date(f.retrieved_at) IS NULL))) THEN '["invalid_source_date"]'::jsonb ELSE '[]'::jsonb END,
  'fields',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'pointer',f.pointer,'scalarType',f.scalar_type,'value',f.value_json,'sourceItemId',f.source_item_id,'sourceIds',f.source_ids,
    'observedAt',f.observed_at,'retrievedAt',f.retrieved_at,'validationState',f.validation_state) ORDER BY f.pointer),'[]')
    FROM public.prospect_research_candidate_fields f WHERE f.revision_id=h.id)
 ) FROM public.prospect_research_candidate_history h WHERE h.id=p_id
$$;


CREATE FUNCTION prospect_candidate_private.history_metadata(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT jsonb_build_object(
  'id',h.id,'candidateId',h.candidate_id,'itemKind',h.item_kind,'runId',h.run_id,'entryId',prospect_candidate_private.bounded_text(h.entry_id),'packageId',h.package_id,
  'originalStatus',prospect_candidate_private.bounded_text(h.original_status),'selectionDisposition',prospect_candidate_private.bounded_text(h.selection_disposition),
  'processingDisposition',prospect_candidate_private.bounded_text(h.processing_disposition),'qualificationState',prospect_candidate_private.bounded_text(h.qualification_state),
  'sourceRoot',prospect_candidate_private.bounded_text(h.source_root),'relativePath',prospect_candidate_private.bounded_text(h.relative_path),
  'sourcePointer',prospect_candidate_private.bounded_text(h.source_pointer),'sourceFileSha256',h.source_file_sha256,'payloadSha256',h.payload_sha256,
  'originalJsonSha256',h.original_json_sha256,'originalJson',NULL,'unmappedPaths','[]'::jsonb,'contentDeferred',true,
  'observedAt',prospect_candidate_private.bounded_text(h.observed_at),'retrievedAt',prospect_candidate_private.bounded_text(h.retrieved_at),
  'recordedAt',h.recorded_at,'readWarnings',h.read_warnings||coalesce((SELECT jsonb_build_array(i.code) FROM public.prospect_research_candidate_projection_issues i WHERE i.revision_id=h.id),'[]')
    ||CASE WHEN EXISTS(SELECT 1 FROM unnest(ARRAY[h.entry_id,h.original_status,h.selection_disposition,h.processing_disposition,h.qualification_state,h.source_root,h.relative_path,h.source_pointer,h.observed_at,h.retrieved_at]) v WHERE char_length(v)>2048)
      THEN '["oversized_metadata_deferred"]'::jsonb ELSE '[]'::jsonb END
    ||CASE WHEN EXISTS(SELECT 1 FROM public.prospect_research_candidate_fields f WHERE f.revision_id=h.id
      AND ((f.observed_at IS NOT NULL AND f.observed_day IS NULL) OR (f.retrieved_at IS NOT NULL AND f.retrieved_day IS NULL)))
      THEN '["invalid_source_date"]'::jsonb ELSE '[]'::jsonb END,
  'fields','[]'::jsonb)
 FROM public.prospect_research_candidate_history h WHERE h.id=p_id
$$;

CREATE FUNCTION prospect_candidate_private.store_revision_content(p_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE content text; digest_value text; row_value public.prospect_research_candidate_history%ROWTYPE;
BEGIN
 SELECT * INTO STRICT row_value FROM public.prospect_research_candidate_history WHERE id=p_id;
 content:=public.prospect_enrichment_stable_json_v1(prospect_candidate_private.history_item(p_id));
 digest_value:=encode(extensions.digest(convert_to(content,'UTF8'),'sha256'),'hex');
 INSERT INTO public.prospect_research_candidate_content_chunks(revision_id,candidate_id,coverage_revision,chunk_offset,chunk,total_characters,content_sha256)
 SELECT p_id,row_value.candidate_id,row_value.coverage_revision,n,substring(content FROM n+1 FOR 65536),char_length(content),digest_value
 FROM generate_series(0,greatest(0,char_length(content)-1),65536) n;
END $$;

CREATE FUNCTION prospect_candidate_private.revision_chunk(p_candidate_id uuid,p_revision_id uuid,p_offset integer,p_coverage_revision bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cutoff bigint; row_value public.prospect_research_candidate_content_chunks%ROWTYPE; total integer;
BEGIN
 IF p_offset IS NULL OR p_offset<0 THEN RAISE EXCEPTION 'invalid candidate content offset'; END IF;
 cutoff:=prospect_candidate_private.cutoff(p_coverage_revision);
 SELECT total_characters INTO total FROM public.prospect_research_candidate_content_chunks
  WHERE revision_id=p_revision_id AND candidate_id=p_candidate_id AND coverage_revision<=cutoff AND chunk_offset=0;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF p_offset>total OR (p_offset<total AND p_offset%65536<>0) THEN RAISE EXCEPTION 'invalid candidate content offset'; END IF;
 IF p_offset=total THEN
   SELECT * INTO row_value FROM public.prospect_research_candidate_content_chunks WHERE revision_id=p_revision_id AND chunk_offset=0;
   RETURN jsonb_build_object('candidateId',p_candidate_id,'revisionId',p_revision_id,'coverageRevision',cutoff,'offset',p_offset,
     'nextOffset',NULL,'chunk','','totalCharacters',total,'contentSha256',row_value.content_sha256);
 END IF;
 SELECT * INTO STRICT row_value FROM public.prospect_research_candidate_content_chunks
   WHERE revision_id=p_revision_id AND candidate_id=p_candidate_id AND coverage_revision<=cutoff AND chunk_offset=p_offset;
 RETURN jsonb_build_object('candidateId',p_candidate_id,'revisionId',p_revision_id,'coverageRevision',cutoff,'offset',p_offset,
   'nextOffset',CASE WHEN p_offset+65536<total THEN p_offset+65536 ELSE NULL END,'chunk',row_value.chunk,
   'totalCharacters',total,'contentSha256',row_value.content_sha256);
END $$;

CREATE FUNCTION prospect_candidate_private.list_history(p_candidate_id uuid,p_limit integer,p_after_id uuid,p_coverage_revision bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cutoff bigint; warnings jsonb; data jsonb; result_items jsonb:='[]'; row_value record; item jsonb;
  bytes bigint:=0; next_id uuid; last_id uuid; seen integer:=0;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'invalid candidate history page size'; END IF;
 IF p_after_id IS NOT NULL AND p_coverage_revision IS NULL THEN RAISE EXCEPTION 'history cursor requires coverage revision'; END IF;
 cutoff:=prospect_candidate_private.cutoff(p_coverage_revision); data:=prospect_candidate_private.summary(p_candidate_id,cutoff);
 IF data IS NULL THEN RETURN NULL; END IF;
 warnings:=prospect_candidate_private.coverage_warnings(cutoff);
 FOR row_value IN SELECT id FROM public.prospect_research_candidate_history WHERE candidate_id=p_candidate_id AND coverage_revision<=cutoff
   AND (p_after_id IS NULL OR id>p_after_id) ORDER BY id LIMIT p_limit+1 LOOP
   item:=prospect_candidate_private.history_metadata(row_value.id);
   IF seen>=p_limit OR bytes+octet_length(item::text)>1048000 THEN next_id:=last_id; EXIT; END IF;
   result_items:=result_items||jsonb_build_array(item); bytes:=bytes+octet_length(item::text); seen:=seen+1; last_id:=row_value.id;
 END LOOP;
 RETURN jsonb_build_object('items',result_items,'nextAfterId',next_id,'coverageRevision',cutoff,'readWarnings',warnings,'complete',warnings='[]'::jsonb);
END $$;

CREATE FUNCTION public.list_prospect_research_candidates_v1(
 p_filters jsonb DEFAULT '{}',p_limit integer DEFAULT 50,p_after_id uuid DEFAULT NULL,p_coverage_revision bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
 SELECT prospect_candidate_private.list_candidates(p_filters,p_limit,p_after_id,p_coverage_revision)
$$;
CREATE FUNCTION public.get_prospect_research_candidate_v1(p_candidate_id uuid,p_coverage_revision bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
 SELECT prospect_candidate_private.get_candidate(p_candidate_id,p_coverage_revision)
$$;
CREATE FUNCTION public.list_prospect_research_candidate_history_v1(
 p_candidate_id uuid,p_limit integer DEFAULT 10,p_after_id uuid DEFAULT NULL,p_coverage_revision bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
 SELECT prospect_candidate_private.list_history(p_candidate_id,p_limit,p_after_id,p_coverage_revision)
$$;


CREATE FUNCTION public.get_prospect_research_candidate_revision_chunk_v1(
 p_candidate_id uuid,p_revision_id uuid,p_offset integer DEFAULT 0,p_coverage_revision bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
 SELECT prospect_candidate_private.revision_chunk(p_candidate_id,p_revision_id,p_offset,p_coverage_revision)
$$;

-- Seed exclusively from already governed stored rows. No source file is reread,
-- no evidence is re-imported, and no protected apply/review routine is invoked.
DO $$
DECLARE t text; row_value record;
BEGIN
  FOREACH t IN ARRAY ARRAY['prospect_enrichment_runs','prospect_enrichment_run_manifest_items',
    'prospect_enrichment_manifest_hold_evidence','prospect_enrichment_packages','prospect_enrichment_items',
    'prospect_enrichment_events','prospect_enrichment_item_targets','prospect_enrichment_profile_choices'] LOOP
    FOR row_value IN EXECUTE format('SELECT to_jsonb(s) AS value FROM public.%I s',t) LOOP
      PERFORM prospect_candidate_private.project(t,row_value.value);
    END LOOP;
  END LOOP;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA prospect_candidate_private FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION prospect_candidate_private.list_candidates(jsonb,integer,uuid,bigint),
 prospect_candidate_private.get_candidate(uuid,bigint),prospect_candidate_private.list_history(uuid,integer,uuid,bigint),
 prospect_candidate_private.revision_chunk(uuid,uuid,integer,bigint) TO service_role;
REVOKE ALL ON FUNCTION public.list_prospect_research_candidates_v1(jsonb,integer,uuid,bigint),
 public.get_prospect_research_candidate_v1(uuid,bigint),
 public.list_prospect_research_candidate_history_v1(uuid,integer,uuid,bigint),public.get_prospect_research_candidate_revision_chunk_v1(uuid,uuid,integer,bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_prospect_research_candidates_v1(jsonb,integer,uuid,bigint),
 public.get_prospect_research_candidate_v1(uuid,bigint),
 public.list_prospect_research_candidate_history_v1(uuid,integer,uuid,bigint),public.get_prospect_research_candidate_revision_chunk_v1(uuid,uuid,integer,bigint) TO service_role;
COMMIT;
