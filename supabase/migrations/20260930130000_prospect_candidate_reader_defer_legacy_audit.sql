-- Keep candidate search and profiles available while the global legacy-source
-- reconciliation runs through its protected audit path. A read must not claim
-- complete coverage until that audit has actually been performed.
BEGIN;

ALTER FUNCTION prospect_candidate_private.coverage_warnings(bigint)
  RENAME TO coverage_warnings_full_audit;

COMMENT ON FUNCTION prospect_candidate_private.coverage_warnings_full_audit(bigint) IS
  'Full legacy-source reconciliation. Use only from the protected coverage audit; not an interactive candidate-reader dependency.';

CREATE FUNCTION prospect_candidate_private.coverage_warnings(p_cutoff bigint)
RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT prospect_candidate_private.coverage_warnings_enrichment_v1(p_cutoff)
    || '["legacy_source_audit_deferred"]'::jsonb
$$;

COMMENT ON FUNCTION prospect_candidate_private.coverage_warnings(bigint) IS
  'Bounded candidate-reader warnings. The explicit deferred marker keeps complete=false; a separate protected audit and later certification change are required to report full legacy-source coverage.';

REVOKE ALL ON FUNCTION prospect_candidate_private.coverage_warnings(bigint)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
