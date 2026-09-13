-- Authoritative, one-to-one identity bridge for GTA prospect research.
--
-- The UUID in gta_prospect_firms remains the database primary key.  This
-- registry assigns the portable FIRM-* identifier only after source-backed
-- adjudication, so the prospect list and any CaseLoad Select audit refer to
-- the same firm, domain, and supporting source.  It intentionally does not
-- backfill historic supplemental observations: an observation is not an
-- authoritative identity allocation.

CREATE TABLE public.gta_prospect_stable_identity_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL UNIQUE REFERENCES public.gta_prospect_firms(id) ON DELETE RESTRICT,
  stable_firm_id text NOT NULL UNIQUE CHECK (stable_firm_id ~ '^FIRM-[0-9A-HJKMNP-TV-Z]{26}$'),
  canonical_domain text NOT NULL UNIQUE CHECK (
    canonical_domain ~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$'
    AND canonical_domain !~ '^www\\.'
    AND canonical_domain = lower(canonical_domain)
  ),
  source_url text NOT NULL CHECK (source_url ~ '^https?://'),
  observed_on date NOT NULL,
  confidence text NOT NULL DEFAULT 'high' CHECK (confidence = 'high'),
  adjudication_basis text NOT NULL CHECK (char_length(btrim(adjudication_basis)) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX gta_prospect_stable_identity_registry_domain_idx
  ON public.gta_prospect_stable_identity_registry (canonical_domain);

ALTER TABLE public.gta_prospect_stable_identity_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_stable_identity_registry FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gta_prospect_stable_identity_registry FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER gta_prospect_stable_identity_registry_no_mutation
  BEFORE UPDATE OR DELETE ON public.gta_prospect_stable_identity_registry
  FOR EACH ROW EXECUTE FUNCTION public.reject_gta_prospect_research_history_mutation();

-- This trigger closes the old supplemental-evidence loophole: a confirmed
-- mapping must name the exact portable identity already allocated to the
-- underlying gta_prospect_firms row.  Unresolved and distinct observations
-- remain valid research states and do not allocate an identity.
CREATE OR REPLACE FUNCTION public.assert_gta_prospect_registered_identity_observation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.match_state = 'confirmed' AND NOT EXISTS (
    SELECT 1
    FROM public.gta_prospect_stable_identity_registry AS registry
    WHERE registry.firm_id = NEW.firm_id
      AND registry.stable_firm_id = NEW.stable_firm_id
      AND registry.canonical_domain = NEW.canonical_domain
  ) THEN
    RAISE EXCEPTION 'confirmed supplemental identity must match the authoritative GTA stable-identity registry';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_gta_prospect_registered_identity_observation() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER gta_prospect_identity_observations_require_registered_identity
  BEFORE INSERT ON public.gta_prospect_identity_observations
  FOR EACH ROW EXECUTE FUNCTION public.assert_gta_prospect_registered_identity_observation();

-- The service-only allocator is idempotent only for the same fully evidenced
-- allocation.  It cannot silently replace an identity, domain, or source.
CREATE OR REPLACE FUNCTION public.register_gta_prospect_stable_identity(
  p_source_record_key text,
  p_stable_firm_id text,
  p_canonical_domain text,
  p_source_url text,
  p_observed_on date,
  p_adjudication_basis text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_firm_id uuid;
  v_existing public.gta_prospect_stable_identity_registry%ROWTYPE;
BEGIN
  IF coalesce(p_source_record_key, '') !~ '^[a-z0-9][a-z0-9-]{1,159}$'
    OR coalesce(p_stable_firm_id, '') !~ '^FIRM-[0-9A-HJKMNP-TV-Z]{26}$'
    OR coalesce(p_canonical_domain, '') !~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$'
    OR p_canonical_domain ~ '^www\\.'
    OR p_canonical_domain IS DISTINCT FROM lower(p_canonical_domain)
    OR coalesce(p_source_url, '') !~ '^https?://'
    OR p_observed_on IS NULL
    OR char_length(btrim(coalesce(p_adjudication_basis, ''))) NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'invalid GTA stable-identity allocation arguments';
  END IF;

  SELECT firm.id INTO v_firm_id
  FROM public.gta_prospect_firms AS firm
  WHERE firm.source_record_key = p_source_record_key;
  IF v_firm_id IS NULL THEN
    RAISE EXCEPTION 'stable identity can only reference an applied GTA source record';
  END IF;

  SELECT * INTO v_existing
  FROM public.gta_prospect_stable_identity_registry AS registry
  WHERE registry.firm_id = v_firm_id;
  IF FOUND THEN
    IF v_existing.stable_firm_id = p_stable_firm_id
      AND v_existing.canonical_domain = p_canonical_domain
      AND v_existing.source_url = p_source_url
      AND v_existing.observed_on = p_observed_on
      AND v_existing.adjudication_basis = btrim(p_adjudication_basis) THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'stable identity is already allocated for this GTA source record and is immutable';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.gta_prospect_stable_identity_registry AS registry
    WHERE registry.stable_firm_id = p_stable_firm_id
       OR registry.canonical_domain = p_canonical_domain
  ) THEN
    RAISE EXCEPTION 'stable firm ID or canonical domain is already allocated to a different GTA firm';
  END IF;

  INSERT INTO public.gta_prospect_stable_identity_registry (
    firm_id, stable_firm_id, canonical_domain, source_url, observed_on, adjudication_basis
  ) VALUES (
    v_firm_id, p_stable_firm_id, p_canonical_domain, p_source_url, p_observed_on, btrim(p_adjudication_basis)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_gta_prospect_stable_identities_for_operator()
RETURNS TABLE(
  source_record_key text,
  stable_firm_id text,
  canonical_domain text,
  source_url text,
  observed_on date,
  confidence text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    firm.source_record_key,
    registry.stable_firm_id,
    registry.canonical_domain,
    registry.source_url,
    registry.observed_on,
    registry.confidence
  FROM public.gta_prospect_stable_identity_registry AS registry
  JOIN public.gta_prospect_firms AS firm ON firm.id = registry.firm_id
  ORDER BY firm.source_record_key;
$$;

REVOKE ALL ON FUNCTION public.register_gta_prospect_stable_identity(text, text, text, text, date, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_gta_prospect_stable_identities_for_operator() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_gta_prospect_stable_identity(text, text, text, text, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_gta_prospect_stable_identities_for_operator() TO service_role;

COMMENT ON TABLE public.gta_prospect_stable_identity_registry IS
  'Private, immutable bridge between an applied GTA prospect firm UUID and the shared portable FIRM identity used by CaseLoad Select audit records.';
COMMENT ON FUNCTION public.register_gta_prospect_stable_identity(text, text, text, text, date, text) IS
  'Service-only, immutable, source-backed allocation of a portable FIRM identity to an applied GTA prospect record.';
COMMENT ON FUNCTION public.list_gta_prospect_stable_identities_for_operator() IS
  'Service-only projection of authoritative GTA prospect stable identities for the operator prospect registry.';
