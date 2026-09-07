-- Internal GTA prospect research ledger.
--
-- This is deliberately separate from public.caseload_prospects (inbound
-- "Start a conversation" submissions) and public.agency_prospects (CRM).
-- It holds only public research, reconciliation, and import provenance. It
-- has no contact fields, messaging/outreach state, CRM foreign keys, or
-- functions callable by browser clients.

CREATE TABLE public.gta_prospect_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name text NOT NULL CHECK (char_length(btrim(source_name)) BETWEEN 1 AND 200),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_record_count integer NOT NULL CHECK (source_record_count >= 0),
  state text NOT NULL DEFAULT 'staged' CHECK (state IN ('staged', 'applied', 'failed')),
  initiated_by_lawyer_id uuid NULL REFERENCES public.firm_lawyers(id) ON DELETE SET NULL,
  applied_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'applied') = (applied_at IS NOT NULL))
  , UNIQUE (source_name, source_sha256)
);

CREATE TABLE public.gta_prospect_firms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A source-controlled, stable record key. It is not a CRM identifier and
  -- is the only key the importer may use for idempotency.
  source_record_key text NOT NULL UNIQUE CHECK (source_record_key ~ '^[a-z0-9][a-z0-9-]{1,159}$'),
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 300),
  normalized_display_name text NOT NULL CHECK (char_length(btrim(normalized_display_name)) BETWEEN 1 AND 300),
  website_url text NULL,
  reconciliation_status text NOT NULL CHECK (
    reconciliation_status IN ('provisional_new', 'update_existing', 'new_pending_identity', 'duplicate', 'unresolved')
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.gta_prospect_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.gta_prospect_firms(id) ON DELETE RESTRICT,
  alias_kind text NOT NULL CHECK (alias_kind IN ('legal_name', 'brand_name', 'source_identifier')),
  alias_value text NOT NULL CHECK (char_length(btrim(alias_value)) BETWEEN 1 AND 300),
  normalized_alias_value text NOT NULL CHECK (char_length(btrim(normalized_alias_value)) BETWEEN 1 AND 300),
  source_type text NOT NULL CHECK (source_type IN ('reviewed_roster', 'reviewed_identity', 'import_source')),
  source_url text NOT NULL CHECK (source_url ~ '^https?://'),
  observed_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firm_id, alias_kind, normalized_alias_value, source_url, observed_on)
);

CREATE TABLE public.gta_prospect_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.gta_prospect_firms(id) ON DELETE RESTRICT,
  domain_value text NOT NULL CHECK (char_length(btrim(domain_value)) BETWEEN 1 AND 253),
  normalized_domain_value text NOT NULL CHECK (char_length(btrim(normalized_domain_value)) BETWEEN 1 AND 253),
  source_type text NOT NULL CHECK (source_type IN ('reviewed_website', 'reviewed_roster', 'import_source')),
  source_url text NOT NULL CHECK (source_url ~ '^https?://'),
  observed_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firm_id, normalized_domain_value, source_url, observed_on)
  -- Deliberately no global domain uniqueness: a shared domain, hosting
  -- provider, or website is evidence requiring adjudication, never a merge.
);

CREATE TABLE public.gta_prospect_offices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.gta_prospect_firms(id) ON DELETE RESTRICT,
  city text NOT NULL CHECK (char_length(btrim(city)) BETWEEN 1 AND 120),
  province text NOT NULL DEFAULT 'ON' CHECK (province = 'ON'),
  address_raw text NULL,
  street_normalized text NULL,
  suite_raw text NULL,
  source_type text NOT NULL CHECK (source_type IN ('reviewed_roster', 'reviewed_website', 'import_source')),
  source_url text NOT NULL CHECK (source_url ~ '^https?://'),
  observed_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (firm_id, city, province, address_raw, suite_raw, source_url, observed_on)
  -- No global street/address unique index: same street with a different or
  -- missing suite is not sufficient for identity reconciliation.
);

CREATE TABLE public.gta_prospect_roster_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.gta_prospect_firms(id) ON DELETE RESTRICT,
  import_batch_id uuid NULL REFERENCES public.gta_prospect_import_batches(id) ON DELETE RESTRICT,
  source_type text NOT NULL CHECK (source_type IN ('reviewed_roster', 'import_source')),
  source_url text NOT NULL CHECK (source_url ~ '^https?://'),
  observed_on date NOT NULL,
  observed_lawyer_count integer NULL CHECK (observed_lawyer_count IS NULL OR observed_lawyer_count >= 0),
  count_qualifier text NOT NULL CHECK (count_qualifier IN ('exact', 'at_least', 'unknown')),
  count_display text NULL,
  canonical_observation jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (count_qualifier = 'unknown' AND observed_lawyer_count IS NULL)
    OR (count_qualifier IN ('exact', 'at_least') AND observed_lawyer_count IS NOT NULL)
  )
);

CREATE TABLE public.gta_prospect_evidence_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.gta_prospect_firms(id) ON DELETE RESTRICT,
  import_batch_id uuid NULL REFERENCES public.gta_prospect_import_batches(id) ON DELETE RESTRICT,
  evidence_type text NOT NULL CHECK (evidence_type IN ('roster', 'advertising', 'google_business_profile', 'website', 'identity')),
  source_type text NOT NULL CHECK (source_type IN ('reviewed_roster', 'reviewed_advertising', 'reviewed_google_business_profile', 'reviewed_website', 'reviewed_identity', 'import_source')),
  source_url text NOT NULL CHECK (source_url ~ '^https?://'),
  observed_on date NOT NULL,
  raw_value text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firm_id, evidence_type, source_url, observed_on)
);

CREATE TABLE public.gta_prospect_identity_adjudications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.gta_prospect_firms(id) ON DELETE RESTRICT,
  import_batch_id uuid NULL REFERENCES public.gta_prospect_import_batches(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (
    decision IN ('provisional_new', 'update_existing', 'new_pending_identity', 'duplicate', 'unresolved')
  ),
  review_method text NOT NULL DEFAULT 'manual_review' CHECK (review_method = 'manual_review'),
  adjudication_basis text NOT NULL CHECK (char_length(btrim(adjudication_basis)) BETWEEN 1 AND 5000),
  source_type text NOT NULL CHECK (source_type IN ('reviewed_identity', 'import_source')),
  source_url text NOT NULL CHECK (source_url ~ '^https?://'),
  observed_on date NOT NULL,
  reviewed_by_lawyer_id uuid NULL REFERENCES public.firm_lawyers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
  -- Automated identity merges are intentionally impossible. A reviewed
  -- adjudication must name a concrete, source-backed basis instead.
);

CREATE TABLE public.gta_prospect_import_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id uuid NOT NULL REFERENCES public.gta_prospect_import_batches(id) ON DELETE RESTRICT,
  source_record_key text NOT NULL CHECK (char_length(btrim(source_record_key)) BETWEEN 1 AND 160),
  source_record_sha256 text NOT NULL CHECK (source_record_sha256 ~ '^[0-9a-f]{64}$'),
  validation_state text NOT NULL CHECK (validation_state IN ('accepted', 'rejected')),
  action_state text NOT NULL CHECK (action_state IN ('created', 'already_present', 'rejected')),
  firm_id uuid NULL REFERENCES public.gta_prospect_firms(id) ON DELETE RESTRICT,
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  canonical_record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_batch_id, source_record_key),
  CHECK ((validation_state = 'accepted') = (jsonb_array_length(validation_errors) = 0)),
  CHECK ((validation_state = 'accepted') = (firm_id IS NOT NULL)),
  CHECK ((validation_state = 'rejected') = (firm_id IS NULL))
);

CREATE INDEX gta_prospect_offices_firm_city_idx ON public.gta_prospect_offices (firm_id, city);
CREATE INDEX gta_prospect_roster_observations_firm_observed_idx ON public.gta_prospect_roster_observations (firm_id, observed_on DESC, created_at DESC);
CREATE INDEX gta_prospect_evidence_links_firm_type_idx ON public.gta_prospect_evidence_links (firm_id, evidence_type, observed_on DESC);
CREATE INDEX gta_prospect_identity_adjudications_firm_created_idx ON public.gta_prospect_identity_adjudications (firm_id, created_at DESC);
CREATE INDEX gta_prospect_import_audit_batch_idx ON public.gta_prospect_import_audit (import_batch_id, created_at);

-- Research observations, evidence, adjudications, and audit rows are
-- append-only. Corrections are new observations; the source record remains
-- reconstructable. Batch state is the sole mutable operational control.
CREATE OR REPLACE FUNCTION public.reject_gta_prospect_research_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'gta prospect research history is append-only';
END;
$$;

REVOKE ALL ON FUNCTION public.reject_gta_prospect_research_history_mutation() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER gta_prospect_aliases_no_mutation
  BEFORE UPDATE OR DELETE ON public.gta_prospect_aliases
  FOR EACH ROW EXECUTE FUNCTION public.reject_gta_prospect_research_history_mutation();
CREATE TRIGGER gta_prospect_domains_no_mutation
  BEFORE UPDATE OR DELETE ON public.gta_prospect_domains
  FOR EACH ROW EXECUTE FUNCTION public.reject_gta_prospect_research_history_mutation();
CREATE TRIGGER gta_prospect_offices_no_mutation
  BEFORE UPDATE OR DELETE ON public.gta_prospect_offices
  FOR EACH ROW EXECUTE FUNCTION public.reject_gta_prospect_research_history_mutation();
CREATE TRIGGER gta_prospect_roster_observations_no_mutation
  BEFORE UPDATE OR DELETE ON public.gta_prospect_roster_observations
  FOR EACH ROW EXECUTE FUNCTION public.reject_gta_prospect_research_history_mutation();
CREATE TRIGGER gta_prospect_evidence_links_no_mutation
  BEFORE UPDATE OR DELETE ON public.gta_prospect_evidence_links
  FOR EACH ROW EXECUTE FUNCTION public.reject_gta_prospect_research_history_mutation();
CREATE TRIGGER gta_prospect_identity_adjudications_no_mutation
  BEFORE UPDATE OR DELETE ON public.gta_prospect_identity_adjudications
  FOR EACH ROW EXECUTE FUNCTION public.reject_gta_prospect_research_history_mutation();
CREATE TRIGGER gta_prospect_import_audit_no_mutation
  BEFORE UPDATE OR DELETE ON public.gta_prospect_import_audit
  FOR EACH ROW EXECUTE FUNCTION public.reject_gta_prospect_research_history_mutation();

ALTER TABLE public.gta_prospect_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_import_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_firms FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_aliases FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_domains FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_offices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_offices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_roster_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_roster_observations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_evidence_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_evidence_links FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_identity_adjudications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_identity_adjudications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_import_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_import_audit FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.gta_prospect_import_batches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.gta_prospect_firms FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.gta_prospect_aliases FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.gta_prospect_domains FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.gta_prospect_offices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.gta_prospect_roster_observations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.gta_prospect_evidence_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.gta_prospect_identity_adjudications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.gta_prospect_import_audit FROM PUBLIC, anon, authenticated;

-- Explicitly grant the only intended database principal. New UUID-backed
-- tables use no sequences, so no sequence grant is required.
REVOKE ALL ON TABLE public.gta_prospect_import_batches, public.gta_prospect_firms, public.gta_prospect_aliases, public.gta_prospect_domains, public.gta_prospect_offices, public.gta_prospect_roster_observations, public.gta_prospect_evidence_links, public.gta_prospect_identity_adjudications, public.gta_prospect_import_audit FROM service_role;

CREATE OR REPLACE FUNCTION public.apply_gta_prospect_research_record(p_batch_id uuid, p_record jsonb, p_record_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f uuid; r record; ev record; existing uuid; existing_hash text; canonical jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_batch_id::text || coalesce(p_record->>'sourceRecordKey',''), 0));
  SELECT firm_id, source_record_sha256 INTO existing, existing_hash FROM public.gta_prospect_import_audit WHERE import_batch_id=p_batch_id AND source_record_key=p_record->>'sourceRecordKey';
  IF existing IS NOT NULL THEN IF existing_hash <> p_record_sha256 THEN RAISE EXCEPTION 'record hash differs for existing batch/source key; start a new batch'; END IF; RETURN jsonb_build_object('state','already_applied','firm_id',existing); END IF;
  SELECT * INTO r FROM jsonb_to_record(p_record) AS x(sourceRecordKey text, firmName text, normalizedFirmName text, websiteUrl text, officeCities jsonb, roster jsonb, reconciliation jsonb, evidence jsonb);
  IF r.sourceRecordKey IS NULL OR r.firmName IS NULL OR r.roster IS NULL OR r.reconciliation IS NULL THEN RAISE EXCEPTION 'invalid canonical GTA record'; END IF;
  INSERT INTO public.gta_prospect_firms(source_record_key,display_name,normalized_display_name,website_url,reconciliation_status) VALUES(r.sourceRecordKey,r.firmName,r.normalizedFirmName,r.websiteUrl,r.reconciliation->>'status') ON CONFLICT(source_record_key) DO NOTHING RETURNING id INTO f;
  IF f IS NULL THEN SELECT id INTO f FROM public.gta_prospect_firms WHERE source_record_key=r.sourceRecordKey; END IF;
  INSERT INTO public.gta_prospect_aliases(firm_id,alias_kind,alias_value,normalized_alias_value,source_type,source_url,observed_on) VALUES
    (f,'brand_name',r.firmName,r.normalizedFirmName,'import_source',r.roster->>'sourceUrl',(r.roster->>'observedOn')::date),
    (f,'source_identifier',r.sourceRecordKey,r.sourceRecordKey,'import_source',r.roster->>'sourceUrl',(r.roster->>'observedOn')::date) ON CONFLICT DO NOTHING;
  INSERT INTO public.gta_prospect_offices(firm_id,city,province,source_type,source_url,observed_on)
    SELECT f,value,'ON','import_source',r.roster->>'sourceUrl',(r.roster->>'observedOn')::date FROM jsonb_array_elements_text(r.officeCities) ON CONFLICT DO NOTHING;
  IF r.websiteUrl IS NOT NULL THEN
    INSERT INTO public.gta_prospect_domains(firm_id,domain_value,normalized_domain_value,source_type,source_url,observed_on)
      VALUES(f,lower(split_part(regexp_replace(r.websiteUrl,'^https?://','','i'), '/', 1)),lower(split_part(regexp_replace(r.websiteUrl,'^https?://','','i'), '/', 1)),'import_source',r.websiteUrl,(r.roster->>'observedOn')::date) ON CONFLICT DO NOTHING;
  END IF;
  FOR ev IN SELECT value FROM jsonb_array_elements(coalesce(r.evidence,'[]'::jsonb)) LOOP
    INSERT INTO public.gta_prospect_evidence_links(firm_id,import_batch_id,evidence_type,source_type,source_url,observed_on,raw_value) VALUES(f,p_batch_id,ev.value->>'type','import_source',ev.value->>'sourceUrl',(ev.value->>'observedOn')::date,ev.value->>'value') ON CONFLICT DO NOTHING;
  END LOOP;
  canonical := jsonb_build_object('sourceRecordKey',r.sourceRecordKey,'firmName',r.firmName,'websiteUrl',r.websiteUrl,'officeCities',r.officeCities,'roster',r.roster,'reconciliation',r.reconciliation,'evidence',r.evidence);
  INSERT INTO public.gta_prospect_roster_observations(firm_id,import_batch_id,source_type,source_url,observed_on,observed_lawyer_count,count_qualifier,count_display,canonical_observation) VALUES(f,p_batch_id,'import_source',r.roster->>'sourceUrl',(r.roster->>'observedOn')::date,NULLIF(r.roster->>'lawyerCount','')::integer,r.roster->>'qualifier',r.roster->>'display',jsonb_build_object('roster',r.roster));
  INSERT INTO public.gta_prospect_identity_adjudications(firm_id,import_batch_id,decision,review_method,adjudication_basis,source_type,source_url,observed_on) VALUES(f,p_batch_id,r.reconciliation->>'status','manual_review',r.reconciliation->>'basis','import_source',r.roster->>'sourceUrl',(r.roster->>'observedOn')::date);
  INSERT INTO public.gta_prospect_import_audit(import_batch_id,source_record_key,source_record_sha256,validation_state,action_state,firm_id,validation_errors,canonical_record) VALUES(p_batch_id,r.sourceRecordKey,p_record_sha256,'accepted','created',f,'[]',canonical);
  RETURN jsonb_build_object('state','applied','firm_id',f);
END; $$;
REVOKE ALL ON FUNCTION public.apply_gta_prospect_research_record(uuid,jsonb,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_gta_prospect_research_record(uuid,jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.begin_gta_prospect_import_batch(p_source_name text,p_source_sha256 text,p_source_record_count integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE b public.gta_prospect_import_batches%ROWTYPE; BEGIN
  IF p_source_name !~ '^[-_a-z0-9]{1,200}$' OR p_source_sha256 !~ '^[0-9a-f]{64}$' OR p_source_record_count < 0 THEN RAISE EXCEPTION 'invalid batch arguments'; END IF;
  INSERT INTO public.gta_prospect_import_batches(source_name,source_sha256,source_record_count) VALUES(p_source_name,p_source_sha256,p_source_record_count) ON CONFLICT(source_name,source_sha256) DO NOTHING;
  SELECT * INTO b FROM public.gta_prospect_import_batches WHERE source_name=p_source_name AND source_sha256=p_source_sha256 FOR UPDATE;
  IF b.state='applied' THEN RAISE EXCEPTION 'applied batch is terminal'; END IF;
  UPDATE public.gta_prospect_import_batches SET state='staged', applied_at=NULL WHERE id=b.id; RETURN b.id;
END; $$;
CREATE OR REPLACE FUNCTION public.fail_gta_prospect_import_batch(p_batch_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN UPDATE public.gta_prospect_import_batches SET state='failed' WHERE id=p_batch_id AND state='staged'; IF NOT FOUND THEN RAISE EXCEPTION 'batch cannot transition to failed'; END IF; END; $$;
CREATE OR REPLACE FUNCTION public.complete_gta_prospect_import_batch(p_batch_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN UPDATE public.gta_prospect_import_batches SET state='applied',applied_at=now() WHERE id=p_batch_id AND state='staged'; IF NOT FOUND THEN RAISE EXCEPTION 'batch cannot transition to applied'; END IF; END; $$;
REVOKE ALL ON FUNCTION public.begin_gta_prospect_import_batch(text,text,integer), public.fail_gta_prospect_import_batch(uuid), public.complete_gta_prospect_import_batch(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.begin_gta_prospect_import_batch(text,text,integer), public.fail_gta_prospect_import_batch(uuid), public.complete_gta_prospect_import_batch(uuid) TO service_role;

COMMENT ON TABLE public.gta_prospect_firms IS
  'Internal public-evidence research firms. Separate from CRM and inbound prospects; no contact or outreach data.';
COMMENT ON TABLE public.gta_prospect_identity_adjudications IS
  'Append-only reviewed identity decisions. Fuzzy names, shared domains/hosting, and same-street comparisons cannot create an automatic merge.';
COMMENT ON TABLE public.gta_prospect_import_audit IS
  'Append-only import evidence retaining raw source records and validation result.';

NOTIFY pgrst, 'reload schema';
