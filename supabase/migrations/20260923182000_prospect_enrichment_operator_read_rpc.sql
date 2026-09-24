-- Fixed, server-only read projection for firm research detail. The service role
-- deliberately has no direct SELECT privilege on the protected GTA ledger.
CREATE OR REPLACE FUNCTION public.read_prospect_enrichment_gta_evidence_v1(
  p_firm_id uuid,
  p_table text,
  p_row_id uuid DEFAULT NULL,
  p_ids uuid[] DEFAULT NULL,
  p_after_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_columns text;
  v_where text;
  v_table_class text;
  v_item jsonb;
BEGIN
  IF p_firm_id IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 501
     OR coalesce(cardinality(p_ids), 0) > 501 THEN
    RAISE EXCEPTION 'invalid protected prospect evidence read bounds' USING ERRCODE = '22023';
  END IF;

  CASE p_table
    WHEN 'gta_prospect_firms' THEN
      v_columns := 'id,display_name,website_url,source_record_key,enrichment_revision';
      v_table_class := 'firm';
    WHEN 'gta_prospect_stable_identity_registry' THEN
      v_columns := 'id,firm_id,stable_firm_id,canonical_domain,source_url,observed_on,confidence,adjudication_basis';
      v_table_class := 'firm_rows';
    WHEN 'gta_prospect_aliases' THEN
      v_columns := 'id,firm_id,alias_kind,alias_value,normalized_alias_value,source_type,source_url,observed_on';
      v_table_class := 'firm_rows';
    WHEN 'gta_prospect_domains' THEN
      v_columns := 'id,firm_id,domain_value,normalized_domain_value,source_type,source_url,observed_on';
      v_table_class := 'firm_rows';
    WHEN 'gta_prospect_offices' THEN
      v_columns := 'id,firm_id,city,province,address_raw,street_normalized,suite_raw,source_type,source_url,observed_on';
      v_table_class := 'firm_rows';
    WHEN 'gta_prospect_roster_observations' THEN
      v_columns := 'id,firm_id,import_batch_id,source_type,source_url,observed_on,observed_lawyer_count,count_qualifier,count_display,canonical_observation';
      v_table_class := 'firm_rows';
    WHEN 'gta_prospect_public_contact_observations' THEN
      v_columns := 'id,firm_id,import_batch_id,contact_name,relationship,public_email,email_kind,source_url,observed_on';
      v_table_class := 'firm_rows';
    WHEN 'gta_prospect_evidence_links' THEN
      v_columns := 'id,firm_id,import_batch_id,evidence_type,source_type,source_url,observed_on,raw_value';
      v_table_class := 'firm_rows';
    WHEN 'gta_prospect_import_audit' THEN
      v_columns := 'id,firm_id,import_batch_id,source_record_key,source_record_sha256,validation_state,action_state,validation_errors,canonical_record,created_at';
      v_table_class := 'firm_rows';
    WHEN 'gta_prospect_shared_identity_observations' THEN
      v_columns := 'id,firm_id,evidence_import_batch_id,mapping_id,match_state,stable_firm_id,canonical_domain,observed_on,confidence,evidence_urls,note,raw_observation';
      v_table_class := 'firm_rows';
    WHEN 'gta_prospect_downtown_geography_observations' THEN
      v_columns := 'id,firm_id,evidence_import_batch_id,boundary_id,geography_status,normalized_address,latitude,longitude,coordinate_source_type,coordinate_source_url,boundary_source_url,boundary_geometry_sha256,observed_on,confidence,note';
      v_table_class := 'firm_rows';
    WHEN 'gta_prospect_website_intake_observations' THEN
      v_columns := 'id,firm_id,evidence_import_batch_id,finding_id,source_url,observed_on,intake_channels,opportunity_state,opportunity_note,evidence_urls,raw_observation';
      v_table_class := 'firm_rows';
    WHEN 'gta_prospect_qualification_assessments' THEN
      v_columns := 'id,firm_id,evidence_import_batch_id,assessment_id,qualification_state,qualification_cohort,assessed_on,criteria,evidence_urls,note,raw_assessment';
      v_table_class := 'firm_rows';
    WHEN 'gta_prospect_supplemental_evidence_import_audit' THEN
      v_columns := 'id,firm_id,evidence_import_batch_id,source_record_key,source_record_sha256,validation_state,canonical_record,created_at';
      v_table_class := 'firm_rows';
    WHEN 'gta_prospect_import_batches' THEN
      v_columns := 'id,state';
      v_table_class := 'core_batch';
    WHEN 'gta_prospect_supplemental_evidence_import_batches' THEN
      v_columns := 'id,state';
      v_table_class := 'supplemental_batch';
    ELSE
      RAISE EXCEPTION 'protected prospect evidence table is not allowlisted' USING ERRCODE = '22023';
  END CASE;

  IF v_table_class = 'firm' THEN
    IF p_row_id IS NOT NULL OR p_ids IS NOT NULL THEN
      RAISE EXCEPTION 'firm lookup is keyed only by p_firm_id' USING ERRCODE = '22023';
    END IF;
    v_where := 't.id = $1';
  ELSIF v_table_class IN ('core_batch', 'supplemental_batch') THEN
    IF p_row_id IS NOT NULL OR p_ids IS NULL THEN
      RAISE EXCEPTION 'import batch lookup requires an explicit batch ID list' USING ERRCODE = '22023';
    END IF;
    IF v_table_class = 'core_batch' THEN
      v_where := 't.id = ANY($3) AND EXISTS (SELECT 1 FROM public.gta_prospect_import_audit AS audit WHERE audit.import_batch_id = t.id AND audit.firm_id = $1)';
    ELSE
      v_where := 't.id = ANY($3) AND EXISTS (SELECT 1 FROM public.gta_prospect_supplemental_evidence_import_audit AS audit WHERE audit.evidence_import_batch_id = t.id AND audit.firm_id = $1)';
    END IF;
  ELSE
    v_where := 't.firm_id = $1 AND ($2 IS NULL OR t.id = $2) AND ($3 IS NULL OR t.id = ANY($3)) AND ($4 IS NULL OR t.id > $4)';
  END IF;

  FOR v_item IN EXECUTE format(
    'SELECT to_jsonb(read_row) FROM (SELECT %s FROM public.%I AS t WHERE %s ORDER BY t.id LIMIT $5) AS read_row',
    v_columns, p_table, v_where
  ) USING p_firm_id, p_row_id, p_ids, p_after_id, p_limit
  LOOP
    RETURN NEXT v_item;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.read_prospect_enrichment_gta_evidence_v1(uuid,text,uuid,uuid[],uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_prospect_enrichment_gta_evidence_v1(uuid,text,uuid,uuid[],uuid,integer) TO service_role;

NOTIFY pgrst, 'reload schema';
