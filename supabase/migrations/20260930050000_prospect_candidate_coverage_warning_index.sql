-- Candidate list reads must preserve the full coverage warning contract while
-- checking malformed dates through the write-time parsed date columns. Those
-- columns are populated with source_date() in record_history() and the fields
-- journal is append-only, so NULL in a parsed-day column exactly identifies a
-- non-NULL source date that failed the existing parser.
BEGIN;

CREATE INDEX prospect_candidate_invalid_date_coverage
  ON public.prospect_research_candidate_fields(coverage_revision,revision_id)
  WHERE (observed_at IS NOT NULL AND observed_day IS NULL)
     OR (retrieved_at IS NOT NULL AND retrieved_day IS NULL);

-- Keep every warning produced by the prior function. Replace only the
-- per-row parser scan with its immutable write-time result so each UI list
-- request does not re-parse all 523k+ source fields.
CREATE OR REPLACE FUNCTION prospect_candidate_private.coverage_warnings_enrichment_v1(p_cutoff bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE warnings jsonb:='[]'; n bigint;
BEGIN
  WITH latest AS (
    SELECT DISTINCT ON(source_key) snapshot FROM public.prospect_research_candidate_coverage
    WHERE source_table='prospect_enrichment_runs' AND revision<=p_cutoff ORDER BY source_key,revision DESC
  )
  SELECT count(*) INTO n FROM latest r WHERE
    r.snapshot->>'manifest_state'<>'finalized' OR r.snapshot->>'manifest_expected_entry_count' IS NULL
    OR (r.snapshot->>'manifest_expected_entry_count')::bigint <>
      (SELECT count(*) FROM public.prospect_research_candidate_history h
       WHERE h.run_id=(r.snapshot->>'id')::uuid AND h.source_table='prospect_enrichment_run_manifest_items' AND h.coverage_revision<=p_cutoff);
  IF n>0 THEN warnings:=warnings||jsonb_build_array('run_manifest_incomplete:'||n); END IF;
  SELECT count(*) INTO n FROM public.prospect_research_candidate_history m
    WHERE m.source_table='prospect_enrichment_run_manifest_items' AND m.coverage_revision<=p_cutoff
    AND m.original_json->>'clientPackageId' IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM public.prospect_research_candidate_history p WHERE
      p.source_table='prospect_enrichment_packages' AND p.run_id=m.run_id AND p.entry_id=m.entry_id AND p.coverage_revision<=p_cutoff);
  IF n>0 THEN warnings:=warnings||jsonb_build_array('manifest_package_missing:'||n); END IF;
  SELECT count(*) INTO n FROM public.prospect_research_candidate_history m
    WHERE m.source_table='prospect_enrichment_run_manifest_items' AND m.coverage_revision<=p_cutoff
    AND m.original_json->>'clientPackageId' IS NULL
    AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(m.original_json->'errorCodes','[]')) e WHERE e LIKE '__held_evidence_sha256:%')
    AND NOT EXISTS(SELECT 1 FROM public.prospect_research_candidate_history h WHERE h.source_table='prospect_enrichment_manifest_hold_evidence'
      AND h.run_id=m.run_id AND h.entry_id=m.entry_id AND h.coverage_revision<=p_cutoff);
  IF n>0 THEN warnings:=warnings||jsonb_build_array('manifest_hold_body_missing:'||n); END IF;
  SELECT count(*) INTO n FROM public.prospect_research_candidate_history m
    WHERE m.source_table='prospect_enrichment_run_manifest_items' AND m.coverage_revision<=p_cutoff
    AND coalesce((m.original_json->>'itemCount')::integer,0) <>
      (SELECT count(*) FROM public.prospect_research_candidate_history i WHERE i.source_table='prospect_enrichment_items'
       AND i.run_id=m.run_id AND i.entry_id=m.entry_id AND i.coverage_revision<=p_cutoff);
  IF n>0 THEN warnings:=warnings||jsonb_build_array('manifest_item_accounting_incomplete:'||n); END IF;
  SELECT
    (SELECT count(*) FROM public.prospect_enrichment_run_manifest_items s WHERE NOT EXISTS(
       SELECT 1 FROM public.prospect_research_candidate_coverage c WHERE c.source_table='prospect_enrichment_run_manifest_items' AND c.source_key=s.run_id::text||'/'||s.entry_id))+
    (SELECT count(*) FROM public.prospect_enrichment_packages s WHERE NOT EXISTS(
       SELECT 1 FROM public.prospect_research_candidate_coverage c WHERE c.source_table='prospect_enrichment_packages' AND c.source_key=s.id::text))+
    (SELECT count(*) FROM public.prospect_enrichment_manifest_hold_evidence s WHERE NOT EXISTS(
       SELECT 1 FROM public.prospect_research_candidate_coverage c WHERE c.source_table='prospect_enrichment_manifest_hold_evidence' AND c.source_key=s.run_id::text||'/'||s.entry_id))+
    (SELECT count(*) FROM public.prospect_enrichment_items s WHERE NOT EXISTS(
       SELECT 1 FROM public.prospect_research_candidate_coverage c WHERE c.source_table='prospect_enrichment_items' AND c.source_key=s.id::text))+
    (SELECT count(*) FROM public.prospect_enrichment_events s WHERE NOT EXISTS(
       SELECT 1 FROM public.prospect_research_candidate_coverage c WHERE c.source_table='prospect_enrichment_events' AND c.source_key=s.id::text))+
    (SELECT count(*) FROM public.prospect_enrichment_item_targets s WHERE NOT EXISTS(
       SELECT 1 FROM public.prospect_research_candidate_coverage c WHERE c.source_table='prospect_enrichment_item_targets' AND c.source_key=s.item_id::text||'/'||s.target_table||'/'||s.target_id::text))+
    (SELECT count(*) FROM public.prospect_enrichment_profile_choices s WHERE NOT EXISTS(
       SELECT 1 FROM public.prospect_research_candidate_coverage c WHERE c.source_table='prospect_enrichment_profile_choices' AND c.source_key=s.id::text))+
    (SELECT count(*) FROM public.prospect_enrichment_runs s WHERE NOT EXISTS(
       SELECT 1 FROM public.prospect_research_candidate_coverage c WHERE c.source_table='prospect_enrichment_runs' AND c.source_key=s.id::text))
    INTO n;
  IF n>0 THEN warnings:=warnings||jsonb_build_array('unregistered_source_rows:'||n); END IF;
  SELECT count(*) INTO n FROM public.prospect_research_candidate_history h
    WHERE h.coverage_revision<=p_cutoff AND h.read_warnings<>'[]'::jsonb;
  IF n>0 THEN warnings:=warnings||jsonb_build_array('retained_source_warnings:'||n); END IF;
  SELECT count(DISTINCT f.revision_id) INTO n
    FROM public.prospect_research_candidate_fields f
    WHERE f.coverage_revision<=p_cutoff
      AND ((f.observed_at IS NOT NULL AND f.observed_day IS NULL)
        OR (f.retrieved_at IS NOT NULL AND f.retrieved_day IS NULL));
  IF n>0 THEN warnings:=warnings||jsonb_build_array('invalid_source_date:'||n); END IF;
  SELECT count(*) INTO n FROM public.prospect_research_candidate_projection_issues i
    JOIN public.prospect_research_candidate_history h ON h.id=i.revision_id
    WHERE h.coverage_revision<=p_cutoff;
  IF n>0 THEN warnings:=warnings||jsonb_build_array('field_projection_requires_raw_review:'||n); END IF;
  RETURN warnings;
END $$;

COMMIT;
