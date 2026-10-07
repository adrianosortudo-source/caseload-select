-- Preserve the deployed tokenization and bounded identity/group semantics.
-- Correlated membership cannot become a global merge semi-join. The truth test
-- also avoids repeated global GIN bitmap intersections for common terms.
BEGIN;

CREATE OR REPLACE FUNCTION prospect_candidate_private.list_candidates_for_text(
  p_filters jsonb,p_limit integer,p_after_id uuid,p_coverage_revision bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cutoff bigint; warnings jsonb; result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid candidate page size'; END IF;
  IF p_after_id IS NOT NULL AND p_coverage_revision IS NULL THEN RAISE EXCEPTION 'candidate cursor requires coverage revision'; END IF;
  PERFORM prospect_candidate_private.check_filters(p_filters);
  cutoff := prospect_candidate_private.cutoff(p_coverage_revision);
  warnings := prospect_candidate_private.coverage_warnings_text_search_v1(cutoff);

  WITH text_terms AS MATERIALIZED (
    SELECT DISTINCT btrim(term) term,plainto_tsquery('simple'::regconfig,btrim(term)) query
    FROM regexp_split_to_table(coalesce(p_filters->>'text',''),'\s+') term
    WHERE numnode(plainto_tsquery('simple'::regconfig,btrim(term)))>0
  ), anchor_term AS MATERIALIZED (
    SELECT term,query FROM text_terms ORDER BY char_length(term) DESC,term LIMIT 1
  ), anchor_candidates AS MATERIALIZED (
    SELECT c.id candidate_id
    FROM public.prospect_research_candidates c
    WHERE btrim(coalesce(p_filters->>'text',''))=''
      AND c.created_revision<=cutoff
    UNION ALL
    SELECT hits.candidate_id
    FROM (
      SELECT f.candidate_id
      FROM anchor_term anchor JOIN public.prospect_research_candidate_search_chunks f
        ON f.search_document @@ anchor.query
      WHERE f.coverage_revision<=cutoff
      UNION ALL
      SELECT named.id
      FROM anchor_term anchor JOIN public.prospect_research_candidates named
        ON to_tsvector('simple'::regconfig,named.identity_key||' '||named.identity_namespace) @@ anchor.query
      WHERE named.created_revision<=cutoff
      UNION ALL
      SELECT h.candidate_id
      FROM anchor_term anchor JOIN public.prospect_research_candidate_history h
        ON to_tsvector('simple'::regconfig,coalesce(h.source_table,'')||' '||coalesce(h.source_root,'')||' '
          ||coalesce(h.relative_path,'')||' '||coalesce(h.source_pointer,'')) @@ anchor.query
      WHERE h.coverage_revision<=cutoff
    ) hits
    GROUP BY hits.candidate_id
  ), anchor_identity_seed AS MATERIALIZED (
    SELECT candidate_id FROM anchor_candidates ORDER BY candidate_id LIMIT 128
  ), anchor_identity_links AS MATERIALIZED (
    SELECT * FROM prospect_candidate_private.identity_links_for_candidates(
      cutoff,ARRAY(SELECT candidate_id FROM anchor_identity_seed))
  ), anchor_identities AS MATERIALIZED (
    SELECT anchors.candidate_id,count(DISTINCT links.verified_firm_id) firm_count,
      min(links.verified_firm_id::text)::uuid firm_id
    FROM anchor_candidates anchors
    LEFT JOIN anchor_identity_links links USING(candidate_id)
    GROUP BY anchors.candidate_id
  ), anchor_firms AS MATERIALIZED (
    SELECT DISTINCT firm_id FROM anchor_identities
    WHERE firm_count=1 AND (SELECT count(*) FROM anchor_candidates)<=128
  ), expanded_seed AS MATERIALIZED (
    SELECT DISTINCT links.candidate_id
    FROM prospect_candidate_private.identity_links_for_firms(
      cutoff,ARRAY(SELECT firm_id FROM anchor_firms)) links
  ), expanded_identity_links AS MATERIALIZED (
    SELECT * FROM prospect_candidate_private.identity_links_for_candidates(
      cutoff,ARRAY(SELECT candidate_id FROM expanded_seed))
  ), expanded_firms AS MATERIALIZED (
    SELECT candidate_id,count(DISTINCT verified_firm_id) firm_count,
      min(verified_firm_id::text)::uuid firm_id
    FROM expanded_identity_links
    GROUP BY candidate_id
  ), candidate_scope AS MATERIALIZED (
    SELECT candidates.candidate_id,'firm:'||candidates.firm_id::text group_key
    FROM expanded_firms candidates JOIN anchor_firms firms USING(firm_id)
    WHERE candidates.firm_count=1
    UNION ALL
    SELECT candidate_id,'candidate:'||candidate_id::text
    FROM anchor_candidates
    UNION ALL
    SELECT candidate_id,'candidate:'||candidate_id::text
    FROM anchor_identities
    WHERE firm_count<>1 OR (SELECT count(*) FROM anchor_candidates)>128
  ), scoped_text_hits AS MATERIALIZED (
    SELECT scope.group_key,terms.term
    FROM candidate_scope scope CROSS JOIN text_terms terms
    CROSS JOIN LATERAL (
      SELECT 1 FROM public.prospect_research_candidate_search_chunks f
      WHERE f.candidate_id=scope.candidate_id AND f.coverage_revision<=cutoff
        -- Keep this as a truth test: the term must filter the candidate range,
        -- not build a global GIN bitmap for every candidate/term lookup.
        AND (f.search_document @@ terms.query) IS TRUE
      LIMIT 1
    ) hit
    UNION ALL
    SELECT scope.group_key,terms.term
    FROM candidate_scope scope
    JOIN public.prospect_research_candidates named ON named.id=scope.candidate_id
    CROSS JOIN text_terms terms
    WHERE named.created_revision<=cutoff
      AND to_tsvector('simple'::regconfig,named.identity_key||' '||named.identity_namespace) @@ terms.query
    UNION ALL
    SELECT scope.group_key,terms.term
    FROM candidate_scope scope
    JOIN public.prospect_research_candidate_history h ON h.candidate_id=scope.candidate_id
    CROSS JOIN text_terms terms
    WHERE h.coverage_revision<=cutoff
      AND to_tsvector('simple'::regconfig,coalesce(h.source_table,'')||' '||coalesce(h.source_root,'')||' '
        ||coalesce(h.relative_path,'')||' '||coalesce(h.source_pointer,'')) @@ terms.query
  ), matched_groups AS MATERIALIZED (
    SELECT group_key FROM scoped_text_hits GROUP BY group_key
    HAVING count(DISTINCT term)=(SELECT count(*) FROM text_terms)
  ), filtered AS MATERIALIZED (
    SELECT DISTINCT scope.candidate_id id
    FROM candidate_scope scope
    WHERE NOT EXISTS (SELECT 1 FROM text_terms)
       OR scope.group_key IN (SELECT group_key FROM matched_groups)
  ), page_ids AS MATERIALIZED (
    SELECT id FROM filtered
    WHERE p_after_id IS NULL OR id>p_after_id
    ORDER BY id LIMIT p_limit
  ), summaries AS MATERIALIZED (
    SELECT id,prospect_candidate_private.summary(id,cutoff) data FROM page_ids
  ), sized AS (
    SELECT *,sum(octet_length(data::text)) OVER(ORDER BY id) bytes FROM summaries
  ), page AS MATERIALIZED (
    SELECT * FROM sized WHERE bytes<=1040000 ORDER BY id
  )
  SELECT jsonb_build_object(
    'items',coalesce((SELECT jsonb_agg(data ORDER BY id) FROM page),'[]'),
    'nextAfterId',CASE WHEN (SELECT count(*) FROM page)=p_limit
      AND EXISTS(SELECT 1 FROM filtered f WHERE f.id>(SELECT id FROM page ORDER BY id DESC LIMIT 1))
      THEN (SELECT id::text FROM page ORDER BY id DESC LIMIT 1) ELSE NULL END,
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

COMMIT;
