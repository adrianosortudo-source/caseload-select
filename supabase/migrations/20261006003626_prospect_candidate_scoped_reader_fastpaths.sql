-- Scope a firm-filtered Admin page to the verified firm's history index. For
-- global text search, resolve identity only for the rarest matched term, then
-- preserve the full group-wide search and pagination semantics.
BEGIN;

CREATE OR REPLACE FUNCTION prospect_candidate_private.list_candidates_for_firm(
  p_filters jsonb,p_limit integer,p_after_id uuid,p_coverage_revision bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cutoff bigint; warnings jsonb; result jsonb; requested_firm uuid;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid candidate page size'; END IF;
  IF p_after_id IS NOT NULL AND p_coverage_revision IS NULL THEN RAISE EXCEPTION 'candidate cursor requires coverage revision'; END IF;
  PERFORM prospect_candidate_private.check_filters(p_filters);
  cutoff := prospect_candidate_private.cutoff(p_coverage_revision);
  warnings := prospect_candidate_private.coverage_warnings(cutoff);
  requested_firm := (p_filters->>'firmId')::uuid;

  IF p_filters ? 'fieldRefRevision' AND NOT EXISTS (
    SELECT 1 FROM public.prospect_research_candidate_fields f
    WHERE f.revision_id=(p_filters->>'fieldRefRevision')::uuid
      AND f.pointer_sha256=p_filters->>'fieldRefPointerSha256'
      AND f.coverage_revision<=cutoff
  ) THEN RAISE EXCEPTION 'invalid candidate field reference'; END IF;

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
  ), firm_members AS MATERIALIZED (
    SELECT candidate.id,candidate.identity_namespace,candidate.identity_key
    FROM validated_identity identity
    JOIN public.prospect_research_candidates candidate ON candidate.id=identity.candidate_id
    WHERE identity.firm_count=1 AND identity.firm_id=requested_firm
      AND candidate.created_revision<=cutoff
  ), group_members AS MATERIALIZED (
    SELECT coalesce(array_agg(member.id ORDER BY member.id),'{}'::uuid[]) AS ids FROM firm_members member
  ), inventory AS MATERIALIZED (
    SELECT member.id,
      jsonb_build_object('verifiedFirmId',requested_firm,'identityNamespace',member.identity_namespace,
        'identityKey',member.identity_key,'identityState','resolved') AS data,
      groups.ids AS group_ids
    FROM firm_members member CROSS JOIN group_members groups
  ), filtered AS MATERIALIZED (
    SELECT inventory.id FROM inventory
    WHERE prospect_candidate_private.matches_group(inventory.id,inventory.data,p_filters,cutoff,inventory.group_ids)
  ), page_ids AS MATERIALIZED (
    SELECT id FROM filtered WHERE p_after_id IS NULL OR id>p_after_id ORDER BY id LIMIT p_limit
  ), summaries AS MATERIALIZED (
    SELECT id,prospect_candidate_private.summary(id,cutoff) AS data FROM page_ids
  ), sized AS (
    SELECT *,sum(octet_length(data::text)) OVER(ORDER BY id) AS bytes FROM summaries
  ), page AS MATERIALIZED (
    SELECT * FROM sized WHERE bytes<=1040000 ORDER BY id
  )
  SELECT jsonb_build_object(
    'items',coalesce((SELECT jsonb_agg(data ORDER BY id) FROM page),'[]'),
    'nextAfterId',CASE WHEN EXISTS(SELECT 1 FROM filtered WHERE id>(SELECT max(id::text)::uuid FROM page))
      THEN (SELECT max(id::text) FROM page) ELSE NULL END,
    'inventoryCount',(SELECT count(*) FROM public.prospect_research_candidates WHERE created_revision<=cutoff),
    'filteredCount',(SELECT count(*) FROM filtered),
    'coverageRevision',cutoff,'readWarnings',warnings,'complete',warnings='[]'::jsonb
  ) INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION prospect_candidate_private.list_candidates_for_firm(jsonb,integer,uuid,bigint)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION prospect_candidate_private.list_candidates_for_firm(jsonb,integer,uuid,bigint)
  TO service_role;

CREATE OR REPLACE FUNCTION prospect_candidate_private.list_candidates_for_text(
  p_filters jsonb,p_limit integer,p_after_id uuid,p_coverage_revision bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cutoff bigint; warnings jsonb; result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid candidate page size'; END IF;
  IF p_after_id IS NOT NULL AND p_coverage_revision IS NULL THEN RAISE EXCEPTION 'candidate cursor requires coverage revision'; END IF;
  PERFORM prospect_candidate_private.check_filters(p_filters);
  cutoff := prospect_candidate_private.cutoff(p_coverage_revision);
  warnings := prospect_candidate_private.coverage_warnings(cutoff);

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
  ), term_counts AS MATERIALIZED (
    SELECT term,count(DISTINCT candidate_id) candidate_count FROM text_hits GROUP BY term
  ), anchor_term AS MATERIALIZED (
    SELECT term FROM term_counts ORDER BY candidate_count,term LIMIT 1
  ), anchor_candidates AS MATERIALIZED (
    SELECT DISTINCT hits.candidate_id FROM text_hits hits JOIN anchor_term anchor USING(term)
  ), anchor_identities AS MATERIALIZED (
    SELECT anchors.candidate_id,count(DISTINCT links.verified_firm_id) firm_count,
      min(links.verified_firm_id::text)::uuid firm_id
    FROM anchor_candidates anchors
    LEFT JOIN LATERAL prospect_candidate_private.identity_links_for(cutoff,anchors.candidate_id) links ON true
    GROUP BY anchors.candidate_id
  ), anchor_firms AS MATERIALIZED (
    SELECT DISTINCT firm_id FROM anchor_identities WHERE firm_count=1
  ), expanded_identity_links AS MATERIALIZED (
    SELECT DISTINCT links.candidate_id
    FROM prospect_candidate_private.identity_links_for_firms(cutoff,ARRAY(SELECT firm_id FROM anchor_firms)) links
  ), expanded_firms AS MATERIALIZED (
    SELECT candidates.candidate_id,count(DISTINCT links.verified_firm_id) firm_count,
      min(links.verified_firm_id::text)::uuid firm_id
    FROM expanded_identity_links candidates
    LEFT JOIN LATERAL prospect_candidate_private.identity_links_for(cutoff,candidates.candidate_id) links ON true
    GROUP BY candidates.candidate_id
  ), candidate_scope AS MATERIALIZED (
    SELECT candidates.candidate_id,'firm:'||candidates.firm_id::text group_key
    FROM expanded_firms candidates JOIN anchor_firms firms USING(firm_id)
    WHERE candidates.firm_count=1
    UNION ALL
    SELECT candidate_id,'candidate:'||candidate_id::text
    FROM anchor_identities WHERE firm_count<>1
  ), scoped_text_hits AS MATERIALIZED (
    SELECT scope.group_key,hits.term FROM candidate_scope scope
    JOIN text_hits hits USING(candidate_id)
  ), matched_groups AS MATERIALIZED (
    SELECT group_key FROM scoped_text_hits GROUP BY group_key
    HAVING count(DISTINCT term)=(SELECT count(*) FROM text_terms)
  ), filtered AS MATERIALIZED (
    SELECT DISTINCT scope.candidate_id id FROM candidate_scope scope
    JOIN matched_groups groups USING(group_key)
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
    'coverageRevision',cutoff,'readWarnings',warnings,'complete',warnings='[]'::jsonb
  ) INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION prospect_candidate_private.list_candidates_for_text(jsonb,integer,uuid,bigint)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION prospect_candidate_private.list_candidates_for_text(jsonb,integer,uuid,bigint)
  TO service_role;

CREATE OR REPLACE FUNCTION public.list_prospect_research_candidates_v1(
  p_filters jsonb DEFAULT '{}',p_limit integer DEFAULT 50,p_after_id uuid DEFAULT NULL,p_coverage_revision bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_filters ? 'firmId' AND p_filters ? 'fieldPointer' AND p_filters ? 'fieldValue'
      AND (p_filters-ARRAY['firmId','fieldPointer','fieldValue']::text[])='{}'::jsonb
      THEN prospect_candidate_private.list_candidates(p_filters,p_limit,p_after_id,p_coverage_revision)
    WHEN p_filters ? 'firmId'
      THEN prospect_candidate_private.list_candidates_for_firm(p_filters,p_limit,p_after_id,p_coverage_revision)
    WHEN p_filters ? 'text' AND (p_filters-'text')='{}'::jsonb
      AND btrim(coalesce(p_filters->>'text',''))<>''
      AND numnode(plainto_tsquery('simple'::regconfig,btrim(p_filters->>'text')))>0
      THEN prospect_candidate_private.list_candidates_for_text(p_filters,p_limit,p_after_id,p_coverage_revision)
    ELSE prospect_candidate_private.list_candidates(p_filters,p_limit,p_after_id,p_coverage_revision)
  END
$$;

COMMIT;
