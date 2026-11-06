-- Prepare a separately invoked cutover. Applying this migration removes no data.
CREATE FUNCTION public.archive_candidate_research_to_local_v1(p_counts jsonb, p_manifest_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE
  tables constant text[] := ARRAY['prospect_research_candidates','prospect_research_candidate_coverage','prospect_research_candidate_history','prospect_research_candidate_fields','prospect_research_candidate_search_chunks','prospect_research_candidate_content_chunks','prospect_research_candidate_projection_issues'];
  t text; actual_count bigint; item record;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'postgres operator required'; END IF;
  IF p_manifest_sha256 IS NULL OR p_manifest_sha256 !~ '^[a-f0-9]{64}$'
    OR p_counts IS NULL OR jsonb_typeof(p_counts) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_counts)) <> 7 THEN
    RAISE EXCEPTION 'verified local manifest and exact seven-table counts required';
  END IF;
  -- Serialize with the projection writer and lock every archived relation before comparing.
  PERFORM pg_advisory_xact_lock(hashtextextended('prospect_candidate_local_archive',0));
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', t);
    IF NOT p_counts ? t OR jsonb_typeof(p_counts->t) <> 'number' THEN RAISE EXCEPTION 'missing archive count for %',t; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I',t) INTO actual_count;
    IF actual_count <> (p_counts->>t)::bigint THEN RAISE EXCEPTION 'source changed for %',t; END IF;
  END LOOP;
  -- Stop only the derived research projection. Keep client/CRM/source triggers and data.
  FOR item IN
    SELECT n.nspname,c.relname,tr.tgname FROM pg_trigger tr
    JOIN pg_class c ON c.oid=tr.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc f ON f.oid=tr.tgfoid JOIN pg_namespace fn ON fn.oid=f.pronamespace
    WHERE fn.nspname='prospect_candidate_private' AND n.nspname='public'
      AND NOT tr.tgisinternal AND NOT (c.relname=ANY(tables))
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DISABLE TRIGGER %I',item.nspname,item.relname,item.tgname);
  END LOOP;
  -- No CASCADE: a new external dependency must block the cutover for review.
  TRUNCATE public.prospect_research_candidate_fields,
    public.prospect_research_candidate_search_chunks,
    public.prospect_research_candidate_content_chunks,
    public.prospect_research_candidate_projection_issues,
    public.prospect_research_candidate_history,
    public.prospect_research_candidate_coverage,
    public.prospect_research_candidates;
  RETURN jsonb_build_object('storage','local','manifestSha256',p_manifest_sha256,'archivedCounts',p_counts);
END $function$;
REVOKE ALL ON FUNCTION public.archive_candidate_research_to_local_v1(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION public.archive_candidate_research_to_local_v1(jsonb,text) IS 'Operator-only explicit cutover after verified local export and portal release. Migration alone removes no rows.';
