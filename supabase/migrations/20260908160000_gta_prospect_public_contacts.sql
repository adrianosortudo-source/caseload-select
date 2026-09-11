-- Public owner and email observations for the GTA prospect-research ledger.
-- These are source-backed public facts for the private operator console. They
-- do not create a CRM contact, permit outreach, or alter consent controls.

CREATE TABLE public.gta_prospect_public_contact_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.gta_prospect_firms(id) ON DELETE RESTRICT,
  import_batch_id uuid NULL REFERENCES public.gta_prospect_import_batches(id) ON DELETE RESTRICT,
  contact_name text NULL CHECK (contact_name IS NULL OR char_length(btrim(contact_name)) BETWEEN 1 AND 300),
  relationship text NOT NULL CHECK (relationship IN ('owner', 'founder', 'principal', 'named_lawyer', 'firm_inbox')),
  public_email text NULL CHECK (public_email IS NULL OR public_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  email_kind text NOT NULL CHECK (email_kind IN ('owner', 'named_person', 'general_firm')),
  source_url text NOT NULL CHECK (source_url ~ '^https?://'),
  observed_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (contact_name IS NOT NULL OR public_email IS NOT NULL),
  UNIQUE NULLS NOT DISTINCT (firm_id, relationship, contact_name, public_email, source_url, observed_on)
);

CREATE INDEX gta_prospect_public_contact_observations_firm_idx
  ON public.gta_prospect_public_contact_observations (firm_id, observed_on DESC);

ALTER TABLE public.gta_prospect_public_contact_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_public_contact_observations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gta_prospect_public_contact_observations FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER gta_prospect_public_contact_observations_no_mutation
  BEFORE UPDATE OR DELETE ON public.gta_prospect_public_contact_observations
  FOR EACH ROW EXECUTE FUNCTION public.reject_gta_prospect_research_history_mutation();

CREATE OR REPLACE FUNCTION public.gta_prospect_research_public_contacts_canonical(p_contacts jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE item jsonb; observed text; normalized jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(p_contacts) <> 'array' THEN RAISE EXCEPTION 'public contacts must be an array'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_contacts) LOOP
    IF jsonb_typeof(item) <> 'object'
      OR NOT (item ?& ARRAY['name', 'relationship', 'email', 'emailKind', 'sourceUrl', 'observedAt'])
      OR item - ARRAY['name', 'relationship', 'email', 'emailKind', 'sourceUrl', 'observedAt'] <> '{}'::jsonb
      OR jsonb_typeof(item->'name') NOT IN ('string', 'null')
      OR jsonb_typeof(item->'email') NOT IN ('string', 'null')
      OR coalesce(item->>'relationship', '') NOT IN ('owner', 'founder', 'principal', 'named_lawyer', 'firm_inbox')
      OR coalesce(item->>'emailKind', '') NOT IN ('owner', 'named_person', 'general_firm')
      OR coalesce(item->>'sourceUrl', '') !~ '^https?://'
      OR (item->>'name' IS NULL AND item->>'email' IS NULL)
      OR (item->>'name' IS NOT NULL AND char_length(btrim(item->>'name')) NOT BETWEEN 1 AND 300)
      OR (item->>'email' IS NOT NULL AND item->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') THEN
      RAISE EXCEPTION 'public contact has invalid fields';
    END IF;
    observed := item->>'observedAt';
    IF observed !~ '^\d{4}-\d{2}-\d{2}$' OR to_char(to_date(observed, 'YYYY-MM-DD'), 'YYYY-MM-DD') <> observed THEN
      RAISE EXCEPTION 'public contact has invalid observation date';
    END IF;
    normalized := normalized || jsonb_build_array(jsonb_build_object(
      'name', NULLIF(btrim(item->>'name'), ''), 'relationship', item->>'relationship',
      'email', lower(NULLIF(btrim(item->>'email'), '')), 'emailKind', item->>'emailKind',
      'sourceUrl', item->>'sourceUrl', 'observedAt', observed
    ));
  END LOOP;
  RETURN normalized;
END; $$;

CREATE OR REPLACE FUNCTION public.apply_gta_prospect_research_record_with_contacts(
  p_batch_id uuid, p_record jsonb, p_record_sha256 text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE contacts jsonb; base_record jsonb; base_hash text; full_canonical jsonb; full_hash text; applied jsonb; firm uuid; item jsonb;
BEGIN
  IF jsonb_typeof(p_record) <> 'object' OR NOT (p_record ? 'publicContacts') THEN
    RAISE EXCEPTION 'record must include publicContacts';
  END IF;
  contacts := public.gta_prospect_research_public_contacts_canonical(p_record->'publicContacts');
  base_record := public.gta_prospect_research_canonical(p_record - 'publicContacts');
  full_canonical := base_record || jsonb_build_object('publicContacts', contacts);
  full_hash := encode(extensions.digest(convert_to(full_canonical::text, 'utf8'), 'sha256'), 'hex');
  IF p_record_sha256 <> full_hash THEN RAISE EXCEPTION 'record hash does not match canonical record'; END IF;
  base_hash := public.gta_prospect_research_record_sha256(base_record);
  applied := public.apply_gta_prospect_research_record(p_batch_id, base_record, base_hash);
  firm := (applied->>'firm_id')::uuid;
  FOR item IN SELECT value FROM jsonb_array_elements(contacts) LOOP
    INSERT INTO public.gta_prospect_public_contact_observations(
      firm_id, import_batch_id, contact_name, relationship, public_email, email_kind, source_url, observed_on
    ) VALUES (
      firm, p_batch_id, item->>'name', item->>'relationship', item->>'email', item->>'emailKind', item->>'sourceUrl', (item->>'observedAt')::date
    ) ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN applied || jsonb_build_object('public_contacts', jsonb_array_length(contacts));
END; $$;

CREATE OR REPLACE FUNCTION public.gta_prospect_research_record_with_contacts_sha256(p_record jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE contacts jsonb; base_record jsonb; full_canonical jsonb;
BEGIN
  IF jsonb_typeof(p_record) <> 'object' OR NOT (p_record ? 'publicContacts') THEN
    RAISE EXCEPTION 'record must include publicContacts';
  END IF;
  contacts := public.gta_prospect_research_public_contacts_canonical(p_record->'publicContacts');
  base_record := public.gta_prospect_research_canonical(p_record - 'publicContacts');
  full_canonical := base_record || jsonb_build_object('publicContacts', contacts);
  RETURN encode(extensions.digest(convert_to(full_canonical::text, 'utf8'), 'sha256'), 'hex');
END; $$;

CREATE OR REPLACE FUNCTION public.list_gta_prospect_research_with_contacts_for_operator()
RETURNS TABLE(
  id text, firm_name text, city text, office_cities text[], website_url text, practice_areas text[],
  observed_lawyer_count integer, observed_lawyer_count_qualifier text, observed_lawyer_count_display text,
  roster_source_url text, roster_checked_at text, reconciliation_status text, legacy_cluster_lawyer_count integer,
  legacy_crosswalk text, reconciliation_note text, advertising_evidence text, advertising_source_url text,
  gbp_evidence text, gbp_source_url text, public_contacts jsonb
)
LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
  SELECT base.*, COALESCE(contacts.items, '[]'::jsonb)
  FROM public.list_gta_prospect_research_for_operator() AS base
  JOIN public.gta_prospect_firms AS firm ON firm.source_record_key = base.id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'name', observation.contact_name, 'relationship', observation.relationship,
      'email', observation.public_email, 'email_kind', observation.email_kind,
      'source_url', observation.source_url, 'observed_at', to_char(observation.observed_on, 'YYYY-MM-DD')
    ) ORDER BY observation.observed_on DESC, observation.id DESC) AS items
    FROM public.gta_prospect_public_contact_observations AS observation
    JOIN public.gta_prospect_import_batches AS batch ON batch.id = observation.import_batch_id AND batch.state = 'applied'
    WHERE observation.firm_id = firm.id
  ) AS contacts ON TRUE
  ORDER BY base.firm_name, base.id;
$$;

REVOKE ALL ON FUNCTION public.gta_prospect_research_public_contacts_canonical(jsonb), public.gta_prospect_research_record_with_contacts_sha256(jsonb), public.apply_gta_prospect_research_record_with_contacts(uuid, jsonb, text), public.list_gta_prospect_research_with_contacts_for_operator() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gta_prospect_research_record_with_contacts_sha256(jsonb), public.apply_gta_prospect_research_record_with_contacts(uuid, jsonb, text), public.list_gta_prospect_research_with_contacts_for_operator() TO service_role;

COMMENT ON TABLE public.gta_prospect_public_contact_observations IS
  'Append-only observations of public owner, principal, named-lawyer, and firm-inbox details for the internal GTA prospect console. Public visibility does not grant outreach authorization.';
COMMENT ON FUNCTION public.list_gta_prospect_research_with_contacts_for_operator() IS
  'Service-role-only operator projection that includes source-backed public owner and email observations. It does not expose CRM, outreach, consent, or client data.';

NOTIFY pgrst, 'reload schema';
