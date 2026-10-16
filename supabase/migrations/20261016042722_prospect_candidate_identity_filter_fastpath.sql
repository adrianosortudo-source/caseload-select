BEGIN;

-- Exact source identity is already protected by the unique digest index on
-- prospect_research_candidates. Resolve that one key before any global
-- identity-link aggregation, then build its summary through the existing
-- per-candidate reader.
CREATE FUNCTION prospect_candidate_private.list_candidates_for_identity(
  p_filters jsonb,p_limit integer,p_after_id uuid,p_coverage_revision bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cutoff bigint; warnings jsonb; result jsonb; namespace_hash text; key_hash text;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid candidate page size'; END IF;
  IF p_after_id IS NOT NULL AND p_coverage_revision IS NULL THEN RAISE EXCEPTION 'candidate cursor requires coverage revision'; END IF;
  PERFORM prospect_candidate_private.check_filters(p_filters);
  cutoff := prospect_candidate_private.cutoff(p_coverage_revision);
  warnings := prospect_candidate_private.coverage_warnings(cutoff);
  namespace_hash := encode(extensions.digest(convert_to(p_filters->>'identityNamespace','UTF8'),'sha256'),'hex');
  key_hash := encode(extensions.digest(convert_to(p_filters->>'identityKey','UTF8'),'sha256'),'hex');

  WITH identity_match AS MATERIALIZED (
    SELECT c.id
    FROM public.prospect_research_candidates c
    WHERE c.identity_namespace_sha256=namespace_hash
      AND c.identity_key_sha256=key_hash
      AND c.identity_namespace=p_filters->>'identityNamespace'
      AND c.identity_key=p_filters->>'identityKey'
      AND c.created_revision<=cutoff
  ), page_ids AS MATERIALIZED (
    SELECT id FROM identity_match
    WHERE p_after_id IS NULL OR id>p_after_id
    ORDER BY id LIMIT p_limit
  ), summaries AS MATERIALIZED (
    SELECT id,prospect_candidate_private.summary(id,cutoff) AS data FROM page_ids
  ), sized AS (
    SELECT *,sum(octet_length(data::text)) OVER(ORDER BY id) AS bytes FROM summaries
  ), page AS MATERIALIZED (
    SELECT * FROM sized WHERE bytes<=1040000 ORDER BY id
  )
  SELECT jsonb_build_object(
    'items',coalesce((SELECT jsonb_agg(data ORDER BY id) FROM page),'[]'::jsonb),
    'nextAfterId',CASE WHEN EXISTS(SELECT 1 FROM identity_match WHERE id>(SELECT max(id::text)::uuid FROM page))
      THEN (SELECT max(id::text) FROM page) ELSE NULL END,
    'inventoryCount',(SELECT count(*) FROM public.prospect_research_candidates WHERE created_revision<=cutoff),
    'filteredCount',(SELECT count(*) FROM identity_match),
    'coverageRevision',cutoff,'readWarnings',warnings,'complete',warnings='[]'::jsonb
  ) INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION prospect_candidate_private.list_candidates_for_identity(jsonb,integer,uuid,bigint)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION prospect_candidate_private.list_candidates_for_identity(jsonb,integer,uuid,bigint)
  TO service_role;

CREATE OR REPLACE FUNCTION public.list_prospect_research_candidates_v1(
  p_filters jsonb DEFAULT '{}',p_limit integer DEFAULT 50,p_after_id uuid DEFAULT NULL,p_coverage_revision bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_filters ? 'identityNamespace' AND p_filters ? 'identityKey'
      AND (p_filters-ARRAY['identityNamespace','identityKey']::text[])='{}'::jsonb
      THEN prospect_candidate_private.list_candidates_for_identity(p_filters,p_limit,p_after_id,p_coverage_revision)
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
