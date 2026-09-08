-- Correct the ISO date check in the already-applied GTA research canonicalizer.
-- The original pattern used a doubled backslash and matched a literal "\\d",
-- rejecting normal YYYY-MM-DD values.  This forward-only replacement preserves
-- the function's validation and canonicalization behaviour otherwise.
CREATE OR REPLACE FUNCTION public.gta_prospect_research_canonical(p_record jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_roster jsonb; v_reconciliation jsonb; v_evidence jsonb; v_item jsonb; v_date text;
BEGIN
  IF jsonb_typeof(p_record) <> 'object'
     OR NOT (p_record ?& ARRAY['sourceRecordKey','firmName','normalizedFirmName','city','practiceAreas','legacyCrosswalk','legacyClusterLawyerCount','websiteUrl','officeCities','roster','reconciliation','evidence'])
     OR p_record - ARRAY['sourceRecordKey','firmName','normalizedFirmName','city','practiceAreas','legacyCrosswalk','legacyClusterLawyerCount','websiteUrl','officeCities','roster','reconciliation','evidence'] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'canonical GTA record has unsupported fields';
  END IF;
  IF coalesce(p_record->>'sourceRecordKey','') !~ '^[a-z0-9][a-z0-9-]{1,159}$'
     OR char_length(btrim(coalesce(p_record->>'firmName',''))) NOT BETWEEN 1 AND 300
     OR char_length(btrim(coalesce(p_record->>'normalizedFirmName',''))) NOT BETWEEN 1 AND 300
     OR char_length(btrim(coalesce(p_record->>'city',''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'canonical GTA record has invalid identity fields';
  END IF;
  IF jsonb_typeof(p_record->'officeCities') <> 'array' OR jsonb_array_length(p_record->'officeCities') = 0
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_record->'officeCities') e WHERE jsonb_typeof(e) <> 'string' OR btrim(e #>> '{}') = '')
     OR jsonb_typeof(p_record->'practiceAreas') <> 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_record->'practiceAreas') e WHERE jsonb_typeof(e) <> 'string' OR btrim(e #>> '{}') = '') THEN
    RAISE EXCEPTION 'canonical GTA record has invalid office or practice-area values';
  END IF;
  IF jsonb_typeof(p_record->'websiteUrl') NOT IN ('string','null')
     OR (jsonb_typeof(p_record->'websiteUrl') = 'string' AND p_record->>'websiteUrl' !~ '^https?://')
     OR jsonb_typeof(p_record->'legacyCrosswalk') NOT IN ('string','null')
     OR jsonb_typeof(p_record->'legacyClusterLawyerCount') NOT IN ('number','null')
     OR (jsonb_typeof(p_record->'legacyClusterLawyerCount') = 'number' AND (p_record->>'legacyClusterLawyerCount' !~ '^[0-9]+$')) THEN
    RAISE EXCEPTION 'canonical GTA record has invalid optional scalar values';
  END IF;
  v_roster := p_record->'roster';
  IF jsonb_typeof(v_roster) <> 'object'
     OR NOT (v_roster ?& ARRAY['sourceUrl','observedOn','lawyerCount','qualifier','display'])
     OR v_roster - ARRAY['sourceUrl','observedOn','lawyerCount','qualifier','display'] <> '{}'::jsonb
     OR coalesce(v_roster->>'sourceUrl','') !~ '^https?://'
     OR jsonb_typeof(v_roster->'lawyerCount') NOT IN ('number','null')
     OR (jsonb_typeof(v_roster->'lawyerCount') = 'number' AND v_roster->>'lawyerCount' !~ '^[0-9]+$')
     OR jsonb_typeof(v_roster->'display') NOT IN ('string','null')
     OR coalesce(v_roster->>'qualifier','') NOT IN ('exact','at_least','unknown')
     OR (v_roster->>'qualifier' = 'unknown' AND jsonb_typeof(v_roster->'lawyerCount') <> 'null')
     OR (v_roster->>'qualifier' IN ('exact','at_least') AND jsonb_typeof(v_roster->'lawyerCount') <> 'number') THEN
    RAISE EXCEPTION 'canonical GTA record has invalid roster fields';
  END IF;
  v_date := v_roster->>'observedOn';
  IF v_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR to_char(to_date(v_date,'YYYY-MM-DD'),'YYYY-MM-DD') <> v_date THEN
    RAISE EXCEPTION 'canonical GTA record has invalid roster observation date';
  END IF;
  v_reconciliation := p_record->'reconciliation';
  IF jsonb_typeof(v_reconciliation) <> 'object'
     OR NOT (v_reconciliation ?& ARRAY['status','basis'])
     OR v_reconciliation - ARRAY['status','basis'] <> '{}'::jsonb
     OR coalesce(v_reconciliation->>'status','') NOT IN ('provisional_new','update_existing','new_pending_identity','duplicate','unresolved')
     OR char_length(btrim(coalesce(v_reconciliation->>'basis',''))) NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'canonical GTA record has invalid reconciliation fields';
  END IF;
  v_evidence := p_record->'evidence';
  IF jsonb_typeof(v_evidence) <> 'array' THEN RAISE EXCEPTION 'canonical GTA record has invalid evidence list'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_evidence) LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR NOT (v_item ?& ARRAY['type','sourceUrl','observedOn','value'])
       OR v_item - ARRAY['type','sourceUrl','observedOn','value'] <> '{}'::jsonb
       OR coalesce(v_item->>'type','') NOT IN ('roster','advertising','google_business_profile','website')
       OR coalesce(v_item->>'sourceUrl','') !~ '^https?://'
       OR v_item->>'observedOn' <> v_date
       OR jsonb_typeof(v_item->'value') NOT IN ('string','null')
       OR (v_item->>'type' = 'roster' AND coalesce(v_item->'value','null'::jsonb) <> coalesce(v_roster->'display','null'::jsonb))
       OR (v_item->>'type' = 'website' AND coalesce(v_item->'value','null'::jsonb) <> coalesce(v_item->'sourceUrl','null'::jsonb))
       OR (v_item->>'type' IN ('advertising','google_business_profile') AND jsonb_typeof(v_item->'value') <> 'null') THEN
      RAISE EXCEPTION 'canonical GTA record has invalid evidence fields';
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'sourceRecordKey',p_record->>'sourceRecordKey','firmName',p_record->>'firmName','normalizedFirmName',p_record->>'normalizedFirmName',
    'city',p_record->>'city','practiceAreas',p_record->'practiceAreas','legacyCrosswalk',p_record->'legacyCrosswalk',
    'legacyClusterLawyerCount',p_record->'legacyClusterLawyerCount','websiteUrl',p_record->'websiteUrl','officeCities',p_record->'officeCities',
    'roster',jsonb_build_object('sourceUrl',v_roster->>'sourceUrl','observedOn',v_date,'lawyerCount',v_roster->'lawyerCount','qualifier',v_roster->>'qualifier','display',v_roster->'display'),
    'reconciliation',jsonb_build_object('status',v_reconciliation->>'status','basis',v_reconciliation->>'basis'),'evidence',v_evidence
  );
END; $$;
