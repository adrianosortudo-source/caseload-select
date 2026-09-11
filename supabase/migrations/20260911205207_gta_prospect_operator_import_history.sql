-- Operator-only, read-only history for the GTA public-research import UI.
-- The projection intentionally omits raw records, canonical audit JSON,
-- contact observations, CRM references, and all outreach state.

CREATE OR REPLACE FUNCTION public.list_gta_prospect_import_history_for_operator()
RETURNS TABLE(
  source_name text,
  source_sha256 text,
  source_record_count integer,
  state text,
  applied_at text,
  created_at text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT
    batch.source_name,
    batch.source_sha256,
    batch.source_record_count,
    batch.state,
    CASE WHEN batch.applied_at IS NULL THEN NULL ELSE to_char(batch.applied_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') END,
    to_char(batch.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF')
  FROM public.gta_prospect_import_batches AS batch
  ORDER BY batch.created_at DESC, batch.id DESC
  LIMIT 10;
$$;

REVOKE ALL ON FUNCTION public.list_gta_prospect_import_history_for_operator() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_gta_prospect_import_history_for_operator() TO service_role;

COMMENT ON FUNCTION public.list_gta_prospect_import_history_for_operator() IS
  'Service-only, read-only last-ten metadata projection for internal GTA public-research imports. It omits records, audits, contacts, CRM, and outreach data.';

NOTIFY pgrst, 'reload schema';
