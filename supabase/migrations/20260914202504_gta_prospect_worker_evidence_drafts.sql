-- Private, source-hashed worker observations for the GTA prospect queue.
--
-- A queue worker may preserve what it observed, but it cannot create a firm,
-- allocate a portable FIRM ID, contact a person, submit an intake channel, or
-- alter CRM/outreach state.  Reconciliation is a separate append-only action
-- that can link a draft only through the existing stable-identity registry.

CREATE TABLE public.gta_prospect_worker_evidence_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.gta_prospect_research_work_items(id) ON DELETE RESTRICT,
  worker_id text NOT NULL CHECK (worker_id ~ '^[-_a-z0-9]{1,120}$'),
  observation_sha256 text NOT NULL CHECK (observation_sha256 ~ '^[a-f0-9]{64}$'),
  observed_on date NOT NULL,
  candidate_canonical_domain text NULL CHECK (candidate_canonical_domain IS NULL OR candidate_canonical_domain ~ '^[a-z0-9][a-z0-9.-]{0,251}[a-z0-9]$'),
  identity_state text NOT NULL CHECK (identity_state IN ('confirmed', 'unresolved', 'distinct')),
  qualification_state text NOT NULL CHECK (qualification_state IN ('qualified', 'needs_evidence', 'disqualified')),
  hold_states jsonb NOT NULL CHECK (jsonb_typeof(hold_states) = 'array'),
  source_artifacts jsonb NOT NULL CHECK (jsonb_typeof(source_artifacts) = 'array'),
  canonical_observation jsonb NOT NULL CHECK (jsonb_typeof(canonical_observation) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_item_id, observation_sha256)
);

CREATE TABLE public.gta_prospect_worker_evidence_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES public.gta_prospect_worker_evidence_drafts(id) ON DELETE RESTRICT,
  reconciliation_state text NOT NULL CHECK (reconciliation_state IN ('linked', 'identity_hold', 'evidence_hold', 'out_of_scope')),
  firm_id uuid NULL REFERENCES public.gta_prospect_firms(id) ON DELETE RESTRICT,
  stable_firm_id text NULL CHECK (stable_firm_id IS NULL OR stable_firm_id ~ '^FIRM-[0-9A-HJKMNP-TV-Z]{26}$'),
  hold_state text NULL CHECK (hold_state IS NULL OR hold_state IN (
    'identity_unresolved', 'lawyer_count_unverified', 'downtown_unverified',
    'owner_email_unavailable', 'advertising_unverified', 'gbp_unverified',
    'website_intake_unverified', 'source_inaccessible', 'outside_downtown',
    'outside_lawyer_band', 'not_a_firm', 'other'
  )),
  reconciliation_note text NOT NULL CHECK (char_length(btrim(reconciliation_note)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (reconciliation_state = 'linked' AND firm_id IS NOT NULL AND stable_firm_id IS NOT NULL AND hold_state IS NULL)
    OR (reconciliation_state IN ('identity_hold', 'evidence_hold', 'out_of_scope') AND firm_id IS NULL AND stable_firm_id IS NULL AND hold_state IS NOT NULL)
  ),
  UNIQUE NULLS NOT DISTINCT (draft_id, reconciliation_state, firm_id, stable_firm_id, hold_state)
);

CREATE INDEX gta_prospect_worker_evidence_drafts_work_item_idx
  ON public.gta_prospect_worker_evidence_drafts (work_item_id, created_at DESC);
CREATE INDEX gta_prospect_worker_evidence_drafts_identity_idx
  ON public.gta_prospect_worker_evidence_drafts (candidate_canonical_domain, observed_on DESC)
  WHERE candidate_canonical_domain IS NOT NULL;
CREATE INDEX gta_prospect_worker_evidence_reconciliations_draft_idx
  ON public.gta_prospect_worker_evidence_reconciliations (draft_id, created_at DESC);
CREATE INDEX gta_prospect_worker_evidence_reconciliations_firm_idx
  ON public.gta_prospect_worker_evidence_reconciliations (firm_id, created_at DESC)
  WHERE firm_id IS NOT NULL;

ALTER TABLE public.gta_prospect_worker_evidence_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_worker_evidence_drafts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_worker_evidence_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gta_prospect_worker_evidence_reconciliations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gta_prospect_worker_evidence_drafts, public.gta_prospect_worker_evidence_reconciliations FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER gta_prospect_worker_evidence_drafts_no_mutation
  BEFORE UPDATE OR DELETE ON public.gta_prospect_worker_evidence_drafts
  FOR EACH ROW EXECUTE FUNCTION public.reject_gta_prospect_research_history_mutation();
CREATE TRIGGER gta_prospect_worker_evidence_reconciliations_no_mutation
  BEFORE UPDATE OR DELETE ON public.gta_prospect_worker_evidence_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.reject_gta_prospect_research_history_mutation();

-- The worker envelope is deliberately small and closed. Its source artifacts
-- contain a URL, observation date, source kind, and digest of the preserved
-- public response. Each finding references one or more artifact IDs.
CREATE OR REPLACE FUNCTION public.gta_prospect_worker_evidence_draft_canonical(p_observation jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sources jsonb;
  v_identity jsonb;
  v_lawyer_count jsonb;
  v_owner_contact jsonb;
  v_downtown jsonb;
  v_advertising jsonb;
  v_gbp jsonb;
  v_website jsonb;
  v_channels jsonb;
  v_holds jsonb;
  v_controls jsonb;
  v_source jsonb;
  v_hold jsonb;
  v_channel jsonb;
  v_source_ids text[];
  v_ref text;
  v_observed_on text;
  v_domain text;
  v_count integer;
  v_email text;
BEGIN
  IF jsonb_typeof(p_observation) <> 'object'
     OR NOT (p_observation ?& ARRAY['schemaVersion', 'observedOn', 'sources', 'identity', 'lawyerCount', 'ownerContact', 'downtown', 'advertising', 'googleBusinessProfile', 'website', 'intakeChannels', 'qualificationState', 'holdStates', 'controls'])
     OR p_observation - ARRAY['schemaVersion', 'observedOn', 'sources', 'identity', 'lawyerCount', 'ownerContact', 'downtown', 'advertising', 'googleBusinessProfile', 'website', 'intakeChannels', 'qualificationState', 'holdStates', 'controls'] <> '{}'::jsonb
     OR p_observation->>'schemaVersion' <> '1'
  THEN
    RAISE EXCEPTION 'worker evidence draft has unsupported fields or version';
  END IF;

  v_observed_on := p_observation->>'observedOn';
  IF v_observed_on !~ '^\d{4}-\d{2}-\d{2}$'
     OR to_char(to_date(v_observed_on, 'YYYY-MM-DD'), 'YYYY-MM-DD') <> v_observed_on
  THEN
    RAISE EXCEPTION 'worker evidence draft has invalid observation date';
  END IF;

  v_sources := p_observation->'sources';
  IF jsonb_typeof(v_sources) <> 'array' OR jsonb_array_length(v_sources) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'worker evidence draft requires 1 to 50 source artifacts';
  END IF;
  SELECT array_agg(value->>'sourceId') INTO v_source_ids FROM jsonb_array_elements(v_sources);
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_sources) AS source(value)
    WHERE jsonb_typeof(source.value) <> 'object'
      OR NOT (source.value ?& ARRAY['sourceId', 'sourceUrl', 'observedOn', 'sourceKind', 'contentSha256'])
      OR source.value - ARRAY['sourceId', 'sourceUrl', 'observedOn', 'sourceKind', 'contentSha256'] <> '{}'::jsonb
      OR coalesce(source.value->>'sourceId', '') !~ '^[a-z0-9][a-z0-9_-]{1,79}$'
      OR coalesce(source.value->>'sourceUrl', '') !~ '^https?://'
      OR coalesce(source.value->>'observedOn', '') !~ '^\d{4}-\d{2}-\d{2}$'
      OR to_char(to_date(source.value->>'observedOn', 'YYYY-MM-DD'), 'YYYY-MM-DD') <> source.value->>'observedOn'
      OR coalesce(source.value->>'sourceKind', '') NOT IN ('first_party', 'public_regulator', 'google_ads_transparency', 'google_business_profile', 'official_geospatial', 'other_public')
      OR coalesce(source.value->>'contentSha256', '') !~ '^[a-f0-9]{64}$'
  ) OR (SELECT count(*) <> count(DISTINCT value->>'sourceId') FROM jsonb_array_elements(v_sources)) THEN
    RAISE EXCEPTION 'worker evidence draft has invalid source artifacts';
  END IF;

  v_identity := p_observation->'identity';
  IF jsonb_typeof(v_identity) <> 'object'
     OR NOT (v_identity ?& ARRAY['state', 'candidateName', 'canonicalDomain', 'confidence', 'sourceIds'])
     OR v_identity - ARRAY['state', 'candidateName', 'canonicalDomain', 'confidence', 'sourceIds'] <> '{}'::jsonb
     OR coalesce(v_identity->>'state', '') NOT IN ('confirmed', 'unresolved', 'distinct')
     OR char_length(btrim(coalesce(v_identity->>'candidateName', ''))) NOT BETWEEN 1 AND 300
     OR coalesce(v_identity->>'confidence', '') NOT IN ('high', 'moderate', 'unknown')
     OR jsonb_typeof(v_identity->'canonicalDomain') NOT IN ('string', 'null')
     OR jsonb_typeof(v_identity->'sourceIds') <> 'array' OR jsonb_array_length(v_identity->'sourceIds') = 0
  THEN
    RAISE EXCEPTION 'worker evidence draft has invalid identity evidence';
  END IF;
  v_domain := NULLIF(lower(v_identity->>'canonicalDomain'), '');
  IF v_domain IS NOT NULL AND (v_domain !~ '^[a-z0-9][a-z0-9.-]{0,251}[a-z0-9]$' OR v_domain LIKE 'www.%' OR v_domain LIKE '%.%.' OR strpos(v_domain, '..') > 0) THEN
    RAISE EXCEPTION 'worker evidence draft has invalid canonical domain';
  END IF;
  IF v_identity->>'state' = 'confirmed' AND (v_domain IS NULL OR v_identity->>'confidence' <> 'high') THEN
    RAISE EXCEPTION 'confirmed worker identity requires a high-confidence canonical domain';
  END IF;

  v_lawyer_count := p_observation->'lawyerCount';
  IF jsonb_typeof(v_lawyer_count) <> 'object'
     OR NOT (v_lawyer_count ?& ARRAY['count', 'qualifier', 'confidence', 'sourceIds'])
     OR v_lawyer_count - ARRAY['count', 'qualifier', 'confidence', 'sourceIds'] <> '{}'::jsonb
     OR jsonb_typeof(v_lawyer_count->'count') NOT IN ('number', 'null')
     OR coalesce(v_lawyer_count->>'qualifier', '') NOT IN ('exact', 'at_least', 'unknown')
     OR coalesce(v_lawyer_count->>'confidence', '') NOT IN ('high', 'moderate', 'unknown')
     OR jsonb_typeof(v_lawyer_count->'sourceIds') <> 'array' OR jsonb_array_length(v_lawyer_count->'sourceIds') = 0
  THEN
    RAISE EXCEPTION 'worker evidence draft has invalid lawyer-count evidence';
  END IF;
  IF v_lawyer_count->>'qualifier' = 'unknown' AND jsonb_typeof(v_lawyer_count->'count') <> 'null' THEN
    RAISE EXCEPTION 'unknown lawyer count cannot claim a number';
  END IF;
  IF v_lawyer_count->>'qualifier' IN ('exact', 'at_least') AND (v_lawyer_count->>'count' !~ '^[0-9]+$') THEN
    RAISE EXCEPTION 'known lawyer count must be a non-negative integer';
  END IF;
  v_count := NULLIF(v_lawyer_count->>'count', '')::integer;

  v_owner_contact := p_observation->'ownerContact';
  IF jsonb_typeof(v_owner_contact) <> 'object'
     OR NOT (v_owner_contact ?& ARRAY['name', 'relationship', 'publicEmail', 'emailKind', 'confidence', 'sourceIds'])
     OR v_owner_contact - ARRAY['name', 'relationship', 'publicEmail', 'emailKind', 'confidence', 'sourceIds'] <> '{}'::jsonb
     OR jsonb_typeof(v_owner_contact->'name') NOT IN ('string', 'null')
     OR jsonb_typeof(v_owner_contact->'publicEmail') NOT IN ('string', 'null')
     OR coalesce(v_owner_contact->>'relationship', '') NOT IN ('confirmed_owner', 'leadership_only', 'unavailable')
     OR coalesce(v_owner_contact->>'emailKind', '') NOT IN ('direct_owner_email', 'firm_general_email', 'unavailable')
     OR coalesce(v_owner_contact->>'confidence', '') NOT IN ('high', 'moderate', 'unknown')
     OR jsonb_typeof(v_owner_contact->'sourceIds') <> 'array' OR jsonb_array_length(v_owner_contact->'sourceIds') = 0
  THEN
    RAISE EXCEPTION 'worker evidence draft has invalid owner-contact evidence';
  END IF;
  v_email := NULLIF(lower(btrim(v_owner_contact->>'publicEmail')), '');
  IF v_email IS NOT NULL AND v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RAISE EXCEPTION 'worker evidence draft has invalid public email';
  END IF;
  IF v_owner_contact->>'emailKind' = 'direct_owner_email' AND (
    v_owner_contact->>'relationship' <> 'confirmed_owner' OR NULLIF(btrim(v_owner_contact->>'name'), '') IS NULL OR v_email IS NULL
  ) THEN
    RAISE EXCEPTION 'direct owner email requires published confirmed-owner evidence, a name, and an email';
  END IF;
  IF v_owner_contact->>'emailKind' = 'unavailable' AND v_email IS NOT NULL THEN
    RAISE EXCEPTION 'unavailable owner email cannot carry an email value';
  END IF;

  v_downtown := p_observation->'downtown';
  v_advertising := p_observation->'advertising';
  v_gbp := p_observation->'googleBusinessProfile';
  v_website := p_observation->'website';
  FOREACH v_source IN ARRAY ARRAY[v_downtown, v_advertising, v_gbp, v_website] LOOP
    IF jsonb_typeof(v_source) <> 'object'
       OR NOT (v_source ?& ARRAY['state', 'confidence', 'sourceIds'])
       OR v_source - ARRAY['state', 'confidence', 'sourceIds'] <> '{}'::jsonb
       OR coalesce(v_source->>'confidence', '') NOT IN ('high', 'moderate', 'unknown')
       OR jsonb_typeof(v_source->'sourceIds') <> 'array' OR jsonb_array_length(v_source->'sourceIds') = 0
    THEN
      RAISE EXCEPTION 'worker evidence draft has invalid source-backed finding';
    END IF;
  END LOOP;
  IF v_downtown->>'state' NOT IN ('inside', 'outside', 'needs_manual_review')
     OR v_advertising->>'state' NOT IN ('observable_activity', 'technical_signal_only', 'not_observed', 'unavailable')
     OR v_gbp->>'state' NOT IN ('opportunity_supported', 'not_established', 'unavailable')
     OR v_website->>'state' NOT IN ('opportunity_supported', 'not_established', 'unavailable')
  THEN
    RAISE EXCEPTION 'worker evidence draft has invalid finding state';
  END IF;

  v_channels := p_observation->'intakeChannels';
  IF jsonb_typeof(v_channels) <> 'object'
     OR NOT (v_channels ?& ARRAY['channels', 'sourceIds'])
     OR v_channels - ARRAY['channels', 'sourceIds'] <> '{}'::jsonb
     OR jsonb_typeof(v_channels->'channels') <> 'array'
     OR jsonb_typeof(v_channels->'sourceIds') <> 'array' OR jsonb_array_length(v_channels->'sourceIds') = 0
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_channels->'channels') AS channel(value) WHERE channel.value #>> '{}' NOT IN ('phone', 'email', 'contact_form', 'booking', 'live_chat', 'client_portal', 'whatsapp', 'sms', 'other_visible_channel'))
  THEN
    RAISE EXCEPTION 'worker evidence draft has invalid intake-channel evidence';
  END IF;

  -- Every finding must cite a preserved source artifact. This prevents an
  -- email, roster count, ad signal, or opportunity assertion from being
  -- stored as an unsourced inference.
  FOREACH v_source IN ARRAY ARRAY[v_identity, v_lawyer_count, v_owner_contact, v_downtown, v_advertising, v_gbp, v_website, v_channels] LOOP
    FOR v_ref IN SELECT value #>> '{}' FROM jsonb_array_elements(v_source->'sourceIds') LOOP
      IF v_ref IS NULL OR NOT (v_ref = ANY(v_source_ids)) THEN
        RAISE EXCEPTION 'worker evidence draft references an unknown source artifact';
      END IF;
    END LOOP;
  END LOOP;

  v_holds := p_observation->'holdStates';
  IF jsonb_typeof(v_holds) <> 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_holds) AS hold(value) WHERE hold.value #>> '{}' NOT IN ('identity_unresolved', 'lawyer_count_unverified', 'downtown_unverified', 'owner_email_unavailable', 'advertising_unverified', 'gbp_unverified', 'website_intake_unverified', 'source_inaccessible', 'outside_downtown', 'outside_lawyer_band', 'not_a_firm', 'other'))
     OR (SELECT count(*) <> count(DISTINCT value #>> '{}') FROM jsonb_array_elements(v_holds))
  THEN
    RAISE EXCEPTION 'worker evidence draft has invalid hold states';
  END IF;
  v_controls := p_observation->'controls';
  IF jsonb_typeof(v_controls) <> 'object'
     OR NOT (v_controls ?& ARRAY['contactFormsSubmitted', 'chatSessionsStarted', 'outreachSent'])
     OR v_controls - ARRAY['contactFormsSubmitted', 'chatSessionsStarted', 'outreachSent'] <> '{}'::jsonb
     OR v_controls->'contactFormsSubmitted' <> 'false'::jsonb
     OR v_controls->'chatSessionsStarted' <> 'false'::jsonb
     OR v_controls->'outreachSent' <> 'false'::jsonb
  THEN
    RAISE EXCEPTION 'worker evidence draft controls must prohibit form submission, chat, and outreach';
  END IF;
  IF p_observation->>'qualificationState' NOT IN ('qualified', 'needs_evidence', 'disqualified') THEN
    RAISE EXCEPTION 'worker evidence draft has invalid qualification state';
  END IF;
  IF p_observation->>'qualificationState' = 'qualified' AND (
    jsonb_array_length(v_holds) <> 0 OR v_identity->>'state' <> 'confirmed' OR v_count NOT BETWEEN 1 AND 10
    OR v_lawyer_count->>'qualifier' <> 'exact' OR v_downtown->>'state' <> 'inside'
    OR v_owner_contact->>'emailKind' <> 'direct_owner_email' OR v_advertising->>'state' <> 'observable_activity'
    OR v_gbp->>'state' <> 'opportunity_supported' OR v_website->>'state' <> 'opportunity_supported'
  ) THEN
    RAISE EXCEPTION 'qualified worker evidence requires every evidence-bearing criterion';
  END IF;

  RETURN jsonb_build_object(
    'schemaVersion', 1, 'observedOn', v_observed_on, 'sources', v_sources,
    'identity', v_identity || jsonb_build_object('canonicalDomain', v_domain),
    'lawyerCount', v_lawyer_count, 'ownerContact', v_owner_contact || jsonb_build_object('publicEmail', v_email),
    'downtown', v_downtown, 'advertising', v_advertising, 'googleBusinessProfile', v_gbp,
    'website', v_website, 'intakeChannels', v_channels, 'qualificationState', p_observation->>'qualificationState',
    'holdStates', v_holds, 'controls', v_controls
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.gta_prospect_worker_evidence_draft_sha256(p_observation jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_canonical jsonb;
BEGIN
  v_canonical := public.gta_prospect_worker_evidence_draft_canonical(p_observation);
  RETURN encode(extensions.digest(convert_to(v_canonical::text, 'utf8'), 'sha256'), 'hex');
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_gta_prospect_worker_evidence_draft(
  p_work_item_id uuid,
  p_worker_id text,
  p_observation jsonb,
  p_observation_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item public.gta_prospect_research_work_items%ROWTYPE;
  v_canonical jsonb;
  v_hash text;
  v_draft public.gta_prospect_worker_evidence_drafts%ROWTYPE;
BEGIN
  IF coalesce(p_worker_id, '') !~ '^[-_a-z0-9]{1,120}$' OR coalesce(p_observation_sha256, '') !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid worker evidence draft arguments';
  END IF;
  SELECT * INTO v_item FROM public.gta_prospect_research_work_items WHERE id = p_work_item_id FOR UPDATE;
  IF NOT FOUND OR v_item.state <> 'leased' OR v_item.lease_owner IS DISTINCT FROM p_worker_id OR v_item.lease_expires_at < now() THEN
    RAISE EXCEPTION 'worker does not own an active GTA prospect research lease';
  END IF;
  v_canonical := public.gta_prospect_worker_evidence_draft_canonical(p_observation);
  v_hash := public.gta_prospect_worker_evidence_draft_sha256(p_observation);
  IF p_observation_sha256 <> v_hash THEN
    RAISE EXCEPTION 'worker evidence draft hash does not match canonical observation';
  END IF;
  INSERT INTO public.gta_prospect_worker_evidence_drafts(
    work_item_id, worker_id, observation_sha256, observed_on, candidate_canonical_domain,
    identity_state, qualification_state, hold_states, source_artifacts, canonical_observation
  ) VALUES (
    p_work_item_id, p_worker_id, v_hash, (v_canonical->>'observedOn')::date,
    NULLIF(v_canonical->'identity'->>'canonicalDomain', ''), v_canonical->'identity'->>'state',
    v_canonical->>'qualificationState', v_canonical->'holdStates', v_canonical->'sources', v_canonical
  ) ON CONFLICT (work_item_id, observation_sha256) DO NOTHING
  RETURNING * INTO v_draft;
  IF FOUND THEN
    RETURN jsonb_build_object('state', 'created', 'draft_id', v_draft.id, 'observation_sha256', v_hash);
  END IF;
  SELECT * INTO v_draft FROM public.gta_prospect_worker_evidence_drafts
  WHERE work_item_id = p_work_item_id AND observation_sha256 = v_hash;
  RETURN jsonb_build_object('state', 'already_present', 'draft_id', v_draft.id, 'observation_sha256', v_hash);
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_gta_prospect_worker_evidence_draft(
  p_draft_id uuid,
  p_reconciliation_state text,
  p_firm_id uuid DEFAULT NULL,
  p_stable_firm_id text DEFAULT NULL,
  p_hold_state text DEFAULT NULL,
  p_reconciliation_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft public.gta_prospect_worker_evidence_drafts%ROWTYPE;
  v_registry public.gta_prospect_stable_identity_registry%ROWTYPE;
  v_row public.gta_prospect_worker_evidence_reconciliations%ROWTYPE;
BEGIN
  IF coalesce(p_reconciliation_state, '') NOT IN ('linked', 'identity_hold', 'evidence_hold', 'out_of_scope')
     OR char_length(btrim(coalesce(p_reconciliation_note, ''))) NOT BETWEEN 1 AND 2000
  THEN
    RAISE EXCEPTION 'invalid worker evidence reconciliation';
  END IF;
  SELECT * INTO v_draft FROM public.gta_prospect_worker_evidence_drafts WHERE id = p_draft_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'worker evidence draft does not exist'; END IF;
  IF p_reconciliation_state = 'linked' THEN
    IF p_firm_id IS NULL OR coalesce(p_stable_firm_id, '') !~ '^FIRM-[0-9A-HJKMNP-TV-Z]{26}$' OR p_hold_state IS NOT NULL OR v_draft.identity_state <> 'confirmed' THEN
      RAISE EXCEPTION 'linked worker evidence requires a confirmed stable identity';
    END IF;
    SELECT * INTO v_registry
    FROM public.gta_prospect_stable_identity_registry
    WHERE firm_id = p_firm_id AND stable_firm_id = p_stable_firm_id
      AND canonical_domain = v_draft.candidate_canonical_domain;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'linked worker evidence must match the registered firm identity and canonical domain';
    END IF;
  ELSE
    IF p_firm_id IS NOT NULL OR p_stable_firm_id IS NOT NULL OR coalesce(p_hold_state, '') NOT IN (
      'identity_unresolved', 'lawyer_count_unverified', 'downtown_unverified', 'owner_email_unavailable',
      'advertising_unverified', 'gbp_unverified', 'website_intake_unverified', 'source_inaccessible',
      'outside_downtown', 'outside_lawyer_band', 'not_a_firm', 'other'
    ) THEN
      RAISE EXCEPTION 'unlinked worker evidence requires an explicit hold state and no firm allocation';
    END IF;
  END IF;
  INSERT INTO public.gta_prospect_worker_evidence_reconciliations(
    draft_id, reconciliation_state, firm_id, stable_firm_id, hold_state, reconciliation_note
  ) VALUES (
    p_draft_id, p_reconciliation_state, p_firm_id, p_stable_firm_id, p_hold_state, btrim(p_reconciliation_note)
  ) ON CONFLICT (draft_id, reconciliation_state, firm_id, stable_firm_id, hold_state) DO NOTHING
  RETURNING * INTO v_row;
  IF FOUND THEN
    RETURN jsonb_build_object('state', 'reconciled', 'reconciliation_id', v_row.id);
  END IF;
  SELECT * INTO v_row FROM public.gta_prospect_worker_evidence_reconciliations
  WHERE draft_id = p_draft_id AND reconciliation_state = p_reconciliation_state
    AND firm_id IS NOT DISTINCT FROM p_firm_id AND stable_firm_id IS NOT DISTINCT FROM p_stable_firm_id
    AND hold_state IS NOT DISTINCT FROM p_hold_state;
  RETURN jsonb_build_object('state', 'already_reconciled', 'reconciliation_id', v_row.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_gta_prospect_worker_evidence_for_operator(
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  draft_id uuid,
  queue_source_record_key text,
  candidate_name text,
  stable_firm_id text,
  canonical_domain text,
  observed_on text,
  lawyer_count integer,
  lawyer_count_qualifier text,
  owner_name text,
  owner_public_email text,
  owner_email_kind text,
  advertising_state text,
  gbp_state text,
  website_state text,
  intake_channels jsonb,
  qualification_state text,
  hold_states jsonb,
  reconciliation_state text,
  reconciliation_hold_state text,
  source_artifacts jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT
    draft.id,
    queue.source_record_key,
    queue.candidate_name,
    reconciliation.stable_firm_id,
    draft.candidate_canonical_domain,
    to_char(draft.observed_on, 'YYYY-MM-DD'),
    NULLIF(draft.canonical_observation->'lawyerCount'->>'count', '')::integer,
    draft.canonical_observation->'lawyerCount'->>'qualifier',
    NULLIF(draft.canonical_observation->'ownerContact'->>'name', ''),
    NULLIF(draft.canonical_observation->'ownerContact'->>'publicEmail', ''),
    draft.canonical_observation->'ownerContact'->>'emailKind',
    draft.canonical_observation->'advertising'->>'state',
    draft.canonical_observation->'googleBusinessProfile'->>'state',
    draft.canonical_observation->'website'->>'state',
    draft.canonical_observation->'intakeChannels'->'channels',
    draft.qualification_state,
    draft.hold_states,
    COALESCE(reconciliation.reconciliation_state, 'unreconciled'),
    reconciliation.hold_state,
    draft.source_artifacts
  FROM public.gta_prospect_worker_evidence_drafts AS draft
  JOIN public.gta_prospect_research_work_items AS queue ON queue.id = draft.work_item_id
  LEFT JOIN LATERAL (
    SELECT row.*
    FROM public.gta_prospect_worker_evidence_reconciliations AS row
    WHERE row.draft_id = draft.id
    ORDER BY row.created_at DESC, row.id DESC
    LIMIT 1
  ) AS reconciliation ON TRUE
  WHERE p_limit BETWEEN 1 AND 200 AND p_offset BETWEEN 0 AND 100000
  ORDER BY draft.created_at DESC, draft.id DESC
  LIMIT p_limit OFFSET p_offset;
$$;

REVOKE ALL ON FUNCTION public.gta_prospect_worker_evidence_draft_canonical(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.gta_prospect_worker_evidence_draft_sha256(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_gta_prospect_worker_evidence_draft(uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reconcile_gta_prospect_worker_evidence_draft(uuid, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_gta_prospect_worker_evidence_for_operator(integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_gta_prospect_worker_evidence_draft(uuid, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.gta_prospect_worker_evidence_draft_sha256(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_gta_prospect_worker_evidence_draft(uuid, text, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_gta_prospect_worker_evidence_for_operator(integer, integer) TO service_role;

COMMENT ON TABLE public.gta_prospect_worker_evidence_drafts IS
  'Private, append-only, source-hashed public research drafts bound to an active GTA queue lease. They cannot create firms, contacts, CRM records, messages, or outreach.';
COMMENT ON TABLE public.gta_prospect_worker_evidence_reconciliations IS
  'Private, append-only reconciliation history. A linked row must match the immutable stable-identity registry; unresolved evidence remains an explicit hold.';
COMMENT ON FUNCTION public.submit_gta_prospect_worker_evidence_draft(uuid, text, jsonb, text) IS
  'Service-only worker intake for source-hashed public observations. Requires an owned active queue lease and forbids contact submission, chat, outreach, and email inference.';
COMMENT ON FUNCTION public.reconcile_gta_prospect_worker_evidence_draft(uuid, text, uuid, text, text, text) IS
  'Service-only append-only reconciliation. It links evidence only to the exact registered firm UUID, portable FIRM ID, and canonical domain.';

NOTIFY pgrst, 'reload schema';
