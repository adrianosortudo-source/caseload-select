BEGIN;

-- The identity-state-only filter does not need verified-firm group membership.
-- Avoid building an array of every candidate in every verified firm before
-- returning the requested identity-state page.
CREATE FUNCTION prospect_candidate_private.list_candidates_for_identity_state(
  p_filters jsonb,p_limit integer,p_after_id uuid,p_coverage_revision bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cutoff bigint; warnings jsonb; result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid candidate page size'; END IF;
  IF p_after_id IS NOT NULL AND p_coverage_revision IS NULL THEN RAISE EXCEPTION 'candidate cursor requires coverage revision'; END IF;
  PERFORM prospect_candidate_private.check_filters(p_filters);
  cutoff := prospect_candidate_private.cutoff(p_coverage_revision);
  warnings := prospect_candidate_private.coverage_warnings(cutoff);

  WITH inventory AS MATERIALIZED (
    SELECT c.id FROM public.prospect_research_candidates c WHERE c.created_revision<=cutoff
  ), identities AS MATERIALIZED (
    SELECT links.candidate_id,count(DISTINCT links.verified_firm_id) AS firm_count,
      min(links.verified_firm_id::text)::uuid AS firm_id
    FROM prospect_candidate_private.identity_links_at(cutoff) links
    GROUP BY links.candidate_id
  ), filtered AS MATERIALIZED (
    SELECT candidates.id
    FROM inventory candidates LEFT JOIN identities links ON links.candidate_id=candidates.id
    WHERE CASE WHEN links.firm_count=1 THEN 'resolved'
      WHEN links.firm_count>1 THEN 'conflict' ELSE 'unresolved' END=p_filters->>'identityState'
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
    'items',coalesce((SELECT jsonb_agg(data ORDER BY id) FROM page),'[]'::jsonb),
    'nextAfterId',CASE WHEN EXISTS(SELECT 1 FROM filtered WHERE id>(SELECT max(id::text)::uuid FROM page))
      THEN (SELECT max(id::text) FROM page) ELSE NULL END,
    'inventoryCount',(SELECT count(*) FROM inventory),
    'filteredCount',(SELECT count(*) FROM filtered),
    'coverageRevision',cutoff,'readWarnings',warnings,'complete',warnings='[]'::jsonb
  ) INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION prospect_candidate_private.list_candidates_for_identity_state(jsonb,integer,uuid,bigint)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION prospect_candidate_private.list_candidates_for_identity_state(jsonb,integer,uuid,bigint)
  TO service_role;

CREATE OR REPLACE FUNCTION public.list_prospect_research_candidates_v1(
  p_filters jsonb DEFAULT '{}',p_limit integer DEFAULT 50,p_after_id uuid DEFAULT NULL,p_coverage_revision bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_filters ? 'identityNamespace' AND p_filters ? 'identityKey'
      AND (p_filters-ARRAY['identityNamespace','identityKey']::text[])='{}'::jsonb
      THEN prospect_candidate_private.list_candidates_for_identity(p_filters,p_limit,p_after_id,p_coverage_revision)
    WHEN p_filters ? 'identityState' AND (p_filters-'identityState')='{}'::jsonb
      THEN prospect_candidate_private.list_candidates_for_identity_state(p_filters,p_limit,p_after_id,p_coverage_revision)
    WHEN p_filters ? 'firmId' AND p_filters ? 'fieldPointer' AND p_filters ? 'fieldValue'
      AND (p_filters-ARRAY['firmId','fieldPointer','fieldValue']::text[])='{}'::jsonb
      THEN prospect_candidate_private.list_candidates(p_filters,p_limit,p_after_id,p_coverage_revision)
    WHEN p_filters ? 'firmId'
      THEN prospect_candidate_private.list_candidates_for_firm(p_filters,p_limit,p_after_id,p_coverage_revision)
    WHEN p_filters ? 'fieldPointer'
      THEN prospect_candidate_private.list_candidates_for_indexed_field(p_filters,p_limit,p_after_id,p_coverage_revision)
    WHEN p_filters ? 'text' AND (p_filters-'text')='{}'::jsonb
      AND btrim(coalesce(p_filters->>'text',''))<>''
      AND numnode(plainto_tsquery('simple'::regconfig,btrim(p_filters->>'text')))>0
      THEN prospect_candidate_private.list_candidates_for_text(p_filters,p_limit,p_after_id,p_coverage_revision)
    ELSE prospect_candidate_private.list_candidates(p_filters,p_limit,p_after_id,p_coverage_revision)
  END
$$;

COMMIT;
