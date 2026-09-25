-- Expose an explicit internal database firm UUID for applied supplemental rows.
-- Keep v2 untouched: firm_id in that contract is the portable FIRM-* identity.
BEGIN;

CREATE FUNCTION public.list_gta_prospect_supplemental_evidence_for_operator_v3()
RETURNS TABLE (
  source_record_key text,
  database_firm_id uuid,
  firm_id text,
  canonical_domain text,
  identity_match_state text,
  identity_observed_on text,
  identity_confidence text,
  website_intake_channels jsonb,
  website_opportunity_state text,
  website_observed_on text,
  qualification_state text,
  qualification_cohort text,
  qualification_assessed_on text,
  qualification_criteria jsonb,
  identity_source text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  WITH applied_firms AS (
    SELECT firm.id, firm.source_record_key
    FROM public.gta_prospect_firms AS firm
    WHERE EXISTS (
      SELECT 1
      FROM public.gta_prospect_import_audit AS audit
      JOIN public.gta_prospect_import_batches AS batch
        ON batch.id = audit.import_batch_id
       AND batch.state = 'applied'
      WHERE audit.firm_id = firm.id
        AND audit.validation_state = 'accepted'
    )
  )
  SELECT
    firm.source_record_key,
    firm.id AS database_firm_id,
    identity_observation.stable_firm_id AS firm_id,
    identity_observation.canonical_domain AS canonical_domain,
    identity_observation.match_state AS identity_match_state,
    to_char(identity_observation.observed_on, 'YYYY-MM-DD') AS identity_observed_on,
    identity_observation.confidence AS identity_confidence,
    website_observation.intake_channels,
    website_observation.opportunity_state,
    to_char(website_observation.observed_on, 'YYYY-MM-DD'),
    assessment.qualification_state,
    assessment.qualification_cohort,
    to_char(assessment.assessed_on, 'YYYY-MM-DD'),
    assessment.criteria,
    CASE WHEN identity_observation.id IS NOT NULL THEN 'supplemental_observation' ELSE NULL END AS identity_source
  FROM applied_firms AS firm
  LEFT JOIN LATERAL (
    SELECT observation.*
    FROM public.gta_prospect_shared_identity_observations AS observation
    JOIN public.gta_prospect_supplemental_evidence_import_batches AS batch
      ON batch.id = observation.evidence_import_batch_id
     AND batch.state = 'applied'
    WHERE observation.firm_id = firm.id
    ORDER BY observation.observed_on DESC, observation.created_at DESC, observation.id DESC
    LIMIT 1
  ) AS identity_observation ON TRUE
  LEFT JOIN public.gta_prospect_stable_identity_registry AS registry
    ON registry.firm_id = firm.id
   AND identity_observation.id IS NULL
  LEFT JOIN LATERAL (
    SELECT observation.*
    FROM public.gta_prospect_website_intake_observations AS observation
    JOIN public.gta_prospect_supplemental_evidence_import_batches AS batch
      ON batch.id = observation.evidence_import_batch_id
     AND batch.state = 'applied'
    WHERE observation.firm_id = firm.id
    ORDER BY observation.observed_on DESC, observation.created_at DESC, observation.id DESC
    LIMIT 1
  ) AS website_observation ON TRUE
  LEFT JOIN LATERAL (
    SELECT observation.*
    FROM public.gta_prospect_qualification_assessments AS observation
    JOIN public.gta_prospect_supplemental_evidence_import_batches AS batch
      ON batch.id = observation.evidence_import_batch_id
     AND batch.state = 'applied'
    WHERE observation.firm_id = firm.id
    ORDER BY observation.assessed_on DESC, observation.created_at DESC, observation.id DESC
    LIMIT 1
  ) AS assessment ON TRUE
  WHERE identity_observation.id IS NOT NULL
     OR registry.id IS NOT NULL
     OR website_observation.id IS NOT NULL
     OR assessment.id IS NOT NULL
  ORDER BY firm.source_record_key;
$$;

REVOKE ALL ON FUNCTION public.list_gta_prospect_supplemental_evidence_for_operator_v3() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_gta_prospect_supplemental_evidence_for_operator_v3() TO service_role;
COMMENT ON FUNCTION public.list_gta_prospect_supplemental_evidence_for_operator_v3() IS
  'Service-role-only applied supplemental summary with separately named internal database firm UUID; firm_id remains the portable stable identity. This is read-only and grants no import or outreach capability.';

NOTIFY pgrst, 'reload schema';
COMMIT;
