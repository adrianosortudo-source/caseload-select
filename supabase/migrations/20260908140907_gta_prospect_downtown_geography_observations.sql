-- Private, append-only Downtown Toronto geography evidence for the GTA
-- prospect ledger. This stores a reproducible point-in-polygon conclusion;
-- it does not infer Downtown membership from a city label or postal code.

CREATE TABLE public.gta_prospect_downtown_geography_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.gta_prospect_firms(id) ON DELETE RESTRICT,
  boundary_id text NOT NULL CHECK (
    boundary_id = 'toronto-official-plan-secondary-plan-41'
  ),
  geography_status text NOT NULL CHECK (
    geography_status IN ('inside', 'outside', 'needs_manual_review')
  ),
  normalized_address text NOT NULL CHECK (
    char_length(btrim(normalized_address)) BETWEEN 1 AND 500
  ),
  latitude numeric(9, 6) NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9, 6) NULL CHECK (longitude BETWEEN -180 AND 180),
  coordinate_source_type text NULL CHECK (
    coordinate_source_type IS NULL OR coordinate_source_type IN (
      'toronto_one_address_repository', 'reviewed_geocoder',
      'reviewed_firm_website', 'manual_review'
    )
  ),
  coordinate_source_url text NULL CHECK (
    coordinate_source_url IS NULL OR coordinate_source_url ~ '^https?://'
  ),
  boundary_source_url text NOT NULL CHECK (boundary_source_url ~ '^https?://'),
  boundary_geometry_sha256 text NOT NULL CHECK (
    boundary_geometry_sha256 ~ '^[a-f0-9]{64}$'
  ),
  observed_on date NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('high', 'moderate', 'unknown')),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (latitude IS NULL AND longitude IS NULL AND coordinate_source_type IS NULL AND coordinate_source_url IS NULL)
    OR
    (latitude IS NOT NULL AND longitude IS NOT NULL AND coordinate_source_type IS NOT NULL AND coordinate_source_url IS NOT NULL)
  ),
  CHECK (
    geography_status = 'needs_manual_review'
    OR (latitude IS NOT NULL AND longitude IS NOT NULL)
  )
);

CREATE INDEX gta_prospect_downtown_geography_observations_firm_observed_idx
  ON public.gta_prospect_downtown_geography_observations (firm_id, observed_on DESC, created_at DESC);

CREATE TRIGGER gta_prospect_downtown_geography_observations_no_mutation
  BEFORE UPDATE OR DELETE ON public.gta_prospect_downtown_geography_observations
  FOR EACH ROW EXECUTE FUNCTION public.reject_gta_prospect_research_history_mutation();

ALTER TABLE public.gta_prospect_downtown_geography_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_downtown_geography_observations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gta_prospect_downtown_geography_observations FROM PUBLIC, anon, authenticated, service_role;

-- The raw observation table remains inaccessible. A service-only function
-- returns the latest evidence-bearing conclusion for each applied firm.
CREATE OR REPLACE FUNCTION public.list_gta_prospect_downtown_geography_for_operator()
RETURNS TABLE (
  source_record_key text,
  boundary_id text,
  geography_status text,
  normalized_address text,
  latitude numeric,
  longitude numeric,
  coordinate_source_type text,
  coordinate_source_url text,
  boundary_source_url text,
  boundary_geometry_sha256 text,
  observed_on text,
  confidence text,
  note text
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
    observation.boundary_id,
    observation.geography_status,
    observation.normalized_address,
    observation.latitude,
    observation.longitude,
    observation.coordinate_source_type,
    observation.coordinate_source_url,
    observation.boundary_source_url,
    observation.boundary_geometry_sha256,
    to_char(observation.observed_on, 'YYYY-MM-DD') AS observed_on,
    observation.confidence,
    observation.note
  FROM applied_firms AS firm
  JOIN LATERAL (
    SELECT candidate.*
    FROM public.gta_prospect_downtown_geography_observations AS candidate
    WHERE candidate.firm_id = firm.id
      AND candidate.boundary_id = 'toronto-official-plan-secondary-plan-41'
    ORDER BY candidate.observed_on DESC, candidate.created_at DESC, candidate.id DESC
    LIMIT 1
  ) AS observation ON TRUE
  ORDER BY firm.source_record_key;
$$;

REVOKE ALL ON FUNCTION public.list_gta_prospect_downtown_geography_for_operator() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_gta_prospect_downtown_geography_for_operator() TO service_role;

COMMENT ON TABLE public.gta_prospect_downtown_geography_observations IS
  'Private append-only point-in-polygon evidence for the Toronto Downtown Plan (Secondary Plan 41). It does not authorize outreach, CRM import, or messaging.';
COMMENT ON FUNCTION public.list_gta_prospect_downtown_geography_for_operator() IS
  'Service-role-only current summary of private Downtown Toronto geography evidence tied to applied GTA prospect identities.';

NOTIFY pgrst, 'reload schema';
