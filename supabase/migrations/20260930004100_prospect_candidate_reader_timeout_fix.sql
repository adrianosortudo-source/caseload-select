-- Bound the common initial candidate-list read to page-sized summary work.
-- The previous list path validated every identity link before it could return
-- the first page, which made a read-only query exceed PostgREST's request cap.
BEGIN;

CREATE INDEX prospect_candidate_history_metadata_search
  ON public.prospect_research_candidate_history USING gin (
    to_tsvector('simple'::regconfig, coalesce(source_table,'') || ' ' || coalesce(source_root,'') || ' '
      || coalesce(relative_path,'') || ' ' || coalesce(source_pointer,''))
  );

CREATE OR REPLACE FUNCTION prospect_candidate_private.list_candidates(p_filters jsonb,p_limit integer,p_after_id uuid,p_coverage_revision bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cutoff bigint; warnings jsonb; result jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid candidate page size'; END IF;
 IF p_after_id IS NOT NULL AND p_coverage_revision IS NULL THEN RAISE EXCEPTION 'candidate cursor requires coverage revision'; END IF;
 PERFORM prospect_candidate_private.check_filters(p_filters);
 cutoff:=prospect_candidate_private.cutoff(p_coverage_revision); warnings:=prospect_candidate_private.coverage_warnings(cutoff);

 -- The default page has no filter predicate. Avoid resolving every historical
 -- identity link merely to return 25 summaries; resolve identities only for
 -- those page rows inside summary(). Counts and UUID keyset paging stay exact.
 IF p_filters='{}'::jsonb THEN
   WITH inventory AS MATERIALIZED (
     SELECT c.id FROM public.prospect_research_candidates c WHERE c.created_revision<=cutoff
   ), page_ids AS MATERIALIZED (
     SELECT id FROM inventory WHERE p_after_id IS NULL OR id>p_after_id ORDER BY id LIMIT p_limit
   ), summaries AS MATERIALIZED (
     SELECT id,prospect_candidate_private.summary(id,cutoff) data FROM page_ids
   ), sized AS (
     SELECT *,sum(octet_length(data::text)) OVER(ORDER BY id) bytes FROM summaries
   ), page AS MATERIALIZED (
     SELECT * FROM sized WHERE bytes<=1040000 ORDER BY id
   )
   SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(data ORDER BY id) FROM page),'[]'),
     'nextAfterId',CASE WHEN EXISTS(SELECT 1 FROM inventory WHERE id>(SELECT max(id::text)::uuid FROM page))
       THEN (SELECT max(id::text) FROM page) ELSE NULL END,
     'inventoryCount',(SELECT count(*) FROM inventory),'filteredCount',(SELECT count(*) FROM inventory),
     'coverageRevision',cutoff,'readWarnings',warnings,'complete',warnings='[]'::jsonb) INTO result;
   RETURN result;
 END IF;

 IF p_filters ? 'fieldRefRevision' AND NOT EXISTS(SELECT 1 FROM public.prospect_research_candidate_fields f
   WHERE f.revision_id=(p_filters->>'fieldRefRevision')::uuid AND f.pointer_sha256=p_filters->>'fieldRefPointerSha256'
     AND f.coverage_revision<=cutoff) THEN RAISE EXCEPTION 'invalid candidate field reference'; END IF;
 WITH identities AS MATERIALIZED (
   SELECT candidate_id,count(DISTINCT verified_firm_id) firm_count,min(verified_firm_id::text) firm_id
   FROM prospect_candidate_private.identity_links_at(cutoff) GROUP BY candidate_id
 ), memberships AS MATERIALIZED (
   SELECT candidate_id,array_agg(candidate_id) OVER(PARTITION BY firm_id) ids FROM identities
   WHERE firm_count=1 AND (p_filters-'fieldPointer'-'fieldValue'-'text')<>'{}'::jsonb
 ), inventory AS MATERIALIZED (
   SELECT c.id,jsonb_build_object('verifiedFirmId',CASE WHEN links.firm_count=1 THEN links.firm_id ELSE NULL END,
      'identityNamespace',c.identity_namespace,'identityKey',c.identity_key,
      'identityState',CASE WHEN links.firm_count=1 THEN 'resolved' WHEN links.firm_count>1 THEN 'conflict' ELSE 'unresolved' END) data,
      coalesce(m.ids,ARRAY[c.id]) group_ids,
      CASE WHEN links.firm_count=1 THEN 'firm:'||links.firm_id ELSE 'candidate:'||c.id::text END group_key
   FROM public.prospect_research_candidates c LEFT JOIN memberships m ON m.candidate_id=c.id
   LEFT JOIN identities links ON links.candidate_id=c.id WHERE c.created_revision<=cutoff
 ), text_terms AS MATERIALIZED (
   SELECT DISTINCT btrim(term) term,plainto_tsquery('simple'::regconfig,btrim(term)) query
   FROM regexp_split_to_table(coalesce(p_filters->>'text',''),'\s+') term
   WHERE p_filters ? 'text' AND btrim(p_filters->>'text')<>'' AND numnode(plainto_tsquery('simple'::regconfig,btrim(term)))>0
 ), text_hits AS MATERIALIZED (
   SELECT f.candidate_id,t.term FROM text_terms t JOIN public.prospect_research_candidate_search_chunks f
     ON f.search_document @@ t.query WHERE p_filters ? 'text' AND btrim(p_filters->>'text')<>'' AND f.coverage_revision<=cutoff
   UNION
   SELECT h.candidate_id,t.term FROM text_terms t JOIN public.prospect_research_candidate_history h
     ON strpos(lower(h.original_json::text),lower(t.term))>0
     JOIN public.prospect_research_candidate_projection_issues i ON i.revision_id=h.id
     WHERE p_filters ? 'text' AND btrim(p_filters->>'text')<>'' AND h.coverage_revision<=cutoff
   UNION
   SELECT named.id,t.term FROM text_terms t JOIN public.prospect_research_candidates named
     ON to_tsvector('simple'::regconfig,named.identity_key||' '||named.identity_namespace) @@ t.query
     WHERE p_filters ? 'text' AND btrim(p_filters->>'text')<>''
   UNION
   SELECT h.candidate_id,t.term FROM text_terms t JOIN public.prospect_research_candidate_history h
     ON to_tsvector('simple'::regconfig,coalesce(h.source_table,'')||' '||coalesce(h.source_root,'')||' '
       ||coalesce(h.relative_path,'')||' '||coalesce(h.source_pointer,'')) @@ t.query
     WHERE p_filters ? 'text' AND btrim(p_filters->>'text')<>'' AND h.coverage_revision<=cutoff
 ), text_matches AS MATERIALIZED (
   SELECT CASE WHEN i.firm_count=1 THEN 'firm:'||i.firm_id ELSE 'candidate:'||h.candidate_id::text END group_id
   FROM text_hits h LEFT JOIN identities i ON i.candidate_id=h.candidate_id
   GROUP BY CASE WHEN i.firm_count=1 THEN 'firm:'||i.firm_id ELSE 'candidate:'||h.candidate_id::text END
   HAVING count(DISTINCT h.term)=(SELECT count(*) FROM text_terms)
 ), typed_field_candidates AS MATERIALIZED (
   SELECT DISTINCT f.candidate_id FROM public.prospect_research_candidate_fields f
   WHERE p_filters ? 'fieldPointer' AND p_filters ? 'fieldValue' AND f.coverage_revision<=cutoff
     AND md5(f.pointer)=md5(p_filters->>'fieldPointer') AND f.pointer=p_filters->>'fieldPointer'
     AND md5(f.value_json::text)=md5((p_filters->'fieldValue')::text) AND f.value_json=p_filters->'fieldValue'
   UNION
   SELECT DISTINCT f.candidate_id FROM public.prospect_research_candidate_fields f
   WHERE p_filters ? 'fieldPointer' AND NOT p_filters ? 'fieldValue' AND f.coverage_revision<=cutoff
     AND md5(f.pointer)=md5(p_filters->>'fieldPointer') AND f.pointer=p_filters->>'fieldPointer'
 ), typed_field_matches AS MATERIALIZED (
   SELECT candidate_id FROM typed_field_candidates
 ), non_text_filtered AS MATERIALIZED (
   SELECT i.id FROM inventory i WHERE NOT (p_filters ? 'fieldPointer') AND (
     p_filters='{}'::jsonb OR ((NOT p_filters ? 'text' OR btrim(p_filters->>'text')='')
       AND prospect_candidate_private.matches_group(i.id,i.data,p_filters,cutoff,i.group_ids))
   )
 ), text_filtered AS MATERIALIZED (
   SELECT i.id FROM inventory i WHERE p_filters ? 'text' AND btrim(p_filters->>'text')<>''
     AND NOT (p_filters ? 'fieldPointer')
     AND prospect_candidate_private.matches_group(i.id,i.data,p_filters-'text',cutoff,i.group_ids)
     AND (NOT EXISTS(SELECT 1 FROM text_terms)
       OR EXISTS(SELECT 1 FROM text_matches tm WHERE tm.group_id=i.group_key))
 ), typed_field_filtered AS MATERIALIZED (
   SELECT i.id FROM typed_field_matches tf JOIN inventory i ON i.id=tf.candidate_id
   WHERE p_filters ? 'fieldPointer'
     AND CASE WHEN (p_filters-'fieldPointer'-'fieldValue'-'text')='{}'::jsonb THEN true
       ELSE prospect_candidate_private.matches_group(i.id,i.data,p_filters-'fieldPointer'-'fieldValue'-'text',cutoff,i.group_ids) END
     AND (NOT p_filters ? 'text' OR btrim(p_filters->>'text')='' OR NOT EXISTS(SELECT 1 FROM text_terms)
       OR EXISTS(SELECT 1 FROM text_matches tm WHERE tm.group_id=i.group_key))
 ), filtered AS MATERIALIZED (
   SELECT id FROM non_text_filtered UNION ALL SELECT id FROM text_filtered UNION ALL SELECT id FROM typed_field_filtered
 ), page_ids AS MATERIALIZED (
   SELECT id FROM filtered WHERE p_after_id IS NULL OR id>p_after_id ORDER BY id LIMIT p_limit
 ), summaries AS MATERIALIZED (
   SELECT id,prospect_candidate_private.summary(id,cutoff) data FROM page_ids
 ), sized AS (
   SELECT *,sum(octet_length(data::text)) OVER(ORDER BY id) bytes FROM summaries
 ), page AS (
   SELECT * FROM sized WHERE bytes<=1040000 ORDER BY id
 )
 SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(data ORDER BY id) FROM page),'[]'),
   'nextAfterId',CASE WHEN EXISTS(SELECT 1 FROM filtered WHERE id>(SELECT max(id::text)::uuid FROM page))
      THEN (SELECT max(id::text) FROM page) ELSE NULL END,
   'inventoryCount',(SELECT count(*) FROM inventory),'filteredCount',(SELECT count(*) FROM filtered),
   'coverageRevision',cutoff,'readWarnings',warnings,'complete',warnings='[]'::jsonb) INTO result;
 RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION prospect_candidate_private.list_candidates(jsonb,integer,uuid,bigint) TO service_role;
COMMIT;
