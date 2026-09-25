-- Additive universal research coverage and proven-firm aggregation.
-- Existing source rows, prior migrations, intake and production allowlist remain unchanged.
BEGIN;

CREATE INDEX prospect_candidate_identity_cutoff ON public.prospect_research_candidate_history(candidate_id,coverage_revision,verified_firm_id) WHERE item_kind='identity_link';
CREATE INDEX prospect_candidate_source_latest ON public.prospect_research_candidate_coverage(source_table,source_key,revision DESC);
CREATE INDEX gta_prospect_import_audit_firm_id_idx ON public.gta_prospect_import_audit(firm_id,id);

CREATE FUNCTION prospect_candidate_private.legacy_inventory()
RETURNS TABLE(table_name text,link_kind text,column_names text[],excluded_columns text[])
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT name,kind,string_to_array(columns,','),string_to_array(excluded,',') FROM (VALUES
 ('gta_prospect_firms','firm','id,source_record_key,display_name,normalized_display_name,website_url,reconciliation_status,created_at','enrichment_revision'),
 ('gta_prospect_import_batches','batch_core','id,source_name,source_sha256,source_record_count,state,applied_at,created_at','initiated_by_lawyer_id'),
 ('gta_prospect_supplemental_evidence_import_batches','batch_supplemental','id,package_id,package_sha256,source_record_count,state,applied_at,created_at',''),
 ('gta_prospect_shared_identity_observations','supplemental','id,firm_id,evidence_import_batch_id,mapping_id,match_state,stable_firm_id,canonical_domain,observed_on,confidence,evidence_urls,note,raw_observation,created_at',''),
 ('gta_prospect_downtown_geography_observations','supplemental_optional','id,firm_id,evidence_import_batch_id,boundary_id,geography_status,normalized_address,latitude,longitude,coordinate_source_type,coordinate_source_url,boundary_source_url,boundary_geometry_sha256,observed_on,confidence,note,created_at',''),
 ('gta_prospect_stable_identity_registry','fk','id,firm_id,stable_firm_id,canonical_domain,source_url,observed_on,confidence,adjudication_basis,created_at',''),
 ('gta_prospect_aliases','fk','id,firm_id,alias_kind,alias_value,normalized_alias_value,source_type,source_url,observed_on,created_at',''),
 ('gta_prospect_domains','fk','id,firm_id,domain_value,normalized_domain_value,source_type,source_url,observed_on,created_at',''),
 ('gta_prospect_offices','fk','id,firm_id,city,province,address_raw,street_normalized,suite_raw,source_type,source_url,observed_on,created_at',''),
 ('gta_prospect_roster_observations','core_optional','id,firm_id,import_batch_id,source_type,source_url,observed_on,observed_lawyer_count,count_qualifier,count_display,canonical_observation,created_at',''),
 ('gta_prospect_public_contact_observations','core_optional','id,firm_id,import_batch_id,contact_name,relationship,public_email,email_kind,source_url,observed_on,created_at',''),
 ('gta_prospect_evidence_links','core_optional','id,firm_id,import_batch_id,evidence_type,source_type,source_url,observed_on,raw_value,created_at',''),
 ('gta_prospect_website_intake_observations','supplemental','id,firm_id,evidence_import_batch_id,finding_id,source_url,observed_on,intake_channels,opportunity_state,opportunity_note,evidence_urls,raw_observation,created_at',''),
 ('gta_prospect_qualification_assessments','supplemental','id,firm_id,evidence_import_batch_id,assessment_id,qualification_state,qualification_cohort,assessed_on,criteria,evidence_urls,note,raw_assessment,created_at',''),
 ('gta_prospect_import_audit','core_audit','id,firm_id,import_batch_id,source_record_key,source_record_sha256,validation_state,action_state,validation_errors,canonical_record,created_at',''),
 ('gta_prospect_supplemental_evidence_import_audit','supplemental','id,firm_id,evidence_import_batch_id,source_record_key,source_record_sha256,validation_state,canonical_record,created_at',''),
 ('gta_prospect_identity_adjudications','core_optional','id,firm_id,import_batch_id,decision,review_method,adjudication_basis,source_type,source_url,observed_on,created_at','reviewed_by_lawyer_id'),
 ('prospect_source_record_map','mapping','id,firm_id,source_system,source_record_id,mapping_status,identity_decision_id,evidence_ids,reviewed_at,created_at','reviewed_by'),
 ('prospect_firm_fit_observations','fk','id,firm_id,target_practice_areas,office_geography,lawyer_count,size_band,independence_status,fit_status,source_url,evidence_ids,observed_at,source_observed_on,source_observed_precision,created_at',''),
 ('prospect_service_observations','fk','id,firm_id,service_name,matter_fit,source_url,evidence_ids,observed_at,source_observed_on,source_observed_precision,created_at',''),
 ('prospect_decision_maker_contacts','fk','id,firm_id,person_name,role_label,role_verification,contact_type,contact_value,contact_quality,source_url,deliverability_state,observed_at,source_observed_on,source_observed_precision,created_at',''),
 ('prospect_source_captures','fk','id,firm_id,requested_url,final_url,publisher,retrieval_method,http_status,sha256,retained_artifact,policy_state,observed_at,source_observed_on,source_observed_precision,created_at',''),
 ('prospect_advertising_observations','fk','id,firm_id,canonical_domain,evidence_type,vendor,signal_type,signal_id,advertiser_identity,advertised_service,destination_url,effective_date,last_shown_date,recency_basis,source_url,capture_id,identity_state,reviewed,attributable,observed_at,source_observed_on,source_observed_precision,created_at',''),
 ('prospect_research_attempts','fk','id,firm_id,provider,query_or_url,outcome,coverage,failure_reason,evidence_ids,observed_at,source_observed_on,source_observed_precision,created_at',''),
 ('prospect_opportunity_observations','fk','id,firm_id,opportunity_type,finding,recommendation_hypothesis,source_url,evidence_ids,confidence,observed_at,source_observed_on,source_observed_precision,created_at',''),
 ('prospect_qualification_decisions','fk','id,firm_id,run_id,cohort_id,rule_version,advertising_status,advertising_status_state,fit_decision,commercial_relevance,decision_maker_access,opportunity_decision,selection_disposition,evidence_ids,rationale,decided_at,source_observed_on,source_observed_precision',''),
 ('prospect_lso_licensees','unlinked','id,source_system,regulator_licensee_id,display_name,status,source_snapshot_id,observed_at,created_at',''),
 ('prospect_firm_affiliations','affiliation','id,licensee_id,firm_id,office_label,role_label,mapping_status,evidence_ids,observed_at,created_at',''),
 ('gta_prospect_research_work_items','queue','id,source_system,source_payload_sha256,source_record_key,candidate_name,canonical_domain,candidate_address,source_urls,candidate_snapshot,candidate_snapshot_sha256,state,resolution,canonical_firm_id,created_at,updated_at','priority,lease_owner,lease_expires_at,attempt_count,next_attempt_at,last_error'),
 ('gta_prospect_research_work_attempts','attempt','id,work_item_id,attempt_number,event_type,note,created_at','worker_id'),
 ('gta_prospect_worker_evidence_drafts','worker','id,work_item_id,observation_sha256,observed_on,candidate_canonical_domain,identity_state,qualification_state,hold_states,source_artifacts,canonical_observation,created_at','worker_id'),
 ('gta_prospect_worker_evidence_reconciliations','reconciliation','id,draft_id,reconciliation_state,firm_id,stable_firm_id,hold_state,reconciliation_note,created_at',''),
 ('gta_prospect_agent_import_drafts','agent','id,source_name,idempotency_key,payload_sha256,review_sha256,import_source_sha256,record_count,records,review_records,review_summary,state,apply_receipts,created_at,updated_at,applied_at','submitted_by')
 ) inventory(name,kind,columns,excluded)
$$;

-- Future columns are not exposed automatically. Coverage reports their omission.
CREATE FUNCTION prospect_candidate_private.legacy_research_row(p_table text,p_row jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT coalesce(jsonb_object_agg(e.key,e.value),'{}') FROM jsonb_each(p_row) e
 JOIN prospect_candidate_private.legacy_inventory() i ON i.table_name=p_table AND e.key=ANY(i.column_names)
$$;

CREATE FUNCTION prospect_candidate_private.legacy_candidate(p_table text,p_key text,p_coverage bigint)
RETURNS uuid LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE ns text:='legacy:'||p_table; ns_hash text; key_hash text; result uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM prospect_candidate_private.legacy_inventory() WHERE table_name=p_table) OR p_key IS NULL THEN
   RAISE EXCEPTION 'unsupported legacy candidate source'; END IF;
 ns_hash:=encode(extensions.digest(convert_to(ns,'UTF8'),'sha256'),'hex');
 key_hash:=encode(extensions.digest(convert_to(p_key,'UTF8'),'sha256'),'hex');
 INSERT INTO public.prospect_research_candidates(identity_namespace,identity_key,identity_namespace_sha256,identity_key_sha256,created_revision)
 VALUES(ns,p_key,ns_hash,key_hash,p_coverage) ON CONFLICT(identity_namespace_sha256,identity_key_sha256) DO NOTHING;
 SELECT id INTO result FROM public.prospect_research_candidates WHERE identity_namespace_sha256=ns_hash AND identity_key_sha256=key_hash
 AND identity_namespace=ns AND identity_key=p_key;
 IF result IS NULL THEN RAISE EXCEPTION 'candidate identity digest collision'; END IF;
 RETURN result;
END $$;

-- Consecutive snapshot deduplication preserves transitions A -> B -> A. The
-- original v1 global hash replay rule is kept for immutable enrichment sources.
CREATE FUNCTION prospect_candidate_private.legacy_journal(p_table text,p_key text,p_row jsonb)
RETURNS bigint LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE prior public.prospect_research_candidate_coverage%ROWTYPE; snapshot jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(20260924,314);
 SELECT * INTO prior FROM public.prospect_research_candidate_coverage WHERE source_table=p_table AND source_key=p_key ORDER BY revision DESC LIMIT 1;
 IF FOUND AND prior.snapshot->'row'=p_row THEN RETURN prior.revision; END IF;
 snapshot:=jsonb_build_object('row',p_row,'sourceRowSha256',prospect_candidate_private.hash_json(p_row),'previousRevision',prior.revision);
 RETURN prospect_candidate_private.journal(p_table,p_key,prospect_candidate_private.hash_json(snapshot),snapshot);
END $$;

-- A firm FK establishes identity only when the canonical firm itself has governed
-- applied provenance. No name, domain, nested UUID claim or portable label is used.
CREATE FUNCTION prospect_candidate_private.governed_firm(p_firm uuid)
RETURNS boolean LANGUAGE sql VOLATILE SET search_path = '' AS $$
 SELECT p_firm IS NOT NULL AND EXISTS(SELECT 1 FROM public.gta_prospect_firms WHERE id=p_firm) AND (
 EXISTS(SELECT 1 FROM public.gta_prospect_import_audit a JOIN public.gta_prospect_import_batches b ON b.id=a.import_batch_id
   WHERE a.firm_id=p_firm AND a.validation_state='accepted' AND a.action_state IN ('created','already_present') AND b.state='applied')
 OR EXISTS(SELECT 1 FROM public.prospect_research_candidate_history h WHERE h.item_kind='identity_link'
   AND h.source_table='verified_identity' AND h.verified_firm_id=p_firm))
$$;

CREATE FUNCTION prospect_candidate_private.legacy_verified_firm(p_table text,p_row jsonb)
RETURNS uuid LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE kind text; firm uuid; parent jsonb; n integer;
BEGIN
 SELECT link_kind INTO kind FROM prospect_candidate_private.legacy_inventory() WHERE table_name=p_table;
 IF kind IN ('batch_core','batch_supplemental','agent','unlinked') THEN RETURN NULL; END IF;
 IF kind='firm' THEN firm:=(p_row->>'id')::uuid;
 ELSIF kind IN ('queue','attempt') THEN
   IF kind='attempt' THEN SELECT to_jsonb(w) INTO parent FROM public.gta_prospect_research_work_items w WHERE id=(p_row->>'work_item_id')::uuid;
   ELSE parent:=p_row; END IF;
   IF parent->>'state' IS DISTINCT FROM 'resolved' OR coalesce(parent->>'resolution','') NOT IN ('imported','already_present') THEN RETURN NULL; END IF;
   firm:=(parent->>'canonical_firm_id')::uuid;
 ELSIF kind IN ('worker','reconciliation') THEN
   IF (SELECT r.reconciliation_state FROM public.gta_prospect_worker_evidence_reconciliations r
     WHERE r.draft_id=(CASE WHEN kind='worker' THEN p_row->>'id' ELSE p_row->>'draft_id' END)::uuid ORDER BY r.created_at DESC,r.id DESC LIMIT 1) IS DISTINCT FROM 'linked' THEN RETURN NULL; END IF;
   SELECT count(DISTINCT r.firm_id),min(r.firm_id::text)::uuid INTO n,firm
   FROM public.gta_prospect_worker_evidence_reconciliations r
   JOIN public.gta_prospect_stable_identity_registry s ON s.firm_id=r.firm_id AND s.stable_firm_id=r.stable_firm_id
   JOIN public.gta_prospect_worker_evidence_drafts d ON d.id=r.draft_id AND d.identity_state='confirmed' AND d.candidate_canonical_domain=s.canonical_domain
   WHERE r.draft_id=(CASE WHEN kind='worker' THEN p_row->>'id' ELSE p_row->>'draft_id' END)::uuid AND r.reconciliation_state='linked';
   IF n<>1 THEN RETURN NULL; END IF;
 ELSE firm:=(p_row->>'firm_id')::uuid; END IF;
 IF NOT prospect_candidate_private.governed_firm(firm) THEN RETURN NULL; END IF;
 IF kind IN ('mapping','affiliation') AND p_row->>'mapping_status' IS DISTINCT FROM 'confirmed' THEN RETURN NULL; END IF;
 IF kind='mapping' AND (p_row->>'identity_decision_id' IS NULL OR p_row->>'reviewed_at' IS NULL) THEN RETURN NULL; END IF;
 IF kind='core_audit' AND (p_row->>'validation_state' IS DISTINCT FROM 'accepted' OR coalesce(p_row->>'action_state','') NOT IN ('created','already_present')) THEN RETURN NULL; END IF;
 IF kind IN ('core_optional','core_audit') AND p_row->>'import_batch_id' IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public.gta_prospect_import_batches b WHERE b.id=(p_row->>'import_batch_id')::uuid AND b.state='applied') THEN RETURN NULL; END IF;
 IF kind IN ('supplemental','supplemental_optional') AND p_row->>'evidence_import_batch_id' IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public.gta_prospect_supplemental_evidence_import_batches b WHERE b.id=(p_row->>'evidence_import_batch_id')::uuid AND b.state='applied') THEN RETURN NULL; END IF;
 RETURN firm;
END $$;

CREATE FUNCTION prospect_candidate_private.legacy_dependencies(p_table text,p_row jsonb,p_firm uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SET search_path = '' AS $$
 WITH authority AS (SELECT a.* FROM public.gta_prospect_import_audit a JOIN public.gta_prospect_import_batches b ON b.id=a.import_batch_id
   WHERE a.firm_id=p_firm AND a.validation_state='accepted' AND a.action_state IN ('created','already_present') AND b.state='applied' ORDER BY a.id LIMIT 1),
 dependencies AS (
   SELECT 'gta_prospect_import_audit' table_name,a.id::text row_key,to_jsonb(a) row_value FROM authority a
   UNION ALL SELECT 'gta_prospect_import_batches',b.id::text,to_jsonb(b) FROM public.gta_prospect_import_batches b WHERE b.id IN(SELECT import_batch_id FROM authority) OR b.id::text=p_row->>'import_batch_id'
   UNION ALL SELECT 'gta_prospect_supplemental_evidence_import_batches',b.id::text,to_jsonb(b) FROM public.gta_prospect_supplemental_evidence_import_batches b WHERE b.id::text=p_row->>'evidence_import_batch_id'
   UNION ALL SELECT 'gta_prospect_research_work_items',w.id::text,to_jsonb(w) FROM public.gta_prospect_research_work_items w WHERE p_table='gta_prospect_research_work_attempts' AND w.id::text=p_row->>'work_item_id'
   UNION ALL SELECT 'prospect_lso_licensees',l.id::text,to_jsonb(l) FROM public.prospect_lso_licensees l WHERE p_table='prospect_firm_affiliations' AND l.id::text=p_row->>'licensee_id'
   UNION ALL SELECT 'gta_prospect_worker_evidence_reconciliations',r.id::text,to_jsonb(r) FROM public.gta_prospect_worker_evidence_reconciliations r
     WHERE p_table IN ('gta_prospect_worker_evidence_drafts','gta_prospect_worker_evidence_reconciliations') AND r.draft_id::text=CASE WHEN p_table='gta_prospect_worker_evidence_drafts' THEN p_row->>'id' ELSE p_row->>'draft_id' END
   UNION ALL SELECT 'gta_prospect_stable_identity_registry',s.id::text,to_jsonb(s) FROM public.gta_prospect_stable_identity_registry s
     WHERE p_table IN ('gta_prospect_worker_evidence_drafts','gta_prospect_worker_evidence_reconciliations') AND s.firm_id=p_firm
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('table',table_name,'key',row_key,'rowSha256',prospect_candidate_private.hash_json(prospect_candidate_private.legacy_research_row(table_name,row_value))) ORDER BY table_name,row_key),'[]') FROM dependencies
$$;

CREATE FUNCTION prospect_candidate_private.project_legacy(p_table text,p_input jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE row_value jsonb; row_hash text; source_key text; coverage bigint; candidate uuid; firm uuid; kind text;
 raw_value jsonb; meta jsonb; warnings jsonb; entry record; batch_value jsonb; proof jsonb; proof_hash text; c bigint; status_key text; licensee_value jsonb;
BEGIN
 SELECT link_kind INTO kind FROM prospect_candidate_private.legacy_inventory() WHERE table_name=p_table;
 IF kind IS NULL THEN RAISE EXCEPTION 'unsupported legacy projection table'; END IF;
 row_value:=prospect_candidate_private.legacy_research_row(p_table,p_input);
 source_key:=row_value->>'id'; IF source_key IS NULL THEN RAISE EXCEPTION 'legacy source ID missing'; END IF;
 row_hash:=prospect_candidate_private.hash_json(row_value);
 coverage:=prospect_candidate_private.legacy_journal(p_table,source_key,row_value);
 IF kind IN ('batch_core','batch_supplemental') THEN RETURN; END IF;
 firm:=prospect_candidate_private.legacy_verified_firm(p_table,row_value);
 FOR entry IN
   SELECT value research,(ordinality-1)::text ordinal,'records' section FROM jsonb_array_elements(CASE WHEN kind='agent' THEN row_value->'records' ELSE jsonb_build_array(row_value) END) WITH ORDINALITY
   UNION ALL
   SELECT review.value,(review.ordinality-1)::text,'review_records' FROM jsonb_array_elements(CASE WHEN kind='agent' THEN row_value->'review_records' ELSE '[]' END) WITH ORDINALITY review
   WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(row_value->'records') record WHERE record->>'sourceRecordKey'=review.value->>'sourceRecordKey')
 LOOP
   candidate:=prospect_candidate_private.legacy_candidate(p_table,source_key||CASE WHEN kind='agent' THEN '/'||entry.section||'/'||entry.ordinal ELSE '' END,coverage);
   raw_value:=CASE WHEN kind='agent' THEN jsonb_build_object('record',entry.research,'envelope',row_value-ARRAY['records','review_records'],'sourcePointer','/'||entry.section||'/'||entry.ordinal,
     'reviewRecords',coalesce((SELECT jsonb_agg(review) FROM jsonb_array_elements(row_value->'review_records') review WHERE review->>'sourceRecordKey'=entry.research->>'sourceRecordKey'),'[]')) ELSE row_value END;
   warnings:='[]'::jsonb;
   IF kind IN ('agent','worker') THEN warnings:=warnings||'["draft_research_requires_operator_review"]'::jsonb; END IF;
   IF entry.section='review_records' THEN warnings:=warnings||'["draft_review_without_source_record"]'::jsonb; END IF;
   meta:=jsonb_build_object('sourceRoot','governed_database','relativePath',p_table,'sourcePointer',CASE WHEN kind='agent' THEN '/'||entry.section||'/'||entry.ordinal ELSE '' END,
     'sourceFileSha256',coalesce(row_value->>'source_record_sha256',row_value->>'observation_sha256',row_value->>'source_payload_sha256',row_value->>'payload_sha256'),
     'originalStatus',coalesce(entry.research->>'original_status',entry.research->>'originalStatus',CASE WHEN kind='agent' THEN entry.research->>'status' END,entry.research->>'databaseDecision',
       entry.research#>>'{canonical_record,originalStatus}',entry.research#>>'{canonical_record,status}',entry.research#>>'{raw_assessment,originalStatus}',entry.research#>>'{raw_assessment,status}'),
     'selectionDisposition',coalesce(entry.research->>'selection_disposition',entry.research->>'selectionDisposition'),
     'qualificationState',coalesce(entry.research->>'qualification_state',entry.research->>'qualificationState'),
     'processingDisposition',coalesce(row_value->>'state',row_value->>'validation_state',row_value->>'reconciliation_state',row_value->>'mapping_status'),
     'observedAt',CASE WHEN row_value ? 'source_observed_precision' THEN CASE WHEN row_value->>'source_observed_precision'='date_only' THEN row_value->>'source_observed_on'
       WHEN row_value->>'source_observed_precision'='exact_time' THEN row_value->>'observed_at' ELSE NULL END ELSE coalesce(row_value->>'observed_at',row_value->>'observed_on',row_value->>'assessed_on') END,
     'retrievedAt',coalesce(entry.research->>'retrievedAt',entry.research->>'retrieved_at'),'sourceItemId',source_key);
   FOREACH status_key IN ARRAY ARRAY['originalStatus','selectionDisposition','qualificationState'] LOOP
     IF jsonb_typeof(meta->status_key)='string' AND btrim(meta->>status_key)='' THEN meta:=jsonb_set(meta,ARRAY[status_key],'null'); warnings:=warnings||'["blank_status_retained"]'::jsonb; END IF;
   END LOOP;
   PERFORM prospect_candidate_private.record_history(candidate,coverage,'research_revision',p_table,source_key||CASE WHEN kind='agent' THEN '/'||entry.section||'/'||entry.ordinal ELSE '' END||'/snapshot/'||coverage::text,
      NULL,NULL,NULL,raw_value,prospect_candidate_private.hash_json(raw_value),meta,warnings);
   -- Follow the typed affiliation FK without resolving a multi-firm person as a firm.
   IF kind='affiliation' THEN
     SELECT prospect_candidate_private.legacy_research_row('prospect_lso_licensees',to_jsonb(l)) INTO licensee_value
       FROM public.prospect_lso_licensees l WHERE l.id=(row_value->>'licensee_id')::uuid;
     IF licensee_value IS NOT NULL THEN
       PERFORM prospect_candidate_private.project_legacy('prospect_lso_licensees',licensee_value);
       SELECT captured.revision INTO c FROM public.prospect_research_candidate_coverage captured WHERE captured.source_table='prospect_lso_licensees' AND captured.source_key=licensee_value->>'id' ORDER BY captured.revision DESC LIMIT 1;
       PERFORM prospect_candidate_private.record_history(candidate,c,'provenance_revision','prospect_lso_licensees',
         (licensee_value->>'id')||'/affiliation/'||source_key||'/snapshot/'||c::text,NULL,NULL,NULL,licensee_value,prospect_candidate_private.hash_json(licensee_value),
         jsonb_build_object('sourceRoot','governed_database','relativePath','prospect_lso_licensees','sourcePointer','',
           'sourceItemId',licensee_value->>'id','observedAt',licensee_value->>'observed_at'),'[]');
     END IF;
   END IF;
   -- Attach complete allowlisted batch provenance to each source record, including staged/rejected rows.
   batch_value:=NULL;
   IF row_value->>'import_batch_id' IS NOT NULL THEN SELECT prospect_candidate_private.legacy_research_row('gta_prospect_import_batches',to_jsonb(b)) INTO batch_value FROM public.gta_prospect_import_batches b WHERE id=(row_value->>'import_batch_id')::uuid;
   ELSIF row_value->>'evidence_import_batch_id' IS NOT NULL THEN SELECT prospect_candidate_private.legacy_research_row('gta_prospect_supplemental_evidence_import_batches',to_jsonb(b)) INTO batch_value FROM public.gta_prospect_supplemental_evidence_import_batches b WHERE id=(row_value->>'evidence_import_batch_id')::uuid; END IF;
   IF batch_value IS NOT NULL THEN
     c:=prospect_candidate_private.journal('legacy_batch_provenance',p_table||'/'||source_key,prospect_candidate_private.hash_json(batch_value),batch_value);
     PERFORM prospect_candidate_private.record_history(candidate,c,'provenance_revision','legacy_batch_provenance',p_table||'/'||source_key,NULL,NULL,NULL,batch_value,prospect_candidate_private.hash_json(batch_value),jsonb_build_object('processingDisposition',batch_value->>'state'),'[]');
   END IF;
   proof_hash:=NULL;
   IF firm IS NOT NULL THEN
     proof:=jsonb_build_object('sourceTable',p_table,'sourceRowId',source_key,'sourceRowSha256',row_hash,'firmId',firm,'linkKind',kind,'batch',batch_value,
       'dependencies',prospect_candidate_private.legacy_dependencies(p_table,row_value,firm),
       'firmReceipt',coalesce((SELECT jsonb_build_object('auditId',a.id,'batchId',b.id,'sourceRecordSha256',a.source_record_sha256,'sourceSha256',b.source_sha256,'state',b.state,'actionState',a.action_state)
         FROM public.gta_prospect_import_audit a JOIN public.gta_prospect_import_batches b ON b.id=a.import_batch_id WHERE a.firm_id=firm AND a.validation_state='accepted' AND a.action_state IN ('created','already_present') AND b.state='applied' ORDER BY a.id LIMIT 1),
         (SELECT h.original_json FROM public.prospect_research_candidate_history h WHERE h.item_kind='identity_link' AND h.source_table='verified_identity' AND h.verified_firm_id=firm ORDER BY h.coverage_revision DESC LIMIT 1)));
     proof_hash:=prospect_candidate_private.hash_json(proof);
     c:=prospect_candidate_private.journal('legacy_verified_identity',p_table||'/'||source_key,proof_hash,proof);
     PERFORM prospect_candidate_private.record_history(candidate,c,'identity_link','legacy_verified_identity',p_table||'/'||source_key,NULL,NULL,NULL,proof,proof_hash,'{}','[]',firm);
   END IF;
   PERFORM prospect_candidate_private.legacy_journal('legacy_identity_assessment',p_table||'/'||source_key,
     jsonb_build_object('firmId',firm,'sourceRowSha256',row_hash,'proofSha256',proof_hash));
 END LOOP;
END $$;

-- Re-evaluate only rows related by typed FKs when an applied receipt or reviewed
-- worker reconciliation arrives after its source row. Append, never rewrite.
CREATE FUNCTION prospect_candidate_private.refresh_legacy_firm(p_firm uuid)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE item record; source record; predicate text;
BEGIN
 IF NOT prospect_candidate_private.governed_firm(p_firm) THEN RETURN; END IF;
 FOR item IN SELECT * FROM prospect_candidate_private.legacy_inventory() LOOP
   predicate:=CASE WHEN item.link_kind='firm' THEN 'id=$1' WHEN 'firm_id'=ANY(item.column_names) THEN 'firm_id=$1'
     WHEN item.link_kind='queue' THEN 'canonical_firm_id=$1' ELSE NULL END;
   IF predicate IS NOT NULL THEN
     FOR source IN EXECUTE format('SELECT to_jsonb(s) data FROM public.%I s WHERE %s',item.table_name,predicate) USING p_firm LOOP
       PERFORM prospect_candidate_private.project_legacy(item.table_name,source.data);
     END LOOP;
   END IF;
 END LOOP;
 FOR source IN SELECT to_jsonb(d) data FROM public.gta_prospect_worker_evidence_drafts d
   WHERE EXISTS(SELECT 1 FROM public.gta_prospect_worker_evidence_reconciliations r WHERE r.draft_id=d.id AND r.firm_id=p_firm AND r.reconciliation_state='linked') LOOP
   PERFORM prospect_candidate_private.project_legacy('gta_prospect_worker_evidence_drafts',source.data);
 END LOOP;
 FOR source IN SELECT to_jsonb(a) data FROM public.gta_prospect_research_work_attempts a JOIN public.gta_prospect_research_work_items w ON w.id=a.work_item_id WHERE w.canonical_firm_id=p_firm LOOP
   PERFORM prospect_candidate_private.project_legacy('gta_prospect_research_work_attempts',source.data);
 END LOOP;
END $$;

CREATE FUNCTION prospect_candidate_private.legacy_projection_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE row_value jsonb:=to_jsonb(NEW); related record;
BEGIN
 PERFORM prospect_candidate_private.project_legacy(TG_TABLE_NAME,row_value);
 IF TG_TABLE_NAME='gta_prospect_import_batches' AND row_value->>'state'='applied' THEN
   FOR related IN SELECT DISTINCT firm_id FROM public.gta_prospect_import_audit WHERE import_batch_id=NEW.id AND firm_id IS NOT NULL LOOP
     PERFORM prospect_candidate_private.refresh_legacy_firm(related.firm_id);
   END LOOP;
 ELSIF TG_TABLE_NAME='gta_prospect_supplemental_evidence_import_batches' AND row_value->>'state'='applied' THEN
   FOR related IN SELECT DISTINCT firm_id FROM public.gta_prospect_supplemental_evidence_import_audit WHERE evidence_import_batch_id=NEW.id LOOP
     PERFORM prospect_candidate_private.refresh_legacy_firm(related.firm_id);
   END LOOP;
 ELSIF TG_TABLE_NAME='gta_prospect_worker_evidence_reconciliations' THEN
   PERFORM prospect_candidate_private.project_legacy('gta_prospect_worker_evidence_drafts',(SELECT to_jsonb(d) FROM public.gta_prospect_worker_evidence_drafts d WHERE d.id=(row_value->>'draft_id')::uuid));
   FOR related IN SELECT DISTINCT firm_id FROM public.gta_prospect_worker_evidence_reconciliations WHERE draft_id=(row_value->>'draft_id')::uuid AND firm_id IS NOT NULL LOOP
     PERFORM prospect_candidate_private.refresh_legacy_firm(related.firm_id);
   END LOOP;
 ELSIF TG_TABLE_NAME='prospect_lso_licensees' THEN
   FOR related IN SELECT to_jsonb(a) data FROM public.prospect_firm_affiliations a WHERE a.licensee_id=NEW.id LOOP
     PERFORM prospect_candidate_private.project_legacy('prospect_firm_affiliations',related.data);
   END LOOP;
 ELSIF TG_TABLE_NAME IN ('gta_prospect_import_audit','gta_prospect_stable_identity_registry') THEN
   PERFORM prospect_candidate_private.refresh_legacy_firm((row_value->>'firm_id')::uuid);
 ELSIF TG_TABLE_NAME='gta_prospect_research_work_items' AND row_value->>'canonical_firm_id' IS NOT NULL THEN
   PERFORM prospect_candidate_private.refresh_legacy_firm((row_value->>'canonical_firm_id')::uuid);
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION prospect_candidate_private.enrichment_firm_refresh_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NEW.state='applied' AND NEW.firm_id IS NOT NULL THEN PERFORM prospect_candidate_private.refresh_legacy_firm(NEW.firm_id); END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION prospect_candidate_private.walk_fields(
 p_value jsonb,p_pointer text,p_item text,p_sources jsonb,p_urls text[],
 p_observed text,p_retrieved text)
RETURNS TABLE(pointer text,scalar_type text,value_json jsonb,source_item_id text,source_ids jsonb,source_urls text[],observed_at text,retrieved_at text)
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v record; kind text := jsonb_typeof(p_value); part text;
  item_value text := p_item; sources_value jsonb := p_sources; urls_value text[] := p_urls;
  observed_value text := p_observed; retrieved_value text := p_retrieved;
BEGIN
  IF kind='object' THEN
    IF p_value ? 'source_observed_precision' THEN
      observed_value:=CASE WHEN p_value->>'source_observed_precision'='date_only' THEN p_value->>'source_observed_on' WHEN p_value->>'source_observed_precision'='exact_time' THEN p_value->>'observed_at' ELSE NULL END;
    ELSIF p_value ?| ARRAY['observedAt','observedOn','observed_at','observed_on','assessedAt','assessedOn','assessed_on'] THEN
      observed_value := coalesce(p_value->>'observedAt',p_value->>'observedOn',p_value->>'observed_at',p_value->>'observed_on',p_value->>'assessedAt',p_value->>'assessedOn',p_value->>'assessed_on');
    END IF;
    IF p_value ?| ARRAY['retrievedAt','retrieved_at'] THEN retrieved_value := coalesce(p_value->>'retrievedAt',p_value->>'retrieved_at'); END IF;
    item_value := coalesce(p_value->>'sourceId',p_value->>'observationId',p_value->>'assessmentId',item_value);
    IF p_value ? 'sourceIds' THEN sources_value := p_value->'sourceIds';
    ELSIF p_value ? 'sourceId' THEN sources_value := jsonb_build_array(p_value->'sourceId'); END IF;
    SELECT coalesce(array_agg(DISTINCT x),'{}'::text[]) INTO urls_value FROM unnest(
      urls_value || ARRAY[p_value->>'url',p_value->>'sourceUrl',p_value->>'pageUrl',p_value->>'requestedUrl',p_value->>'finalUrl',p_value->>'source_url',p_value->>'requested_url',p_value->>'final_url',p_value->>'coordinate_source_url',p_value->>'boundary_source_url',p_value->>'destination_url'] ||
      ARRAY(SELECT value FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_value->'evidence_urls')='array' THEN p_value->'evidence_urls' ELSE '[]' END)) ||
      ARRAY(SELECT value FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_value->'source_urls')='array' THEN p_value->'source_urls' ELSE '[]' END))
    ) x WHERE x IS NOT NULL;
  END IF;
  IF kind NOT IN ('object','array') OR p_value IN ('{}'::jsonb,'[]'::jsonb) THEN
    RETURN QUERY SELECT p_pointer,kind,p_value,item_value,sources_value,urls_value,observed_value,retrieved_value;
  ELSIF kind='object' THEN
    FOR v IN SELECT key,value FROM jsonb_each(p_value) ORDER BY key LOOP
      part := replace(replace(v.key,'~','~0'),'/','~1');
      RETURN QUERY SELECT * FROM prospect_candidate_private.walk_fields(v.value,p_pointer||'/'||part,item_value,sources_value,urls_value,observed_value,retrieved_value);
    END LOOP;
  ELSE
    FOR v IN SELECT value,ordinality FROM jsonb_array_elements(p_value) WITH ORDINALITY LOOP
      RETURN QUERY SELECT * FROM prospect_candidate_private.walk_fields(v.value,p_pointer||'/'||(v.ordinality-1)::text,item_value,sources_value,urls_value,observed_value,retrieved_value);
    END LOOP;
  END IF;
END $$;

DO $$ DECLARE item record; source record;
BEGIN
 FOR item IN SELECT * FROM prospect_candidate_private.legacy_inventory() LOOP
   EXECUTE format('CREATE TRIGGER candidate_legacy_projection AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION prospect_candidate_private.legacy_projection_trigger()',item.table_name);
   FOR source IN EXECUTE format('SELECT to_jsonb(s) data FROM public.%I s ORDER BY id',item.table_name) LOOP
     PERFORM prospect_candidate_private.project_legacy(item.table_name,source.data);
   END LOOP;
 END LOOP;
END $$;
CREATE TRIGGER candidate_z_firm_refresh AFTER INSERT OR UPDATE ON public.prospect_enrichment_packages
 FOR EACH ROW EXECUTE FUNCTION prospect_candidate_private.enrichment_firm_refresh_trigger();

CREATE FUNCTION prospect_candidate_private.identity_links_for(p_cutoff bigint,p_candidate uuid)
RETURNS TABLE(candidate_id uuid,verified_firm_id uuid)
LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT h.candidate_id,h.verified_firm_id FROM public.prospect_research_candidate_history h
 WHERE h.item_kind='identity_link' AND h.coverage_revision<=p_cutoff
 AND (p_candidate IS NULL OR h.candidate_id=p_candidate)
 AND (h.source_table<>'legacy_verified_identity' OR (h.original_json->>'sourceRowSha256'=(
   SELECT c.snapshot->>'sourceRowSha256' FROM public.prospect_research_candidate_coverage c
   WHERE c.source_table=h.original_json->>'sourceTable' AND c.source_key=h.original_json->>'sourceRowId' AND c.revision<=p_cutoff
   ORDER BY c.revision DESC LIMIT 1)
 AND h.payload_sha256=(SELECT c.snapshot#>>'{row,proofSha256}' FROM public.prospect_research_candidate_coverage c
   WHERE c.source_table='legacy_identity_assessment' AND c.source_key=h.source_key AND c.revision<=p_cutoff ORDER BY c.revision DESC LIMIT 1)
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(h.original_json->'dependencies') dependency WHERE dependency->>'rowSha256' IS DISTINCT FROM (
   SELECT c.snapshot->>'sourceRowSha256' FROM public.prospect_research_candidate_coverage c
   WHERE c.source_table=dependency->>'table' AND c.source_key=dependency->>'key' AND c.revision<=p_cutoff ORDER BY c.revision DESC LIMIT 1))))
$$;

CREATE FUNCTION prospect_candidate_private.identity_links_at(p_cutoff bigint)
RETURNS TABLE(candidate_id uuid,verified_firm_id uuid)
LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT candidate_id,verified_firm_id FROM prospect_candidate_private.identity_links_for(p_cutoff,NULL)
$$;

CREATE OR REPLACE FUNCTION prospect_candidate_private.full_summary(p_candidate uuid,p_cutoff bigint)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
 WITH candidate AS (SELECT * FROM public.prospect_research_candidates WHERE id=p_candidate AND created_revision<=p_cutoff),
 history AS (SELECT * FROM public.prospect_research_candidate_history WHERE candidate_id=p_candidate AND coverage_revision<=p_cutoff),
 fields AS (SELECT f.* FROM public.prospect_research_candidate_fields f JOIN history h ON h.id=f.revision_id
   WHERE h.item_kind IN ('research_revision','provenance_revision')),
 identities AS (SELECT count(DISTINCT verified_firm_id) AS n,min(verified_firm_id::text) AS firm FROM prospect_candidate_private.identity_links_for(p_cutoff,p_candidate)),
 statuses AS (
   SELECT coalesce(jsonb_agg(DISTINCT original_status) FILTER(WHERE original_status IS NOT NULL),'[]') AS original,
     coalesce(jsonb_agg(DISTINCT selection_disposition) FILTER(WHERE selection_disposition IS NOT NULL),'[]') AS selection,
     coalesce(jsonb_agg(DISTINCT qualification_state) FILTER(WHERE qualification_state IS NOT NULL),'[]') AS qualification
   FROM history WHERE item_kind IN ('research_revision','provenance_revision')
 )
 SELECT jsonb_build_object(
   'id',c.id,'identityNamespace',c.identity_namespace,'identityKey',c.identity_key,
   'displayName',coalesce(
      (SELECT f.value_json#>>'{}' FROM fields f WHERE f.scalar_type='string'
       AND f.pointer ~ '/(displayName|display_name|firmName|firm_name|candidate_name)$' AND btrim(f.value_json#>>'{}')<>''
       ORDER BY f.coverage_revision DESC,f.pointer LIMIT 1),c.identity_key),
   'verifiedFirmId',CASE WHEN i.n=1 THEN i.firm ELSE NULL END,
   'identityState',CASE WHEN i.n>1 THEN 'conflict' WHEN i.n=1 THEN 'resolved' ELSE 'unresolved' END,
   'revisionCount',(SELECT count(*) FROM history WHERE item_kind IN ('research_revision','provenance_revision')),
   'originalStatuses',s.original,'selectionDispositions',s.selection,
   'processingDispositions',(SELECT coalesce(jsonb_agg(DISTINCT processing_disposition) FILTER(WHERE processing_disposition IS NOT NULL),'[]') FROM history),
   'qualificationStates',s.qualification,
   'latestRecordedAt',(SELECT max(recorded_at) FROM history),
   'readWarnings',(SELECT coalesce(jsonb_agg(DISTINCT w),'[]') FROM (
     SELECT jsonb_array_elements_text(read_warnings) w FROM history
     UNION SELECT issue.code FROM public.prospect_research_candidate_projection_issues issue JOIN history h ON h.id=issue.revision_id
     UNION SELECT 'identity_conflict' WHERE i.n>1
     UNION SELECT 'legacy_identity_unverified' WHERE c.identity_namespace LIKE 'legacy:%' AND i.n<>1
     UNION SELECT 'invalid_source_date' WHERE EXISTS (SELECT 1 FROM fields f
       WHERE (f.observed_at IS NOT NULL AND prospect_candidate_private.source_date(f.observed_at) IS NULL)
         OR (f.retrieved_at IS NOT NULL AND prospect_candidate_private.source_date(f.retrieved_at) IS NULL))
   ) warning_rows)
 ) FROM candidate c CROSS JOIN identities i CROSS JOIN statuses s
$$;

ALTER FUNCTION prospect_candidate_private.coverage_warnings(bigint) RENAME TO coverage_warnings_enrichment_v1;
CREATE FUNCTION prospect_candidate_private.coverage_warnings(p_cutoff bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE warnings jsonb:=prospect_candidate_private.coverage_warnings_enrichment_v1(p_cutoff); item record; n bigint;
BEGIN
 FOR item IN SELECT * FROM prospect_candidate_private.legacy_inventory() LOOP
   -- Current missing versions are warnings even when an older cursor is supplied.
   EXECUTE format('SELECT count(*) FROM public.%I s WHERE prospect_candidate_private.legacy_research_row($1,to_jsonb(s)) IS DISTINCT FROM (SELECT c.snapshot->''row'' FROM public.prospect_research_candidate_coverage c WHERE c.source_table=$1 AND c.source_key=s.id::text ORDER BY c.revision DESC LIMIT 1)',item.table_name) INTO n USING item.table_name;
   IF n>0 THEN warnings:=warnings||jsonb_build_array('legacy_source_rows_unprojected:'||item.table_name||':'||n); END IF;
   SELECT count(*) INTO n FROM information_schema.columns col WHERE col.table_schema='public' AND col.table_name=item.table_name
     AND NOT col.column_name=ANY(item.column_names||item.excluded_columns);
   IF n>0 THEN warnings:=warnings||jsonb_build_array('legacy_columns_not_projected:'||item.table_name||':'||n); END IF;
 END LOOP;
 WITH identities AS MATERIALIZED (
   SELECT candidate_id,count(DISTINCT verified_firm_id) n
   FROM prospect_candidate_private.identity_links_at(p_cutoff) GROUP BY candidate_id
 )
 SELECT count(*) INTO n FROM public.prospect_research_candidates c LEFT JOIN identities i ON i.candidate_id=c.id
 WHERE c.identity_namespace LIKE 'legacy:%' AND c.created_revision<=p_cutoff AND coalesce(i.n,0)<>1;
 IF n>0 THEN warnings:=warnings||jsonb_build_array('legacy_identity_unverified:'||n); END IF;
 RETURN warnings;
END $$;

ALTER FUNCTION prospect_candidate_private.check_filters(jsonb) RENAME TO check_filters_candidate_v1;
CREATE FUNCTION prospect_candidate_private.check_filters(p_filters jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
 PERFORM prospect_candidate_private.check_filters_candidate_v1(p_filters-ARRAY['firmId','identityNamespace','identityKey']::text[]);
 IF p_filters ? 'firmId' AND (jsonb_typeof(p_filters->'firmId')<>'string' OR p_filters->>'firmId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN RAISE EXCEPTION 'invalid firm ID filter'; END IF;
 IF (p_filters ? 'identityNamespace')<>(p_filters ? 'identityKey') THEN RAISE EXCEPTION 'exact candidate identity requires namespace and key'; END IF;
 IF p_filters ? 'identityNamespace' AND (jsonb_typeof(p_filters->'identityNamespace')<>'string' OR char_length(p_filters->>'identityNamespace') NOT BETWEEN 1 AND 4000) THEN RAISE EXCEPTION 'invalid candidate identity namespace'; END IF;
 IF p_filters ? 'identityKey' AND (jsonb_typeof(p_filters->'identityKey')<>'string' OR char_length(p_filters->>'identityKey') NOT BETWEEN 1 AND 4000) THEN RAISE EXCEPTION 'invalid candidate identity key'; END IF;
END $$;

CREATE FUNCTION prospect_candidate_private.group_candidates(p_id uuid,p_cutoff bigint)
RETURNS uuid[] LANGUAGE sql STABLE SET search_path = '' AS $$
 WITH identities AS MATERIALIZED (
   SELECT candidate_id,min(verified_firm_id::text)::uuid firm_id FROM prospect_candidate_private.identity_links_at(p_cutoff)
   GROUP BY candidate_id HAVING count(DISTINCT verified_firm_id)=1
 ), target AS (SELECT firm_id FROM identities WHERE candidate_id=p_id)
 SELECT CASE WHEN EXISTS(SELECT 1 FROM target) THEN ARRAY(SELECT candidate_id FROM identities WHERE firm_id=(SELECT firm_id FROM target) ORDER BY candidate_id)
 ELSE ARRAY[p_id] END
$$;

CREATE FUNCTION prospect_candidate_private.matches_group(p_id uuid,p_summary jsonb,p_filters jsonb,p_cutoff bigint,p_members uuid[])
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
 WITH members AS MATERIALIZED (SELECT p_members ids)
 SELECT
 (NOT p_filters ? 'firmId' OR (p_summary->>'identityState'='resolved' AND (p_summary->>'verifiedFirmId')::uuid=(p_filters->>'firmId')::uuid))
 AND (NOT p_filters ? 'identityNamespace' OR p_summary->>'identityNamespace'=p_filters->>'identityNamespace')
 AND (NOT p_filters ? 'identityKey' OR p_summary->>'identityKey'=p_filters->>'identityKey')
 AND (NOT p_filters ? 'identityState' OR p_summary->>'identityState'=p_filters->>'identityState')
 AND NOT EXISTS (
   SELECT 1 FROM (VALUES ('originalStatus'),('selectionDisposition'),('processingDisposition'),('qualificationState')) x(filter_key)
   WHERE p_filters ? x.filter_key AND NOT (
     CASE WHEN p_filters->>x.filter_key='__unknown__' THEN NOT EXISTS(
       SELECT 1 FROM public.prospect_research_candidate_history h WHERE h.candidate_id=ANY((SELECT ids FROM members)::uuid[]) AND h.coverage_revision<=p_cutoff
         AND CASE x.filter_key WHEN 'originalStatus' THEN h.original_status WHEN 'selectionDisposition' THEN h.selection_disposition
           WHEN 'processingDisposition' THEN h.processing_disposition ELSE h.qualification_state END IS NOT NULL)
     ELSE EXISTS(SELECT 1 FROM public.prospect_research_candidate_history h WHERE h.candidate_id=ANY((SELECT ids FROM members)::uuid[]) AND h.coverage_revision<=p_cutoff
         AND CASE x.filter_key WHEN 'originalStatus' THEN h.original_status WHEN 'selectionDisposition' THEN h.selection_disposition
           WHEN 'processingDisposition' THEN h.processing_disposition ELSE h.qualification_state END=p_filters->>x.filter_key) END)
 )
 AND (NOT p_filters ? 'text' OR btrim(p_filters->>'text')='' OR NOT EXISTS (
   SELECT 1 FROM regexp_split_to_table(p_filters->>'text','\s+') term
   WHERE numnode(plainto_tsquery('simple'::regconfig,term))>0
     AND NOT EXISTS (SELECT 1 FROM public.prospect_research_candidate_search_chunks f
       WHERE f.candidate_id=ANY((SELECT ids FROM members)::uuid[]) AND f.coverage_revision<=p_cutoff
       AND f.search_document @@ plainto_tsquery('simple'::regconfig,term))
     AND NOT EXISTS(SELECT 1 FROM public.prospect_research_candidate_history h JOIN public.prospect_research_candidate_projection_issues i ON i.revision_id=h.id
       WHERE h.candidate_id=ANY((SELECT ids FROM members)::uuid[]) AND h.coverage_revision<=p_cutoff AND strpos(lower(h.original_json::text),lower(term))>0)
     AND NOT EXISTS(SELECT 1 FROM public.prospect_research_candidates named WHERE named.id=ANY((SELECT ids FROM members)::uuid[])
       AND to_tsvector('simple'::regconfig,named.identity_key||' '||named.identity_namespace) @@ plainto_tsquery('simple'::regconfig,term))
     AND NOT EXISTS(SELECT 1 FROM public.prospect_research_candidate_history h WHERE h.candidate_id=ANY((SELECT ids FROM members)::uuid[]) AND h.coverage_revision<=p_cutoff
       AND to_tsvector('simple'::regconfig,concat_ws(' ',h.source_table,h.source_root,h.relative_path,h.source_pointer)) @@ plainto_tsquery('simple'::regconfig,term))
 ))
 AND (NOT p_filters ? 'fieldPointer' OR EXISTS (
   SELECT 1 FROM public.prospect_research_candidate_fields f WHERE f.candidate_id=ANY((SELECT ids FROM members)::uuid[]) AND f.coverage_revision<=p_cutoff
   AND md5(f.pointer)=md5(p_filters->>'fieldPointer') AND f.pointer=p_filters->>'fieldPointer'
   AND (NOT p_filters ? 'fieldValue' OR (md5(f.value_json::text)=md5((p_filters->'fieldValue')::text) AND f.value_json=p_filters->'fieldValue'))
 ))
 AND (NOT p_filters ? 'fieldRefRevision' OR EXISTS(
   SELECT 1 FROM public.prospect_research_candidate_fields reference_field JOIN public.prospect_research_candidate_fields f
     ON f.pointer_sha256=reference_field.pointer_sha256 AND f.pointer=reference_field.pointer
       AND md5(f.value_json::text)=md5(reference_field.value_json::text)
       AND f.value_json=reference_field.value_json AND f.scalar_type=reference_field.scalar_type
   WHERE reference_field.revision_id=(p_filters->>'fieldRefRevision')::uuid
     AND reference_field.pointer_sha256=p_filters->>'fieldRefPointerSha256'
     AND reference_field.coverage_revision<=p_cutoff AND f.candidate_id=ANY((SELECT ids FROM members)::uuid[]) AND f.coverage_revision<=p_cutoff
 ))
 AND (NOT p_filters ? 'sourceUrl' OR EXISTS (
   SELECT 1 FROM public.prospect_research_candidate_fields f WHERE f.candidate_id=ANY((SELECT ids FROM members)::uuid[]) AND f.coverage_revision<=p_cutoff
     AND f.source_url_hashes @> ARRAY[md5(p_filters->>'sourceUrl')] AND f.source_urls @> ARRAY[p_filters->>'sourceUrl']
 ))
 AND (NOT p_filters ?| ARRAY['observedFrom','observedTo','observedUnknown'] OR EXISTS (
   SELECT 1 FROM public.prospect_research_candidate_fields f WHERE f.candidate_id=ANY((SELECT ids FROM members)::uuid[]) AND f.coverage_revision<=p_cutoff
     AND (NOT p_filters ? 'observedUnknown' OR ((prospect_candidate_private.source_date(f.observed_at) IS NULL)=(p_filters->>'observedUnknown')::boolean))
     AND (NOT p_filters ? 'observedFrom' OR f.observed_day>=(p_filters->>'observedFrom')::date)
     AND (NOT p_filters ? 'observedTo' OR f.observed_day<=(p_filters->>'observedTo')::date)
 ))
 AND (NOT p_filters ?| ARRAY['retrievedFrom','retrievedTo','retrievedUnknown'] OR EXISTS (
   SELECT 1 FROM public.prospect_research_candidate_fields f WHERE f.candidate_id=ANY((SELECT ids FROM members)::uuid[]) AND f.coverage_revision<=p_cutoff
     AND (NOT p_filters ? 'retrievedUnknown' OR ((prospect_candidate_private.source_date(f.retrieved_at) IS NULL)=(p_filters->>'retrievedUnknown')::boolean))
     AND (NOT p_filters ? 'retrievedFrom' OR f.retrieved_day>=(p_filters->>'retrievedFrom')::date)
     AND (NOT p_filters ? 'retrievedTo' OR f.retrieved_day<=(p_filters->>'retrievedTo')::date)
 ))
$$;

CREATE OR REPLACE FUNCTION prospect_candidate_private.matches(p_id uuid,p_summary jsonb,p_filters jsonb,p_cutoff bigint)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT prospect_candidate_private.matches_group(p_id,p_summary,p_filters,p_cutoff,prospect_candidate_private.group_candidates(p_id,p_cutoff))
$$;

CREATE OR REPLACE FUNCTION prospect_candidate_private.list_candidates(p_filters jsonb,p_limit integer,p_after_id uuid,p_coverage_revision bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cutoff bigint; warnings jsonb; result jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid candidate page size'; END IF;
 IF p_after_id IS NOT NULL AND p_coverage_revision IS NULL THEN RAISE EXCEPTION 'candidate cursor requires coverage revision'; END IF;
 PERFORM prospect_candidate_private.check_filters(p_filters);
 cutoff:=prospect_candidate_private.cutoff(p_coverage_revision); warnings:=prospect_candidate_private.coverage_warnings(cutoff);
 IF p_filters ? 'fieldRefRevision' AND NOT EXISTS(SELECT 1 FROM public.prospect_research_candidate_fields f
   WHERE f.revision_id=(p_filters->>'fieldRefRevision')::uuid AND f.pointer_sha256=p_filters->>'fieldRefPointerSha256'
     AND f.coverage_revision<=cutoff) THEN RAISE EXCEPTION 'invalid candidate field reference'; END IF;
 WITH identities AS MATERIALIZED (
   SELECT candidate_id,count(DISTINCT verified_firm_id) firm_count,min(verified_firm_id::text) firm_id
   FROM prospect_candidate_private.identity_links_at(cutoff) GROUP BY candidate_id
 ), memberships AS MATERIALIZED (
   -- Typed/text set filters use group_key directly and do not need per-candidate member arrays.
   SELECT candidate_id,array_agg(candidate_id) OVER(PARTITION BY firm_id) ids FROM identities
   WHERE firm_count=1 AND (p_filters-'fieldPointer'-'fieldValue'-'text')<>'{}'::jsonb
 ), inventory AS MATERIALIZED (
   -- Counts and filters need only identity metadata. Build retained summaries for the returned page.
   SELECT c.id,jsonb_build_object('verifiedFirmId',CASE WHEN links.firm_count=1 THEN links.firm_id ELSE NULL END,
      'identityNamespace',c.identity_namespace,'identityKey',c.identity_key,
      'identityState',CASE WHEN links.firm_count=1 THEN 'resolved' WHEN links.firm_count>1 THEN 'conflict' ELSE 'unresolved' END) data,
      coalesce(m.ids,ARRAY[c.id]) group_ids,
      CASE WHEN links.firm_count=1 THEN 'firm:'||links.firm_id ELSE 'candidate:'||c.id::text END group_key
   FROM public.prospect_research_candidates c LEFT JOIN memberships m ON m.candidate_id=c.id
   LEFT JOIN identities links ON links.candidate_id=c.id WHERE c.created_revision<=cutoff
 ), text_terms AS MATERIALIZED (
   SELECT DISTINCT btrim(term) term,plainto_tsquery('simple'::regconfig,btrim(term)) query
   FROM regexp_split_to_table(coalesce(p_filters->>'text',''),'\s+') term
   WHERE p_filters ? 'text' AND btrim(p_filters->>'text')<>'' AND numnode(plainto_tsquery('simple'::regconfig,btrim(term)))>0
 ), text_hits AS MATERIALIZED (
   -- Search the GIN index once for the whole inventory instead of once per candidate.
   SELECT f.candidate_id,t.term FROM text_terms t JOIN public.prospect_research_candidate_search_chunks f
     ON f.search_document @@ t.query WHERE p_filters ? 'text' AND btrim(p_filters->>'text')<>'' AND f.coverage_revision<=cutoff
   UNION
   SELECT h.candidate_id,t.term FROM text_terms t JOIN public.prospect_research_candidate_history h
     ON strpos(lower(h.original_json::text),lower(t.term))>0
     JOIN public.prospect_research_candidate_projection_issues i ON i.revision_id=h.id
     WHERE p_filters ? 'text' AND btrim(p_filters->>'text')<>'' AND h.coverage_revision<=cutoff
   UNION
   SELECT named.id,t.term FROM text_terms t JOIN public.prospect_research_candidates named
     ON to_tsvector('simple'::regconfig,named.identity_key||' '||named.identity_namespace) @@ t.query
     WHERE p_filters ? 'text' AND btrim(p_filters->>'text')<>''
   UNION
   SELECT h.candidate_id,t.term FROM text_terms t JOIN public.prospect_research_candidate_history h
     ON to_tsvector('simple'::regconfig,concat_ws(' ',h.source_table,h.source_root,h.relative_path,h.source_pointer)) @@ t.query
     WHERE p_filters ? 'text' AND btrim(p_filters->>'text')<>'' AND h.coverage_revision<=cutoff
 ), text_matches AS MATERIALIZED (
   SELECT CASE WHEN i.firm_count=1 THEN 'firm:'||i.firm_id ELSE 'candidate:'||h.candidate_id::text END group_id
   FROM text_hits h LEFT JOIN identities i ON i.candidate_id=h.candidate_id
   GROUP BY CASE WHEN i.firm_count=1 THEN 'firm:'||i.firm_id ELSE 'candidate:'||h.candidate_id::text END
   HAVING count(DISTINCT h.term)=(SELECT count(*) FROM text_terms)
 ), typed_field_candidates AS MATERIALIZED (
   -- Keep the optional value filter out of an OR so a cached generic plan can
   -- use both leading keys of prospect_candidate_field_exact.
   SELECT DISTINCT f.candidate_id
   FROM public.prospect_research_candidate_fields f
   WHERE p_filters ? 'fieldPointer' AND p_filters ? 'fieldValue' AND f.coverage_revision<=cutoff
     AND md5(f.pointer)=md5(p_filters->>'fieldPointer') AND f.pointer=p_filters->>'fieldPointer'
     AND md5(f.value_json::text)=md5((p_filters->'fieldValue')::text) AND f.value_json=p_filters->'fieldValue'
   UNION
   SELECT DISTINCT f.candidate_id
   FROM public.prospect_research_candidate_fields f
   WHERE p_filters ? 'fieldPointer' AND NOT p_filters ? 'fieldValue' AND f.coverage_revision<=cutoff
     AND md5(f.pointer)=md5(p_filters->>'fieldPointer') AND f.pointer=p_filters->>'fieldPointer'
 ), typed_field_matches AS MATERIALIZED (
   -- A typed field belongs to its source candidate only. Firm grouping is
   -- retained for other filters, but must not widen an exact field match.
   SELECT candidate_id FROM typed_field_candidates
 ), non_text_filtered AS MATERIALIZED (
   -- Keep ordinary and blank-text reads on the original predicate path.
   SELECT i.id FROM inventory i WHERE NOT (p_filters ? 'fieldPointer') AND (
     p_filters='{}'::jsonb OR (
       (NOT p_filters ? 'text' OR btrim(p_filters->>'text')='')
       AND prospect_candidate_private.matches_group(i.id,i.data,p_filters,cutoff,i.group_ids)
     )
   )
 ), text_filtered AS MATERIALIZED (
   SELECT i.id FROM inventory i WHERE p_filters ? 'text' AND btrim(p_filters->>'text')<>''
     AND NOT (p_filters ? 'fieldPointer')
     AND prospect_candidate_private.matches_group(i.id,i.data,p_filters-'text',cutoff,i.group_ids)
     AND (NOT EXISTS(SELECT 1 FROM text_terms)
       OR EXISTS(SELECT 1 FROM text_matches tm WHERE tm.group_id=i.group_key))
 ), typed_field_filtered AS MATERIALIZED (
   -- Return only candidates with the exact indexed field match.
   SELECT i.id FROM typed_field_matches tf JOIN inventory i ON i.id=tf.candidate_id
   WHERE p_filters ? 'fieldPointer'
     AND CASE WHEN (p_filters-'fieldPointer'-'fieldValue'-'text')='{}'::jsonb THEN true
       ELSE prospect_candidate_private.matches_group(i.id,i.data,p_filters-'fieldPointer'-'fieldValue'-'text',cutoff,i.group_ids) END
     AND (NOT p_filters ? 'text' OR btrim(p_filters->>'text')='' OR NOT EXISTS(SELECT 1 FROM text_terms)
       OR EXISTS(SELECT 1 FROM text_matches tm WHERE tm.group_id=i.group_key))
 ), filtered AS MATERIALIZED (
   SELECT id FROM non_text_filtered
   UNION ALL
   SELECT id FROM text_filtered
   UNION ALL
   SELECT id FROM typed_field_filtered
 ), page_ids AS MATERIALIZED (
   SELECT id FROM filtered WHERE p_after_id IS NULL OR id>p_after_id ORDER BY id LIMIT p_limit
 ), summaries AS MATERIALIZED (
   SELECT id,prospect_candidate_private.summary(id,cutoff) data FROM page_ids
 ), sized AS (
   SELECT *,sum(octet_length(data::text)) OVER(ORDER BY id) bytes FROM summaries
 ), page AS (
   SELECT * FROM sized WHERE bytes<=1040000 ORDER BY id
 )
 SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(data ORDER BY id) FROM page),'[]'),
   'nextAfterId',CASE WHEN EXISTS(SELECT 1 FROM filtered WHERE id>(SELECT max(id::text)::uuid FROM page))
      THEN (SELECT max(id::text) FROM page) ELSE NULL END,
   'inventoryCount',(SELECT count(*) FROM inventory),'filteredCount',(SELECT count(*) FROM filtered),
   'coverageRevision',cutoff,'readWarnings',warnings,'complete',warnings='[]'::jsonb) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION prospect_candidate_private.choice_retractions(p_choice jsonb,p_firm uuid,p_cutoff bigint)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
 WITH events AS (
   SELECT DISTINCT ON(h.source_key) h.source_key,h.original_json event,h.package_id FROM public.prospect_research_candidate_history h
   WHERE h.source_table='prospect_enrichment_events' AND h.coverage_revision<=p_cutoff
   AND h.original_json->>'event_type'='evidence_retracted'
   AND h.original_json#>>'{details,targetTable}'=p_choice->>'target_table'
   AND h.original_json#>>'{details,targetId}'=p_choice->>'target_id'
   ORDER BY h.source_key,h.coverage_revision DESC
 ), parents AS (
   SELECT e.*,p.original_json payload FROM events e
   JOIN LATERAL (SELECT h.original_json FROM public.prospect_research_candidate_history h WHERE h.source_table='prospect_enrichment_packages' AND h.package_id=e.package_id AND h.coverage_revision<=p_cutoff ORDER BY h.coverage_revision DESC LIMIT 1) p ON true
   JOIN LATERAL (SELECT h.original_json FROM public.prospect_research_candidate_history h WHERE h.source_table='package_lifecycle' AND h.package_id=e.package_id AND h.coverage_revision<=p_cutoff ORDER BY h.coverage_revision DESC LIMIT 1) lifecycle ON lifecycle.original_json->>'firmId'=p_firm::text
 ), sources AS (
   SELECT *,ARRAY(SELECT value#>>'{}' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(event#>'{details,sourceIds}')='array' THEN event#>'{details,sourceIds}' ELSE '[]' END) WHERE jsonb_typeof(value)='string') source_ids FROM parents
 ), replacements AS (
   SELECT *,coalesce((SELECT jsonb_agg(value) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(payload->'sources')='array' THEN payload->'sources' ELSE '[]' END) WHERE jsonb_typeof(value)='object' AND value->>'sourceId'=ANY(source_ids)),'[]') replacement_sources FROM sources
 ) SELECT coalesce(jsonb_agg(event||jsonb_build_object('replacementSources',replacement_sources,'replacementSourceState',
   CASE WHEN cardinality(source_ids)=0 THEN 'not_recorded' WHEN jsonb_array_length(replacement_sources)=cardinality(source_ids) THEN 'available' ELSE 'incomplete' END) ORDER BY source_key),'[]') FROM replacements
$$;

CREATE OR REPLACE FUNCTION prospect_candidate_private.get_candidate(p_candidate_id uuid,p_coverage_revision bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cutoff bigint; data jsonb; choices jsonb; warnings jsonb; firm text; choice_total bigint; choice_count bigint;
BEGIN
 cutoff:=prospect_candidate_private.cutoff(p_coverage_revision);
 data:=prospect_candidate_private.summary(p_candidate_id,cutoff);
 IF data IS NULL THEN RETURN NULL; END IF;
 warnings:=prospect_candidate_private.coverage_warnings(cutoff)||(data->'readWarnings'); firm:=data->>'verifiedFirmId';
 WITH current_choices AS (
 SELECT c.revision,c.snapshot||jsonb_build_object('evidenceState',CASE WHEN retractions.items='[]'::jsonb THEN 'retained' ELSE 'retracted' END,'retractions',retractions.items) snapshot FROM public.prospect_research_candidate_coverage c
 CROSS JOIN LATERAL (SELECT prospect_candidate_private.choice_retractions(c.snapshot,firm::uuid,cutoff) items) retractions
 WHERE c.source_table='prospect_enrichment_profile_choices' AND c.revision<=cutoff AND c.snapshot->>'firm_id'=firm
 AND NOT EXISTS(SELECT 1 FROM public.prospect_research_candidate_coverage successor
   WHERE successor.source_table='prospect_enrichment_profile_choices' AND successor.revision<=cutoff AND successor.snapshot->>'supersedes_choice_id'=c.source_key)
 ), sized AS (SELECT *,sum(octet_length(snapshot::text)) OVER(ORDER BY revision) bytes FROM current_choices)
 SELECT coalesce(jsonb_agg(snapshot ORDER BY revision) FILTER(WHERE bytes<=262144),'[]'),count(*),count(*) FILTER(WHERE bytes<=262144)
 INTO choices,choice_total,choice_count FROM sized;
 IF choice_count<choice_total THEN warnings:=warnings||'["profile_choices_deferred_to_history"]'::jsonb; END IF;
 RETURN jsonb_build_object('candidate',data,'profileChoices',choices,'coverageRevision',cutoff,'readWarnings',warnings,'complete',warnings='[]'::jsonb);
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA prospect_candidate_private FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION prospect_candidate_private.list_candidates(jsonb,integer,uuid,bigint),
 prospect_candidate_private.get_candidate(uuid,bigint),prospect_candidate_private.list_history(uuid,integer,uuid,bigint),
 prospect_candidate_private.revision_chunk(uuid,uuid,integer,bigint) TO service_role;
COMMIT;
