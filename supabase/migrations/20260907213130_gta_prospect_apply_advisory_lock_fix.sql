-- Correct the two forward-only import-state defects discovered while applying
-- the GTA public-research import. This migration preserves the existing RPC
-- signatures, SECURITY DEFINER configuration, search path, and data writes.

CREATE OR REPLACE FUNCTION public.apply_gta_prospect_research_record(p_batch_id uuid, p_record jsonb, p_record_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f uuid; r record; ev record; existing uuid; existing_hash text; canonical jsonb; computed_hash text; batch public.gta_prospect_import_batches%ROWTYPE;
BEGIN
  SELECT * INTO batch FROM public.gta_prospect_import_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND OR batch.state <> 'staged' THEN RAISE EXCEPTION 'batch is not staged for record application'; END IF;
  canonical := public.gta_prospect_research_canonical(p_record);
  computed_hash := encode(extensions.digest(convert_to(canonical::text,'utf8'),'sha256'),'hex');
  IF p_record_sha256 <> computed_hash THEN RAISE EXCEPTION 'record hash does not match canonical record'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended((p_batch_id::text || (canonical->>'sourceRecordKey')), 0));
  SELECT firm_id, source_record_sha256 INTO existing, existing_hash FROM public.gta_prospect_import_audit WHERE import_batch_id=p_batch_id AND source_record_key=canonical->>'sourceRecordKey';
  IF existing IS NOT NULL THEN
    IF existing_hash <> computed_hash THEN RAISE EXCEPTION 'record hash differs for existing batch/source key; start a new batch'; END IF;
    RETURN jsonb_build_object('state','already_applied','firm_id',existing);
  END IF;
  SELECT * INTO r FROM jsonb_to_record(canonical) AS x(sourceRecordKey text, firmName text, normalizedFirmName text, city text, practiceAreas jsonb, legacyCrosswalk jsonb, legacyClusterLawyerCount jsonb, websiteUrl text, officeCities jsonb, roster jsonb, reconciliation jsonb, evidence jsonb);
  INSERT INTO public.gta_prospect_firms(source_record_key,display_name,normalized_display_name,website_url,reconciliation_status) VALUES(r.sourceRecordKey,r.firmName,r.normalizedFirmName,r.websiteUrl,r.reconciliation->>'status') ON CONFLICT(source_record_key) DO NOTHING RETURNING id INTO f;
  IF f IS NULL THEN SELECT id INTO f FROM public.gta_prospect_firms WHERE source_record_key=r.sourceRecordKey; END IF;
  INSERT INTO public.gta_prospect_aliases(firm_id,alias_kind,alias_value,normalized_alias_value,source_type,source_url,observed_on) VALUES
    (f,'brand_name',r.firmName,r.normalizedFirmName,'import_source',r.roster->>'sourceUrl',(r.roster->>'observedOn')::date),
    (f,'source_identifier',r.sourceRecordKey,r.sourceRecordKey,'import_source',r.roster->>'sourceUrl',(r.roster->>'observedOn')::date) ON CONFLICT DO NOTHING;
  INSERT INTO public.gta_prospect_offices(firm_id,city,province,source_type,source_url,observed_on)
    SELECT f,value,'ON','import_source',r.roster->>'sourceUrl',(r.roster->>'observedOn')::date FROM jsonb_array_elements_text(r.officeCities) ON CONFLICT DO NOTHING;
  IF r.websiteUrl IS NOT NULL THEN
    INSERT INTO public.gta_prospect_domains(firm_id,domain_value,normalized_domain_value,source_type,source_url,observed_on)
      VALUES(f,lower(split_part(regexp_replace(r.websiteUrl,'^https?://','','i'), '/', 1)),lower(split_part(regexp_replace(r.websiteUrl,'^https?://','','i'), '/', 1)),'import_source',r.websiteUrl,(r.roster->>'observedOn')::date) ON CONFLICT DO NOTHING;
  END IF;
  FOR ev IN SELECT value FROM jsonb_array_elements(r.evidence) LOOP
    INSERT INTO public.gta_prospect_evidence_links(firm_id,import_batch_id,evidence_type,source_type,source_url,observed_on,raw_value) VALUES(f,p_batch_id,ev.value->>'type','import_source',ev.value->>'sourceUrl',(ev.value->>'observedOn')::date,ev.value->>'value') ON CONFLICT DO NOTHING;
  END LOOP;
  INSERT INTO public.gta_prospect_roster_observations(firm_id,import_batch_id,source_type,source_url,observed_on,observed_lawyer_count,count_qualifier,count_display,canonical_observation) VALUES(f,p_batch_id,'import_source',r.roster->>'sourceUrl',(r.roster->>'observedOn')::date,NULLIF(r.roster->>'lawyerCount','')::integer,r.roster->>'qualifier',r.roster->>'display',jsonb_build_object('roster',r.roster));
  INSERT INTO public.gta_prospect_identity_adjudications(firm_id,import_batch_id,decision,review_method,adjudication_basis,source_type,source_url,observed_on) VALUES(f,p_batch_id,r.reconciliation->>'status','manual_review',r.reconciliation->>'basis','import_source',r.roster->>'sourceUrl',(r.roster->>'observedOn')::date);
  INSERT INTO public.gta_prospect_import_audit(import_batch_id,source_record_key,source_record_sha256,validation_state,action_state,firm_id,validation_errors,canonical_record) VALUES(p_batch_id,r.sourceRecordKey,computed_hash,'accepted','created',f,'[]',canonical);
  RETURN jsonb_build_object('state','applied','firm_id',f);
END; $$;

CREATE OR REPLACE FUNCTION public.begin_gta_prospect_import_batch(p_source_name text,p_source_sha256 text,p_source_record_count integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE b public.gta_prospect_import_batches%ROWTYPE; BEGIN
  IF p_source_name !~ '^[-_a-z0-9]{1,200}$' OR p_source_sha256 !~ '^[0-9a-f]{64}$' OR p_source_record_count < 0 THEN RAISE EXCEPTION 'invalid batch arguments'; END IF;
  INSERT INTO public.gta_prospect_import_batches(source_name,source_sha256,source_record_count)
    VALUES(p_source_name,p_source_sha256,p_source_record_count)
    ON CONFLICT(source_name,source_sha256) DO NOTHING
    RETURNING * INTO b;
  IF FOUND THEN RETURN b.id; END IF;
  SELECT * INTO b FROM public.gta_prospect_import_batches WHERE source_name=p_source_name AND source_sha256=p_source_sha256 FOR UPDATE;
  IF b.state='applied' THEN RAISE EXCEPTION 'applied batch is terminal'; END IF;
  IF b.state='staged' THEN RAISE EXCEPTION 'batch is already staged'; END IF;
  UPDATE public.gta_prospect_import_batches SET state='staged', applied_at=NULL WHERE id=b.id; RETURN b.id;
END; $$;
