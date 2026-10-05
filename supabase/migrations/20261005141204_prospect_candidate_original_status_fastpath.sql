-- Allocate with official Supabase CLI 2.117.0: migration new prospect_candidate_original_status_fastpath.
-- Literal global status reads use retained status seeds instead of resolving the
-- complete identity inventory before filtering. Existing reader paths stay intact.
BEGIN;
CREATE INDEX prospect_candidate_original_status_exact
  ON public.prospect_research_candidate_history(md5(original_status),coverage_revision,candidate_id)
  WHERE original_status IS NOT NULL;
CREATE OR REPLACE FUNCTION prospect_candidate_private.list_candidates(p_filters jsonb,p_limit integer,p_after_id uuid,p_coverage_revision bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cutoff bigint; warnings jsonb; result jsonb; requested_firm uuid;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid candidate page size'; END IF;
 IF p_after_id IS NOT NULL AND p_coverage_revision IS NULL THEN RAISE EXCEPTION 'candidate cursor requires coverage revision'; END IF;
 PERFORM prospect_candidate_private.check_filters(p_filters);
 cutoff:=prospect_candidate_private.cutoff(p_coverage_revision); warnings:=prospect_candidate_private.coverage_warnings(cutoff);
 -- Start with exact retained statuses, then expand only their validated firm
 -- groups. Unknown status and every combined filter retain the prior reader.
 IF p_filters ? 'originalStatus' AND (p_filters-'originalStatus')='{}'::jsonb
    AND p_filters->>'originalStatus'<>'__unknown__' THEN
   WITH status_seed AS MATERIALIZED (
     SELECT DISTINCT h.candidate_id FROM public.prospect_research_candidate_history h
     WHERE h.coverage_revision<=cutoff AND h.original_status IS NOT NULL
       AND md5(h.original_status)=md5(p_filters->>'originalStatus')
       AND h.original_status=p_filters->>'originalStatus'
   ), seed_identities AS MATERIALIZED (
     SELECT seed.candidate_id,count(DISTINCT links.verified_firm_id) firm_count,
       min(links.verified_firm_id::text)::uuid firm_id
     FROM status_seed seed
     LEFT JOIN LATERAL prospect_candidate_private.identity_links_for(cutoff,seed.candidate_id) links ON true
     GROUP BY seed.candidate_id
   ), matched_firms AS MATERIALIZED (
     SELECT DISTINCT firm_id FROM seed_identities WHERE firm_count=1
   ), firm_candidates AS MATERIALIZED (
     SELECT DISTINCT links.candidate_id FROM prospect_candidate_private.identity_links_for_firms(
       cutoff,ARRAY(SELECT firm_id FROM matched_firms)) links
   ), expanded_identities AS MATERIALIZED (
     SELECT member.candidate_id,count(DISTINCT links.verified_firm_id) firm_count,
       min(links.verified_firm_id::text)::uuid firm_id
     FROM firm_candidates member
     LEFT JOIN LATERAL prospect_candidate_private.identity_links_for(cutoff,member.candidate_id) links ON true
     GROUP BY member.candidate_id
   ), matching_candidates AS MATERIALIZED (
     SELECT candidate_id FROM expanded_identities
     WHERE firm_count=1 AND firm_id IN(SELECT firm_id FROM matched_firms)
     UNION ALL
     SELECT candidate_id FROM seed_identities WHERE firm_count<>1
   ), filtered AS MATERIALIZED (
     SELECT DISTINCT c.id FROM matching_candidates matched
     JOIN public.prospect_research_candidates c ON c.id=matched.candidate_id
     WHERE c.created_revision<=cutoff
   ), page_ids AS MATERIALIZED (
     SELECT id FROM filtered WHERE p_after_id IS NULL OR id>p_after_id ORDER BY id LIMIT p_limit
   ), summaries AS MATERIALIZED (
     SELECT id,prospect_candidate_private.summary(id,cutoff) data FROM page_ids
   ), sized AS (
     SELECT *,sum(octet_length(data::text)) OVER(ORDER BY id) bytes FROM summaries
   ), page AS MATERIALIZED (
     SELECT * FROM sized WHERE bytes<=1040000 ORDER BY id
   )
   SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(data ORDER BY id) FROM page),'[]'),
     'nextAfterId',CASE WHEN EXISTS(SELECT 1 FROM filtered WHERE id>(SELECT max(id::text)::uuid FROM page))
       THEN (SELECT max(id::text) FROM page) ELSE NULL END,
     'inventoryCount',(SELECT count(*) FROM public.prospect_research_candidates WHERE created_revision<=cutoff),
     'filteredCount',(SELECT count(*) FROM filtered),'coverageRevision',cutoff,'readWarnings',warnings,
     'complete',warnings='[]'::jsonb) INTO result;
   RETURN result;
 END IF;
 -- Exact firm and JSON-pointer/value filters can use the existing firm-leading
 -- identity index and exact-field index before validating full identity history.
 IF p_filters ? 'firmId' AND p_filters ? 'fieldPointer' AND p_filters ? 'fieldValue'
    AND (p_filters-ARRAY['firmId','fieldPointer','fieldValue']::text[])='{}'::jsonb THEN
   requested_firm:=(p_filters->>'firmId')::uuid;
   WITH firm_seed AS MATERIALIZED (
     SELECT DISTINCT h.candidate_id
     FROM public.prospect_research_candidate_history h
     WHERE h.item_kind='identity_link'
       AND h.verified_firm_id=requested_firm
       AND h.coverage_revision<=cutoff
   ), validated_identity AS MATERIALIZED (
     SELECT seed.candidate_id,count(DISTINCT links.verified_firm_id) AS firm_count,
       min(links.verified_firm_id::text)::uuid AS firm_id
     FROM firm_seed seed
     LEFT JOIN LATERAL prospect_candidate_private.identity_links_for(cutoff,seed.candidate_id) links ON true
     GROUP BY seed.candidate_id
   ), filtered AS MATERIALIZED (
     SELECT DISTINCT candidate.id
     FROM validated_identity link_state
     JOIN public.prospect_research_candidates candidate ON candidate.id=link_state.candidate_id
     JOIN public.prospect_research_candidate_fields field ON field.candidate_id=candidate.id
     WHERE link_state.firm_count=1 AND link_state.firm_id=requested_firm
       AND candidate.created_revision<=cutoff
       AND field.coverage_revision<=cutoff
       AND md5(field.pointer)=md5(p_filters->>'fieldPointer')
       AND field.pointer=p_filters->>'fieldPointer'
       AND md5(field.value_json::text)=md5((p_filters->'fieldValue')::text)
       AND field.value_json=p_filters->'fieldValue'
   ), page_ids AS MATERIALIZED (
     SELECT id FROM filtered WHERE p_after_id IS NULL OR id>p_after_id ORDER BY id LIMIT p_limit
   ), summaries AS MATERIALIZED (
     SELECT id,prospect_candidate_private.summary(id,cutoff) data FROM page_ids
   ), sized AS (
     SELECT *,sum(octet_length(data::text)) OVER(ORDER BY id) bytes FROM summaries
   ), page AS MATERIALIZED (
     SELECT * FROM sized WHERE bytes<=1040000 ORDER BY id
   )
   SELECT jsonb_build_object(
     'items',coalesce((SELECT jsonb_agg(data ORDER BY id) FROM page),'[]'),
     'nextAfterId',CASE WHEN EXISTS(SELECT 1 FROM filtered WHERE id>(SELECT max(id::text)::uuid FROM page))
       THEN (SELECT max(id::text) FROM page) ELSE NULL END,
     'inventoryCount',(SELECT count(*) FROM public.prospect_research_candidates WHERE created_revision<=cutoff),
     'filteredCount',(SELECT count(*) FROM filtered),
     'coverageRevision',cutoff,
     'readWarnings',warnings,
     'complete',warnings='[]'::jsonb
   ) INTO result;
   RETURN result;
 END IF;

 -- Search first, then resolve identity only for actual matches and their
 -- verified-firm groups. This preserves group-search semantics without
 -- validating every historical identity link for a selective text query.
 IF p_filters ? 'text' AND (p_filters-'text')='{}'::jsonb AND btrim(p_filters->>'text')<>''
    AND numnode(plainto_tsquery('simple'::regconfig,btrim(p_filters->>'text')))>0 THEN
   WITH text_terms AS MATERIALIZED (
     SELECT DISTINCT btrim(term) term,plainto_tsquery('simple'::regconfig,btrim(term)) query
     FROM regexp_split_to_table(coalesce(p_filters->>'text',''),'\s+') term
     WHERE numnode(plainto_tsquery('simple'::regconfig,btrim(term)))>0
   ), text_hits AS MATERIALIZED (
     SELECT f.candidate_id,t.term FROM text_terms t JOIN public.prospect_research_candidate_search_chunks f
       ON f.search_document @@ t.query WHERE f.coverage_revision<=cutoff
     UNION
     SELECT h.candidate_id,t.term FROM text_terms t JOIN public.prospect_research_candidate_history h
       ON strpos(lower(h.original_json::text),lower(t.term))>0
       JOIN public.prospect_research_candidate_projection_issues i ON i.revision_id=h.id
       WHERE h.coverage_revision<=cutoff
     UNION
     SELECT named.id,t.term FROM text_terms t JOIN public.prospect_research_candidates named
       ON to_tsvector('simple'::regconfig,named.identity_key||' '||named.identity_namespace) @@ t.query
       WHERE named.created_revision<=cutoff
     UNION
     SELECT h.candidate_id,t.term FROM text_terms t JOIN public.prospect_research_candidate_history h
       ON to_tsvector('simple'::regconfig,coalesce(h.source_table,'')||' '||coalesce(h.source_root,'')||' '
         ||coalesce(h.relative_path,'')||' '||coalesce(h.source_pointer,'')) @@ t.query
       WHERE h.coverage_revision<=cutoff
   ), hit_candidates AS MATERIALIZED (
     SELECT DISTINCT candidate_id FROM text_hits
   ), hit_identities AS MATERIALIZED (
     SELECT hits.candidate_id,count(DISTINCT links.verified_firm_id) firm_count,
       min(links.verified_firm_id::text)::uuid firm_id
     FROM hit_candidates hits
     LEFT JOIN LATERAL prospect_candidate_private.identity_links_for(cutoff,hits.candidate_id) links ON true
     GROUP BY hits.candidate_id
   ), matched_groups AS MATERIALIZED (
     SELECT CASE WHEN identities.firm_count=1 THEN 'firm:'||identities.firm_id::text
       ELSE 'candidate:'||identities.candidate_id::text END group_key
     FROM text_hits hits JOIN hit_identities identities USING(candidate_id)
     GROUP BY CASE WHEN identities.firm_count=1 THEN 'firm:'||identities.firm_id::text
       ELSE 'candidate:'||identities.candidate_id::text END
     HAVING count(DISTINCT hits.term)=(SELECT count(*) FROM text_terms)
   ), selected_firms AS MATERIALIZED (
     SELECT DISTINCT identities.firm_id FROM hit_identities identities
     JOIN matched_groups groups ON groups.group_key='firm:'||identities.firm_id::text
     WHERE identities.firm_count=1
   ), expanded_identity_links AS MATERIALIZED (
     SELECT DISTINCT links.candidate_id
     FROM prospect_candidate_private.identity_links_for_firms(cutoff,ARRAY(SELECT firm_id FROM selected_firms)) links
   ), expanded_firms AS MATERIALIZED (
     SELECT candidates.candidate_id,count(DISTINCT links.verified_firm_id) firm_count,
       min(links.verified_firm_id::text)::uuid firm_id
     FROM expanded_identity_links candidates
     LEFT JOIN LATERAL prospect_candidate_private.identity_links_for(cutoff,candidates.candidate_id) links ON true
     GROUP BY candidates.candidate_id
   ), selected_candidates AS MATERIALIZED (
     SELECT candidate_id,firm_id,'firm:'||firm_id::text group_key
     FROM expanded_firms WHERE firm_count=1 AND EXISTS(
       SELECT 1 FROM selected_firms WHERE selected_firms.firm_id=expanded_firms.firm_id)
     UNION ALL
     SELECT candidate_id,NULL::uuid,'candidate:'||candidate_id::text
     FROM hit_identities WHERE firm_count<>1 AND EXISTS(
       SELECT 1 FROM matched_groups WHERE group_key='candidate:'||hit_identities.candidate_id::text)
   ), filtered AS MATERIALIZED (
     SELECT DISTINCT selected.candidate_id id FROM selected_candidates selected
     JOIN matched_groups groups ON groups.group_key=selected.group_key
   ), page_ids AS MATERIALIZED (
     SELECT id FROM filtered WHERE p_after_id IS NULL OR id>p_after_id ORDER BY id LIMIT p_limit
   ), summaries AS MATERIALIZED (
     SELECT id,prospect_candidate_private.summary(id,cutoff) data FROM page_ids
   ), sized AS (
     SELECT *,sum(octet_length(data::text)) OVER(ORDER BY id) bytes FROM summaries
   ), page AS MATERIALIZED (
     SELECT * FROM sized WHERE bytes<=1040000 ORDER BY id
   )
   SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(data ORDER BY id) FROM page),'[]'),
     'nextAfterId',CASE WHEN EXISTS(SELECT 1 FROM filtered WHERE id>(SELECT max(id::text)::uuid FROM page))
       THEN (SELECT max(id::text) FROM page) ELSE NULL END,
     'inventoryCount',(SELECT count(*) FROM public.prospect_research_candidates WHERE created_revision<=cutoff),
     'filteredCount',(SELECT count(*) FROM filtered),'coverageRevision',cutoff,'readWarnings',warnings,
     'complete',warnings='[]'::jsonb) INTO result;
   RETURN result;
 END IF;

 -- The default page has no filter predicate. Avoid resolving every historical
 -- identity link merely to return 25 summaries; resolve identities only for
 -- those page rows inside summary(). Counts and UUID keyset paging stay exact.
 IF p_filters='{}'::jsonb OR (p_filters ? 'text' AND (p_filters-'text')='{}'::jsonb
    AND (btrim(p_filters->>'text')='' OR numnode(plainto_tsquery('simple'::regconfig,btrim(p_filters->>'text')))=0)) THEN
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
COMMENT ON FUNCTION prospect_candidate_private.list_candidates(jsonb,integer,uuid,bigint) IS
  'Literal originalStatus and exact firm/field reads seed selective matches before complete identity validation; every other search preserves the prior reader.';
REVOKE ALL ON FUNCTION prospect_candidate_private.list_candidates(jsonb,integer,uuid,bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION prospect_candidate_private.list_candidates(jsonb,integer,uuid,bigint) TO service_role;

COMMIT;