-- Private, append-only owner-contact research for the GTA prospect ledger.
--
-- This is deliberately separate from the core GTA research import contract.
-- The core ledger remains public-evidence firm research with no contact
-- fields. This companion table only records a publicly published business
-- contact route when it is tied to a reviewed owner/leader identity.

CREATE TABLE public.gta_prospect_owner_contact_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.gta_prospect_firms(id) ON DELETE RESTRICT,
  owner_name text NOT NULL CHECK (char_length(btrim(owner_name)) BETWEEN 1 AND 240),
  owner_role text NOT NULL CHECK (
    owner_role IN ('sole_proprietor', 'owner', 'founding_partner', 'managing_partner', 'other_partner')
  ),
  ownership_confidence text NOT NULL CHECK (
    ownership_confidence IN ('confirmed_owner', 'leadership_only')
  ),
  ownership_source_type text NOT NULL CHECK (
    ownership_source_type IN ('reviewed_website', 'reviewed_directory', 'reviewed_regulator', 'import_source')
  ),
  ownership_source_url text NOT NULL CHECK (ownership_source_url ~ '^https?://'),
  ownership_observed_on date NOT NULL,
  email_availability text NOT NULL CHECK (
    email_availability IN ('direct_owner_email', 'firm_general_email', 'unavailable')
  ),
  email_address text NULL CHECK (
    email_address IS NULL OR (
      char_length(btrim(email_address)) BETWEEN 3 AND 320
      AND email_address ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  ),
  email_source_type text NULL CHECK (
    email_source_type IS NULL OR email_source_type IN ('reviewed_website', 'reviewed_directory', 'reviewed_regulator', 'import_source')
  ),
  email_source_url text NULL CHECK (email_source_url IS NULL OR email_source_url ~ '^https?://'),
  email_observed_on date NULL,
  is_primary_contact boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (email_availability = 'unavailable'
      AND email_address IS NULL
      AND email_source_type IS NULL
      AND email_source_url IS NULL
      AND email_observed_on IS NULL)
    OR
    (email_availability IN ('direct_owner_email', 'firm_general_email')
      AND email_address IS NOT NULL
      AND email_source_type IS NOT NULL
      AND email_source_url IS NOT NULL
      AND email_observed_on IS NOT NULL)
  ),
  CHECK (
    email_availability <> 'direct_owner_email'
    OR ownership_confidence = 'confirmed_owner'
  )
);

CREATE INDEX gta_prospect_owner_contact_observations_firm_observed_idx
  ON public.gta_prospect_owner_contact_observations (firm_id, ownership_observed_on DESC, created_at DESC);

CREATE TRIGGER gta_prospect_owner_contact_observations_no_mutation
  BEFORE UPDATE OR DELETE ON public.gta_prospect_owner_contact_observations
  FOR EACH ROW EXECUTE FUNCTION public.reject_gta_prospect_research_history_mutation();

ALTER TABLE public.gta_prospect_owner_contact_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_owner_contact_observations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gta_prospect_owner_contact_observations FROM PUBLIC, anon, authenticated, service_role;

-- The operator receives a small, current summary only. The raw evidence
-- ledger remains private, and browser roles cannot call this function.
CREATE OR REPLACE FUNCTION public.list_gta_prospect_owner_contacts_for_operator()
RETURNS TABLE (
  source_record_key text,
  owner_name text,
  owner_role text,
  ownership_confidence text,
  ownership_source_url text,
  ownership_observed_on text,
  email_availability text,
  email_address text,
  email_source_url text,
  email_observed_on text,
  is_primary_contact boolean
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
    contact.owner_name,
    contact.owner_role,
    contact.ownership_confidence,
    contact.ownership_source_url,
    to_char(contact.ownership_observed_on, 'YYYY-MM-DD') AS ownership_observed_on,
    contact.email_availability,
    contact.email_address,
    contact.email_source_url,
    CASE WHEN contact.email_observed_on IS NULL THEN NULL
      ELSE to_char(contact.email_observed_on, 'YYYY-MM-DD') END AS email_observed_on,
    contact.is_primary_contact
  FROM applied_firms AS firm
  JOIN LATERAL (
    SELECT observation.*
    FROM public.gta_prospect_owner_contact_observations AS observation
    WHERE observation.firm_id = firm.id
    ORDER BY observation.is_primary_contact DESC, observation.ownership_observed_on DESC, observation.created_at DESC, observation.id DESC
    LIMIT 1
  ) AS contact ON TRUE
  ORDER BY firm.source_record_key;
$$;

REVOKE ALL ON FUNCTION public.list_gta_prospect_owner_contacts_for_operator() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_gta_prospect_owner_contacts_for_operator() TO service_role;

COMMENT ON TABLE public.gta_prospect_owner_contact_observations IS
  'Private append-only evidence of publicly published owner identity and business email. It is separate from the core GTA research import and has no outreach, CRM, or messaging state.';
COMMENT ON FUNCTION public.list_gta_prospect_owner_contacts_for_operator() IS
  'Service-role-only current summary of private GTA owner-contact research. Direct owner email requires confirmed ownership and a published source.';

NOTIFY pgrst, 'reload schema';
