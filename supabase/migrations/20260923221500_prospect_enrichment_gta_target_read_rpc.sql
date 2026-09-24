-- Exact, bounded target-row read bridge for hash verification. Direct service-role
-- SELECT on the governed GTA tables remains revoked.
CREATE OR REPLACE FUNCTION public.read_prospect_enrichment_gta_target_rows_v1(
  p_firm_id uuid, p_table text, p_ids uuid[]
)
RETURNS TABLE (row_json jsonb, row_sha256 text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_firm_table boolean;
BEGIN
  IF p_firm_id IS NULL OR p_table IS NULL OR p_ids IS NULL
    OR cardinality(p_ids) < 1 OR cardinality(p_ids) > 100
    OR (SELECT count(DISTINCT id) FROM unnest(p_ids) AS ids(id)) <> cardinality(p_ids) THEN
    RAISE EXCEPTION 'invalid bounded GTA target read input' USING ERRCODE = '22023';
  END IF;

  IF p_table = 'gta_prospect_firms' THEN
    v_firm_table := true;
  ELSIF p_table IN (
    'gta_prospect_stable_identity_registry', 'gta_prospect_import_audit',
    'gta_prospect_supplemental_evidence_import_audit', 'gta_prospect_shared_identity_observations',
    'gta_prospect_website_intake_observations', 'gta_prospect_qualification_assessments',
    'gta_prospect_roster_observations', 'gta_prospect_downtown_geography_observations',
    'gta_prospect_public_contact_observations'
  ) THEN
    v_firm_table := false;
  ELSE
    RAISE EXCEPTION 'GTA target table is not allowlisted' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT to_jsonb(t), public.prospect_enrichment_row_sha256_v1(to_jsonb(t)) FROM public.%I AS t WHERE %s AND t.id = ANY($2) ORDER BY t.id',
    p_table,
    CASE WHEN v_firm_table THEN 't.id = $1' ELSE 't.firm_id = $1' END
  ) USING p_firm_id, p_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.read_prospect_enrichment_gta_target_rows_v1(uuid,text,uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_prospect_enrichment_gta_target_rows_v1(uuid,text,uuid[]) TO service_role;

NOTIFY pgrst, 'reload schema';
