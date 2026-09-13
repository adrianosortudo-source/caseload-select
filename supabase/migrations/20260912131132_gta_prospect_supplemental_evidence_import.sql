-- Supplemental, evidence-bearing GTA prospect imports.
--
-- This lane enriches firms which have already passed through the core GTA
-- public-research ledger. It never creates a firm, CRM contact, outreach, or
-- browser-callable write path. Every observation is append-only and attached
-- to a replay-safe package so an operator can review one frozen payload before
-- applying it.

CREATE TABLE public.gta_prospect_supplemental_evidence_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id text NOT NULL UNIQUE CHECK (package_id ~ '^[-_a-z0-9]{1,200}$'),
  package_sha256 text NOT NULL CHECK (package_sha256 ~ '^[a-f0-9]{64}$'),
  source_record_count integer NOT NULL CHECK (source_record_count >= 0),
  state text NOT NULL DEFAULT 'staged' CHECK (state IN ('staged', 'applied', 'failed')),
  applied_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'applied') = (applied_at IS NOT NULL))
);

CREATE TABLE public.gta_prospect_supplemental_evidence_import_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_import_batch_id uuid NOT NULL REFERENCES public.gta_prospect_supplemental_evidence_import_batches(id) ON DELETE RESTRICT,
  firm_id uuid NOT NULL REFERENCES public.gta_prospect_firms(id) ON DELETE RESTRICT,
  source_record_key text NOT NULL CHECK (source_record_key ~ '^[a-z0-9][a-z0-9-]{1,159}$'),
  source_record_sha256 text NOT NULL CHECK (source_record_sha256 ~ '^[a-f0-9]{64}$'),
  validation_state text NOT NULL CHECK (validation_state = 'accepted'),
  canonical_record jsonb NOT NULL CHECK (jsonb_typeof(canonical_record) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (evidence_import_batch_id, source_record_key)
);

CREATE TABLE public.gta_prospect_shared_identity_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.gta_prospect_firms(id) ON DELETE RESTRICT,
  evidence_import_batch_id uuid NOT NULL REFERENCES public.gta_prospect_supplemental_evidence_import_batches(id) ON DELETE RESTRICT,
  mapping_id text NOT NULL CHECK (mapping_id ~ '^[-_A-Za-z0-9]{1,200}$'),
  match_state text NOT NULL CHECK (match_state IN ('confirmed', 'unresolved', 'distinct')),
  stable_firm_id text NULL CHECK (stable_firm_id IS NULL OR stable_firm_id ~ '^FIRM-[0-9A-HJKMNP-TV-Z]{26}$'),
  canonical_domain text NULL CHECK (canonical_domain IS NULL OR canonical_domain ~ '^[a-z0-9][a-z0-9.-]{0,251}[a-z0-9]$'),
  observed_on date NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('high', 'moderate', 'unknown')),
  evidence_urls jsonb NOT NULL CHECK (jsonb_typeof(evidence_urls) = 'array'),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 1000),
  raw_observation jsonb NOT NULL CHECK (jsonb_typeof(raw_observation) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (match_state = 'confirmed' AND stable_firm_id IS NOT NULL AND canonical_domain IS NOT NULL AND confidence = 'high')
    OR (match_state IN ('unresolved', 'distinct') AND stable_firm_id IS NULL)
  ),
  UNIQUE (evidence_import_batch_id, mapping_id)
);

CREATE TABLE public.gta_prospect_website_intake_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.gta_prospect_firms(id) ON DELETE RESTRICT,
  evidence_import_batch_id uuid NOT NULL REFERENCES public.gta_prospect_supplemental_evidence_import_batches(id) ON DELETE RESTRICT,
  finding_id text NOT NULL CHECK (finding_id ~ '^[-_A-Za-z0-9]{1,200}$'),
  source_url text NOT NULL CHECK (source_url ~ '^https?://'),
  observed_on date NOT NULL,
  intake_channels jsonb NOT NULL CHECK (jsonb_typeof(intake_channels) = 'array'),
  opportunity_state text NOT NULL CHECK (opportunity_state IN ('supported', 'not_established')),
  opportunity_note text NULL CHECK (opportunity_note IS NULL OR char_length(opportunity_note) <= 1000),
  evidence_urls jsonb NOT NULL CHECK (jsonb_typeof(evidence_urls) = 'array'),
  raw_observation jsonb NOT NULL CHECK (jsonb_typeof(raw_observation) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (evidence_import_batch_id, finding_id)
);

CREATE TABLE public.gta_prospect_qualification_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.gta_prospect_firms(id) ON DELETE RESTRICT,
  evidence_import_batch_id uuid NOT NULL REFERENCES public.gta_prospect_supplemental_evidence_import_batches(id) ON DELETE RESTRICT,
  assessment_id text NOT NULL CHECK (assessment_id ~ '^[-_A-Za-z0-9]{1,200}$'),
  qualification_state text NOT NULL CHECK (qualification_state IN ('qualified', 'needs_evidence', 'disqualified')),
  qualification_cohort text NOT NULL CHECK (qualification_cohort ~ '^[-_a-z0-9]{1,120}$'),
  assessed_on date NOT NULL,
  criteria jsonb NOT NULL CHECK (jsonb_typeof(criteria) = 'object'),
  evidence_urls jsonb NOT NULL CHECK (jsonb_typeof(evidence_urls) = 'array'),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 1000),
  raw_assessment jsonb NOT NULL CHECK (jsonb_typeof(raw_assessment) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    qualification_state <> 'qualified'
    OR criteria ?& ARRAY['lawyerCount', 'downtownGeometry', 'sharedIdentity', 'ownerContact', 'advertisingActivity', 'gbpEvidence', 'websiteIntake']
  ),
  UNIQUE (evidence_import_batch_id, assessment_id)
);

CREATE INDEX gta_prospect_supplemental_evidence_audit_batch_idx
  ON public.gta_prospect_supplemental_evidence_import_audit (evidence_import_batch_id, created_at);
CREATE INDEX gta_prospect_shared_identity_observations_firm_observed_idx
  ON public.gta_prospect_shared_identity_observations (firm_id, observed_on DESC, created_at DESC);
CREATE INDEX gta_prospect_website_intake_observations_firm_observed_idx
  ON public.gta_prospect_website_intake_observations (firm_id, observed_on DESC, created_at DESC);
CREATE INDEX gta_prospect_qualification_assessments_firm_assessed_idx
  ON public.gta_prospect_qualification_assessments (firm_id, assessed_on DESC, created_at DESC);

ALTER TABLE public.gta_prospect_downtown_geography_observations
  ADD COLUMN evidence_import_batch_id uuid NULL REFERENCES public.gta_prospect_supplemental_evidence_import_batches(id) ON DELETE RESTRICT;
CREATE INDEX gta_prospect_downtown_geography_observations_evidence_batch_idx
  ON public.gta_prospect_downtown_geography_observations (evidence_import_batch_id, created_at)
  WHERE evidence_import_batch_id IS NOT NULL;

CREATE TRIGGER gta_prospect_supplemental_evidence_import_audit_no_mutation
  BEFORE UPDATE OR DELETE ON public.gta_prospect_supplemental_evidence_import_audit
  FOR EACH ROW EXECUTE FUNCTION public.reject_gta_prospect_research_history_mutation();
CREATE TRIGGER gta_prospect_shared_identity_observations_no_mutation
  BEFORE UPDATE OR DELETE ON public.gta_prospect_shared_identity_observations
  FOR EACH ROW EXECUTE FUNCTION public.reject_gta_prospect_research_history_mutation();
CREATE TRIGGER gta_prospect_website_intake_observations_no_mutation
  BEFORE UPDATE OR DELETE ON public.gta_prospect_website_intake_observations
  FOR EACH ROW EXECUTE FUNCTION public.reject_gta_prospect_research_history_mutation();
CREATE TRIGGER gta_prospect_qualification_assessments_no_mutation
  BEFORE UPDATE OR DELETE ON public.gta_prospect_qualification_assessments
  FOR EACH ROW EXECUTE FUNCTION public.reject_gta_prospect_research_history_mutation();

ALTER TABLE public.gta_prospect_supplemental_evidence_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_supplemental_evidence_import_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_supplemental_evidence_import_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_supplemental_evidence_import_audit FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_shared_identity_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_shared_identity_observations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_website_intake_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_website_intake_observations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_qualification_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_qualification_assessments FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.gta_prospect_supplemental_evidence_import_batches, public.gta_prospect_supplemental_evidence_import_audit, public.gta_prospect_shared_identity_observations, public.gta_prospect_website_intake_observations, public.gta_prospect_qualification_assessments FROM PUBLIC, anon, authenticated, service_role;

-- Start, apply, complete, and fail are separate so the operator UI can show a
-- frozen review receipt. Exact package replays are harmless; reusing a package
-- identifier with changed content is refused.
CREATE OR REPLACE FUNCTION public.begin_gta_prospect_supplemental_evidence_import(
  p_package_id text,
  p_package_sha256 text,
  p_source_record_count integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE batch public.gta_prospect_supplemental_evidence_import_batches%ROWTYPE;
BEGIN
  IF p_package_id !~ '^[-_a-z0-9]{1,200}$'
     OR p_package_sha256 !~ '^[a-f0-9]{64}$'
     OR p_source_record_count < 0
  THEN
    RAISE EXCEPTION 'invalid supplemental evidence batch arguments';
  END IF;

  INSERT INTO public.gta_prospect_supplemental_evidence_import_batches(
    package_id, package_sha256, source_record_count
  ) VALUES (p_package_id, p_package_sha256, p_source_record_count)
  ON CONFLICT (package_id) DO NOTHING
  RETURNING * INTO batch;
  IF FOUND THEN
    RETURN jsonb_build_object('state', 'ready', 'batch_id', batch.id);
  END IF;

  SELECT * INTO batch
  FROM public.gta_prospect_supplemental_evidence_import_batches
  WHERE package_id = p_package_id
  FOR UPDATE;
  IF batch.package_sha256 <> p_package_sha256
     OR batch.source_record_count <> p_source_record_count
  THEN
    RAISE EXCEPTION 'package identifier already belongs to different evidence content';
  END IF;
  IF batch.state = 'applied' THEN
    RETURN jsonb_build_object('state', 'already_applied', 'batch_id', batch.id);
  END IF;
  IF batch.state = 'failed' THEN
    UPDATE public.gta_prospect_supplemental_evidence_import_batches
    SET state = 'staged', applied_at = NULL
    WHERE id = batch.id;
  END IF;
  RETURN jsonb_build_object('state', 'ready', 'batch_id', batch.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.gta_prospect_supplemental_evidence_record_sha256(
  p_record jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF jsonb_typeof(p_record) <> 'object' THEN
    RAISE EXCEPTION 'supplemental evidence record must be an object';
  END IF;
  RETURN encode(extensions.digest(convert_to(p_record::text, 'utf8'), 'sha256'), 'hex');
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_gta_prospect_supplemental_evidence_record(
  p_batch_id uuid,
  p_record jsonb,
  p_record_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  batch public.gta_prospect_supplemental_evidence_import_batches%ROWTYPE;
  firm uuid;
  source_key text;
  computed_hash text;
  prior_hash text;
  item jsonb;
BEGIN
  IF jsonb_typeof(p_record) <> 'object' THEN
    RAISE EXCEPTION 'supplemental evidence record must be an object';
  END IF;
  source_key := p_record->>'sourceRecordKey';
  IF source_key IS NULL OR source_key !~ '^[a-z0-9][a-z0-9-]{1,159}$' THEN
    RAISE EXCEPTION 'supplemental evidence record has invalid sourceRecordKey';
  END IF;
  computed_hash := public.gta_prospect_supplemental_evidence_record_sha256(p_record);
  IF p_record_sha256 <> computed_hash THEN
    RAISE EXCEPTION 'supplemental evidence record hash does not match canonical record';
  END IF;
  SELECT * INTO batch
  FROM public.gta_prospect_supplemental_evidence_import_batches
  WHERE id = p_batch_id
  FOR UPDATE;
  IF NOT FOUND OR batch.state <> 'staged' THEN
    RAISE EXCEPTION 'supplemental evidence batch is not staged for record application';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('gta-prospect-supplemental-source-key:' || source_key, 20260912131132)
  );
  SELECT audit.source_record_sha256 INTO prior_hash
  FROM public.gta_prospect_supplemental_evidence_import_audit AS audit
  WHERE audit.evidence_import_batch_id = p_batch_id
    AND audit.source_record_key = source_key;
  IF FOUND THEN
    IF prior_hash <> computed_hash THEN
      RAISE EXCEPTION 'supplemental evidence differs for an existing batch/source key';
    END IF;
    RETURN jsonb_build_object('state', 'already_applied');
  END IF;

  SELECT core_audit.firm_id INTO firm
  FROM public.gta_prospect_import_audit AS core_audit
  JOIN public.gta_prospect_import_batches AS core_batch
    ON core_batch.id = core_audit.import_batch_id
   AND core_batch.state = 'applied'
  WHERE core_audit.source_record_key = source_key
    AND core_audit.validation_state = 'accepted'
  ORDER BY core_batch.applied_at DESC, core_audit.created_at DESC
  LIMIT 1;
  IF firm IS NULL THEN
    RAISE EXCEPTION 'supplemental evidence can only reference an applied core source record';
  END IF;

  IF p_record ? 'identityMappings' AND jsonb_typeof(p_record->'identityMappings') <> 'array' THEN
    RAISE EXCEPTION 'identityMappings must be an array';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_record->'identityMappings', '[]'::jsonb)) LOOP
    INSERT INTO public.gta_prospect_shared_identity_observations(
      firm_id, evidence_import_batch_id, mapping_id, match_state, stable_firm_id,
      canonical_domain, observed_on, confidence, evidence_urls, note, raw_observation
    ) VALUES (
      firm, p_batch_id, item->>'mappingId', item->>'matchState', NULLIF(item->>'firmId', ''),
      NULLIF(lower(item->>'canonicalDomain'), ''), (item->>'observedAt')::date,
      item->>'confidence', COALESCE(item->'evidenceUrls', '[]'::jsonb),
      NULLIF(item->>'note', ''), item
    );
  END LOOP;

  IF p_record ? 'downtownGeography' AND jsonb_typeof(p_record->'downtownGeography') <> 'array' THEN
    RAISE EXCEPTION 'downtownGeography must be an array';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_record->'downtownGeography', '[]'::jsonb)) LOOP
    INSERT INTO public.gta_prospect_downtown_geography_observations(
      firm_id, evidence_import_batch_id, boundary_id, geography_status, normalized_address,
      latitude, longitude, coordinate_source_type, coordinate_source_url, boundary_source_url,
      boundary_geometry_sha256, observed_on, confidence, note
    ) VALUES (
      firm, p_batch_id, item->>'boundaryId', item->>'geographyStatus', item->>'normalizedAddress',
      NULLIF(item->>'latitude', '')::numeric, NULLIF(item->>'longitude', '')::numeric,
      NULLIF(item->>'coordinateSourceType', ''), NULLIF(item->>'coordinateSourceUrl', ''),
      item->>'boundarySourceUrl', item->>'boundaryGeometrySha256', (item->>'observedAt')::date,
      item->>'confidence', NULLIF(item->>'note', '')
    );
  END LOOP;

  IF p_record ? 'websiteIntakeFindings' AND jsonb_typeof(p_record->'websiteIntakeFindings') <> 'array' THEN
    RAISE EXCEPTION 'websiteIntakeFindings must be an array';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_record->'websiteIntakeFindings', '[]'::jsonb)) LOOP
    INSERT INTO public.gta_prospect_website_intake_observations(
      firm_id, evidence_import_batch_id, finding_id, source_url, observed_on, intake_channels,
      opportunity_state, opportunity_note, evidence_urls, raw_observation
    ) VALUES (
      firm, p_batch_id, item->>'findingId', item->>'sourceUrl', (item->>'observedAt')::date,
      COALESCE(item->'intakeChannels', '[]'::jsonb), item->>'opportunityState',
      NULLIF(item->>'opportunityNote', ''), COALESCE(item->'evidenceUrls', '[]'::jsonb), item
    );
  END LOOP;

  IF p_record ? 'qualificationAssessments' AND jsonb_typeof(p_record->'qualificationAssessments') <> 'array' THEN
    RAISE EXCEPTION 'qualificationAssessments must be an array';
  END IF;
  IF COALESCE(jsonb_array_length(p_record->'identityMappings'), 0)
     + COALESCE(jsonb_array_length(p_record->'downtownGeography'), 0)
     + COALESCE(jsonb_array_length(p_record->'websiteIntakeFindings'), 0)
     + COALESCE(jsonb_array_length(p_record->'qualificationAssessments'), 0) = 0
  THEN
    RAISE EXCEPTION 'supplemental evidence record must include at least one observation or assessment';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_record->'qualificationAssessments', '[]'::jsonb)) LOOP
    INSERT INTO public.gta_prospect_qualification_assessments(
      firm_id, evidence_import_batch_id, assessment_id, qualification_state, qualification_cohort, assessed_on,
      criteria, evidence_urls, note, raw_assessment
    ) VALUES (
      firm, p_batch_id, item->>'assessmentId', item->>'qualificationState', item->>'qualificationCohort', (item->>'assessedAt')::date,
      COALESCE(item->'criteria', '{}'::jsonb), COALESCE(item->'evidenceUrls', '[]'::jsonb),
      NULLIF(item->>'note', ''), item
    );
  END LOOP;

  INSERT INTO public.gta_prospect_supplemental_evidence_import_audit(
    evidence_import_batch_id, firm_id, source_record_key, source_record_sha256,
    validation_state, canonical_record
  ) VALUES (p_batch_id, firm, source_key, computed_hash, 'accepted', p_record);
  RETURN jsonb_build_object('state', 'applied', 'firm_id', firm);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_gta_prospect_supplemental_evidence_import(
  p_batch_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE batch public.gta_prospect_supplemental_evidence_import_batches%ROWTYPE; applied_count integer;
BEGIN
  SELECT * INTO batch
  FROM public.gta_prospect_supplemental_evidence_import_batches
  WHERE id = p_batch_id
  FOR UPDATE;
  IF NOT FOUND OR batch.state <> 'staged' THEN
    RAISE EXCEPTION 'supplemental evidence batch cannot transition to applied';
  END IF;
  SELECT count(*) INTO applied_count
  FROM public.gta_prospect_supplemental_evidence_import_audit
  WHERE evidence_import_batch_id = batch.id
    AND validation_state = 'accepted';
  IF applied_count <> batch.source_record_count THEN
    RAISE EXCEPTION 'supplemental evidence batch cannot complete until every accepted record is applied';
  END IF;
  UPDATE public.gta_prospect_supplemental_evidence_import_batches
  SET state = 'applied', applied_at = now()
  WHERE id = batch.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_gta_prospect_supplemental_evidence_import(
  p_batch_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE batch public.gta_prospect_supplemental_evidence_import_batches%ROWTYPE;
BEGIN
  SELECT * INTO batch
  FROM public.gta_prospect_supplemental_evidence_import_batches
  WHERE id = p_batch_id
  FOR UPDATE;
  IF NOT FOUND OR batch.state <> 'staged' THEN
    RAISE EXCEPTION 'supplemental evidence batch cannot transition to failed';
  END IF;
  UPDATE public.gta_prospect_supplemental_evidence_import_batches
  SET state = 'failed'
  WHERE id = batch.id;
END;
$$;

-- This read projection intentionally exposes only the latest applied summary
-- for a source key. Raw package payloads and audit records remain private.
CREATE OR REPLACE FUNCTION public.list_gta_prospect_supplemental_evidence_for_operator()
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
  qualification_criteria jsonb
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
    identity_observation.stable_firm_id AS firm_id,
    identity_observation.canonical_domain,
    identity_observation.match_state,
    CASE WHEN identity_observation.observed_on IS NULL THEN NULL ELSE to_char(identity_observation.observed_on, 'YYYY-MM-DD') END,
    identity_observation.confidence,
    website_observation.intake_channels,
    website_observation.opportunity_state,
    CASE WHEN website_observation.observed_on IS NULL THEN NULL ELSE to_char(website_observation.observed_on, 'YYYY-MM-DD') END,
    assessment.qualification_state,
    assessment.qualification_cohort,
    CASE WHEN assessment.assessed_on IS NULL THEN NULL ELSE to_char(assessment.assessed_on, 'YYYY-MM-DD') END,
    assessment.criteria
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
     OR website_observation.id IS NOT NULL
     OR assessment.id IS NOT NULL
  ORDER BY firm.source_record_key;
$$;

-- The original geography reader predates evidence packages. Preserve its
-- established response contract while excluding geography inserted into a
-- staged or failed supplemental package. Legacy observations have no package
-- FK and remain visible exactly as before.
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
    LEFT JOIN public.gta_prospect_supplemental_evidence_import_batches AS supplemental_batch
      ON supplemental_batch.id = candidate.evidence_import_batch_id
    WHERE candidate.firm_id = firm.id
      AND candidate.boundary_id = 'toronto-official-plan-secondary-plan-41'
      AND (candidate.evidence_import_batch_id IS NULL OR supplemental_batch.state = 'applied')
    ORDER BY candidate.observed_on DESC, candidate.created_at DESC, candidate.id DESC
    LIMIT 1
  ) AS observation ON TRUE
  ORDER BY firm.source_record_key;
$$;

REVOKE ALL ON FUNCTION public.begin_gta_prospect_supplemental_evidence_import(text, text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.gta_prospect_supplemental_evidence_record_sha256(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_gta_prospect_supplemental_evidence_record(uuid, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_gta_prospect_supplemental_evidence_import(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fail_gta_prospect_supplemental_evidence_import(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_gta_prospect_supplemental_evidence_for_operator() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_gta_prospect_downtown_geography_for_operator() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.begin_gta_prospect_supplemental_evidence_import(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.gta_prospect_supplemental_evidence_record_sha256(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_gta_prospect_supplemental_evidence_record(uuid, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_gta_prospect_supplemental_evidence_import(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_gta_prospect_supplemental_evidence_import(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_gta_prospect_supplemental_evidence_for_operator() TO service_role;
GRANT EXECUTE ON FUNCTION public.list_gta_prospect_downtown_geography_for_operator() TO service_role;

COMMENT ON TABLE public.gta_prospect_supplemental_evidence_import_batches IS
  'Private replay-safe packages of supplemental GTA prospect evidence. A package cannot create a firm, CRM contact, outreach, or messaging action.';
COMMENT ON TABLE public.gta_prospect_shared_identity_observations IS
  'Private append-only evidence mapping an applied GTA source record to a stable firm identity. Name-only matches are not confirmed identities.';
COMMENT ON TABLE public.gta_prospect_website_intake_observations IS
  'Private append-only visible website and intake-channel evidence. It records observations only; it does not submit forms, chats, or claims absent channels.';
COMMENT ON TABLE public.gta_prospect_qualification_assessments IS
  'Private append-only qualification conclusions. Qualified requires recorded evidence criteria; advertising is observable activity, not spend or investment.';
COMMENT ON FUNCTION public.list_gta_prospect_supplemental_evidence_for_operator() IS
  'Service-role-only current summary of applied supplemental GTA prospect evidence. It exposes no raw package data, CRM state, or outreach capability.';

NOTIFY pgrst, 'reload schema';
