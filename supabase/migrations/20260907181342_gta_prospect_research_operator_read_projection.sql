-- Narrow, read-only operator projection for the internal GTA public-research
-- ledger.  The underlying tables intentionally remain inaccessible to every
-- API role, including service_role.  This function is the sole read boundary
-- for the server-side operator route.
--
-- It returns public firm-research evidence only.  It deliberately excludes
-- contact details, lawyer identities, raw audit JSON, hashes, CRM IDs, import
-- operations, and any messaging or outreach state.

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
    ARRAY[]::text[] AS practice_areas,
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
      -- Offices do not carry a batch foreign key, so bound them to the
      -- selected applied roster's completion time as well as its source
      -- provenance. This excludes an appended staged observation that happens
      -- to reuse an older source URL and date.
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

NOTIFY pgrst, 'reload schema';
