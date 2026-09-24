-- Restore current, source-backed practice-area values and expose stable
-- registry identity only when no applied supplemental identity observation
-- exists. Explicit unresolved/distinct observations always take precedence.

CREATE OR REPLACE FUNCTION public.list_gta_prospect_research_for_operator()
RETURNS TABLE (
  id text,
  firm_name text,
  city text,
  office_cities text[],
  website_url text,
  practice_areas text[],
  observed_lawyer_count integer,
  observed_lawyer_count_qualifier text,
  observed_lawyer_count_display text,
  roster_source_url text,
  roster_checked_at text,
  reconciliation_status text,
  legacy_cluster_lawyer_count integer,
  legacy_crosswalk text,
  reconciliation_note text,
  advertising_evidence text,
  advertising_source_url text,
  gbp_evidence text,
  gbp_source_url text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  WITH eligible_firms AS (
    SELECT firm.id, firm.source_record_key, firm.display_name, firm.website_url, firm.reconciliation_status
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
    firm.source_record_key AS id,
    firm.display_name AS firm_name,
    offices.city,
    offices.office_cities,
    firm.website_url,
    practices.practice_areas,
    roster.observed_lawyer_count,
    roster.count_qualifier AS observed_lawyer_count_qualifier,
    roster.count_display AS observed_lawyer_count_display,
    roster.source_url AS roster_source_url,
    to_char(roster.observed_on, 'YYYY-MM-DD') AS roster_checked_at,
    firm.reconciliation_status,
    NULL::integer AS legacy_cluster_lawyer_count,
    NULL::text AS legacy_crosswalk,
    identity.adjudication_basis AS reconciliation_note,
    CASE WHEN advertising.source_url IS NULL THEN 'unknown' ELSE 'observed' END AS advertising_evidence,
    advertising.source_url AS advertising_source_url,
    CASE WHEN gbp.source_url IS NULL THEN 'unknown' ELSE 'observed' END AS gbp_evidence,
    gbp.source_url AS gbp_source_url
  FROM eligible_firms AS firm
  JOIN LATERAL (
    SELECT observation.*, batch.applied_at
    FROM public.gta_prospect_roster_observations AS observation
    JOIN public.gta_prospect_import_batches AS batch
      ON batch.id = observation.import_batch_id
     AND batch.state = 'applied'
    WHERE observation.firm_id = firm.id
    ORDER BY observation.observed_on DESC, observation.id DESC
    LIMIT 1
  ) AS roster ON TRUE
  JOIN LATERAL (
    SELECT
      array_agg(DISTINCT office.city ORDER BY office.city) AS office_cities,
      (array_agg(DISTINCT office.city ORDER BY office.city))[1] AS city
    FROM public.gta_prospect_offices AS office
    WHERE office.firm_id = firm.id
      AND office.created_at <= roster.applied_at
      AND EXISTS (
        SELECT 1
        FROM public.gta_prospect_roster_observations AS office_roster
        JOIN public.gta_prospect_import_batches AS office_batch
          ON office_batch.id = office_roster.import_batch_id
         AND office_batch.state = 'applied'
        WHERE office_roster.firm_id = firm.id
          AND office_roster.source_url = office.source_url
          AND office_roster.observed_on = office.observed_on
      )
  ) AS offices ON cardinality(offices.office_cities) > 0
  LEFT JOIN LATERAL (
    SELECT coalesce(array_agg(area.value ORDER BY area.ordinality), ARRAY[]::text[]) AS practice_areas
    FROM (
      SELECT audit.canonical_record->'practiceAreas' AS practice_areas_json
      FROM public.gta_prospect_import_audit AS audit
      JOIN public.gta_prospect_import_batches AS batch
        ON batch.id = audit.import_batch_id
       AND batch.state = 'applied'
      WHERE audit.firm_id = firm.id
        AND audit.validation_state = 'accepted'
      ORDER BY batch.applied_at DESC, audit.created_at DESC, audit.id DESC
      LIMIT 1
    ) AS latest
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(latest.practice_areas_json) = 'array'
          THEN latest.practice_areas_json
        ELSE '[]'::jsonb
      END
    ) WITH ORDINALITY AS area(value, ordinality)
  ) AS practices ON TRUE
  LEFT JOIN LATERAL (
    SELECT adjudication.adjudication_basis
    FROM public.gta_prospect_identity_adjudications AS adjudication
    LEFT JOIN public.gta_prospect_import_batches AS batch
      ON batch.id = adjudication.import_batch_id
    WHERE adjudication.firm_id = firm.id
      AND (adjudication.import_batch_id IS NULL OR batch.state = 'applied')
    ORDER BY adjudication.observed_on DESC, adjudication.id DESC
    LIMIT 1
  ) AS identity ON TRUE
  LEFT JOIN LATERAL (
    SELECT evidence.source_url
    FROM public.gta_prospect_evidence_links AS evidence
    JOIN public.gta_prospect_import_batches AS batch
      ON batch.id = evidence.import_batch_id
     AND batch.state = 'applied'
    WHERE evidence.firm_id = firm.id
      AND evidence.evidence_type = 'advertising'
    ORDER BY evidence.observed_on DESC, evidence.id DESC
    LIMIT 1
  ) AS advertising ON TRUE
  LEFT JOIN LATERAL (
    SELECT evidence.source_url
    FROM public.gta_prospect_evidence_links AS evidence
    JOIN public.gta_prospect_import_batches AS batch
      ON batch.id = evidence.import_batch_id
     AND batch.state = 'applied'
    WHERE evidence.firm_id = firm.id
      AND evidence.evidence_type = 'google_business_profile'
    ORDER BY evidence.observed_on DESC, evidence.id DESC
    LIMIT 1
  ) AS gbp ON TRUE
  ORDER BY firm.display_name, firm.source_record_key;
$$;

REVOKE ALL ON FUNCTION public.list_gta_prospect_research_for_operator() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_gta_prospect_research_for_operator() TO service_role;
COMMENT ON FUNCTION public.list_gta_prospect_research_for_operator() IS
  'Service-role-only, read-only projection for the operator GTA public-research console. It does not expose contact, CRM, outreach, raw import, or lawyer data.';

CREATE OR REPLACE FUNCTION public.list_gta_prospect_supplemental_evidence_for_operator_v2()
RETURNS TABLE (
  source_record_key text,
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
    CASE WHEN identity_observation.id IS NULL THEN registry.stable_firm_id ELSE identity_observation.stable_firm_id END AS firm_id,
    CASE WHEN identity_observation.id IS NULL THEN registry.canonical_domain ELSE identity_observation.canonical_domain END AS canonical_domain,
    CASE WHEN identity_observation.id IS NULL AND registry.id IS NOT NULL THEN 'confirmed' ELSE identity_observation.match_state END AS identity_match_state,
    CASE WHEN identity_observation.id IS NULL THEN to_char(registry.observed_on, 'YYYY-MM-DD') ELSE to_char(identity_observation.observed_on, 'YYYY-MM-DD') END AS identity_observed_on,
    CASE WHEN identity_observation.id IS NULL THEN registry.confidence ELSE identity_observation.confidence END AS identity_confidence,
    website_observation.intake_channels,
    website_observation.opportunity_state,
    to_char(website_observation.observed_on, 'YYYY-MM-DD'),
    assessment.qualification_state,
    assessment.qualification_cohort,
    to_char(assessment.assessed_on, 'YYYY-MM-DD'),
    assessment.criteria,
    CASE WHEN identity_observation.id IS NOT NULL THEN 'supplemental_observation'
         WHEN registry.id IS NOT NULL THEN 'stable_identity_registry'
         ELSE NULL END AS identity_source
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

REVOKE ALL ON FUNCTION public.list_gta_prospect_supplemental_evidence_for_operator_v2() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_gta_prospect_supplemental_evidence_for_operator_v2() TO service_role;
COMMENT ON FUNCTION public.list_gta_prospect_supplemental_evidence_for_operator_v2() IS
  'Service-role-only current summary of applied supplemental evidence and registry-backed identity fallback. It exposes no raw package data, CRM state, or outreach capability.';

NOTIFY pgrst, 'reload schema';
