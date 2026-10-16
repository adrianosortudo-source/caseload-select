BEGIN;

-- Start exact typed-field queries from their indexed candidate set. The
-- previous generic reader resolved identity for the whole inventory before
-- it applied this selective predicate, which timed out for combined filters.
CREATE OR REPLACE FUNCTION prospect_candidate_private.list_candidates_for_indexed_field(
  p_filters jsonb,p_limit integer,p_after_id uuid,p_coverage_revision bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cutoff bigint; warnings jsonb; result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid candidate page size'; END IF;
  IF p_after_id IS NOT NULL AND p_coverage_revision IS NULL THEN RAISE EXCEPTION 'candidate cursor requires coverage revision'; END IF;
  PERFORM prospect_candidate_private.check_filters(p_filters);
  cutoff := prospect_candidate_private.cutoff(p_coverage_revision);
  warnings := prospect_candidate_private.coverage_warnings(cutoff);

  IF p_filters ? 'fieldRefRevision' AND NOT EXISTS (
    SELECT 1 FROM public.prospect_research_candidate_fields f
    WHERE f.revision_id=(p_filters->>'fieldRefRevision')::uuid
      AND f.pointer_sha256=p_filters->>'fieldRefPointerSha256'
      AND f.coverage_revision<=cutoff
  ) THEN RAISE EXCEPTION 'invalid candidate field reference'; END IF;

  -- A typed-field-only query has no group-wide predicate to evaluate. Count
  -- its indexed candidate set directly, then resolve full summaries only for
  -- the bounded page. The general path below still resolves identities before
  -- applying any additional firm, text, status, or date filters.
  IF (p_filters-ARRAY['fieldPointer','fieldValue','fieldRefRevision','fieldRefPointerSha256']::text[])='{}'::jsonb THEN
    WITH field_matches AS MATERIALIZED (
      SELECT DISTINCT f.candidate_id AS id
      FROM public.prospect_research_candidate_fields f
      JOIN public.prospect_research_candidates c ON c.id=f.candidate_id
      WHERE c.created_revision<=cutoff AND f.coverage_revision<=cutoff
        AND md5(f.pointer)=md5(p_filters->>'fieldPointer')
        AND f.pointer=p_filters->>'fieldPointer'
        AND (NOT p_filters ? 'fieldValue' OR
          (md5(f.value_json::text)=md5((p_filters->'fieldValue')::text)
            AND f.value_json=p_filters->'fieldValue'))
    ), page_ids AS MATERIALIZED (
      SELECT id FROM field_matches
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
      'items',coalesce((SELECT jsonb_agg(data ORDER BY id) FROM page),'[]'),
      'nextAfterId',CASE WHEN EXISTS(SELECT 1 FROM field_matches WHERE id>(SELECT max(id::text)::uuid FROM page))
        THEN (SELECT max(id::text) FROM page) ELSE NULL END,
      'inventoryCount',(SELECT count(*) FROM public.prospect_research_candidates WHERE created_revision<=cutoff),
      'filteredCount',(SELECT count(*) FROM field_matches),
      'coverageRevision',cutoff,'readWarnings',warnings,'complete',warnings='[]'::jsonb
    ) INTO result;
    RETURN result;
  END IF;

  WITH field_matches AS MATERIALIZED (
    SELECT DISTINCT f.candidate_id
    FROM public.prospect_research_candidate_fields f
    JOIN public.prospect_research_candidates c ON c.id=f.candidate_id
    WHERE p_filters ? 'fieldPointer' AND c.created_revision<=cutoff AND f.coverage_revision<=cutoff
      AND md5(f.pointer)=md5(p_filters->>'fieldPointer')
      AND f.pointer=p_filters->>'fieldPointer'
      AND (NOT p_filters ? 'fieldValue' OR
        (md5(f.value_json::text)=md5((p_filters->'fieldValue')::text)
          AND f.value_json=p_filters->'fieldValue'))
  ), anchor_identity_links AS MATERIALIZED (
    SELECT * FROM prospect_candidate_private.identity_links_for_candidates(
      cutoff,ARRAY(SELECT candidate_id FROM field_matches))
  ), anchor_identities AS MATERIALIZED (
    SELECT anchors.candidate_id,count(DISTINCT links.verified_firm_id) firm_count,
      min(links.verified_firm_id::text)::uuid firm_id
    FROM field_matches anchors
    LEFT JOIN anchor_identity_links links USING(candidate_id)
    GROUP BY anchors.candidate_id
  ), anchor_firms AS MATERIALIZED (
    SELECT DISTINCT firm_id FROM anchor_identities WHERE firm_count=1
  ), expanded_identity_links AS MATERIALIZED (
    SELECT DISTINCT links.candidate_id
    FROM prospect_candidate_private.identity_links_for_firms(cutoff,ARRAY(SELECT firm_id FROM anchor_firms)) links
  ), expanded_identity_details AS MATERIALIZED (
    SELECT * FROM prospect_candidate_private.identity_links_for_candidates(
      cutoff,ARRAY(SELECT candidate_id FROM expanded_identity_links))
  ), expanded_firms AS MATERIALIZED (
    SELECT candidates.candidate_id,count(DISTINCT links.verified_firm_id) firm_count,
      min(links.verified_firm_id::text)::uuid firm_id
    FROM expanded_identity_links candidates
    LEFT JOIN expanded_identity_details links USING(candidate_id)
    GROUP BY candidates.candidate_id
  ), candidate_scope AS MATERIALIZED (
    SELECT anchors.candidate_id,
      CASE WHEN anchors.firm_count=1 THEN 'firm:'||anchors.firm_id::text
        ELSE 'candidate:'||anchors.candidate_id::text END group_key,
      CASE WHEN anchors.firm_count=1 THEN anchors.firm_id ELSE NULL END verified_firm_id,
      c.identity_namespace,c.identity_key,
      CASE WHEN anchors.firm_count=1 THEN 'resolved' WHEN anchors.firm_count>1 THEN 'conflict' ELSE 'unresolved' END identity_state,
      CASE WHEN anchors.firm_count=1 THEN ARRAY(
        SELECT members.candidate_id FROM expanded_firms members
        WHERE members.firm_count=1 AND members.firm_id=anchors.firm_id ORDER BY members.candidate_id
      ) ELSE ARRAY[anchors.candidate_id] END group_ids
    FROM anchor_identities anchors
    JOIN public.prospect_research_candidates c ON c.id=anchors.candidate_id
  ), inventory AS MATERIALIZED (
    SELECT candidate_id AS id,
      jsonb_build_object('verifiedFirmId',verified_firm_id,'identityNamespace',identity_namespace,
        'identityKey',identity_key,'identityState',identity_state) AS data,
      group_ids
    FROM candidate_scope
  ), filtered AS MATERIALIZED (
    -- Typed field matches belong to their source candidate. The remaining
    -- filters retain the existing group-wide semantics for verified firms.
    SELECT i.id FROM inventory i
    WHERE prospect_candidate_private.matches_group(
      i.id,i.data,p_filters-'fieldPointer'-'fieldValue',cutoff,i.group_ids)
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

REVOKE ALL ON FUNCTION prospect_candidate_private.list_candidates_for_indexed_field(jsonb,integer,uuid,bigint)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION prospect_candidate_private.list_candidates_for_indexed_field(jsonb,integer,uuid,bigint)
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
