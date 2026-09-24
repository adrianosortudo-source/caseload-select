-- Narrow service-only read bridge for comparison export. Canonical GTA tables
-- deliberately have no direct service_role grants; return only identity fields.
CREATE OR REPLACE FUNCTION public.read_prospect_enrichment_firm_identities_v1(
  p_firm_ids uuid[], p_source_record_keys text[], p_stable_firm_ids text[]
)
RETURNS TABLE (firm_id uuid, source_record_key text, stable_firm_id text, canonical_domain text, enrichment_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(cardinality(p_firm_ids), 0) > 1000
    OR coalesce(cardinality(p_source_record_keys), 0) > 1000
    OR coalesce(cardinality(p_stable_firm_ids), 0) > 1000
    OR EXISTS (SELECT 1 FROM unnest(coalesce(p_source_record_keys, ARRAY[]::text[])) AS k(value)
      WHERE k.value IS NULL OR char_length(k.value) NOT BETWEEN 1 AND 160 OR k.value ~ '[[:cntrl:]]')
    OR EXISTS (SELECT 1 FROM unnest(coalesce(p_stable_firm_ids, ARRAY[]::text[])) AS k(value)
      WHERE k.value IS NULL OR k.value !~ '^FIRM-[0-9A-HJKMNP-TV-Z]{26}$')
    OR EXISTS (SELECT 1 FROM unnest(coalesce(p_firm_ids, ARRAY[]::uuid[])) AS k(value) WHERE k.value IS NULL) THEN
    RAISE EXCEPTION 'too many firm identity lookup keys';
  END IF;
  RETURN QUERY
  SELECT firm.id, firm.source_record_key, registry.stable_firm_id, registry.canonical_domain, firm.enrichment_revision
  FROM public.gta_prospect_firms AS firm
  LEFT JOIN public.gta_prospect_stable_identity_registry AS registry ON registry.firm_id = firm.id
  WHERE firm.id = ANY(coalesce(p_firm_ids, ARRAY[]::uuid[]))
     OR firm.source_record_key = ANY(coalesce(p_source_record_keys, ARRAY[]::text[]))
     OR registry.stable_firm_id = ANY(coalesce(p_stable_firm_ids, ARRAY[]::text[]))
  LIMIT 1001;
END;
$$;

REVOKE ALL ON FUNCTION public.read_prospect_enrichment_firm_identities_v1(uuid[],text[],text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_prospect_enrichment_firm_identities_v1(uuid[],text[],text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.lookup_prospect_enrichment_core_identity_conflicts_v1(
  p_normalized_display_name text, p_source_record_keys text[], p_domains text[]
)
RETURNS TABLE (match_kind text, match_value text, firm_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (p_normalized_display_name IS NOT NULL AND (char_length(p_normalized_display_name) NOT BETWEEN 1 AND 500
      OR p_normalized_display_name <> lower(p_normalized_display_name)
      OR p_normalized_display_name !~ '^[^[:space:]]+( [^[:space:]]+)*$'))
    OR coalesce(cardinality(p_source_record_keys), 0) > 1000
    OR coalesce(cardinality(p_domains), 0) > 100 THEN
    RAISE EXCEPTION 'core identity lookup exceeds its bounded input';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(coalesce(p_source_record_keys, ARRAY[]::text[])) AS k(value)
      WHERE k.value IS NULL OR char_length(k.value) NOT BETWEEN 1 AND 160 OR k.value ~ '[[:cntrl:]]')
    OR EXISTS (SELECT 1 FROM unnest(coalesce(p_domains, ARRAY[]::text[])) AS d(value)
      WHERE d.value IS NULL OR char_length(d.value) NOT BETWEEN 1 AND 253
        OR d.value <> lower(d.value) OR d.value ~ '[[:space:][:cntrl:]/?#@]'
        OR d.value LIKE '.%' OR d.value LIKE '%.' OR d.value LIKE '%..%' OR d.value LIKE 'www.%'
        OR d.value ~ '^[-:]' OR d.value ~ '[-:]$') THEN
    RAISE EXCEPTION 'core identity lookup key has invalid format or length';
  END IF;
  RETURN QUERY
  SELECT found.match_kind, found.match_value, found.firm_id FROM (
    SELECT 'name'::text AS match_kind, firm.normalized_display_name::text AS match_value, firm.id AS firm_id
      FROM public.gta_prospect_firms AS firm WHERE p_normalized_display_name IS NOT NULL AND firm.normalized_display_name = p_normalized_display_name
    UNION ALL
    SELECT 'source_key'::text, firm.source_record_key::text, firm.id
      FROM public.gta_prospect_firms AS firm WHERE firm.source_record_key = ANY(coalesce(p_source_record_keys, ARRAY[]::text[]))
    UNION ALL
    SELECT 'domain'::text, registry.canonical_domain::text, registry.firm_id
      FROM public.gta_prospect_stable_identity_registry AS registry WHERE registry.canonical_domain = ANY(coalesce(p_domains, ARRAY[]::text[]))
    UNION ALL
    SELECT 'domain'::text, domain.normalized_domain_value::text, domain.firm_id
      FROM public.gta_prospect_domains AS domain WHERE domain.normalized_domain_value = ANY(coalesce(p_domains, ARRAY[]::text[]))
  ) AS found
  ORDER BY found.match_kind, found.match_value
  LIMIT 1001;
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_prospect_enrichment_core_identity_conflicts_v1(text,text[],text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lookup_prospect_enrichment_core_identity_conflicts_v1(text,text[],text[]) TO service_role;

NOTIFY pgrst, 'reload schema';
