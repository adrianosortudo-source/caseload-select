-- Private, append-only storage for prospect enrichment packages and their
-- cross-system lineage. Apply only after this exact version is pushed.
BEGIN;

ALTER TABLE public.gta_prospect_firms
  ADD COLUMN enrichment_revision bigint NOT NULL DEFAULT 0 CHECK (enrichment_revision >= 0);

CREATE TABLE public.prospect_enrichment_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by text NOT NULL CHECK (char_length(btrim(submitted_by)) BETWEEN 1 AND 200),
  run_key text NOT NULL CHECK (char_length(btrim(run_key)) BETWEEN 1 AND 200),
  source_system text NOT NULL CHECK (char_length(btrim(source_system)) BETWEEN 1 AND 200),
  source_name text NOT NULL CHECK (char_length(btrim(source_name)) BETWEEN 1 AND 200),
  source_manifest_sha256 text NULL CHECK (source_manifest_sha256 IS NULL OR source_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  manifest_sha256 text NULL CHECK (manifest_sha256 IS NULL OR manifest_sha256 ~ '^[a-f0-9]{64}$'),
  manifest_generated_at text NULL CHECK (manifest_generated_at IS NULL OR char_length(manifest_generated_at) BETWEEN 20 AND 100),
  manifest_expected_package_count integer NULL CHECK (manifest_expected_package_count IS NULL OR manifest_expected_package_count >= 0),
  manifest_expected_entry_count integer NULL CHECK (manifest_expected_entry_count IS NULL OR manifest_expected_entry_count >= 0),
  manifest_expected_chunk_count integer NULL CHECK (manifest_expected_chunk_count IS NULL OR manifest_expected_chunk_count > 0),
  manifest_registered_chunk_count integer NOT NULL DEFAULT 0 CHECK (manifest_registered_chunk_count >= 0),
  manifest_state text NOT NULL DEFAULT 'open' CHECK (manifest_state IN ('open','finalized')),
  manifest_finalized_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submitted_by, run_key),
  CHECK (
    (source_manifest_sha256 IS NULL AND manifest_sha256 IS NULL AND manifest_generated_at IS NULL AND
     manifest_expected_package_count IS NULL AND manifest_expected_entry_count IS NULL AND
     manifest_expected_chunk_count IS NULL AND manifest_registered_chunk_count = 0 AND
     manifest_state = 'open' AND manifest_finalized_at IS NULL)
    OR
    (source_manifest_sha256 IS NOT NULL AND manifest_sha256 IS NOT NULL AND manifest_generated_at IS NOT NULL AND
     manifest_expected_package_count IS NOT NULL AND manifest_expected_entry_count IS NOT NULL AND
     manifest_expected_chunk_count IS NOT NULL AND
     manifest_expected_package_count <= manifest_expected_entry_count AND
     manifest_registered_chunk_count <= manifest_expected_chunk_count AND
     ((manifest_state = 'open' AND manifest_finalized_at IS NULL) OR
      (manifest_state = 'finalized' AND manifest_finalized_at IS NOT NULL AND
       manifest_registered_chunk_count = manifest_expected_chunk_count)))
  )
);

-- Every expected package and held candidate is preserved independently for
-- paginated reconciliation. Chunk receipts preserve retry identity exactly.
CREATE TABLE public.prospect_enrichment_run_manifest_chunks (
  run_id uuid NOT NULL REFERENCES public.prospect_enrichment_runs(id) ON DELETE RESTRICT,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  chunk_sha256 text NOT NULL CHECK (chunk_sha256 ~ '^[a-f0-9]{64}$'),
  entry_count integer NOT NULL CHECK (entry_count BETWEEN 0 AND 1000),
  chunk_body jsonb NOT NULL CHECK (
    jsonb_typeof(chunk_body) = 'object' AND jsonb_typeof(chunk_body->'entries') = 'array' AND
    jsonb_array_length(chunk_body->'entries') = entry_count AND
    octet_length(chunk_body::text) <= 2097152
  ),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, chunk_index)
);

CREATE TABLE public.prospect_enrichment_run_manifest_items (
  run_id uuid NOT NULL REFERENCES public.prospect_enrichment_runs(id) ON DELETE RESTRICT,
  entry_id text NOT NULL CHECK (char_length(btrim(entry_id)) BETWEEN 1 AND 200),
  client_package_id text NULL CHECK (client_package_id IS NULL OR client_package_id ~ '^[a-z0-9][a-z0-9._-]{0,119}$'),
  research_key text NULL CHECK (research_key IS NULL OR char_length(research_key) BETWEEN 1 AND 2000),
  expected_payload_sha256 text NULL CHECK (expected_payload_sha256 IS NULL OR expected_payload_sha256 ~ '^[a-f0-9]{64}$'),
  item_count integer NOT NULL CHECK (item_count BETWEEN 0 AND 1001),
  client_items jsonb NOT NULL CHECK (jsonb_typeof(client_items) = 'array' AND jsonb_array_length(client_items) = item_count),
  initial_disposition text NOT NULL CHECK (initial_disposition IN (
    'ready_for_review','identity_hold','evidence_hold','hold_schema','source_root_unavailable',
    'source_read_failed','source_changed_during_snapshot','reference_out_of_scope',
    'reference_provenance_only','provenance_only'
  )),
  source_root text NULL CHECK (source_root IS NULL OR char_length(source_root) <= 2000),
  relative_path text NOT NULL CHECK (char_length(relative_path) BETWEEN 1 AND 4000),
  source_pointer text NOT NULL CHECK (char_length(source_pointer) <= 4000),
  file_sha256 text NULL CHECK (file_sha256 IS NULL OR file_sha256 ~ '^[a-f0-9]{64}$'),
  error_codes jsonb NOT NULL CHECK (jsonb_typeof(error_codes) = 'array'),
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  manifest_entry jsonb NOT NULL CHECK (jsonb_typeof(manifest_entry) = 'object'),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, entry_id),
  FOREIGN KEY (run_id, chunk_index)
    REFERENCES public.prospect_enrichment_run_manifest_chunks(run_id, chunk_index) ON DELETE RESTRICT,
  CHECK (
    (client_package_id IS NULL AND expected_payload_sha256 IS NULL AND item_count = 0 AND client_items = '[]'::jsonb)
    OR
    (client_package_id IS NOT NULL AND research_key IS NOT NULL AND expected_payload_sha256 IS NOT NULL)
  )
);
CREATE UNIQUE INDEX prospect_enrichment_run_manifest_items_package_idx
  ON public.prospect_enrichment_run_manifest_items (run_id, client_package_id)
  WHERE client_package_id IS NOT NULL;
CREATE INDEX prospect_enrichment_run_manifest_items_page_idx
  ON public.prospect_enrichment_run_manifest_items (run_id, entry_id);

CREATE TABLE public.prospect_enrichment_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.prospect_enrichment_runs(id) ON DELETE RESTRICT,
  client_package_id text NOT NULL CHECK (client_package_id ~ '^[a-z0-9][a-z0-9._-]{0,119}$'),
  submitted_by text NOT NULL CHECK (char_length(btrim(submitted_by)) BETWEEN 1 AND 200),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^pe-v1-[a-f0-9]{64}$'),
  raw_body text NOT NULL,
  raw_body_sha256 text NOT NULL CHECK (raw_body_sha256 ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  schema_version text NOT NULL CHECK (schema_version = 'prospect-enrichment/v1'),
  research_key text NOT NULL CHECK (char_length(research_key) BETWEEN 1 AND 2000),
  firm_id uuid NULL REFERENCES public.gta_prospect_firms(id) ON DELETE RESTRICT,
  supersedes_package_id uuid NULL REFERENCES public.prospect_enrichment_packages(id) ON DELETE RESTRICT,
  identity_state text NOT NULL CHECK (identity_state IN ('resolved','unresolved','conflict')),
  state text NOT NULL CHECK (state IN ('received','identity_hold','evidence_hold','ready_for_review','applied','rejected','superseded')),
  review_json jsonb NULL CHECK (review_json IS NULL OR jsonb_typeof(review_json) = 'object'),
  review_sha256 text NULL CHECK (review_sha256 IS NULL OR review_sha256 ~ '^[a-f0-9]{64}$'),
  expected_revision_sha256 text NULL CHECK (expected_revision_sha256 IS NULL OR expected_revision_sha256 ~ '^[a-f0-9]{64}$'),
  review_expires_at timestamptz NULL,
  apply_receipt jsonb NULL CHECK (apply_receipt IS NULL OR jsonb_typeof(apply_receipt) = 'object'),
  applied_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submitted_by, idempotency_key),
  UNIQUE (submitted_by, client_package_id),
  CHECK ((state = 'applied') = (applied_at IS NOT NULL)),
  CHECK ((review_json IS NULL) = (review_sha256 IS NULL)),
  CHECK ((review_json IS NULL) = (review_expires_at IS NULL))
);

CREATE TABLE public.prospect_enrichment_source_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system text NOT NULL CHECK (char_length(btrim(source_system)) BETWEEN 1 AND 200),
  source_event_key text NOT NULL CHECK (char_length(source_event_key) BETWEEN 1 AND 160),
  semantic_sha256 text NOT NULL CHECK (semantic_sha256 ~ '^[a-f0-9]{64}$'),
  first_package_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, source_event_key)
);

CREATE TABLE public.prospect_enrichment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.prospect_enrichment_packages(id) ON DELETE RESTRICT,
  source_event_id uuid NOT NULL REFERENCES public.prospect_enrichment_source_events(id) ON DELETE RESTRICT,
  client_item_id text NOT NULL CHECK (client_item_id ~ '^(src:|obs:|assessment:)?[a-z0-9][a-z0-9._-]{0,119}$'),
  item_kind text NOT NULL CHECK (item_kind IN ('source','assessment','firm_fit','service','contact','advertising','opportunity','website_intake','roster','research_attempt')),
  normalized_sha256 text NOT NULL CHECK (normalized_sha256 ~ '^[a-f0-9]{64}$'),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) IN ('object','array')),
  source_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_ids) = 'array'),
  observed_at timestamptz NULL,
  observed_on date NULL,
  provenance_state text NOT NULL CHECK (char_length(btrim(provenance_state)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, client_item_id),
  CHECK (observed_at IS NULL OR observed_on IS NULL)
);

ALTER TABLE public.prospect_enrichment_source_events
  ADD CONSTRAINT prospect_enrichment_source_events_first_package_fk
  FOREIGN KEY (first_package_id) REFERENCES public.prospect_enrichment_packages(id) ON DELETE RESTRICT;

CREATE TABLE public.prospect_enrichment_item_targets (
  item_id uuid NOT NULL REFERENCES public.prospect_enrichment_items(id) ON DELETE RESTRICT,
  target_table text NOT NULL CHECK (target_table IN (
    'gta_prospect_firms','gta_prospect_stable_identity_registry','gta_prospect_import_audit',
    'gta_prospect_supplemental_evidence_import_audit','gta_prospect_shared_identity_observations',
    'gta_prospect_website_intake_observations','gta_prospect_qualification_assessments',
    'gta_prospect_roster_observations','gta_prospect_downtown_geography_observations',
    'gta_prospect_public_contact_observations','prospect_source_record_map','prospect_source_captures',
    'prospect_research_attempts','prospect_advertising_observations','prospect_qualification_decisions',
    'prospect_firm_fit_observations','prospect_service_observations','prospect_decision_maker_contacts',
    'prospect_opportunity_observations'
  )),
  target_id uuid NOT NULL,
  target_row_sha256 text NOT NULL CHECK (target_row_sha256 ~ '^[a-f0-9]{64}$'),
  application_kind text NOT NULL CHECK (application_kind IN ('inserted','existing')),
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, target_table, target_id)
);

CREATE TABLE public.prospect_enrichment_profile_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.gta_prospect_firms(id) ON DELETE RESTRICT,
  field_key text NOT NULL CHECK (char_length(btrim(field_key)) BETWEEN 1 AND 300),
  target_table text NOT NULL CHECK (target_table IN (
    'gta_prospect_firms','gta_prospect_import_audit','gta_prospect_domains','gta_prospect_aliases','prospect_enrichment_items',
    'prospect_enrichment_packages','gta_prospect_roster_observations','prospect_decision_maker_contacts',
    'prospect_advertising_observations','prospect_opportunity_observations','prospect_service_observations',
    'gta_prospect_offices','gta_prospect_stable_identity_registry'
  )),
  target_id uuid NOT NULL,
  source_selector text NOT NULL CHECK (char_length(source_selector) BETWEEN 1 AND 2000),
  selected_value jsonb NOT NULL,
  selected_provenance jsonb NOT NULL CHECK (jsonb_typeof(selected_provenance) = 'object'),
  package_id uuid NULL REFERENCES public.prospect_enrichment_packages(id) ON DELETE RESTRICT,
  reviewed_by uuid NOT NULL,
  chosen_at timestamptz NOT NULL DEFAULT now(),
  supersedes_choice_id uuid NULL REFERENCES public.prospect_enrichment_profile_choices(id) ON DELETE RESTRICT,
  rationale text NOT NULL CHECK (char_length(btrim(rationale)) BETWEEN 1 AND 5000),
  CHECK (supersedes_choice_id IS NULL OR supersedes_choice_id <> id)
);

CREATE UNIQUE INDEX prospect_enrichment_profile_choices_one_successor_idx
  ON public.prospect_enrichment_profile_choices (supersedes_choice_id)
  WHERE supersedes_choice_id IS NOT NULL;
CREATE UNIQUE INDEX prospect_enrichment_profile_choices_one_root_idx
  ON public.prospect_enrichment_profile_choices (firm_id, field_key)
  WHERE supersedes_choice_id IS NULL;

CREATE TABLE public.prospect_enrichment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.prospect_enrichment_packages(id) ON DELETE RESTRICT,
  event_key text NOT NULL CHECK (char_length(btrim(event_key)) BETWEEN 1 AND 200),
  event_type text NOT NULL CHECK (event_type IN (
    'received','reviewed','review_changed','applied','application_failed','package_verified',
    'verified','readback_failed','rejected','superseded','evidence_retracted'
  )),
  actor text NOT NULL CHECK (char_length(btrim(actor)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  UNIQUE (package_id, event_key)
);

CREATE INDEX prospect_enrichment_packages_run_created_idx ON public.prospect_enrichment_packages (run_id, created_at, id);
CREATE INDEX prospect_enrichment_packages_firm_created_idx ON public.prospect_enrichment_packages (firm_id, created_at, id);
CREATE INDEX prospect_enrichment_packages_state_created_idx ON public.prospect_enrichment_packages (state, created_at, id);
CREATE INDEX prospect_enrichment_items_package_kind_idx ON public.prospect_enrichment_items (package_id, item_kind);
CREATE INDEX prospect_enrichment_item_targets_target_idx ON public.prospect_enrichment_item_targets (target_table, target_id);
CREATE INDEX prospect_enrichment_events_package_created_idx ON public.prospect_enrichment_events (package_id, created_at, id);
CREATE INDEX prospect_enrichment_profile_choices_firm_field_chosen_idx ON public.prospect_enrichment_profile_choices (firm_id, field_key, chosen_at, id);

-- Preserve old time bytes as legacy_unknown. New records state their precision
-- explicitly and are never assigned a timestamp from receipt/creation time.
ALTER TABLE public.prospect_source_captures
  ADD COLUMN source_observed_on date NULL,
  ADD COLUMN source_observed_precision text NOT NULL DEFAULT 'legacy_unknown',
  ALTER COLUMN observed_at DROP NOT NULL,
  ADD CONSTRAINT prospect_source_captures_observation_precision_check CHECK (
    source_observed_precision IN ('exact_time','date_only','unknown','legacy_unknown') AND
    ((source_observed_precision = 'exact_time' AND observed_at IS NOT NULL AND source_observed_on IS NULL) OR
     (source_observed_precision = 'date_only' AND observed_at IS NULL AND source_observed_on IS NOT NULL) OR
     (source_observed_precision = 'unknown' AND observed_at IS NULL AND source_observed_on IS NULL) OR
     source_observed_precision = 'legacy_unknown')
  );
ALTER TABLE public.prospect_research_attempts
  ADD COLUMN source_observed_on date NULL,
  ADD COLUMN source_observed_precision text NOT NULL DEFAULT 'legacy_unknown',
  ALTER COLUMN observed_at DROP NOT NULL,
  ADD CONSTRAINT prospect_research_attempts_observation_precision_check CHECK (
    source_observed_precision IN ('exact_time','date_only','unknown','legacy_unknown') AND
    ((source_observed_precision = 'exact_time' AND observed_at IS NOT NULL AND source_observed_on IS NULL) OR
     (source_observed_precision = 'date_only' AND observed_at IS NULL AND source_observed_on IS NOT NULL) OR
     (source_observed_precision = 'unknown' AND observed_at IS NULL AND source_observed_on IS NULL) OR
     source_observed_precision = 'legacy_unknown')
  );
ALTER TABLE public.prospect_advertising_observations
  ADD COLUMN source_observed_on date NULL,
  ADD COLUMN source_observed_precision text NOT NULL DEFAULT 'legacy_unknown',
  ALTER COLUMN observed_at DROP NOT NULL,
  ADD CONSTRAINT prospect_advertising_observations_observation_precision_check CHECK (
    source_observed_precision IN ('exact_time','date_only','unknown','legacy_unknown') AND
    ((source_observed_precision = 'exact_time' AND observed_at IS NOT NULL AND source_observed_on IS NULL) OR
     (source_observed_precision = 'date_only' AND observed_at IS NULL AND source_observed_on IS NOT NULL) OR
     (source_observed_precision = 'unknown' AND observed_at IS NULL AND source_observed_on IS NULL) OR
     source_observed_precision = 'legacy_unknown')
  );
ALTER TABLE public.prospect_firm_fit_observations
  ADD COLUMN source_observed_on date NULL,
  ADD COLUMN source_observed_precision text NOT NULL DEFAULT 'legacy_unknown',
  ALTER COLUMN observed_at DROP NOT NULL,
  ADD CONSTRAINT prospect_firm_fit_observations_observation_precision_check CHECK (
    source_observed_precision IN ('exact_time','date_only','unknown','legacy_unknown') AND
    ((source_observed_precision = 'exact_time' AND observed_at IS NOT NULL AND source_observed_on IS NULL) OR
     (source_observed_precision = 'date_only' AND observed_at IS NULL AND source_observed_on IS NOT NULL) OR
     (source_observed_precision = 'unknown' AND observed_at IS NULL AND source_observed_on IS NULL) OR
     source_observed_precision = 'legacy_unknown')
  );
ALTER TABLE public.prospect_service_observations
  ADD COLUMN source_observed_on date NULL,
  ADD COLUMN source_observed_precision text NOT NULL DEFAULT 'legacy_unknown',
  ALTER COLUMN observed_at DROP NOT NULL,
  ADD CONSTRAINT prospect_service_observations_observation_precision_check CHECK (
    source_observed_precision IN ('exact_time','date_only','unknown','legacy_unknown') AND
    ((source_observed_precision = 'exact_time' AND observed_at IS NOT NULL AND source_observed_on IS NULL) OR
     (source_observed_precision = 'date_only' AND observed_at IS NULL AND source_observed_on IS NOT NULL) OR
     (source_observed_precision = 'unknown' AND observed_at IS NULL AND source_observed_on IS NULL) OR
     source_observed_precision = 'legacy_unknown')
  );
ALTER TABLE public.prospect_decision_maker_contacts
  ADD COLUMN source_observed_on date NULL,
  ADD COLUMN source_observed_precision text NOT NULL DEFAULT 'legacy_unknown',
  ALTER COLUMN observed_at DROP NOT NULL,
  ADD CONSTRAINT prospect_decision_maker_contacts_observation_precision_check CHECK (
    source_observed_precision IN ('exact_time','date_only','unknown','legacy_unknown') AND
    ((source_observed_precision = 'exact_time' AND observed_at IS NOT NULL AND source_observed_on IS NULL) OR
     (source_observed_precision = 'date_only' AND observed_at IS NULL AND source_observed_on IS NOT NULL) OR
     (source_observed_precision = 'unknown' AND observed_at IS NULL AND source_observed_on IS NULL) OR
     source_observed_precision = 'legacy_unknown')
  );
ALTER TABLE public.prospect_opportunity_observations
  ADD COLUMN source_observed_on date NULL,
  ADD COLUMN source_observed_precision text NOT NULL DEFAULT 'legacy_unknown',
  ALTER COLUMN observed_at DROP NOT NULL,
  ADD CONSTRAINT prospect_opportunity_observations_observation_precision_check CHECK (
    source_observed_precision IN ('exact_time','date_only','unknown','legacy_unknown') AND
    ((source_observed_precision = 'exact_time' AND observed_at IS NOT NULL AND source_observed_on IS NULL) OR
     (source_observed_precision = 'date_only' AND observed_at IS NULL AND source_observed_on IS NOT NULL) OR
     (source_observed_precision = 'unknown' AND observed_at IS NULL AND source_observed_on IS NULL) OR
     source_observed_precision = 'legacy_unknown')
  );
ALTER TABLE public.prospect_qualification_decisions
  ADD COLUMN source_observed_on date NULL,
  ADD COLUMN source_observed_precision text NOT NULL DEFAULT 'legacy_unknown',
  ALTER COLUMN decided_at DROP NOT NULL,
  ALTER COLUMN decided_at DROP DEFAULT,
  ADD CONSTRAINT prospect_qualification_decisions_observation_precision_check CHECK (
    source_observed_precision IN ('exact_time','date_only','unknown','legacy_unknown') AND
    ((source_observed_precision = 'exact_time' AND decided_at IS NOT NULL AND source_observed_on IS NULL) OR
     (source_observed_precision = 'date_only' AND decided_at IS NULL AND source_observed_on IS NOT NULL) OR
     (source_observed_precision = 'unknown' AND decided_at IS NULL AND source_observed_on IS NULL) OR
     source_observed_precision = 'legacy_unknown')
  ),
  ADD COLUMN cohort_id text NULL CHECK (cohort_id IS NULL OR char_length(cohort_id) BETWEEN 1 AND 120);

DROP INDEX IF EXISTS public.prospect_advertising_observations_firm_idx;
CREATE INDEX prospect_advertising_observations_firm_idx ON public.prospect_advertising_observations (firm_id, observed_at DESC NULLS LAST, source_observed_on DESC NULLS LAST, created_at DESC);
DROP INDEX IF EXISTS public.prospect_research_attempts_firm_idx;
CREATE INDEX prospect_research_attempts_firm_idx ON public.prospect_research_attempts (firm_id, observed_at DESC NULLS LAST, source_observed_on DESC NULLS LAST, created_at DESC);
DROP INDEX IF EXISTS public.prospect_firm_fit_observations_firm_idx;
CREATE INDEX prospect_firm_fit_observations_firm_idx ON public.prospect_firm_fit_observations (firm_id, observed_at DESC NULLS LAST, source_observed_on DESC NULLS LAST, created_at DESC);
DROP INDEX IF EXISTS public.prospect_service_observations_firm_idx;
CREATE INDEX prospect_service_observations_firm_idx ON public.prospect_service_observations (firm_id, observed_at DESC NULLS LAST, source_observed_on DESC NULLS LAST, created_at DESC);
DROP INDEX IF EXISTS public.prospect_decision_maker_contacts_firm_idx;
CREATE INDEX prospect_decision_maker_contacts_firm_idx ON public.prospect_decision_maker_contacts (firm_id, observed_at DESC NULLS LAST, source_observed_on DESC NULLS LAST, created_at DESC);
DROP INDEX IF EXISTS public.prospect_opportunity_observations_firm_idx;
CREATE INDEX prospect_opportunity_observations_firm_idx ON public.prospect_opportunity_observations (firm_id, observed_at DESC NULLS LAST, source_observed_on DESC NULLS LAST, created_at DESC);
CREATE INDEX prospect_source_captures_firm_observed_idx ON public.prospect_source_captures (firm_id, observed_at DESC NULLS LAST, source_observed_on DESC NULLS LAST, created_at DESC);
CREATE INDEX prospect_qualification_decisions_firm_observed_idx ON public.prospect_qualification_decisions (firm_id, decided_at DESC NULLS LAST, source_observed_on DESC NULLS LAST, id DESC);

CREATE OR REPLACE FUNCTION public.reject_prospect_enrichment_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'prospect enrichment history is immutable; append a correction event instead';
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_prospect_enrichment_run_manifest_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  received_chunks bigint;
  entry_rows bigint;
  distinct_entries bigint;
  package_entries bigint;
  distinct_packages bigint;
  first_chunk integer;
  last_chunk integer;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'prospect enrichment runs are retained'; END IF;
  IF ROW(NEW.id, NEW.submitted_by, NEW.run_key, NEW.source_system, NEW.source_name, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.submitted_by, OLD.run_key, OLD.source_system, OLD.source_name, OLD.created_at) THEN
    RAISE EXCEPTION 'prospect enrichment run identity is immutable';
  END IF;

  IF OLD.manifest_sha256 IS NULL THEN
    IF NEW.manifest_sha256 IS NULL THEN RAISE EXCEPTION 'only manifest registration may update a run'; END IF;
  ELSIF ROW(NEW.source_manifest_sha256, NEW.manifest_sha256, NEW.manifest_generated_at,
            NEW.manifest_expected_package_count, NEW.manifest_expected_entry_count,
            NEW.manifest_expected_chunk_count)
        IS DISTINCT FROM
        ROW(OLD.source_manifest_sha256, OLD.manifest_sha256, OLD.manifest_generated_at,
            OLD.manifest_expected_package_count, OLD.manifest_expected_entry_count,
            OLD.manifest_expected_chunk_count) THEN
    RAISE EXCEPTION 'registered manifest identity and counts are immutable';
  END IF;

  IF OLD.manifest_state = 'finalized' AND
     ROW(NEW.manifest_registered_chunk_count, NEW.manifest_state, NEW.manifest_finalized_at)
     IS DISTINCT FROM
     ROW(OLD.manifest_registered_chunk_count, OLD.manifest_state, OLD.manifest_finalized_at) THEN
    RAISE EXCEPTION 'finalized run manifest is immutable';
  END IF;
  IF NEW.manifest_state NOT IN (OLD.manifest_state, 'finalized') OR
     NEW.manifest_registered_chunk_count < OLD.manifest_registered_chunk_count OR
     NEW.manifest_registered_chunk_count > OLD.manifest_registered_chunk_count + 1 THEN
    RAISE EXCEPTION 'manifest registration must append at most one chunk and finalize once';
  END IF;

  SELECT count(*), min(chunk_index), max(chunk_index)
    INTO received_chunks, first_chunk, last_chunk
  FROM public.prospect_enrichment_run_manifest_chunks WHERE run_id = NEW.id;
  IF NEW.manifest_registered_chunk_count <> received_chunks THEN
    RAISE EXCEPTION 'manifest chunk count does not match durable chunk receipts';
  END IF;

  IF NEW.manifest_state = 'finalized' AND OLD.manifest_state <> 'finalized' THEN
    IF NEW.manifest_sha256 IS NULL OR received_chunks <> NEW.manifest_expected_chunk_count OR
       first_chunk <> 0 OR last_chunk <> NEW.manifest_expected_chunk_count - 1 THEN
      RAISE EXCEPTION 'manifest cannot finalize before all contiguous chunks are registered';
    END IF;
    SELECT count(*), count(DISTINCT entry_id),
           count(*) FILTER (WHERE client_package_id IS NOT NULL),
           count(DISTINCT client_package_id) FILTER (WHERE client_package_id IS NOT NULL)
      INTO entry_rows, distinct_entries, package_entries, distinct_packages
    FROM public.prospect_enrichment_run_manifest_items WHERE run_id = NEW.id;
    IF entry_rows <> NEW.manifest_expected_entry_count OR distinct_entries <> entry_rows OR
       package_entries <> NEW.manifest_expected_package_count OR distinct_packages <> package_entries THEN
      RAISE EXCEPTION 'manifest entry or package inventory does not match declared counts';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.prospect_enrichment_packages package
      LEFT JOIN public.prospect_enrichment_run_manifest_items item
        ON item.run_id = package.run_id AND item.client_package_id = package.client_package_id
      WHERE package.run_id = NEW.id
        AND (item.entry_id IS NULL
          OR item.expected_payload_sha256 IS DISTINCT FROM package.payload_sha256
          OR item.research_key IS DISTINCT FROM package.research_key)
    ) THEN
      RAISE EXCEPTION 'staged packages do not reconcile with the finalized manifest';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_prospect_enrichment_run_manifest_append()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  run_row public.prospect_enrichment_runs%ROWTYPE;
  exact_entry_count bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'run manifest chunks and entries are append-only'; END IF;
  SELECT * INTO run_row
  FROM public.prospect_enrichment_runs
  WHERE id = NEW.run_id
  FOR UPDATE;
  IF NOT FOUND OR run_row.manifest_state <> 'open' OR run_row.manifest_sha256 IS NULL THEN
    RAISE EXCEPTION 'run manifest must be initialized and open before chunks or entries are appended';
  END IF;

  IF TG_TABLE_NAME = 'prospect_enrichment_run_manifest_chunks' THEN
    IF NEW.chunk_index >= run_row.manifest_expected_chunk_count OR
       NEW.entry_count <> jsonb_array_length(NEW.chunk_body->'entries') THEN
      RAISE EXCEPTION 'manifest chunk is outside the declared run inventory';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.chunk_index >= run_row.manifest_expected_chunk_count OR
     NEW.manifest_entry ->> 'entryId' IS DISTINCT FROM NEW.entry_id OR
     NEW.manifest_entry ->> 'clientPackageId' IS DISTINCT FROM NEW.client_package_id OR
     NEW.manifest_entry ->> 'researchKey' IS DISTINCT FROM NEW.research_key OR
     NEW.manifest_entry ->> 'expectedPayloadSha256' IS DISTINCT FROM NEW.expected_payload_sha256 OR
     NEW.manifest_entry ->> 'itemCount' IS DISTINCT FROM NEW.item_count::text OR
     NEW.manifest_entry ->> 'initialDisposition' IS DISTINCT FROM NEW.initial_disposition OR
     NEW.manifest_entry #> '{clientItems}' IS DISTINCT FROM NEW.client_items OR
     NEW.manifest_entry #> '{errorCodes}' IS DISTINCT FROM NEW.error_codes OR
     NEW.manifest_entry #>> '{source,sourceRoot}' IS DISTINCT FROM NEW.source_root OR
     NEW.manifest_entry #>> '{source,relativePath}' IS DISTINCT FROM NEW.relative_path OR
     NEW.manifest_entry #>> '{source,sourcePointer}' IS DISTINCT FROM NEW.source_pointer OR
     NEW.manifest_entry #>> '{source,fileSha256}' IS DISTINCT FROM NEW.file_sha256 THEN
    RAISE EXCEPTION 'normalized manifest entry columns must match the preserved manifest entry';
  END IF;
  SELECT count(*) INTO exact_entry_count
  FROM public.prospect_enrichment_run_manifest_chunks chunk,
       jsonb_array_elements(chunk.chunk_body->'entries') entry
  WHERE chunk.run_id = NEW.run_id AND chunk.chunk_index = NEW.chunk_index
    AND entry = NEW.manifest_entry;
  IF exact_entry_count <> 1 THEN
    RAISE EXCEPTION 'manifest entry must occur exactly once in its registered chunk';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prospect_enrichment_stable_json_v1(p_value jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
DECLARE result text;
BEGIN
  CASE jsonb_typeof(p_value)
    WHEN 'null' THEN RETURN 'null';
    WHEN 'boolean' THEN RETURN p_value::text;
    WHEN 'number' THEN RETURN p_value::text;
    WHEN 'string' THEN RETURN to_json(p_value #>> '{}')::text;
    WHEN 'array' THEN
      SELECT '[' || coalesce(string_agg(public.prospect_enrichment_stable_json_v1(item.value), ',' ORDER BY item.ordinality), '') || ']'
        INTO result
      FROM jsonb_array_elements(p_value) WITH ORDINALITY AS item(value, ordinality);
      RETURN result;
    WHEN 'object' THEN
      SELECT '{' || coalesce(string_agg(to_json(property.key)::text || ':' || public.prospect_enrichment_stable_json_v1(property.value), ',' ORDER BY property.key COLLATE "C"), '') || '}'
        INTO result
      FROM jsonb_each(p_value) AS property(key, value);
      RETURN result;
    ELSE
      RAISE EXCEPTION 'unsupported JSON value for prospect enrichment hashing';
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.prospect_enrichment_firm_revision_sha256_v1(p_firm_id uuid,p_revision bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT encode(extensions.digest(convert_to(public.prospect_enrichment_stable_json_v1(jsonb_build_object(
    'schemaVersion','prospect-enrichment-firm-revision/v1',
    'firmId',lower(p_firm_id::text),
    'revision',p_revision::text
  )),'utf8'),'sha256'),'hex');
$$;

CREATE OR REPLACE FUNCTION public.register_prospect_enrichment_manifest_chunk_v1(
  p_submitted_by text,
  p_chunk jsonb,
  p_finalize boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  run_row public.prospect_enrichment_runs%ROWTYPE;
  existing_chunk public.prospect_enrichment_run_manifest_chunks%ROWTYPE;
  v_run_key text;
  v_source_system text;
  v_source_name text;
  v_source_manifest_sha256 text;
  v_manifest_sha256 text;
  v_generated_at text;
  v_expected_package_count integer;
  v_expected_entry_count integer;
  v_chunk_index integer;
  v_chunk_count integer;
  v_chunk_sha256 text;
  v_entry_count integer;
  v_registered_chunk_count integer;
  v_received_entry_count integer;
  v_received_package_count integer;
  v_manifest_json jsonb;
  v_computed_sha256 text;
  v_outcome text;
  v_entry jsonb;
  v_item jsonb;
  v_source jsonb;
  v_keys integer;
  v_item_count integer;
  v_expected_event_key text;
BEGIN
  IF p_submitted_by IS NULL OR char_length(btrim(p_submitted_by)) NOT BETWEEN 1 AND 200 OR
     jsonb_typeof(p_chunk) <> 'object' OR octet_length(p_chunk::text) > 2097152 OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_chunk)) <> 14 OR NOT (p_chunk ?& ARRAY[
       'schemaVersion','adapterVersion','runId','sourceSystem','sourceName','sourceManifestSha256',
       'runManifestSha256','generatedAt','expectedPackageCount','expectedEntryCount','chunkIndex',
       'chunkCount','chunkSha256','entries'
     ]) OR p_chunk->>'schemaVersion' <> 'prospect-enrichment-run-manifest-chunk/v1' OR
     jsonb_typeof(p_chunk->'entries') <> 'array' THEN
    RAISE EXCEPTION 'invalid run manifest chunk';
  END IF;
  v_run_key := p_chunk->>'runId';
  v_source_system := p_chunk->>'sourceSystem';
  v_source_name := p_chunk->>'sourceName';
  v_source_manifest_sha256 := p_chunk->>'sourceManifestSha256';
  v_manifest_sha256 := p_chunk->>'runManifestSha256';
  v_generated_at := p_chunk->>'generatedAt';
  v_expected_package_count := (p_chunk->>'expectedPackageCount')::integer;
  v_expected_entry_count := (p_chunk->>'expectedEntryCount')::integer;
  v_chunk_index := (p_chunk->>'chunkIndex')::integer;
  v_chunk_count := (p_chunk->>'chunkCount')::integer;
  v_chunk_sha256 := p_chunk->>'chunkSha256';
  v_entry_count := jsonb_array_length(p_chunk->'entries');
  PERFORM v_generated_at::timestamptz;
  IF jsonb_typeof(p_chunk->'adapterVersion') <> 'string' OR char_length(p_chunk->>'adapterVersion') NOT BETWEEN 1 AND 120 OR
     jsonb_typeof(p_chunk->'runId') <> 'string' OR
     jsonb_typeof(p_chunk->'sourceSystem') <> 'string' OR
     jsonb_typeof(p_chunk->'sourceName') <> 'string' OR
     jsonb_typeof(p_chunk->'sourceManifestSha256') <> 'string' OR
     jsonb_typeof(p_chunk->'runManifestSha256') <> 'string' OR
     jsonb_typeof(p_chunk->'generatedAt') <> 'string' OR
     jsonb_typeof(p_chunk->'chunkSha256') <> 'string' OR
     v_run_key IS NULL OR char_length(v_run_key) NOT BETWEEN 1 AND 200 OR
     v_source_system IS NULL OR char_length(btrim(v_source_system)) NOT BETWEEN 1 AND 200 OR
     v_source_name IS NULL OR char_length(btrim(v_source_name)) NOT BETWEEN 1 AND 200 OR
     v_source_manifest_sha256 !~ '^[a-f0-9]{64}$' OR v_manifest_sha256 !~ '^[a-f0-9]{64}$' OR
     v_chunk_sha256 !~ '^[a-f0-9]{64}$' OR
     jsonb_typeof(p_chunk->'expectedPackageCount') <> 'number' OR
     jsonb_typeof(p_chunk->'expectedEntryCount') <> 'number' OR
     jsonb_typeof(p_chunk->'chunkIndex') <> 'number' OR
     jsonb_typeof(p_chunk->'chunkCount') <> 'number' OR
     v_expected_package_count < 0 OR v_expected_entry_count < v_expected_package_count OR
     v_chunk_count < 1 OR v_chunk_index < 0 OR v_chunk_index >= v_chunk_count OR
     v_entry_count > 1000 THEN
    RAISE EXCEPTION 'invalid run manifest chunk metadata';
  END IF;
  v_computed_sha256 := encode(extensions.digest(convert_to(public.prospect_enrichment_stable_json_v1(p_chunk->'entries'), 'utf8'), 'sha256'), 'hex');
  IF v_computed_sha256 <> v_chunk_sha256 THEN RAISE EXCEPTION 'manifest chunk hash mismatch'; END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_chunk->'entries') AS entries(value) LOOP
    IF jsonb_typeof(v_entry) <> 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_entry)) <> 9 OR NOT (v_entry ?& ARRAY[
      'entryId','researchKey','clientPackageId','expectedPayloadSha256','itemCount','clientItems',
      'initialDisposition','source','errorCodes'
    ]) OR jsonb_typeof(v_entry->'entryId') <> 'string' OR
       jsonb_typeof(v_entry->'itemCount') <> 'number' OR
       jsonb_typeof(v_entry->'clientItems') <> 'array' OR jsonb_typeof(v_entry->'source') <> 'object' OR
       (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_entry->'source')) <> 4 OR NOT (v_entry->'source' ?& ARRAY[
         'sourceRoot','relativePath','sourcePointer','fileSha256'
       ]) OR jsonb_typeof(v_entry #> '{source,relativePath}') <> 'string' OR
       jsonb_typeof(v_entry #> '{source,sourcePointer}') <> 'string' OR
       jsonb_typeof(v_entry->'errorCodes') <> 'array' OR
       (v_entry->'researchKey' <> 'null'::jsonb AND jsonb_typeof(v_entry->'researchKey') <> 'string') OR
       (v_entry->'clientPackageId' <> 'null'::jsonb AND jsonb_typeof(v_entry->'clientPackageId') <> 'string') OR
       (v_entry->'expectedPayloadSha256' <> 'null'::jsonb AND jsonb_typeof(v_entry->'expectedPayloadSha256') <> 'string') OR
       (v_entry #> '{source,sourceRoot}' <> 'null'::jsonb AND jsonb_typeof(v_entry #> '{source,sourceRoot}') <> 'string') OR
       (v_entry #> '{source,fileSha256}' <> 'null'::jsonb AND jsonb_typeof(v_entry #> '{source,fileSha256}') <> 'string') OR
       jsonb_typeof(v_entry->'initialDisposition') <> 'string' OR
       char_length(coalesce(v_entry->>'entryId','')) NOT BETWEEN 1 AND 200 OR
       char_length(coalesce(v_entry #>> '{source,relativePath}','')) NOT BETWEEN 1 AND 4000 OR
       char_length(coalesce(v_entry #>> '{source,sourcePointer}','')) > 4000 OR
       jsonb_array_length(v_entry->'clientItems') <> (v_entry->>'itemCount')::integer OR
       (v_entry->>'itemCount')::integer NOT BETWEEN 0 AND 1001 OR
       v_entry->>'initialDisposition' NOT IN (
         'ready_for_review','identity_hold','evidence_hold','hold_schema','source_root_unavailable',
         'source_read_failed','source_changed_during_snapshot','reference_out_of_scope',
         'reference_provenance_only','provenance_only'
       ) OR
       (v_entry->'clientPackageId' = 'null'::jsonb AND
         (v_entry->'expectedPayloadSha256' <> 'null'::jsonb OR (v_entry->>'itemCount')::integer <> 0 OR v_entry->'clientItems' <> '[]'::jsonb)) OR
       (v_entry->'clientPackageId' <> 'null'::jsonb AND
         (v_entry->'researchKey' = 'null'::jsonb OR v_entry->'expectedPayloadSha256' = 'null'::jsonb OR
          coalesce(v_entry->>'clientPackageId','') !~ '^[a-z0-9][a-z0-9._-]{0,119}$' OR
          v_entry->>'expectedPayloadSha256' !~ '^[a-f0-9]{64}$' OR
          char_length(coalesce(v_entry->>'researchKey','')) NOT BETWEEN 1 AND 2000)) OR
       (v_entry->'researchKey' <> 'null'::jsonb AND char_length(coalesce(v_entry->>'researchKey','')) NOT BETWEEN 1 AND 2000) OR
       (v_entry #> '{source,sourceRoot}' <> 'null'::jsonb AND jsonb_typeof(v_entry #> '{source,sourceRoot}') <> 'string') OR
       (v_entry #> '{source,fileSha256}' <> 'null'::jsonb AND (v_entry #>> '{source,fileSha256}') !~ '^[a-f0-9]{64}$') THEN
      RAISE EXCEPTION 'invalid run manifest entry';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_entry->'clientItems') AS items(value) LOOP
      IF jsonb_typeof(v_item) <> 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_item)) <> 4 OR NOT (v_item ?& ARRAY[
       'clientItemId','itemKind','sourceEventKey','semanticSha256'
      ]) OR jsonb_typeof(v_item->'clientItemId') <> 'string' OR
         jsonb_typeof(v_item->'itemKind') <> 'string' OR
         jsonb_typeof(v_item->'sourceEventKey') <> 'string' OR
         jsonb_typeof(v_item->'semanticSha256') <> 'string' OR
         v_item->>'itemKind' NOT IN ('source','observation','assessment') OR
         char_length(coalesce(v_item->>'clientItemId','')) NOT BETWEEN 1 AND 120 OR
         char_length(coalesce(v_item->>'sourceEventKey','')) NOT BETWEEN 1 AND 160 OR
         v_item->>'semanticSha256' !~ '^[a-f0-9]{64}$' OR
         v_item->>'clientItemId' !~ '^(src:|obs:|assessment:)[a-z0-9][a-z0-9._-]{0,119}$' THEN
        RAISE EXCEPTION 'invalid run manifest client item';
      END IF;
      v_expected_event_key := v_item->>'itemKind' || ':' || encode(extensions.digest(
        convert_to(public.prospect_enrichment_stable_json_v1(jsonb_build_array(v_entry->>'researchKey',v_item->>'clientItemId')), 'utf8'), 'sha256'), 'hex');
      IF v_item->>'sourceEventKey' IS DISTINCT FROM v_expected_event_key OR
         (v_item->>'itemKind' = 'source' AND v_item->>'clientItemId' NOT LIKE 'src:%') OR
         (v_item->>'itemKind' = 'observation' AND v_item->>'clientItemId' NOT LIKE 'obs:%') OR
         (v_item->>'itemKind' = 'assessment' AND v_item->>'clientItemId' NOT LIKE 'assessment:%') THEN
        RAISE EXCEPTION 'manifest source event key does not match its stable item identity';
      END IF;
    END LOOP;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_entry->'clientItems') item
      GROUP BY item->>'clientItemId' HAVING count(*) > 1
    ) THEN RAISE EXCEPTION 'manifest package contains duplicate client item identities'; END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_entry->'errorCodes') error_code
      WHERE jsonb_typeof(error_code) <> 'string' OR char_length(error_code #>> '{}') NOT BETWEEN 1 AND 200
    ) THEN RAISE EXCEPTION 'manifest error codes must be bounded strings'; END IF;
  END LOOP;

  INSERT INTO public.prospect_enrichment_runs(
    submitted_by,run_key,source_system,source_name,source_manifest_sha256,manifest_sha256,
    manifest_generated_at,manifest_expected_package_count,manifest_expected_entry_count,manifest_expected_chunk_count
  ) VALUES (
    p_submitted_by,v_run_key,v_source_system,v_source_name,v_source_manifest_sha256,v_manifest_sha256,
    v_generated_at,v_expected_package_count,v_expected_entry_count,v_chunk_count
  ) ON CONFLICT (submitted_by,run_key) DO NOTHING;
  SELECT * INTO run_row FROM public.prospect_enrichment_runs
  WHERE submitted_by = p_submitted_by AND run_key = v_run_key FOR UPDATE;
  IF run_row.source_system <> v_source_system OR run_row.source_name <> v_source_name THEN
    v_outcome := 'run_conflict';
  ELSIF run_row.manifest_sha256 IS NULL THEN
    UPDATE public.prospect_enrichment_runs SET
      source_manifest_sha256 = v_source_manifest_sha256,
      manifest_sha256 = v_manifest_sha256,
      manifest_generated_at = v_generated_at,
      manifest_expected_package_count = v_expected_package_count,
      manifest_expected_entry_count = v_expected_entry_count,
      manifest_expected_chunk_count = v_chunk_count
    WHERE id = run_row.id RETURNING * INTO run_row;
    v_outcome := NULL;
  ELSIF ROW(run_row.source_manifest_sha256,run_row.manifest_sha256,run_row.manifest_generated_at,
            run_row.manifest_expected_package_count,run_row.manifest_expected_entry_count,run_row.manifest_expected_chunk_count)
        IS DISTINCT FROM
        ROW(v_source_manifest_sha256,v_manifest_sha256,v_generated_at,
            v_expected_package_count,v_expected_entry_count,v_chunk_count) THEN
    v_outcome := 'manifest_conflict';
  ELSE
    v_outcome := NULL;
  END IF;

  IF v_outcome IS NULL THEN
    SELECT * INTO existing_chunk FROM public.prospect_enrichment_run_manifest_chunks
    WHERE run_id = run_row.id AND chunk_index = v_chunk_index;
    IF FOUND THEN
      IF existing_chunk.chunk_sha256 <> v_chunk_sha256 OR existing_chunk.chunk_body <> p_chunk OR
         existing_chunk.entry_count <> v_entry_count THEN
        v_outcome := 'chunk_conflict';
      ELSE
        v_outcome := CASE WHEN run_row.manifest_state = 'finalized' THEN 'already_finalized' ELSE 'chunk_replayed' END;
      END IF;
    ELSIF run_row.manifest_state = 'finalized' THEN
      v_outcome := 'manifest_conflict';
    ELSE
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_chunk->'entries') entry
        GROUP BY entry->>'entryId' HAVING count(*) > 1
      ) OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_chunk->'entries') entry
        WHERE entry->>'clientPackageId' IS NOT NULL AND entry->>'clientPackageId' <> 'null'
        GROUP BY entry->>'clientPackageId' HAVING count(*) > 1
      ) OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_chunk->'entries') entry
        JOIN public.prospect_enrichment_run_manifest_items existing
          ON existing.run_id = run_row.id
         AND (existing.entry_id = entry->>'entryId' OR
              (existing.client_package_id IS NOT NULL AND existing.client_package_id = entry->>'clientPackageId'))
      ) THEN
        v_outcome := 'manifest_conflict';
      ELSE
        INSERT INTO public.prospect_enrichment_run_manifest_chunks(run_id,chunk_index,chunk_sha256,entry_count,chunk_body)
        VALUES (run_row.id,v_chunk_index,v_chunk_sha256,v_entry_count,p_chunk);
        FOR v_entry IN SELECT value FROM jsonb_array_elements(p_chunk->'entries') AS entries(value) LOOP
          INSERT INTO public.prospect_enrichment_run_manifest_items(
            run_id,entry_id,client_package_id,research_key,expected_payload_sha256,item_count,client_items,
            initial_disposition,source_root,relative_path,source_pointer,file_sha256,error_codes,chunk_index,manifest_entry
          ) VALUES (
            run_row.id,v_entry->>'entryId',nullif(v_entry->>'clientPackageId','null'),
            nullif(v_entry->>'researchKey','null'),nullif(v_entry->>'expectedPayloadSha256','null'),
            (v_entry->>'itemCount')::integer,v_entry->'clientItems',v_entry->>'initialDisposition',
            nullif(v_entry #>> '{source,sourceRoot}','null'),v_entry #>> '{source,relativePath}',
            v_entry #>> '{source,sourcePointer}',nullif(v_entry #>> '{source,fileSha256}','null'),
            v_entry->'errorCodes',v_chunk_index,v_entry
          );
        END LOOP;
        SELECT count(*) INTO v_registered_chunk_count FROM public.prospect_enrichment_run_manifest_chunks WHERE run_id = run_row.id;
        UPDATE public.prospect_enrichment_runs SET manifest_registered_chunk_count = v_registered_chunk_count
        WHERE id = run_row.id RETURNING * INTO run_row;
        v_outcome := 'chunk_registered';
      END IF;
    END IF;
  END IF;

  IF p_finalize AND v_outcome NOT IN ('run_conflict','manifest_conflict','chunk_conflict') THEN
    IF run_row.manifest_state = 'finalized' THEN
      v_outcome := 'already_finalized';
    ELSIF run_row.manifest_registered_chunk_count = run_row.manifest_expected_chunk_count THEN
      SELECT count(*) INTO v_received_entry_count FROM public.prospect_enrichment_run_manifest_items WHERE run_id = run_row.id;
      SELECT count(*) INTO v_received_package_count FROM public.prospect_enrichment_run_manifest_items
        WHERE run_id = run_row.id AND client_package_id IS NOT NULL;
      v_manifest_json := jsonb_build_object(
        'schemaVersion','prospect-enrichment-run-manifest/v1',
        'runId',run_row.run_key,
        'sourceSystem',run_row.source_system,
        'sourceName',run_row.source_name,
        'sourceManifestSha256',run_row.source_manifest_sha256,
        'generatedAt',run_row.manifest_generated_at,
        'expectedPackageCount',run_row.manifest_expected_package_count,
        'entries',coalesce((SELECT jsonb_agg(manifest_entry ORDER BY entry_id)
          FROM public.prospect_enrichment_run_manifest_items WHERE run_id = run_row.id),'[]'::jsonb)
      );
      v_computed_sha256 := encode(extensions.digest(convert_to(public.prospect_enrichment_stable_json_v1(v_manifest_json), 'utf8'), 'sha256'), 'hex');
      IF v_received_entry_count <> run_row.manifest_expected_entry_count OR
         v_received_package_count <> run_row.manifest_expected_package_count OR
         v_computed_sha256 <> run_row.manifest_sha256 THEN
        v_outcome := 'manifest_conflict';
      ELSE
        UPDATE public.prospect_enrichment_runs SET manifest_state='finalized',manifest_finalized_at=clock_timestamp()
        WHERE id=run_row.id RETURNING * INTO run_row;
        v_outcome := 'finalized';
      END IF;
    ELSE
      v_outcome := 'incomplete';
    END IF;
  END IF;

  SELECT count(*) INTO v_received_entry_count FROM public.prospect_enrichment_run_manifest_items WHERE run_id = run_row.id;
  SELECT count(*) INTO v_received_package_count FROM public.prospect_enrichment_run_manifest_items
    WHERE run_id = run_row.id AND client_package_id IS NOT NULL;
  RETURN jsonb_build_object(
    'outcome',v_outcome,'runId',run_row.run_key,'runKey',run_row.run_key,'serverRunId',run_row.id,
    'sourceManifestSha256',run_row.source_manifest_sha256,'manifestSha256',run_row.manifest_sha256,
    'registeredChunkCount',run_row.manifest_registered_chunk_count,'expectedChunkCount',run_row.manifest_expected_chunk_count,
    'receivedEntryCount',v_received_entry_count,'expectedEntryCount',run_row.manifest_expected_entry_count,
    'receivedPackageCount',v_received_package_count,'expectedPackageCount',run_row.manifest_expected_package_count,
    'manifestState',CASE WHEN run_row.manifest_sha256 IS NULL THEN 'missing' ELSE run_row.manifest_state END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.stage_prospect_enrichment_package_v1(
  p_submitted_by text,
  p_run_key text,
  p_source_system text,
  p_source_name text,
  p_client_package_id text,
  p_idempotency_key text,
  p_raw_body text,
  p_raw_body_sha256 text,
  p_payload jsonb,
  p_payload_sha256 text,
  p_research_key text,
  p_identity_state text,
  p_items jsonb,
  p_sources jsonb,
  p_supersedes_package_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  run_row public.prospect_enrichment_runs%ROWTYPE;
  package_row public.prospect_enrichment_packages%ROWTYPE;
  existing_row public.prospect_enrichment_packages%ROWTYPE;
  manifest_row public.prospect_enrichment_run_manifest_items%ROWTYPE;
  firm_row public.gta_prospect_firms%ROWTYPE;
  source_input jsonb;
  item_input jsonb;
  item_data jsonb;
  lineage_item jsonb;
  expected_source_ids jsonb;
  source_content jsonb;
  retraction_source_content jsonb;
  semantic_content jsonb;
  expected_semantic_sha256 text;
  expected_event_key text;
  actual_sources jsonb := '[]'::jsonb;
  actual_items jsonb := '[]'::jsonb;
  actual_lineage jsonb := '[]'::jsonb;
  payload_items jsonb := '[]'::jsonb;
  event_row record;
  lock_key text;
  existing_source_event public.prospect_enrichment_source_events%ROWTYPE;
  source_event_id uuid;
  source_id text;
  predecessor_id uuid;
  payload_firm_id uuid;
  computed_raw_sha256 text;
  computed_payload_sha256 text;
  computed_idempotency_key text;
  state_value text;
  observation_count integer;
  assessment_count integer;
  source_count integer;
  item_count integer;
  received_at timestamptz;
BEGIN
  IF p_submitted_by IS NULL OR char_length(btrim(p_submitted_by)) NOT BETWEEN 1 AND 200 OR
     p_run_key IS NULL OR char_length(btrim(p_run_key)) NOT BETWEEN 1 AND 200 OR
     p_source_system IS NULL OR char_length(btrim(p_source_system)) NOT BETWEEN 1 AND 200 OR
     p_source_name IS NULL OR char_length(btrim(p_source_name)) NOT BETWEEN 1 AND 200 OR
     p_client_package_id IS NULL OR p_client_package_id !~ '^[a-z0-9][a-z0-9._-]{0,119}$' OR
     p_raw_body IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR
     jsonb_typeof(p_items) <> 'array' OR jsonb_typeof(p_sources) <> 'array' OR
     p_research_key IS NULL OR char_length(p_research_key) NOT BETWEEN 1 AND 2000 OR
     p_identity_state NOT IN ('resolved','unresolved','conflict') OR
     p_raw_body_sha256 !~ '^[a-f0-9]{64}$' OR p_payload_sha256 !~ '^[a-f0-9]{64}$' OR
     p_idempotency_key !~ '^pe-v1-[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid prospect enrichment stage request';
  END IF;

  IF p_payload->>'schemaVersion' IS DISTINCT FROM 'prospect-enrichment/v1' OR
     p_payload->>'runId' IS DISTINCT FROM p_run_key OR
     p_payload->>'packageId' IS DISTINCT FROM p_client_package_id OR
     p_payload->>'sourceSystem' IS DISTINCT FROM p_source_system OR
     p_payload->>'sourceName' IS DISTINCT FROM p_source_name OR
     p_payload #>> '{subject,researchKey}' IS DISTINCT FROM p_research_key OR
     p_payload #>> '{subject,identityState}' IS DISTINCT FROM p_identity_state OR
     nullif(p_payload->>'supersedesPackageId','null') IS DISTINCT FROM p_supersedes_package_id OR
     jsonb_typeof(p_payload->'sources') <> 'array' OR
     jsonb_typeof(p_payload->'observations') <> 'array' OR
     jsonb_typeof(p_payload->'controls') <> 'object' OR
     p_payload #>> '{controls,contactFormsSubmitted}' IS DISTINCT FROM 'false' OR
     p_payload #>> '{controls,chatSessionsStarted}' IS DISTINCT FROM 'false' OR
     p_payload #>> '{controls,outreachSent}' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'stage request does not match immutable package payload';
  END IF;

  computed_raw_sha256 := encode(extensions.digest(convert_to(p_raw_body,'utf8'),'sha256'),'hex');
  computed_payload_sha256 := encode(extensions.digest(
    convert_to(public.prospect_enrichment_stable_json_v1(p_payload),'utf8'),'sha256'),'hex');
  computed_idempotency_key := 'pe-v1-' || encode(extensions.digest(
    convert_to(p_source_system || E'\n' || p_run_key || E'\n' || p_client_package_id,'utf8'),'sha256'),'hex');
  IF computed_raw_sha256 <> p_raw_body_sha256 OR computed_payload_sha256 <> p_payload_sha256 OR
     computed_idempotency_key <> p_idempotency_key THEN
    RAISE EXCEPTION 'stage request hash or idempotency key mismatch';
  END IF;

  source_count := jsonb_array_length(p_sources);
  observation_count := (SELECT count(*) FROM jsonb_array_elements(p_items) AS items(item) WHERE item->>'itemKind' = 'observation');
  assessment_count := (SELECT count(*) FROM jsonb_array_elements(p_items) AS items(item) WHERE item->>'itemKind' = 'assessment');
  item_count := source_count + jsonb_array_length(p_items);
  IF source_count > 500 OR observation_count > 500 OR assessment_count > 1 OR item_count > 1001 OR
     jsonb_array_length(p_items) <> observation_count + assessment_count THEN
    RAISE EXCEPTION 'stage item counts exceed prospect enrichment limits';
  END IF;

  SELECT coalesce(jsonb_agg(source_json->'data' ORDER BY ordinality),'[]'::jsonb)
    INTO actual_sources
  FROM jsonb_array_elements(p_sources) WITH ORDINALITY AS source_rows(source_json,ordinality);
  IF actual_sources IS DISTINCT FROM p_payload->'sources' THEN
    RAISE EXCEPTION 'staged sources must exactly match the package payload';
  END IF;
  SELECT coalesce(jsonb_agg(item->'data' ORDER BY ordinality),'[]'::jsonb)
    INTO actual_items
  FROM jsonb_array_elements(p_items) WITH ORDINALITY AS item_rows(item,ordinality);
  payload_items := p_payload->'observations' || CASE WHEN p_payload->'assessment' = 'null'::jsonb
    THEN '[]'::jsonb ELSE jsonb_build_array(p_payload->'assessment') END;
  IF actual_items IS DISTINCT FROM payload_items THEN
    RAISE EXCEPTION 'staged observations and assessment must exactly match the package payload';
  END IF;

  FOR source_input IN SELECT value FROM jsonb_array_elements(p_sources) AS rows(value) LOOP
    IF jsonb_typeof(source_input) <> 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(source_input)) <> 8 OR
       NOT (source_input ?& ARRAY['sourceId','clientItemId','sourceEventKey','semanticSha256','data','observedAt','observedOn','provenanceState']) OR
       jsonb_typeof(source_input->'data') <> 'object' OR
       source_input->>'sourceId' IS DISTINCT FROM source_input #>> '{data,sourceId}' OR
       source_input->>'clientItemId' IS DISTINCT FROM 'src:' || (source_input->>'sourceId') OR
       source_input->>'provenanceState' NOT IN ('complete','partial','legacy_unknown') OR
       source_input->'observedAt' IS DISTINCT FROM source_input #> '{data,observedAt}' OR
       source_input->'observedOn' IS DISTINCT FROM source_input #> '{data,observedOn}' THEN
      RAISE EXCEPTION 'invalid staged source item';
    END IF;
    expected_event_key := 'source:' || encode(extensions.digest(convert_to(
      public.prospect_enrichment_stable_json_v1(jsonb_build_array(p_research_key,source_input->>'clientItemId')),'utf8'),'sha256'),'hex');
    semantic_content := (source_input->'data') - 'sourceId'::text;
    expected_semantic_sha256 := encode(extensions.digest(convert_to(public.prospect_enrichment_stable_json_v1(
      jsonb_build_object('itemKind','source','researchKey',p_research_key,'semanticContent',semantic_content,'sourceSystem',p_source_system)
    ),'utf8'),'sha256'),'hex');
    IF source_input->>'sourceEventKey' IS DISTINCT FROM expected_event_key OR
       source_input->>'semanticSha256' IS DISTINCT FROM expected_semantic_sha256 OR
       char_length(coalesce(source_input->>'sourceId','')) NOT BETWEEN 1 AND 120 OR
       source_input->>'sourceId' !~ '^[a-z0-9][a-z0-9._-]{0,119}$' OR
       source_input->>'semanticSha256' !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'staged source lineage hash or identity mismatch';
    END IF;
    actual_lineage := actual_lineage || jsonb_build_array(jsonb_build_object(
      'clientItemId',source_input->>'clientItemId','itemKind','source',
      'sourceEventKey',source_input->>'sourceEventKey','semanticSha256',source_input->>'semanticSha256'
    ));
  END LOOP;

  FOR item_input IN SELECT value FROM jsonb_array_elements(p_items) AS rows(value) LOOP
    item_data := item_input->'data';
    IF jsonb_typeof(item_input) <> 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(item_input)) <> 9 OR
       NOT (item_input ?& ARRAY['clientItemId','itemKind','sourceEventKey','semanticSha256','data','sourceIds','observedAt','observedOn','provenanceState']) OR
       jsonb_typeof(item_data) <> 'object' OR jsonb_typeof(item_input->'sourceIds') <> 'array' OR
       item_input->'sourceIds' IS DISTINCT FROM item_data->'sourceIds' OR
       item_input->>'provenanceState' NOT IN ('complete','partial','legacy_unknown') OR
       item_input->>'itemKind' NOT IN ('observation','assessment') THEN
      RAISE EXCEPTION 'invalid staged observation or assessment item';
    END IF;
    IF item_input->>'itemKind' = 'observation' THEN
      IF item_input->>'clientItemId' IS DISTINCT FROM 'obs:' || (item_data->>'observationId') OR
         item_input->'observedAt' IS DISTINCT FROM item_data->'observedAt' OR
         item_input->'observedOn' IS DISTINCT FROM item_data->'observedOn' OR
         jsonb_typeof(item_data->'retractionSourceIds') <> 'array' THEN
        RAISE EXCEPTION 'observation lineage does not match its immutable item data';
      END IF;
      SELECT coalesce(jsonb_agg((source.value->'data') - 'sourceId'::text ORDER BY referenced.ordinality),'[]'::jsonb)
        INTO source_content
      FROM jsonb_array_elements_text(item_data->'sourceIds') WITH ORDINALITY AS referenced(source_id,ordinality)
      JOIN jsonb_array_elements(p_sources) AS source(value) ON source.value->>'sourceId' = referenced.source_id;
      SELECT coalesce(jsonb_agg((source.value->'data') - 'sourceId'::text ORDER BY referenced.ordinality),'[]'::jsonb)
        INTO retraction_source_content
      FROM jsonb_array_elements_text(item_data->'retractionSourceIds') WITH ORDINALITY AS referenced(source_id,ordinality)
      JOIN jsonb_array_elements(p_sources) AS source(value) ON source.value->>'sourceId' = referenced.source_id;
      IF jsonb_array_length(source_content) <> jsonb_array_length(item_data->'sourceIds') OR
         jsonb_array_length(retraction_source_content) <> jsonb_array_length(item_data->'retractionSourceIds') THEN
        RAISE EXCEPTION 'observation lineage references a missing source';
      END IF;
      semantic_content := (item_data - 'observationId'::text - 'existingRecord'::text) || jsonb_build_object(
        'sourceContent',source_content,'retractionSourceContent',retraction_source_content
      );
    ELSE
      IF item_input->>'clientItemId' IS DISTINCT FROM 'assessment:' || (item_data->>'assessmentId') OR
         item_input->'observedAt' IS DISTINCT FROM item_data->'assessedAt' OR
         item_input->'observedOn' IS DISTINCT FROM item_data->'assessedOn' THEN
        RAISE EXCEPTION 'assessment lineage does not match its immutable item data';
      END IF;
      SELECT coalesce(jsonb_agg((source.value->'data') - 'sourceId'::text ORDER BY referenced.ordinality),'[]'::jsonb)
        INTO source_content
      FROM jsonb_array_elements_text(item_data->'sourceIds') WITH ORDINALITY AS referenced(source_id,ordinality)
      JOIN jsonb_array_elements(p_sources) AS source(value) ON source.value->>'sourceId' = referenced.source_id;
      IF jsonb_array_length(source_content) <> jsonb_array_length(item_data->'sourceIds') THEN
        RAISE EXCEPTION 'assessment lineage references a missing source';
      END IF;
      semantic_content := (item_data - 'assessmentId'::text - 'existingRecord'::text) || jsonb_build_object('sourceContent',source_content);
    END IF;
    expected_event_key := item_input->>'itemKind' || ':' || encode(extensions.digest(convert_to(
      public.prospect_enrichment_stable_json_v1(jsonb_build_array(p_research_key,item_input->>'clientItemId')),'utf8'),'sha256'),'hex');
    expected_semantic_sha256 := encode(extensions.digest(convert_to(public.prospect_enrichment_stable_json_v1(
      jsonb_build_object('itemKind',item_input->>'itemKind','researchKey',p_research_key,'semanticContent',semantic_content,'sourceSystem',p_source_system)
    ),'utf8'),'sha256'),'hex');
    IF item_input->>'sourceEventKey' IS DISTINCT FROM expected_event_key OR
       item_input->>'semanticSha256' IS DISTINCT FROM expected_semantic_sha256 OR
       item_input->>'semanticSha256' !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'staged item lineage hash mismatch';
    END IF;
    actual_lineage := actual_lineage || jsonb_build_array(jsonb_build_object(
      'clientItemId',item_input->>'clientItemId','itemKind',item_input->>'itemKind',
      'sourceEventKey',item_input->>'sourceEventKey','semanticSha256',item_input->>'semanticSha256'
    ));
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(actual_lineage) AS lineages(item)
    GROUP BY item->>'clientItemId' HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(actual_lineage) AS lineages(item)
    GROUP BY item->>'sourceEventKey' HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'stage package contains duplicate immutable item identities'; END IF;

  IF p_identity_state = 'resolved' THEN
    IF nullif(p_payload #>> '{subject,databaseFirmId}','') IS NULL OR
       p_payload #>> '{subject,databaseFirmId}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'resolved package identity requires a valid database firm id';
    END IF;
    payload_firm_id := (p_payload #>> '{subject,databaseFirmId}')::uuid;
    SELECT * INTO firm_row FROM public.gta_prospect_firms WHERE id = payload_firm_id FOR KEY SHARE;
    IF NOT FOUND OR firm_row.source_record_key IS DISTINCT FROM p_payload #>> '{subject,sourceRecordKey}' THEN
      RAISE EXCEPTION 'resolved package identity does not match the current prospect firm';
    END IF;
    IF p_payload #>> '{subject,stableFirmId}' IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.gta_prospect_stable_identity_registry registry
      WHERE registry.firm_id = payload_firm_id AND registry.stable_firm_id = p_payload #>> '{subject,stableFirmId}'
        AND registry.canonical_domain = p_payload #>> '{subject,canonicalDomain}'
    ) THEN RAISE EXCEPTION 'resolved stable identity does not match the authoritative registry'; END IF;
  ELSE
    payload_firm_id := NULL;
  END IF;

  IF p_supersedes_package_id IS NOT NULL THEN
    IF p_supersedes_package_id = p_client_package_id THEN RAISE EXCEPTION 'package cannot supersede itself'; END IF;
    SELECT predecessor.id INTO predecessor_id
    FROM public.prospect_enrichment_packages predecessor
    WHERE predecessor.submitted_by = p_submitted_by AND predecessor.client_package_id = p_supersedes_package_id
      AND predecessor.payload->>'sourceSystem' = p_source_system
      AND predecessor.research_key = p_research_key
    FOR KEY SHARE;
    IF predecessor_id IS NULL THEN RAISE EXCEPTION 'superseded package must exist for this actor, source, and research identity'; END IF;
  END IF;

  FOR lock_key IN
    SELECT lock_value FROM (VALUES
      ('package-id:' || p_submitted_by || ':' || p_client_package_id),
      ('idempotency:' || p_submitted_by || ':' || p_idempotency_key)
    ) locks(lock_value) ORDER BY lock_value
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('prospect-enrichment:' || lock_key, 620260923));
  END LOOP;

  INSERT INTO public.prospect_enrichment_runs(submitted_by,run_key,source_system,source_name)
  VALUES (p_submitted_by,p_run_key,p_source_system,p_source_name)
  ON CONFLICT (submitted_by,run_key) DO NOTHING;
  SELECT * INTO run_row FROM public.prospect_enrichment_runs
  WHERE submitted_by = p_submitted_by AND run_key = p_run_key FOR UPDATE;
  IF run_row.source_system IS DISTINCT FROM p_source_system OR run_row.source_name IS DISTINCT FROM p_source_name THEN
    RETURN jsonb_build_object('outcome','run_conflict');
  END IF;

  IF run_row.manifest_sha256 IS NOT NULL THEN
    IF run_row.manifest_state <> 'finalized' THEN RETURN jsonb_build_object('outcome','run_conflict'); END IF;
    SELECT * INTO manifest_row FROM public.prospect_enrichment_run_manifest_items entry
    WHERE entry.run_id = run_row.id AND entry.client_package_id = p_client_package_id;
    IF NOT FOUND OR manifest_row.expected_payload_sha256 IS DISTINCT FROM p_payload_sha256 OR
       manifest_row.research_key IS DISTINCT FROM p_research_key OR
       manifest_row.client_items IS DISTINCT FROM actual_lineage THEN
      RETURN jsonb_build_object('outcome','package_conflict');
    END IF;
  END IF;

  SELECT * INTO existing_row FROM public.prospect_enrichment_packages package
  WHERE package.submitted_by = p_submitted_by AND package.idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF existing_row.run_id = run_row.id AND existing_row.client_package_id = p_client_package_id AND
       existing_row.raw_body = p_raw_body AND existing_row.raw_body_sha256 = p_raw_body_sha256 AND
       existing_row.payload = p_payload AND existing_row.payload_sha256 = p_payload_sha256 AND
       existing_row.research_key = p_research_key AND existing_row.identity_state = p_identity_state AND
       existing_row.firm_id IS NOT DISTINCT FROM payload_firm_id AND
       existing_row.supersedes_package_id IS NOT DISTINCT FROM predecessor_id THEN
      RETURN jsonb_build_object(
        'outcome','replayed','packageId',existing_row.id,'clientPackageId',existing_row.client_package_id,
        'runId',p_run_key,'serverRunId',run_row.id,'payloadSha256',existing_row.payload_sha256,
        'state',existing_row.state,'identityState',existing_row.identity_state,
        'counts',jsonb_build_object('sources',source_count,'observations',observation_count,'assessments',assessment_count,'items',item_count),
        'receivedAt',existing_row.created_at
      );
    END IF;
    RETURN jsonb_build_object('outcome','idempotency_conflict');
  END IF;
  SELECT * INTO existing_row FROM public.prospect_enrichment_packages package
  WHERE package.submitted_by = p_submitted_by AND package.client_package_id = p_client_package_id FOR UPDATE;
  IF FOUND THEN RETURN jsonb_build_object('outcome','package_conflict'); END IF;

  FOR lock_key IN
    SELECT DISTINCT p_source_system || ':' || (lineage->>'sourceEventKey')
    FROM jsonb_array_elements(actual_lineage) AS lineages(lineage)
    ORDER BY 1
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('prospect-enrichment:event:' || lock_key, 620260923));
  END LOOP;
  FOR event_row IN
    SELECT lineage.value->>'sourceEventKey' AS event_key,lineage.value->>'semanticSha256' AS semantic_sha256
    FROM jsonb_array_elements(actual_lineage) AS lineage(value)
    ORDER BY lineage.value->>'sourceEventKey'
  LOOP
    SELECT * INTO existing_source_event FROM public.prospect_enrichment_source_events event
    WHERE event.source_system = p_source_system AND event.source_event_key = event_row.event_key;
    IF FOUND AND existing_source_event.semantic_sha256 IS DISTINCT FROM event_row.semantic_sha256 THEN
      RETURN jsonb_build_object('outcome','source_event_conflict');
    END IF;
  END LOOP;

  state_value := CASE
    WHEN p_identity_state <> 'resolved' THEN 'identity_hold'
    WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(p_sources) AS source_rows(item) WHERE item->>'provenanceState' <> 'complete') OR
         EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) AS item_rows(item) WHERE item->>'provenanceState' <> 'complete') THEN 'evidence_hold'
    ELSE 'ready_for_review'
  END;
  INSERT INTO public.prospect_enrichment_packages(
    run_id,client_package_id,submitted_by,idempotency_key,raw_body,raw_body_sha256,payload,payload_sha256,
    schema_version,research_key,firm_id,supersedes_package_id,identity_state,state
  ) VALUES (
    run_row.id,p_client_package_id,p_submitted_by,p_idempotency_key,p_raw_body,p_raw_body_sha256,p_payload,p_payload_sha256,
    p_payload->>'schemaVersion',p_research_key,payload_firm_id,predecessor_id,p_identity_state,state_value
  ) RETURNING * INTO package_row;

  FOR source_input IN SELECT value FROM jsonb_array_elements(p_sources) AS rows(value) LOOP
    INSERT INTO public.prospect_enrichment_source_events(source_system,source_event_key,semantic_sha256,first_package_id)
    VALUES (p_source_system,source_input->>'sourceEventKey',source_input->>'semanticSha256',package_row.id)
    ON CONFLICT (source_system,source_event_key) DO NOTHING;
    SELECT event.id INTO source_event_id FROM public.prospect_enrichment_source_events event
    WHERE event.source_system = p_source_system AND event.source_event_key = source_input->>'sourceEventKey';
    INSERT INTO public.prospect_enrichment_items(
      package_id,source_event_id,client_item_id,item_kind,normalized_sha256,data,source_ids,
      observed_at,observed_on,provenance_state
    ) VALUES (
      package_row.id,source_event_id,source_input->>'clientItemId','source',source_input->>'semanticSha256',
      source_input->'data','[]'::jsonb,nullif(source_input->>'observedAt','null')::timestamptz,
      nullif(source_input->>'observedOn','null')::date,source_input->>'provenanceState'
    );
  END LOOP;
  FOR item_input IN SELECT value FROM jsonb_array_elements(p_items) AS rows(value) LOOP
    INSERT INTO public.prospect_enrichment_source_events(source_system,source_event_key,semantic_sha256,first_package_id)
    VALUES (p_source_system,item_input->>'sourceEventKey',item_input->>'semanticSha256',package_row.id)
    ON CONFLICT (source_system,source_event_key) DO NOTHING;
    SELECT event.id INTO source_event_id FROM public.prospect_enrichment_source_events event
    WHERE event.source_system = p_source_system AND event.source_event_key = item_input->>'sourceEventKey';
    INSERT INTO public.prospect_enrichment_items(
      package_id,source_event_id,client_item_id,item_kind,normalized_sha256,data,source_ids,
      observed_at,observed_on,provenance_state
    ) VALUES (
      package_row.id,source_event_id,item_input->>'clientItemId',
      CASE WHEN item_input->>'itemKind' = 'assessment' THEN 'assessment' ELSE item_input #>> '{data,kind}' END,
      item_input->>'semanticSha256',item_input->'data',item_input->'sourceIds',
      nullif(item_input->>'observedAt','null')::timestamptz,nullif(item_input->>'observedOn','null')::date,
      item_input->>'provenanceState'
    );
  END LOOP;
  INSERT INTO public.prospect_enrichment_events(package_id,event_key,event_type,actor,details)
  VALUES (package_row.id,'received:' || p_payload_sha256,'received',p_submitted_by,jsonb_build_object(
    'runId',p_run_key,'clientPackageId',p_client_package_id,'payloadSha256',p_payload_sha256,
    'sourceCount',source_count,'itemCount',item_count
  ));

  RETURN jsonb_build_object(
    'outcome','created','packageId',package_row.id,'clientPackageId',package_row.client_package_id,
    'runId',p_run_key,'serverRunId',run_row.id,'payloadSha256',package_row.payload_sha256,
    'state',package_row.state,'identityState',package_row.identity_state,
    'counts',jsonb_build_object('sources',source_count,'observations',observation_count,'assessments',assessment_count,'items',item_count),
    'receivedAt',package_row.created_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_prospect_enrichment_run_summaries_v1(
  p_limit integer,
  p_cursor_created_at timestamptz,
  p_cursor_id uuid,
  p_run_id uuid DEFAULT NULL
)
RETURNS TABLE (
  run_id uuid,
  run_key text,
  source_system text,
  source_name text,
  created_at timestamptz,
  source_manifest_sha256 text,
  manifest_sha256 text,
  manifest_state text,
  manifest_expected_entry_count integer,
  manifest_received_entry_count bigint,
  manifest_expected_package_count integer,
  manifest_received_package_count bigint,
  manifest_expected_chunk_count integer,
  manifest_registered_chunk_count integer,
  candidate_count bigint,
  package_count bigint,
  package_state_counts jsonb,
  research_outcome_counts jsonb,
  visibility_counts jsonb,
  missing_package_count bigint,
  payload_mismatch_count bigint,
  research_key_mismatch_count bigint,
  orphan_package_count bigint,
  needs_attention_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR
     ((p_cursor_created_at IS NULL) <> (p_cursor_id IS NULL)) THEN
    RAISE EXCEPTION 'invalid run summary pagination arguments';
  END IF;
  RETURN QUERY
  SELECT r.id,r.run_key,r.source_system,r.source_name,r.created_at,r.source_manifest_sha256,r.manifest_sha256,
    CASE WHEN r.manifest_sha256 IS NULL THEN 'missing' ELSE r.manifest_state END,
    r.manifest_expected_entry_count,
    coalesce(inventory.entry_count,0)::bigint,
    r.manifest_expected_package_count,
    coalesce(inventory.package_entry_count,0)::bigint,
    r.manifest_expected_chunk_count,r.manifest_registered_chunk_count,
    coalesce(inventory.candidate_count,0)::bigint,
    coalesce(package_counts.package_count,0)::bigint,
    coalesce(package_states.counts,'{}'::jsonb),
    coalesce(outcomes.counts,'{}'::jsonb),
    coalesce(visibility.counts,'{}'::jsonb),
    coalesce(reconcile.missing_count,0)::bigint,
    coalesce(reconcile.payload_mismatch_count,0)::bigint,
    coalesce(reconcile.research_key_mismatch_count,0)::bigint,
    coalesce(reconcile.orphan_count,0)::bigint,
    coalesce(reconcile.needs_attention_count,0)::bigint
  FROM public.prospect_enrichment_runs r
  LEFT JOIN LATERAL (
    SELECT count(*) AS entry_count,
      count(*) FILTER (WHERE item.client_package_id IS NOT NULL) AS package_entry_count,
      count(DISTINCT item.research_key) FILTER (WHERE item.research_key IS NOT NULL) AS candidate_count
    FROM public.prospect_enrichment_run_manifest_items item WHERE item.run_id = r.id
  ) inventory ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS package_count FROM public.prospect_enrichment_packages package WHERE package.run_id = r.id
  ) package_counts ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_object_agg(states.state,coalesce(counts.state_count,0)) AS counts
    FROM unnest(ARRAY['received','identity_hold','evidence_hold','ready_for_review','applied','rejected','superseded']) AS states(state)
    LEFT JOIN (
      SELECT package.state,count(*) AS state_count
      FROM public.prospect_enrichment_packages package WHERE package.run_id = r.id GROUP BY package.state
    ) counts USING (state)
  ) package_states ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_object_agg(outcomes.outcome,coalesce(counts.outcome_count,0)) AS counts
    FROM unnest(ARRAY['complete','partial','blocked','error','not_run','unknown','not_reported']) AS outcomes(outcome)
    LEFT JOIN (
      SELECT coalesce(package.payload #>> '{assessment,researchOutcome}','not_reported') AS outcome,count(*) AS outcome_count
      FROM public.prospect_enrichment_packages package WHERE package.run_id = r.id
      GROUP BY coalesce(package.payload #>> '{assessment,researchOutcome}','not_reported')
    ) counts USING (outcome)
  ) outcomes ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
      'packageVerified',count(*) FILTER (WHERE package_success.event_type='package_verified'
        AND package_success.details->>'verificationVersion'='prospect-enrichment-readback/v1'
        AND package_success.details->>'readbackSha256' ~ '^[a-f0-9]{64}$'),
      'packageNotVerified',count(*) - count(*) FILTER (WHERE package_success.event_type='package_verified'
        AND package_success.details->>'verificationVersion'='prospect-enrichment-readback/v1'
        AND package_success.details->>'readbackSha256' ~ '^[a-f0-9]{64}$'),
      'canonicalVerified',count(*) FILTER (WHERE canonical_success.event_type='verified'
        AND canonical_success.details->>'verificationVersion'='prospect-enrichment-readback/v1'
        AND canonical_success.details->>'readbackSha256' ~ '^[a-f0-9]{64}$'
        AND package.apply_receipt IS NOT NULL
        AND canonical_success.details->>'expectedReceiptSha256' = encode(extensions.digest(
          convert_to(public.prospect_enrichment_stable_json_v1(package.apply_receipt), 'utf8'), 'sha256'), 'hex')
        AND current_applied_revision.id IS NOT NULL),
      'canonicalNotVerified',count(*) - count(*) FILTER (WHERE canonical_success.event_type='verified'
        AND canonical_success.details->>'verificationVersion'='prospect-enrichment-readback/v1'
        AND canonical_success.details->>'readbackSha256' ~ '^[a-f0-9]{64}$'
        AND package.apply_receipt IS NOT NULL
        AND canonical_success.details->>'expectedReceiptSha256' = encode(extensions.digest(
          convert_to(public.prospect_enrichment_stable_json_v1(package.apply_receipt), 'utf8'), 'sha256'), 'hex')
        AND current_applied_revision.id IS NOT NULL)
    ) AS counts
    FROM public.prospect_enrichment_packages package
    LEFT JOIN LATERAL (
      SELECT event.package_id,event.event_type,event.details FROM public.prospect_enrichment_events event
      WHERE event.package_id = package.id AND event.event_type IN ('package_verified','readback_failed')
        AND event.details->>'visibilityScope' = 'package'
        AND event.details->>'payloadSha256' = package.payload_sha256
      ORDER BY event.created_at DESC,event.id DESC LIMIT 1
    ) package_success ON true
    LEFT JOIN LATERAL (
      SELECT event.package_id,event.event_type,event.details FROM public.prospect_enrichment_events event
      WHERE event.package_id = package.id AND event.event_type IN ('verified','readback_failed')
        AND event.details->>'visibilityScope' = 'canonical'
        AND event.details->>'payloadSha256' = package.payload_sha256
      ORDER BY event.created_at DESC,event.id DESC LIMIT 1
    ) canonical_success ON true
    LEFT JOIN LATERAL (
      SELECT firm.id FROM public.gta_prospect_firms firm
      WHERE firm.id=package.firm_id AND package.state='applied'
        AND package.apply_receipt IS NOT NULL
        AND package.apply_receipt->>'schemaVersion'='prospect-enrichment-apply-receipt/v1'
        AND package.apply_receipt->>'firmId'=package.firm_id::text
        AND package.apply_receipt->>'resultingRevisionSha256'=
          public.prospect_enrichment_firm_revision_sha256_v1(firm.id,firm.enrichment_revision)
    ) current_applied_revision ON true
    WHERE package.run_id = r.id
  ) visibility ON true
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE item.client_package_id IS NOT NULL AND package.id IS NULL) AS missing_count,
      count(*) FILTER (WHERE item.client_package_id IS NOT NULL AND package.id IS NOT NULL AND package.payload_sha256 <> item.expected_payload_sha256) AS payload_mismatch_count,
      count(*) FILTER (WHERE item.client_package_id IS NOT NULL AND package.id IS NOT NULL AND package.research_key <> item.research_key) AS research_key_mismatch_count,
      (SELECT count(*) FROM public.prospect_enrichment_packages package
       WHERE package.run_id = r.id AND NOT EXISTS (
         SELECT 1 FROM public.prospect_enrichment_run_manifest_items item
         WHERE item.run_id = r.id AND item.client_package_id = package.client_package_id
       )) AS orphan_count,
      count(*) FILTER (
        WHERE item.initial_disposition NOT IN ('ready_for_review') OR
          (item.client_package_id IS NOT NULL AND (package.id IS NULL OR package.payload_sha256 <> item.expected_payload_sha256 OR package.research_key <> item.research_key OR
           package.state IN ('identity_hold','evidence_hold','rejected')))
      ) AS needs_attention_count
    FROM public.prospect_enrichment_run_manifest_items item
    LEFT JOIN public.prospect_enrichment_packages package
      ON package.run_id = item.run_id AND package.client_package_id = item.client_package_id
    WHERE item.run_id = r.id
  ) reconcile ON true
  WHERE (p_run_id IS NULL AND
         (p_cursor_created_at IS NULL OR (r.created_at,r.id) < (p_cursor_created_at,p_cursor_id)))
     OR (p_run_id IS NOT NULL AND r.id = p_run_id)
  ORDER BY r.created_at DESC,r.id DESC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_prospect_enrichment_run_summary_v1(p_run_id uuid)
RETURNS TABLE (
  run_id uuid, run_key text, source_system text, source_name text, created_at timestamptz,
  source_manifest_sha256 text, manifest_sha256 text, manifest_state text,
  manifest_expected_entry_count integer, manifest_received_entry_count bigint,
  manifest_expected_package_count integer, manifest_received_package_count bigint,
  manifest_expected_chunk_count integer, manifest_registered_chunk_count integer,
  candidate_count bigint, package_count bigint, package_state_counts jsonb,
  research_outcome_counts jsonb, visibility_counts jsonb, missing_package_count bigint,
  payload_mismatch_count bigint, research_key_mismatch_count bigint,
  orphan_package_count bigint, needs_attention_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM public.list_prospect_enrichment_run_summaries_v1(1,NULL,NULL,p_run_id);
$$;

CREATE OR REPLACE FUNCTION public.list_prospect_enrichment_run_manifest_items_v1(
  p_run_id uuid,
  p_after_entry_id text,
  p_limit integer
)
RETURNS TABLE (
  entry_id text,
  manifest_entry jsonb,
  package_id uuid,
  actual_payload_sha256 text,
  package_state text,
  reconciliation_state text,
  package_visibility_verified boolean,
  canonical_visibility_verified boolean,
  items jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_run_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR
     (p_after_entry_id IS NOT NULL AND char_length(p_after_entry_id) > 200) THEN
    RAISE EXCEPTION 'invalid run manifest pagination arguments';
  END IF;
  RETURN QUERY
  SELECT item.entry_id,item.manifest_entry,package.id,package.payload_sha256,package.state,
    CASE
      WHEN item.client_package_id IS NULL AND item.initial_disposition IN ('provenance_only','reference_provenance_only') THEN 'retained_source_context'
      WHEN item.client_package_id IS NULL THEN 'source_hold'
      WHEN package.id IS NULL THEN 'missing_package'
      WHEN package.payload_sha256 <> item.expected_payload_sha256 THEN 'hash_mismatch'
      WHEN package.state = 'rejected' THEN 'rejected'
      WHEN package.state = 'applied' THEN 'applied'
      WHEN package.state = 'superseded' THEN 'superseded'
      ELSE 'staged'
    END,
    CASE WHEN package.id IS NULL THEN false ELSE EXISTS (
      SELECT 1 FROM public.prospect_enrichment_events event
      WHERE event.package_id = package.id AND event.event_type = 'package_verified'
        AND event.details->>'visibilityScope' = 'package'
        AND event.details->>'payloadSha256' = package.payload_sha256
        AND event.details->>'verificationVersion' = 'prospect-enrichment-readback/v1'
        AND event.details->>'readbackSha256' ~ '^[a-f0-9]{64}$'
        AND NOT EXISTS (
          SELECT 1 FROM public.prospect_enrichment_events newer
          WHERE newer.package_id=package.id
            AND newer.event_type IN ('package_verified','readback_failed')
            AND newer.details->>'visibilityScope'='package'
            AND newer.details->>'payloadSha256'=package.payload_sha256
            AND (newer.created_at,newer.id)>(event.created_at,event.id)
        )
    ) END,
    CASE WHEN package.id IS NULL OR package.state <> 'applied' THEN false ELSE EXISTS (
      SELECT 1 FROM public.prospect_enrichment_events event
      WHERE event.package_id = package.id AND event.event_type = 'verified'
        AND event.details->>'visibilityScope' = 'canonical'
        AND event.details->>'payloadSha256' = package.payload_sha256
        AND event.details->>'verificationVersion' = 'prospect-enrichment-readback/v1'
        AND event.details->>'readbackSha256' ~ '^[a-f0-9]{64}$'
        AND package.apply_receipt IS NOT NULL
        AND package.apply_receipt->>'schemaVersion' = 'prospect-enrichment-apply-receipt/v1'
        AND package.firm_id IS NOT NULL
        AND package.apply_receipt->>'firmId' = package.firm_id::text
        AND event.details->>'expectedReceiptSha256' = encode(extensions.digest(
          convert_to(public.prospect_enrichment_stable_json_v1(package.apply_receipt), 'utf8'), 'sha256'), 'hex')
        AND EXISTS (
          SELECT 1 FROM public.gta_prospect_firms firm
          WHERE firm.id = package.firm_id
            AND package.apply_receipt->>'resultingRevisionSha256' =
              public.prospect_enrichment_firm_revision_sha256_v1(firm.id,firm.enrichment_revision)
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.prospect_enrichment_events newer
          WHERE newer.package_id=package.id
            AND newer.event_type IN ('verified','readback_failed')
            AND newer.details->>'visibilityScope'='canonical'
            AND newer.details->>'payloadSha256'=package.payload_sha256
            AND (newer.created_at,newer.id)>(event.created_at,event.id)
        )
  ) END,
    coalesce(item_rows.items,'[]'::jsonb)
  FROM public.prospect_enrichment_run_manifest_items item
  JOIN public.prospect_enrichment_runs run ON run.id = item.run_id
  LEFT JOIN public.prospect_enrichment_packages package
    ON package.run_id = item.run_id AND package.client_package_id = item.client_package_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'clientItemId',expected.value->>'clientItemId',
      'itemKind',expected.value->>'itemKind',
      'sourceEventKey',expected.value->>'sourceEventKey',
      'semanticSha256',expected.value->>'semanticSha256',
      'itemId',actual.id,
      'actualSourceEventKey',source_event.source_event_key,
      'actualSemanticSha256',source_event.semantic_sha256,
      'disposition',CASE WHEN choice.disposition IN ('accept_new','link_existing','retain_only') THEN choice.disposition ELSE 'pending' END,
      'reason',choice.reason,
      'targets',coalesce(target_rows.targets,'[]'::jsonb),
      'events',coalesce(retraction_events.events,'[]'::jsonb)
    ) ORDER BY expected.ordinality) AS items
    FROM jsonb_array_elements(item.client_items) WITH ORDINALITY AS expected(value,ordinality)
    LEFT JOIN LATERAL (
      SELECT stored_item.id,stored_item.source_event_id
      FROM public.prospect_enrichment_items stored_item
      WHERE package.id IS NOT NULL AND stored_item.package_id = package.id
        AND stored_item.client_item_id = expected.value->>'clientItemId'
      ORDER BY stored_item.id LIMIT 1
    ) actual ON true
    LEFT JOIN public.prospect_enrichment_source_events source_event
      ON source_event.id = actual.source_event_id AND source_event.source_system = run.source_system
    LEFT JOIN LATERAL (
      SELECT review_item->>'disposition' AS disposition,review_item->>'reason' AS reason
      FROM jsonb_array_elements(coalesce(package.review_json->'items','[]'::jsonb)) AS review_items(review_item)
      WHERE review_item->>'itemId' = actual.id::text
      LIMIT 1
    ) choice ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'table',target.target_table,'id',target.target_id,'rowSha256',target.target_row_sha256,
        'applicationKind',target.application_kind
      ) ORDER BY target.target_table,target.target_id) AS targets
      FROM public.prospect_enrichment_item_targets target WHERE target.item_id = actual.id
    ) target_rows ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'eventType',event.event_type,'details',event.details,'createdAt',event.created_at
      ) ORDER BY event.created_at,event.id) AS events
      FROM public.prospect_enrichment_events event
      WHERE package.id IS NOT NULL AND actual.id IS NOT NULL AND event.package_id = package.id
        AND event.event_type = 'evidence_retracted'
        AND EXISTS (
          SELECT 1 FROM public.prospect_enrichment_item_targets target
          WHERE target.item_id = actual.id AND event.details->>'targetTable' = target.target_table
            AND event.details->>'targetId' = target.target_id::text
        )
    ) retraction_events ON true
  ) item_rows ON true
  WHERE item.run_id = p_run_id AND (p_after_entry_id IS NULL OR item.entry_id > p_after_entry_id)
  ORDER BY item.entry_id
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_prospect_enrichment_package_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'prospect enrichment packages are retained and cannot be deleted';
  END IF;
  IF ROW(NEW.id, NEW.run_id, NEW.client_package_id, NEW.submitted_by, NEW.idempotency_key,
         NEW.raw_body, NEW.raw_body_sha256, NEW.payload, NEW.payload_sha256, NEW.schema_version,
         NEW.research_key, NEW.supersedes_package_id, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.run_id, OLD.client_package_id, OLD.submitted_by, OLD.idempotency_key,
         OLD.raw_body, OLD.raw_body_sha256, OLD.payload, OLD.payload_sha256, OLD.schema_version,
         OLD.research_key, OLD.supersedes_package_id, OLD.created_at) THEN
    RAISE EXCEPTION 'incoming package evidence is immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_prospect_enrichment_profile_choice()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE predecessor public.prospect_enrichment_profile_choices%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'profile choices are immutable'; END IF;
  IF NEW.supersedes_choice_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO predecessor
  FROM public.prospect_enrichment_profile_choices
  WHERE id = NEW.supersedes_choice_id
  FOR UPDATE;
  IF NOT FOUND OR predecessor.firm_id <> NEW.firm_id OR predecessor.field_key <> NEW.field_key THEN
    RAISE EXCEPTION 'profile choice may supersede only the current choice for the same firm field';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.prospect_enrichment_profile_choices successor
    WHERE successor.supersedes_choice_id = predecessor.id
  ) THEN RAISE EXCEPTION 'profile choice predecessor is no longer current'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_prospect_enrichment_supersedes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE predecessor public.prospect_enrichment_packages%ROWTYPE;
BEGIN
  IF NEW.supersedes_package_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.supersedes_package_id = NEW.id THEN RAISE EXCEPTION 'package cannot supersede itself'; END IF;
  SELECT * INTO predecessor FROM public.prospect_enrichment_packages WHERE id = NEW.supersedes_package_id;
  IF NOT FOUND OR predecessor.submitted_by <> NEW.submitted_by THEN
    RAISE EXCEPTION 'package supersession must reference an existing package from the same actor';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.supersedes_package_id IS DISTINCT FROM OLD.supersedes_package_id THEN
    RAISE EXCEPTION 'package supersession lineage is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_gta_prospect_enrichment_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  old_firm uuid;
  new_firm uuid;
  affected uuid;
  old_json jsonb;
  new_json jsonb;
BEGIN
  IF TG_TABLE_NAME = 'gta_prospect_firms' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.enrichment_revision := coalesce(NEW.enrichment_revision, 0) + 1;
      RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
      old_json := to_jsonb(OLD) - 'enrichment_revision'::text;
      new_json := to_jsonb(NEW) - 'enrichment_revision'::text;
      IF old_json IS DISTINCT FROM new_json THEN
        NEW.enrichment_revision := OLD.enrichment_revision + 1;
      END IF;
      RETURN NEW;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP IN ('UPDATE','DELETE') THEN old_firm := nullif(to_jsonb(OLD)->>'firm_id','')::uuid; END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN new_firm := nullif(to_jsonb(NEW)->>'firm_id','')::uuid; END IF;
  FOR affected IN
    SELECT DISTINCT firm_id FROM unnest(ARRAY[old_firm,new_firm]) AS firm_id
    WHERE firm_id IS NOT NULL ORDER BY firm_id
  LOOP
    UPDATE public.gta_prospect_firms
    SET enrichment_revision = enrichment_revision + 1
    WHERE id = affected;
    IF NOT FOUND THEN RAISE EXCEPTION 'prospect evidence references a missing canonical firm'; END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_gta_prospect_enrichment_batch_revisions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE affected uuid;
BEGIN
  IF OLD.state IS NOT DISTINCT FROM NEW.state THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'gta_prospect_import_batches' THEN
    FOR affected IN
      SELECT DISTINCT audit.firm_id
      FROM public.gta_prospect_import_audit audit
      WHERE audit.import_batch_id = NEW.id AND audit.firm_id IS NOT NULL
      ORDER BY audit.firm_id
    LOOP
      UPDATE public.gta_prospect_firms SET enrichment_revision = enrichment_revision + 1 WHERE id = affected;
    END LOOP;
  ELSIF TG_TABLE_NAME = 'gta_prospect_supplemental_evidence_import_batches' THEN
    FOR affected IN
      SELECT DISTINCT audit.firm_id
      FROM public.gta_prospect_supplemental_evidence_import_audit audit
      WHERE audit.evidence_import_batch_id = NEW.id AND audit.firm_id IS NOT NULL
      ORDER BY audit.firm_id
    LOOP
      UPDATE public.gta_prospect_firms SET enrichment_revision = enrichment_revision + 1 WHERE id = affected;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prospect_enrichment_packages_immutable_fields
  BEFORE UPDATE OR DELETE ON public.prospect_enrichment_packages
  FOR EACH ROW EXECUTE FUNCTION public.guard_prospect_enrichment_package_immutable_fields();
CREATE TRIGGER prospect_enrichment_packages_supersedes_guard
  BEFORE INSERT OR UPDATE ON public.prospect_enrichment_packages
  FOR EACH ROW EXECUTE FUNCTION public.guard_prospect_enrichment_supersedes();
CREATE TRIGGER prospect_enrichment_runs_manifest_guard
  BEFORE UPDATE OR DELETE ON public.prospect_enrichment_runs
  FOR EACH ROW EXECUTE FUNCTION public.guard_prospect_enrichment_run_manifest_update();
CREATE TRIGGER prospect_enrichment_run_manifest_chunks_append_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.prospect_enrichment_run_manifest_chunks
  FOR EACH ROW EXECUTE FUNCTION public.guard_prospect_enrichment_run_manifest_append();
CREATE TRIGGER prospect_enrichment_run_manifest_items_append_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.prospect_enrichment_run_manifest_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_prospect_enrichment_run_manifest_append();
CREATE TRIGGER prospect_enrichment_items_no_mutation
  BEFORE UPDATE OR DELETE ON public.prospect_enrichment_items
  FOR EACH ROW EXECUTE FUNCTION public.reject_prospect_enrichment_history_mutation();
CREATE TRIGGER prospect_enrichment_item_targets_no_mutation
  BEFORE UPDATE OR DELETE ON public.prospect_enrichment_item_targets
  FOR EACH ROW EXECUTE FUNCTION public.reject_prospect_enrichment_history_mutation();
CREATE TRIGGER prospect_enrichment_profile_choices_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.prospect_enrichment_profile_choices
  FOR EACH ROW EXECUTE FUNCTION public.guard_prospect_enrichment_profile_choice();
CREATE TRIGGER prospect_enrichment_events_no_mutation
  BEFORE UPDATE OR DELETE ON public.prospect_enrichment_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_prospect_enrichment_history_mutation();
CREATE TRIGGER prospect_enrichment_source_events_no_mutation
  BEFORE UPDATE OR DELETE ON public.prospect_enrichment_source_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_prospect_enrichment_history_mutation();

CREATE TRIGGER gta_prospect_firms_enrichment_revision
  BEFORE INSERT OR UPDATE ON public.gta_prospect_firms
  FOR EACH ROW EXECUTE FUNCTION public.bump_gta_prospect_enrichment_revision();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'gta_prospect_aliases','gta_prospect_domains','gta_prospect_offices','gta_prospect_roster_observations',
    'gta_prospect_import_audit','gta_prospect_identity_adjudications','gta_prospect_evidence_links',
    'gta_prospect_stable_identity_registry','gta_prospect_supplemental_evidence_import_audit',
    'gta_prospect_shared_identity_observations','gta_prospect_website_intake_observations',
    'gta_prospect_qualification_assessments','gta_prospect_public_contact_observations',
    'gta_prospect_downtown_geography_observations','prospect_source_record_map','prospect_source_captures',
    'prospect_research_attempts','prospect_advertising_observations','prospect_qualification_decisions',
    'prospect_firm_fit_observations','prospect_service_observations','prospect_decision_maker_contacts',
    'prospect_opportunity_observations','prospect_enrichment_profile_choices'
  ] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bump_gta_prospect_enrichment_revision()',
        table_name || '_enrichment_revision', table_name
      );
    END IF;
  END LOOP;
END;
$$;

CREATE TRIGGER gta_prospect_import_batches_enrichment_revision
  BEFORE UPDATE OF state ON public.gta_prospect_import_batches
  FOR EACH ROW EXECUTE FUNCTION public.bump_gta_prospect_enrichment_batch_revisions();
CREATE TRIGGER gta_prospect_supplemental_batches_enrichment_revision
  BEFORE UPDATE OF state ON public.gta_prospect_supplemental_evidence_import_batches
  FOR EACH ROW EXECUTE FUNCTION public.bump_gta_prospect_enrichment_batch_revisions();

ALTER TABLE public.prospect_enrichment_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_enrichment_run_manifest_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_enrichment_run_manifest_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_enrichment_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_enrichment_source_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_enrichment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_enrichment_item_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_enrichment_profile_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_enrichment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_enrichment_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_enrichment_run_manifest_chunks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_enrichment_run_manifest_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_enrichment_packages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_enrichment_source_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_enrichment_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_enrichment_item_targets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_enrichment_profile_choices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_enrichment_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.prospect_enrichment_runs, public.prospect_enrichment_packages,
  public.prospect_enrichment_run_manifest_chunks, public.prospect_enrichment_run_manifest_items,
  public.prospect_enrichment_source_events, public.prospect_enrichment_items,
  public.prospect_enrichment_item_targets, public.prospect_enrichment_profile_choices,
  public.prospect_enrichment_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.prospect_enrichment_runs TO service_role;
GRANT SELECT, INSERT ON TABLE public.prospect_enrichment_run_manifest_chunks,
  public.prospect_enrichment_run_manifest_items,
  public.prospect_enrichment_source_events, public.prospect_enrichment_items,
  public.prospect_enrichment_item_targets, public.prospect_enrichment_profile_choices,
  public.prospect_enrichment_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.prospect_enrichment_packages TO service_role;

-- The new private API owns these existing research rows. No browser role receives
-- access; immutable-history triggers continue to prohibit correction by UPDATE.
GRANT SELECT, INSERT ON TABLE public.prospect_source_record_map, public.prospect_source_captures,
  public.prospect_research_attempts, public.prospect_advertising_observations,
  public.prospect_qualification_decisions, public.prospect_firm_fit_observations,
  public.prospect_service_observations, public.prospect_decision_maker_contacts,
  public.prospect_opportunity_observations TO service_role;

REVOKE ALL ON FUNCTION public.reject_prospect_enrichment_history_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_prospect_enrichment_run_manifest_update() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_prospect_enrichment_run_manifest_append() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prospect_enrichment_stable_json_v1(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prospect_enrichment_firm_revision_sha256_v1(uuid,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_prospect_enrichment_manifest_chunk_v1(text,jsonb,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stage_prospect_enrichment_package_v1(text,text,text,text,text,text,text,text,jsonb,text,text,text,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_prospect_enrichment_run_summaries_v1(integer,timestamptz,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_prospect_enrichment_run_summary_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_prospect_enrichment_run_manifest_items_v1(uuid,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospect_enrichment_stable_json_v1(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.prospect_enrichment_firm_revision_sha256_v1(uuid,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_prospect_enrichment_manifest_chunk_v1(text,jsonb,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.stage_prospect_enrichment_package_v1(text,text,text,text,text,text,text,text,jsonb,text,text,text,jsonb,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_prospect_enrichment_run_summaries_v1(integer,timestamptz,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_prospect_enrichment_run_summary_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_prospect_enrichment_run_manifest_items_v1(uuid,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.guard_prospect_enrichment_package_immutable_fields() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_prospect_enrichment_profile_choice() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_prospect_enrichment_supersedes() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.bump_gta_prospect_enrichment_revision() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.bump_gta_prospect_enrichment_batch_revisions() FROM PUBLIC, anon, authenticated, service_role;


CREATE OR REPLACE FUNCTION public.prospect_enrichment_row_sha256_v1(p_row jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT encode(extensions.digest(convert_to(public.prospect_enrichment_stable_json_v1(p_row), 'utf8'), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.prospect_enrichment_new_firm_precondition_sha256_v1(p_package_id uuid,p_payload_sha256 text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT public.prospect_enrichment_row_sha256_v1(jsonb_build_object(
    'schemaVersion','prospect-enrichment-new-firm-precondition/v1',
    'packageId',p_package_id::text,
    'payloadSha256',p_payload_sha256
  ));
$$;

CREATE OR REPLACE FUNCTION public.prospect_enrichment_existing_target_sha256_v1(p_table text,p_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE row_json jsonb;
BEGIN
  IF p_table NOT IN (
    'gta_prospect_firms','gta_prospect_stable_identity_registry','gta_prospect_import_audit',
    'gta_prospect_supplemental_evidence_import_audit','gta_prospect_shared_identity_observations',
    'gta_prospect_website_intake_observations','gta_prospect_qualification_assessments',
    'gta_prospect_roster_observations','gta_prospect_downtown_geography_observations',
    'gta_prospect_public_contact_observations','prospect_source_record_map','prospect_source_captures',
    'prospect_research_attempts','prospect_advertising_observations','prospect_qualification_decisions',
    'prospect_firm_fit_observations','prospect_service_observations','prospect_decision_maker_contacts',
    'prospect_opportunity_observations'
  ) THEN RETURN NULL; END IF;
  EXECUTE format('SELECT to_jsonb(row_value) FROM public.%I AS row_value WHERE id = $1',p_table)
    INTO row_json USING p_id;
  IF row_json IS NULL THEN RETURN NULL; END IF;
  RETURN public.prospect_enrichment_row_sha256_v1(row_json);
END;
$$;

-- Linking existing evidence locks the exact row through receipt creation so
-- the reviewed row hash cannot become stale between validation and commit.
CREATE OR REPLACE FUNCTION public.prospect_enrichment_lock_existing_target_v1(p_table text,p_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE row_json jsonb;
BEGIN
  IF p_table NOT IN (
    'gta_prospect_firms','gta_prospect_stable_identity_registry','gta_prospect_import_audit',
    'gta_prospect_supplemental_evidence_import_audit','gta_prospect_shared_identity_observations',
    'gta_prospect_website_intake_observations','gta_prospect_qualification_assessments',
    'gta_prospect_roster_observations','gta_prospect_downtown_geography_observations',
    'gta_prospect_public_contact_observations','prospect_source_record_map','prospect_source_captures',
    'prospect_research_attempts','prospect_advertising_observations','prospect_qualification_decisions',
    'prospect_firm_fit_observations','prospect_service_observations','prospect_decision_maker_contacts',
    'prospect_opportunity_observations'
  ) THEN RETURN NULL; END IF;
  EXECUTE format('SELECT to_jsonb(row_value) FROM public.%I AS row_value WHERE id = $1 FOR UPDATE',p_table)
    INTO row_json USING p_id;
  IF row_json IS NULL THEN RETURN NULL; END IF;
  RETURN public.prospect_enrichment_row_sha256_v1(row_json);
END;
$$;

-- Only the reviewed RPC paths can change package state or the final receipt.
CREATE OR REPLACE FUNCTION public.guard_prospect_enrichment_package_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE mutation_kind text := current_setting('app.prospect_enrichment_mutation',true);
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'prospect enrichment packages are retained and cannot be deleted'; END IF;
  IF ROW(NEW.id, NEW.run_id, NEW.client_package_id, NEW.submitted_by, NEW.idempotency_key,
         NEW.raw_body, NEW.raw_body_sha256, NEW.payload, NEW.payload_sha256, NEW.schema_version,
         NEW.research_key, NEW.supersedes_package_id, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.run_id, OLD.client_package_id, OLD.submitted_by, OLD.idempotency_key,
         OLD.raw_body, OLD.raw_body_sha256, OLD.payload, OLD.payload_sha256, OLD.schema_version,
         OLD.research_key, OLD.supersedes_package_id, OLD.created_at) THEN
    RAISE EXCEPTION 'incoming package evidence is immutable';
  END IF;
  IF OLD.apply_receipt IS NOT NULL AND NEW.apply_receipt IS DISTINCT FROM OLD.apply_receipt THEN
    RAISE EXCEPTION 'application receipt is immutable';
  END IF;
  IF OLD.state IN ('applied','rejected','superseded') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'terminal package state is immutable';
  END IF;
  IF mutation_kind='review' THEN
    IF OLD.state NOT IN ('received','identity_hold','evidence_hold','ready_for_review')
       OR NEW.state NOT IN ('identity_hold','ready_for_review')
       OR NEW.apply_receipt IS NOT NULL OR NEW.applied_at IS NOT NULL
       OR (to_jsonb(NEW) - ARRAY['firm_id','state','review_json','review_sha256','expected_revision_sha256','review_expires_at','updated_at']::text[])
          IS DISTINCT FROM
          (to_jsonb(OLD) - ARRAY['firm_id','state','review_json','review_sha256','expected_revision_sha256','review_expires_at','updated_at']::text[]) THEN
      RAISE EXCEPTION 'invalid package review transition';
    END IF;
  ELSIF mutation_kind='reject' THEN
    IF OLD.state NOT IN ('received','identity_hold','evidence_hold','ready_for_review') OR NEW.state <> 'rejected'
       OR NEW.apply_receipt IS NOT NULL OR NEW.applied_at IS NOT NULL
       OR (to_jsonb(NEW) - ARRAY['state','updated_at']::text[]) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','updated_at']::text[]) THEN
      RAISE EXCEPTION 'invalid package rejection transition';
    END IF;
  ELSIF mutation_kind='apply' THEN
    IF OLD.state <> 'ready_for_review' OR NEW.state <> 'applied'
       OR NEW.apply_receipt IS NULL OR NEW.applied_at IS NULL
       OR (to_jsonb(NEW) - ARRAY['firm_id','state','apply_receipt','applied_at','updated_at']::text[])
          IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['firm_id','state','apply_receipt','applied_at','updated_at']::text[]) THEN
      RAISE EXCEPTION 'invalid package application transition';
    END IF;
  ELSE
    RAISE EXCEPTION 'package writes require a reviewed operator procedure';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prospect_enrichment_validate_review_v1(p_package_id uuid,p_review jsonb)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_review_package_row public.prospect_enrichment_packages%ROWTYPE;
  v_review_firm_row public.gta_prospect_firms%ROWTYPE;
  v_review_item_row public.prospect_enrichment_items%ROWTYPE;
  v_review_source_row public.prospect_enrichment_items%ROWTYPE;
  v_review_choice jsonb;
  v_review_source_id text;
  v_review_expected_firm_id uuid;
  v_review_core jsonb;
  v_review_core_evidence jsonb;
  v_review_mapping jsonb;
  v_review_mapping_item public.prospect_enrichment_items%ROWTYPE;
  v_review_mapping_source public.prospect_enrichment_items%ROWTYPE;
  v_review_roster_item public.prospect_enrichment_items%ROWTYPE;
  v_review_roster_source public.prospect_enrichment_items%ROWTYPE;
  v_review_source_date date;
  v_review_roster_date date;
  v_review_source_record_key text;
  v_review_expected_source_record_key text;
  v_review_normalized_name text;
  v_review_normalized_name_folded text;
  v_review_domain_value text;
  v_review_mapped_cities text[];
  v_review_core_cities text[];
  v_review_mapped_practice_areas text[];
  v_review_core_practice_areas text[];
  v_review_source_url text;
  v_review_source_excerpt text;
  v_review_firm_name text;
  v_review_city text;
  v_review_website_source_id text;
  v_review_expected_field_key text;
  v_review_expected_selector text;
  v_review_expected_selected_value jsonb;
  v_review_source_key_valid boolean;
  v_review_package_item_count integer;
  v_review_review_item_count integer;
BEGIN
  SELECT * INTO v_review_package_row FROM public.prospect_enrichment_packages WHERE id = p_package_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'package_not_found'; END IF;
  IF jsonb_typeof(p_review) <> 'object'
     OR p_review - ARRAY['payloadSha256','identity','items']::text[] <> '{}'::jsonb
     OR NOT (p_review ?& ARRAY['payloadSha256','identity','items'])
     OR p_review->>'payloadSha256' IS DISTINCT FROM v_review_package_row.payload_sha256
     OR jsonb_typeof(p_review->'identity') <> 'object'
     OR jsonb_typeof(p_review->'items') <> 'array'
     OR (p_review->'identity') - ARRAY['choice','firmId','coreInput']::text[] <> '{}'::jsonb
     OR NOT (p_review->'identity' ?& ARRAY['choice','firmId','coreInput']) THEN
    RAISE EXCEPTION 'invalid_review';
  END IF;

  SELECT count(*) INTO v_review_package_item_count FROM public.prospect_enrichment_items WHERE package_id = p_package_id;
  v_review_review_item_count := jsonb_array_length(p_review->'items');
  IF v_review_review_item_count <> v_review_package_item_count OR v_review_review_item_count > 1001 OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_review->'items') AS requested(value)
    LEFT JOIN public.prospect_enrichment_items AS stored
      ON stored.package_id = p_package_id AND stored.id::text = requested.value->>'itemId'
    WHERE jsonb_typeof(requested.value) <> 'object'
       OR requested.value - ARRAY['itemId','disposition','reason','profileChoice']::text[] <> '{}'::jsonb
       OR NOT (requested.value ?& ARRAY['itemId','disposition','reason','profileChoice'])
       OR stored.id IS NULL
       OR requested.value->>'disposition' NOT IN ('accept_new','link_existing','retain_only')
       OR jsonb_typeof(requested.value->'profileChoice') NOT IN ('null','object')
       OR (jsonb_typeof(requested.value->'profileChoice')='object' AND (
           (requested.value->'profileChoice') - ARRAY['fieldKey','sourceSelector','selectedValue']::text[] <> '{}'::jsonb
           OR NOT (requested.value->'profileChoice' ?& ARRAY['fieldKey','sourceSelector','selectedValue'])
           OR jsonb_typeof(requested.value->'profileChoice'->'fieldKey') <> 'string'
           OR jsonb_typeof(requested.value->'profileChoice'->'sourceSelector') <> 'string'
           OR char_length(btrim(requested.value->'profileChoice'->>'fieldKey')) NOT BETWEEN 1 AND 300
           OR char_length(btrim(requested.value->'profileChoice'->>'sourceSelector')) NOT BETWEEN 1 AND 2000))
       OR (requested.value->>'disposition' = 'retain_only' AND
           (jsonb_typeof(requested.value->'reason') <> 'string' OR char_length(btrim(requested.value->>'reason')) = 0))
       OR (requested.value->>'disposition' = 'retain_only' AND requested.value->'profileChoice' <> 'null'::jsonb)
       OR (stored.item_kind = 'source' AND
           (requested.value->>'disposition' <> 'retain_only' OR requested.value->'profileChoice' <> 'null'::jsonb))
       OR (requested.value->>'disposition' = 'link_existing' AND stored.data->'existingRecord' IS NULL)
       OR (requested.value->>'disposition' IN ('accept_new','link_existing') AND
           (stored.provenance_state <> 'complete' OR stored.data->>'evidenceState' = 'retracted'))
       OR (requested.value->'profileChoice' <> 'null'::jsonb AND requested.value->>'disposition' NOT IN ('accept_new','link_existing'))
  ) OR EXISTS (
    SELECT requested.value->>'itemId'
    FROM jsonb_array_elements(p_review->'items') AS requested(value)
    GROUP BY requested.value->>'itemId' HAVING count(*) <> 1
  ) OR EXISTS (
    SELECT requested.value->'profileChoice'->>'fieldKey'
    FROM jsonb_array_elements(p_review->'items') AS requested(value)
    WHERE jsonb_typeof(requested.value->'profileChoice')='object'
    GROUP BY requested.value->'profileChoice'->>'fieldKey' HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'invalid_review'; END IF;

  -- Accepted items can cite only complete, public sources from this package.
  FOR v_review_item_row IN
    SELECT stored.* FROM public.prospect_enrichment_items stored
    JOIN jsonb_array_elements(p_review->'items') requested(value)
      ON requested.value->>'itemId' = stored.id::text
    WHERE stored.package_id = p_package_id AND requested.value->>'disposition' IN ('accept_new','link_existing')
  LOOP
    IF v_review_item_row.item_kind = 'source' THEN RAISE EXCEPTION 'invalid_item'; END IF;
    IF jsonb_typeof(v_review_item_row.data->'sourceIds') <> 'array' OR jsonb_array_length(v_review_item_row.data->'sourceIds') = 0 THEN
      RAISE EXCEPTION 'invalid_item';
    END IF;
    FOR v_review_source_id IN SELECT jsonb_array_elements_text(v_review_item_row.data->'sourceIds') LOOP
      SELECT * INTO v_review_source_row
      FROM public.prospect_enrichment_items source_item
      WHERE source_item.package_id = p_package_id
        AND source_item.client_item_id = 'src:' || v_review_source_id
        AND source_item.item_kind = 'source';
      IF NOT FOUND OR v_review_source_row.provenance_state <> 'complete' OR v_review_source_row.data->>'policyState' <> 'public-source'
         OR coalesce(v_review_source_row.data->>'url','') !~ '^https?://' THEN
        RAISE EXCEPTION 'invalid_item';
      END IF;
    END LOOP;
    IF v_review_item_row.data ? 'existingRecord' AND v_review_item_row.data->'existingRecord' <> 'null'::jsonb THEN
      IF v_review_item_row.data #>> '{existingRecord,table}' IS NULL
         OR v_review_item_row.data #>> '{existingRecord,id}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR v_review_item_row.data #>> '{existingRecord,rowSha256}' !~ '^[a-f0-9]{64}$' THEN
        RAISE EXCEPTION 'invalid_item';
      END IF;
    END IF;
  END LOOP;

  -- Profile selection is a narrow, typed projection. The client submits the
  -- exact JSON Pointer and value it reviewed; this function re-derives both
  -- from the immutable item and rejects every unsupported item kind.
  FOR v_review_item_row IN
    SELECT stored.* FROM public.prospect_enrichment_items stored
    JOIN jsonb_array_elements(p_review->'items') requested(value)
      ON requested.value->>'itemId' = stored.id::text
    WHERE stored.package_id = p_package_id
      AND jsonb_typeof(requested.value->'profileChoice') = 'object'
  LOOP
    v_review_choice := (SELECT value FROM jsonb_array_elements(p_review->'items') requested(value)
      WHERE requested.value->>'itemId'=v_review_item_row.id::text LIMIT 1);
    IF v_review_item_row.item_kind='website_intake' THEN
      v_review_expected_field_key := 'websiteUrl'; v_review_expected_selector := '/data/pageUrl';
      v_review_expected_selected_value := v_review_item_row.data #> '{data,pageUrl}';
    ELSIF v_review_item_row.item_kind='firm_fit' THEN
      v_review_expected_field_key := 'office:' || v_review_item_row.client_item_id; v_review_expected_selector := '/data/office';
      v_review_expected_selected_value := v_review_item_row.data #> '{data,office}';
    ELSIF v_review_item_row.item_kind IN ('roster','contact','advertising','opportunity') THEN
      v_review_expected_field_key := v_review_item_row.item_kind || ':' || v_review_item_row.client_item_id; v_review_expected_selector := '/data';
      v_review_expected_selected_value := v_review_item_row.data->'data';
    ELSE
      RAISE EXCEPTION 'invalid_profile_choice';
    END IF;
    IF v_review_choice->'profileChoice'->>'fieldKey' IS DISTINCT FROM v_review_expected_field_key
       OR v_review_choice->'profileChoice'->>'sourceSelector' IS DISTINCT FROM v_review_expected_selector
       OR v_review_choice->'profileChoice'->'selectedValue' IS DISTINCT FROM v_review_expected_selected_value THEN
      RAISE EXCEPTION 'invalid_profile_choice';
    END IF;
  END LOOP;

  IF p_review->'identity'->>'choice' = 'unresolved' THEN
    IF p_review->'identity'->'firmId' IS DISTINCT FROM 'null'::jsonb
       OR p_review->'identity'->'coreInput' IS DISTINCT FROM 'null'::jsonb
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_review->'items') review_choice(value)
                  WHERE review_choice.value->>'disposition' <> 'retain_only' OR review_choice.value->'profileChoice' <> 'null'::jsonb) THEN
      RAISE EXCEPTION 'invalid_identity';
    END IF;
    RETURN NULL;
  ELSIF p_review->'identity'->>'choice' = 'existing' THEN
    IF p_review->'identity'->>'firmId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR p_review->'identity'->'coreInput' IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION 'invalid_identity';
    END IF;
    v_review_expected_firm_id := (p_review->'identity'->>'firmId')::uuid;
    SELECT * INTO v_review_firm_row FROM public.gta_prospect_firms WHERE id = v_review_expected_firm_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_identity'; END IF;
    IF v_review_package_row.payload #>> '{subject,databaseFirmId}' IS NOT NULL
       AND v_review_package_row.payload #>> '{subject,databaseFirmId}' <> v_review_expected_firm_id::text THEN
      RAISE EXCEPTION 'identity_conflict';
    END IF;
    IF v_review_package_row.payload #>> '{subject,stableFirmId}' IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.gta_prospect_stable_identity_registry registry
      WHERE registry.firm_id = v_review_expected_firm_id
        AND registry.stable_firm_id = v_review_package_row.payload #>> '{subject,stableFirmId}'
        AND registry.canonical_domain = v_review_package_row.payload #>> '{subject,canonicalDomain}'
    ) THEN RAISE EXCEPTION 'identity_conflict'; END IF;
    v_review_domain_value := lower(regexp_replace(coalesce(v_review_package_row.payload #>> '{subject,canonicalDomain}',''), '^www\.', ''));
    IF v_review_domain_value <> '' AND EXISTS (
      SELECT 1 FROM public.gta_prospect_domains domain_row
      WHERE domain_row.normalized_domain_value = v_review_domain_value AND domain_row.firm_id <> v_review_expected_firm_id
      UNION ALL
      SELECT 1 FROM public.gta_prospect_stable_identity_registry registry
      WHERE registry.canonical_domain = v_review_domain_value AND registry.firm_id <> v_review_expected_firm_id
    ) THEN RAISE EXCEPTION 'identity_conflict'; END IF;
    RETURN v_review_expected_firm_id;
  ELSIF p_review->'identity'->>'choice' <> 'new' THEN
    RAISE EXCEPTION 'invalid_identity';
  END IF;

  IF p_review->'identity'->'firmId' IS DISTINCT FROM 'null'::jsonb
     OR v_review_package_row.identity_state <> 'unresolved'
     OR v_review_package_row.payload #>> '{subject,databaseFirmId}' IS NOT NULL
     OR v_review_package_row.payload #>> '{subject,stableFirmId}' IS NOT NULL
     OR jsonb_typeof(p_review->'identity'->'coreInput') <> 'object' THEN
    RAISE EXCEPTION 'invalid_identity';
  END IF;
  v_review_core := p_review->'identity'->'coreInput';
  IF v_review_core - ARRAY['id','firmName','city','officeCities','websiteUrl','practiceAreas','observedLawyerCount',
      'observedLawyerCountQualifier','observedLawyerCountDisplay','rosterSourceUrl','rosterCheckedAt',
      'reconciliationStatus','legacyClusterLawyerCount','legacyCrosswalk','reconciliationNote','publicContacts','coreEvidence']::text[] <> '{}'::jsonb
     OR NOT (v_review_core ?& ARRAY['id','firmName','city','officeCities','websiteUrl','practiceAreas','observedLawyerCount',
      'observedLawyerCountQualifier','observedLawyerCountDisplay','rosterSourceUrl','rosterCheckedAt',
      'reconciliationStatus','legacyClusterLawyerCount','legacyCrosswalk','reconciliationNote','publicContacts','coreEvidence'])
     OR jsonb_typeof(v_review_core->'coreEvidence') <> 'object'
     OR (v_review_core->'coreEvidence') - ARRAY['firmName','city','officeCities','websiteUrl','practiceAreas','roster']::text[] <> '{}'::jsonb
     OR NOT (v_review_core->'coreEvidence' ?& ARRAY['firmName','city','officeCities','websiteUrl','practiceAreas','roster'])
     OR jsonb_typeof(v_review_core->'coreEvidence'->'firmName') <> 'object'
     OR (v_review_core->'coreEvidence'->'firmName') - ARRAY['sourceId']::text[] <> '{}'::jsonb
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_review_core->'coreEvidence'->'firmName')) <> 1
     OR jsonb_typeof(v_review_core->'coreEvidence'->'firmName'->'sourceId') <> 'string'
     OR jsonb_typeof(v_review_core->'coreEvidence'->'city') <> 'object'
     OR (v_review_core->'coreEvidence'->'city') - ARRAY['itemId','sourceId']::text[] <> '{}'::jsonb
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_review_core->'coreEvidence'->'city')) <> 2
     OR jsonb_typeof(v_review_core->'coreEvidence'->'officeCities') <> 'array'
     OR jsonb_typeof(v_review_core->'coreEvidence'->'practiceAreas') <> 'array'
     OR jsonb_typeof(v_review_core->'coreEvidence'->'websiteUrl') <> 'object'
     OR (v_review_core->'coreEvidence'->'websiteUrl') - ARRAY['sourceId']::text[] <> '{}'::jsonb
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_review_core->'coreEvidence'->'websiteUrl')) <> 1
     OR (v_review_core->'coreEvidence'->'websiteUrl'->'sourceId' <> 'null'::jsonb
         AND jsonb_typeof(v_review_core->'coreEvidence'->'websiteUrl'->'sourceId') <> 'string')
     OR (v_review_core->'coreEvidence'->'roster') - ARRAY['itemId','sourceId']::text[] <> '{}'::jsonb
     OR jsonb_typeof(v_review_core->'coreEvidence'->'roster') <> 'object'
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_review_core->'coreEvidence'->'roster')) <> 2
     OR jsonb_typeof(v_review_core->'coreEvidence'->'city'->'itemId') <> 'string'
     OR jsonb_typeof(v_review_core->'coreEvidence'->'city'->'sourceId') <> 'string'
     OR jsonb_typeof(v_review_core->'coreEvidence'->'roster'->'itemId') <> 'string'
     OR jsonb_typeof(v_review_core->'coreEvidence'->'roster'->'sourceId') <> 'string'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_review_core->'coreEvidence'->'officeCities') AS entry(value)
       WHERE jsonb_typeof(entry.value) <> 'object' OR entry.value - ARRAY['itemId','sourceId']::text[] <> '{}'::jsonb
         OR NOT (entry.value ?& ARRAY['itemId','sourceId'])
         OR jsonb_typeof(entry.value->'itemId') <> 'string'
         OR entry.value->>'itemId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR jsonb_typeof(entry.value->'sourceId') <> 'string'
         OR entry.value->>'sourceId' !~ '^[a-z0-9][a-z0-9._-]{0,119}$')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_review_core->'coreEvidence'->'practiceAreas') AS entry(value)
       WHERE jsonb_typeof(entry.value) <> 'object' OR entry.value - ARRAY['itemId','sourceId']::text[] <> '{}'::jsonb
         OR NOT (entry.value ?& ARRAY['itemId','sourceId'])
         OR jsonb_typeof(entry.value->'itemId') <> 'string'
         OR entry.value->>'itemId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR jsonb_typeof(entry.value->'sourceId') <> 'string'
         OR entry.value->>'sourceId' !~ '^[a-z0-9][a-z0-9._-]{0,119}$')
     OR v_review_core->>'reconciliationStatus' <> 'provisional_new'
     OR v_review_core->'legacyClusterLawyerCount' <> 'null'::jsonb OR v_review_core->'legacyCrosswalk' <> 'null'::jsonb
     OR v_review_core->'publicContacts' <> '[]'::jsonb
     OR jsonb_typeof(v_review_core->'officeCities') <> 'array' OR jsonb_array_length(v_review_core->'officeCities') = 0
     OR jsonb_typeof(v_review_core->'practiceAreas') <> 'array'
     OR v_review_core->>'firmName' IS DISTINCT FROM v_review_package_row.payload #>> '{subject,displayName}'
     OR v_review_core->>'city' IS DISTINCT FROM v_review_core->'officeCities'->>0
     OR v_review_core->>'observedLawyerCountQualifier' NOT IN ('exact','at_least','unknown')
     OR char_length(btrim(coalesce(v_review_core->>'reconciliationNote',''))) < 40
     OR char_length(v_review_core->>'reconciliationNote') > 5000 THEN
    RAISE EXCEPTION 'invalid_identity';
  END IF;

  v_review_firm_name := v_review_core->>'firmName';
  v_review_city := v_review_core->>'city';
  IF v_review_core->'observedLawyerCountQualifier' = '"unknown"'::jsonb THEN
    IF v_review_core->'observedLawyerCount' <> 'null'::jsonb THEN RAISE EXCEPTION 'invalid_identity'; END IF;
  ELSIF jsonb_typeof(v_review_core->'observedLawyerCount') <> 'number'
        OR (v_review_core->>'observedLawyerCount')::numeric < 0 OR (v_review_core->>'observedLawyerCount')::numeric <> trunc((v_review_core->>'observedLawyerCount')::numeric) THEN
    RAISE EXCEPTION 'invalid_identity';
  END IF;
  IF v_review_core->'websiteUrl' <> 'null'::jsonb AND coalesce(v_review_core->>'websiteUrl','') !~ '^https?://'
     OR jsonb_typeof(v_review_core->'practiceAreas') <> 'array'
     OR v_review_core->'officeCities'->>0 IS DISTINCT FROM v_review_city THEN RAISE EXCEPTION 'invalid_identity'; END IF;

  v_review_core_evidence := v_review_core->'coreEvidence';
  -- Firm name is supported by an exact public-source excerpt, never by the subject claim alone.
  source_id := v_review_core_evidence #>> '{firmName,sourceId}';
  SELECT * INTO v_review_source_row FROM public.prospect_enrichment_items
  WHERE package_id = p_package_id AND client_item_id = 'src:' || v_review_source_id AND item_kind = 'source';
  IF NOT FOUND OR v_review_source_row.provenance_state <> 'complete' OR v_review_source_row.data->>'policyState' <> 'public-source'
     OR v_review_source_row.data->>'excerpt' IS NULL OR position(v_review_firm_name IN v_review_source_row.data->>'excerpt') = 0 THEN
    RAISE EXCEPTION 'invalid_identity';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.prospect_enrichment_items item
    JOIN jsonb_array_elements(p_review->'items') review_choice(value) ON review_choice.value->>'itemId' = item.id::text
    WHERE item.package_id = p_package_id AND item.item_kind <> 'source'
      AND review_choice.value->>'disposition' IN ('accept_new','link_existing')
      AND item.data->'sourceIds' @> jsonb_build_array(v_review_source_id)
  ) THEN RAISE EXCEPTION 'invalid_identity'; END IF;

  -- The primary and all office cities come only from explicitly selected firm-fit evidence.
  mapping := v_review_core_evidence->'city';
  IF v_review_mapping->>'itemId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'invalid_identity'; END IF;
  SELECT * INTO v_review_mapping_item FROM public.prospect_enrichment_items WHERE id=(v_review_mapping->>'itemId')::uuid AND package_id=p_package_id;
  SELECT * INTO v_review_mapping_source FROM public.prospect_enrichment_items WHERE package_id=p_package_id AND client_item_id='src:' || (v_review_mapping->>'sourceId') AND item_kind='source';
  IF NOT FOUND OR v_review_mapping_item.item_kind <> 'firm_fit' OR v_review_mapping_item.data #>> '{data,office,city}' IS DISTINCT FROM v_review_city
     OR NOT v_review_mapping_item.data->'sourceIds' @> jsonb_build_array(v_review_mapping->>'sourceId')
     OR v_review_mapping_source.data->>'policyState' <> 'public-source' OR v_review_mapping_source.provenance_state <> 'complete'
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_review->'items') review_choice(value)
       WHERE review_choice.value->>'itemId'=v_review_mapping_item.id::text AND review_choice.value->>'disposition' IN ('accept_new','link_existing')) THEN
    RAISE EXCEPTION 'invalid_identity';
  END IF;

  SELECT array_agg(cities.city_value ORDER BY cities.ordinal), array_agg(cities.city_value ORDER BY cities.ordinal)
  INTO v_review_mapped_cities, v_review_core_cities
  FROM (
    SELECT entry.ordinality AS ordinal,
           city_item.data #>> '{data,office,city}' AS city_value
    FROM jsonb_array_elements(v_review_core_evidence->'officeCities') WITH ORDINALITY AS entry(value,ordinality)
    JOIN public.prospect_enrichment_items city_item ON city_item.id=(entry.value->>'itemId')::uuid
    JOIN public.prospect_enrichment_items city_source ON city_source.package_id=p_package_id
      AND city_source.client_item_id='src:' || (entry.value->>'sourceId') AND city_source.item_kind='source'
    WHERE city_item.package_id=p_package_id AND city_item.item_kind='firm_fit'
      AND city_item.data->'sourceIds' @> jsonb_build_array(entry.value->>'sourceId')
      AND city_source.provenance_state='complete' AND city_source.data->>'policyState'='public-source'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_review->'items') review_choice(value)
        WHERE review_choice.value->>'itemId'=city_item.id::text AND review_choice.value->>'disposition' IN ('accept_new','link_existing'))
  ) cities;
  SELECT array_agg(value ORDER BY ordinality) INTO v_review_core_cities FROM jsonb_array_elements_text(v_review_core->'officeCities') WITH ORDINALITY AS listed(value,ordinality);
  IF v_review_mapped_cities IS NULL OR v_review_mapped_cities IS DISTINCT FROM v_review_core_cities OR v_review_mapped_cities[1] IS DISTINCT FROM v_review_city
     OR (SELECT count(DISTINCT lower(btrim(value))) FROM unnest(v_review_mapped_cities) value) <> cardinality(v_review_mapped_cities)
     OR (SELECT count(*) FROM jsonb_array_elements(v_review_core_evidence->'officeCities')) <> cardinality(v_review_mapped_cities) THEN
    RAISE EXCEPTION 'invalid_identity';
  END IF;

  SELECT array_agg(services.name_value ORDER BY services.service_normalized_name COLLATE "C") INTO v_review_mapped_practice_areas
  FROM (
    SELECT lower(btrim(item.data #>> '{data,name}') COLLATE "C") AS service_normalized_name,
           min(item.data #>> '{data,name}') AS name_value
    FROM jsonb_array_elements(v_review_core_evidence->'practiceAreas') AS entry(value)
    JOIN public.prospect_enrichment_items item ON item.id=(entry.value->>'itemId')::uuid AND item.package_id=p_package_id
    JOIN public.prospect_enrichment_items source_item ON source_item.package_id=p_package_id
      AND source_item.client_item_id='src:' || (entry.value->>'sourceId') AND source_item.item_kind='source'
    WHERE item.item_kind='service' AND item.data->'sourceIds' @> jsonb_build_array(entry.value->>'sourceId')
      AND source_item.provenance_state='complete' AND source_item.data->>'policyState'='public-source'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_review->'items') review_choice(value)
        WHERE review_choice.value->>'itemId'=item.id::text AND review_choice.value->>'disposition' IN ('accept_new','link_existing'))
    GROUP BY lower(btrim(item.data #>> '{data,name}') COLLATE "C")
  ) services;
  SELECT array_agg(value ORDER BY ordinality) INTO v_review_core_practice_areas FROM jsonb_array_elements_text(v_review_core->'practiceAreas') WITH ORDINALITY AS listed(value,ordinality);
  IF coalesce(v_review_mapped_practice_areas,'{}') IS DISTINCT FROM coalesce(v_review_core_practice_areas,'{}')
     OR (SELECT count(*) FROM jsonb_array_elements(v_review_core_evidence->'practiceAreas')) <> coalesce(cardinality(v_review_mapped_practice_areas),0) THEN
    RAISE EXCEPTION 'invalid_identity';
  END IF;

  v_review_mapping := v_review_core_evidence->'roster';
  IF v_review_mapping->>'itemId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'invalid_identity'; END IF;
  SELECT * INTO v_review_roster_item FROM public.prospect_enrichment_items WHERE id=(v_review_mapping->>'itemId')::uuid AND package_id=p_package_id;
  SELECT * INTO v_review_roster_source FROM public.prospect_enrichment_items WHERE package_id=p_package_id AND client_item_id='src:' || (v_review_mapping->>'sourceId') AND item_kind='source';
  IF NOT FOUND OR v_review_roster_item.item_kind <> 'roster' OR v_review_roster_item.data->>'evidenceState' <> 'asserted'
     OR NOT v_review_roster_item.data->'sourceIds' @> jsonb_build_array(v_review_mapping->>'sourceId')
     OR v_review_roster_source.provenance_state <> 'complete' OR v_review_roster_source.data->>'policyState' <> 'public-source'
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_review->'items') review_choice(value)
       WHERE review_choice.value->>'itemId'=v_review_roster_item.id::text AND review_choice.value->>'disposition' IN ('accept_new','link_existing')) THEN
    RAISE EXCEPTION 'invalid_identity';
  END IF;
  v_review_roster_date := coalesce(v_review_roster_item.observed_on,(v_review_roster_item.observed_at AT TIME ZONE 'UTC')::date);
  v_review_source_date := coalesce(nullif(v_review_roster_source.data->>'observedOn','')::date,(nullif(v_review_roster_source.data->>'observedAt','')::timestamptz AT TIME ZONE 'UTC')::date);
  IF v_review_roster_date IS NULL OR v_review_source_date IS DISTINCT FROM v_review_roster_date
     OR v_review_core->>'rosterCheckedAt' IS DISTINCT FROM to_char(v_review_roster_date,'YYYY-MM-DD')
     OR v_review_core->>'rosterSourceUrl' IS DISTINCT FROM v_review_roster_source.data->>'url'
     OR v_review_core->'observedLawyerCount' IS DISTINCT FROM v_review_roster_item.data #> '{data,lawyerCount}'
     OR v_review_core->>'observedLawyerCountQualifier' IS DISTINCT FROM v_review_roster_item.data #>> '{data,countQualifier}'
     OR v_review_core->'observedLawyerCountDisplay' IS DISTINCT FROM v_review_roster_item.data #> '{data,display}' THEN
    RAISE EXCEPTION 'invalid_identity';
  END IF;

  v_review_website_source_id := v_review_core_evidence #>> '{websiteUrl,sourceId}';
  IF v_review_core->'websiteUrl' = 'null'::jsonb THEN
    IF v_review_website_source_id IS NOT NULL THEN RAISE EXCEPTION 'invalid_identity'; END IF;
  ELSE
    IF v_review_website_source_id IS NULL OR v_review_core->>'websiteUrl' !~ '^https?://' THEN RAISE EXCEPTION 'invalid_identity'; END IF;
    SELECT * INTO v_review_source_row FROM public.prospect_enrichment_items
    WHERE package_id=p_package_id AND client_item_id='src:' || v_review_website_source_id AND item_kind='source';
    v_review_source_date := coalesce(nullif(v_review_source_row.data->>'observedOn','')::date,(nullif(v_review_source_row.data->>'observedAt','')::timestamptz AT TIME ZONE 'UTC')::date);
    IF NOT FOUND OR v_review_source_row.provenance_state <> 'complete' OR v_review_source_row.data->>'policyState' <> 'public-source'
       OR v_review_source_row.data->>'url' IS DISTINCT FROM v_review_core->>'websiteUrl' OR v_review_source_date IS DISTINCT FROM v_review_roster_date THEN
      RAISE EXCEPTION 'invalid_identity';
    END IF;
  END IF;

  IF position(v_review_firm_name IN v_review_core->>'reconciliationNote') = 0
     OR position(v_review_city IN v_review_core->>'reconciliationNote') = 0
     OR position(to_char(v_review_roster_date,'YYYY-MM-DD') IN v_review_core->>'reconciliationNote') = 0
     OR lower(btrim(v_review_core->>'reconciliationNote')) IN ('reviewed','new firm','verified','evidence reviewed') THEN
    RAISE EXCEPTION 'invalid_identity';
  END IF;

  v_review_source_record_key := v_review_package_row.payload #>> '{subject,sourceRecordKey}';
  v_review_source_key_valid := v_review_source_record_key ~ '^[a-z0-9][a-z0-9-]{0,159}$';
  IF v_review_source_key_valid AND NOT EXISTS (SELECT 1 FROM public.gta_prospect_firms firm WHERE firm.source_record_key=v_review_source_record_key) THEN
    v_review_expected_source_record_key := v_review_source_record_key;
  ELSE
    v_review_expected_source_record_key := 'pe-' || replace(p_package_id::text,'-','');
  END IF;
  IF v_review_core->>'id' IS DISTINCT FROM v_review_expected_source_record_key THEN RAISE EXCEPTION 'invalid_identity'; END IF;

  v_review_normalized_name := lower(regexp_replace(btrim(v_review_firm_name), '\s+', ' ', 'g'));
  v_review_normalized_name_folded := btrim(regexp_replace(v_review_normalized_name, '[^a-z0-9]+', ' ', 'g'));
  IF EXISTS (
    SELECT 1 FROM public.gta_prospect_firms firm
    WHERE lower(regexp_replace(btrim(firm.normalized_display_name), '\s+', ' ', 'g'))=v_review_normalized_name
       OR btrim(regexp_replace(lower(firm.normalized_display_name), '[^a-z0-9]+', ' ', 'g'))=v_review_normalized_name_folded
    UNION ALL
    SELECT 1 FROM public.gta_prospect_aliases alias
    WHERE lower(regexp_replace(btrim(alias.normalized_alias_value), '\s+', ' ', 'g'))=v_review_normalized_name
       OR btrim(regexp_replace(lower(alias.normalized_alias_value), '[^a-z0-9]+', ' ', 'g'))=v_review_normalized_name_folded
  ) THEN RAISE EXCEPTION 'identity_conflict'; END IF;

  IF v_review_core->'websiteUrl' <> 'null'::jsonb THEN
    v_review_domain_value := lower(regexp_replace(split_part(split_part(regexp_replace(v_review_core->>'websiteUrl','^https?://','','i'),'/','1'),':','1'), '^www\.', ''));
    IF v_review_domain_value = '' OR EXISTS (
      SELECT 1 FROM public.gta_prospect_domains domain_row WHERE domain_row.normalized_domain_value=v_review_domain_value
      UNION ALL SELECT 1 FROM public.gta_prospect_stable_identity_registry registry WHERE registry.canonical_domain=v_review_domain_value
      UNION ALL SELECT 1 FROM public.gta_prospect_firms firm
        WHERE lower(regexp_replace(split_part(split_part(regexp_replace(coalesce(firm.website_url,''),'^https?://','','i'),'/','1'),':','1'), '^www\.', ''))=v_review_domain_value
    ) THEN RAISE EXCEPTION 'identity_conflict'; END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_prospect_enrichment_package_v1(
  p_package_id uuid,p_payload_sha256 text,p_review jsonb,p_review_sha256 text,p_operator_id uuid,p_review_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  package_row public.prospect_enrichment_packages%ROWTYPE;
  target_firm_id uuid;
  target_firm public.gta_prospect_firms%ROWTYPE;
  expected_revision text;
  computed_review_sha text;
  outcome_value text;
  final_state text;
BEGIN
  PERFORM set_config('app.prospect_enrichment_mutation','review',true);
  SELECT * INTO package_row FROM public.prospect_enrichment_packages WHERE id=p_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'package_not_found'; END IF;
  IF package_row.payload_sha256 IS DISTINCT FROM p_payload_sha256 THEN RAISE EXCEPTION 'payload_mismatch'; END IF;
  IF package_row.state IN ('applied','rejected','superseded') THEN RAISE EXCEPTION 'package_terminal'; END IF;
  IF p_operator_id IS NULL OR p_review_expires_at <= now() OR p_review_expires_at > now() + interval '1 hour' THEN
    RAISE EXCEPTION 'invalid_review';
  END IF;
  computed_review_sha := public.prospect_enrichment_row_sha256_v1(p_review);
  IF p_review_sha256 IS DISTINCT FROM computed_review_sha OR p_review->>'payloadSha256' IS DISTINCT FROM package_row.payload_sha256 THEN
    RAISE EXCEPTION 'invalid_review';
  END IF;
  target_firm_id := public.prospect_enrichment_validate_review_v1(p_package_id,p_review);
  IF target_firm_id IS NOT NULL THEN
    SELECT * INTO target_firm FROM public.gta_prospect_firms WHERE id=target_firm_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'identity_conflict'; END IF;
    expected_revision := public.prospect_enrichment_firm_revision_sha256_v1(target_firm.id,target_firm.enrichment_revision);
  ELSE
    expected_revision := public.prospect_enrichment_new_firm_precondition_sha256_v1(p_package_id,p_payload_sha256);
  END IF;
  outcome_value := CASE WHEN package_row.review_sha256 = p_review_sha256 THEN 'replayed' ELSE 'reviewed' END;
  final_state := CASE WHEN p_review->'identity'->>'choice'='unresolved' THEN 'identity_hold' ELSE 'ready_for_review' END;
  UPDATE public.prospect_enrichment_packages
  SET firm_id=target_firm_id,state=final_state,review_json=p_review,review_sha256=p_review_sha256,
      expected_revision_sha256=expected_revision,review_expires_at=p_review_expires_at
  WHERE id=p_package_id;
  IF outcome_value='reviewed' THEN
    INSERT INTO public.prospect_enrichment_events(package_id,event_key,event_type,actor,details)
    VALUES (p_package_id,'review:' || p_review_sha256,
      CASE WHEN package_row.review_sha256 IS NULL THEN 'reviewed' ELSE 'review_changed' END,
      p_operator_id::text,jsonb_build_object(
        'payloadSha256',p_payload_sha256,'reviewSha256',p_review_sha256,
        'expectedRevisionSha256',expected_revision,'reviewExpiresAt',p_review_expires_at,
        'identityChoice',p_review->'identity'->>'choice'
      )) ON CONFLICT (package_id,event_key) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('outcome',outcome_value,'packageId',p_package_id,'reviewSha256',p_review_sha256,
    'expectedRevisionSha256',expected_revision,'reviewExpiresAt',p_review_expires_at,'review',p_review,'state',final_state);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_prospect_enrichment_package_v1(
  p_package_id uuid,p_payload_sha256 text,p_reason text,p_operator_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE package_row public.prospect_enrichment_packages%ROWTYPE; outcome_value text;
BEGIN
  PERFORM set_config('app.prospect_enrichment_mutation','reject',true);
  SELECT * INTO package_row FROM public.prospect_enrichment_packages WHERE id=p_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'package_not_found'; END IF;
  IF package_row.payload_sha256 IS DISTINCT FROM p_payload_sha256 THEN RAISE EXCEPTION 'payload_mismatch'; END IF;
  IF p_operator_id IS NULL OR char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'invalid_review'; END IF;
  IF package_row.state='applied' OR package_row.state='superseded' THEN RAISE EXCEPTION 'package_terminal'; END IF;
  outcome_value := CASE WHEN package_row.state='rejected' THEN 'already_rejected' ELSE 'rejected' END;
  IF outcome_value='rejected' THEN
    UPDATE public.prospect_enrichment_packages SET state='rejected' WHERE id=p_package_id;
    INSERT INTO public.prospect_enrichment_events(package_id,event_key,event_type,actor,details)
    VALUES (p_package_id,'rejected:' || p_payload_sha256,'rejected',p_operator_id::text,
      jsonb_build_object('payloadSha256',p_payload_sha256,'reason',btrim(p_reason)))
    ON CONFLICT (package_id,event_key) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('outcome',outcome_value,'packageId',p_package_id,'payloadSha256',p_payload_sha256,'state','rejected');
END;
$$;

CREATE OR REPLACE FUNCTION public.prospect_enrichment_pending_target_add_v1(
  p_target_map jsonb,p_item_id uuid,p_target_table text,p_target_id uuid,p_application_kind text
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_set(
    coalesce(p_target_map,'{}'::jsonb), ARRAY[p_item_id::text],
    CASE WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(p_target_map->p_item_id::text,'[]'::jsonb)) AS prior(value)
      WHERE prior.value->>'targetTable'=p_target_table AND prior.value->>'targetId'=p_target_id::text
    ) THEN coalesce(p_target_map->p_item_id::text,'[]'::jsonb)
    ELSE coalesce(p_target_map->p_item_id::text,'[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'targetTable',p_target_table,'targetId',p_target_id,'applicationKind',p_application_kind
    )) END, true
  );
$$;

CREATE OR REPLACE FUNCTION public.apply_prospect_enrichment_package_v1(
  p_package_id uuid,p_review_sha256 text,p_expected_revision_sha256 text,p_operator_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  package_row public.prospect_enrichment_packages%ROWTYPE;
  firm_row public.gta_prospect_firms%ROWTYPE;
  item_row public.prospect_enrichment_items%ROWTYPE;
  source_row public.prospect_enrichment_items%ROWTYPE;
  source_capture public.prospect_source_captures%ROWTYPE;
  supplemental_batch jsonb;
  core_batch jsonb;
  core_batch_id uuid;
  supplemental_batch_id uuid;
  core_apply jsonb;
  supplemental_apply jsonb;
  core_record jsonb;
  current_core_record jsonb;
  supplemental_record jsonb;
  core_input jsonb;
  roster_item public.prospect_enrichment_items%ROWTYPE;
  roster_source public.prospect_enrichment_items%ROWTYPE;
  choice jsonb;
  choice_row public.prospect_enrichment_profile_choices%ROWTYPE;
  previous_choice_id uuid;
  profile_choice_receipt jsonb := '[]'::jsonb;
  profile_provenance jsonb;
  selected_value jsonb;
  field_key_value text;
  source_selector_value text;
  capture_map jsonb := '{}'::jsonb;
  target_map jsonb := '{}'::jsonb;
  receipt_items jsonb := '[]'::jsonb;
  targets_for_item jsonb;
  target_receipt jsonb;
  target_value jsonb;
  target_sha text;
  target_table_name text;
  target_id_value uuid;
  target_kind text;
  receipt jsonb;
  expected_revision text;
  resulting_revision text;
  firm_id_value uuid;
  source_record_key text;
  observation_date date;
  observation_time timestamptz;
  source_id text;
  source_ids jsonb;
  evidence_ids jsonb;
  evidence_urls jsonb;
  item_data jsonb;
  item_id_value uuid;
  item_disposition text;
  application_value text;
  existing_hash text;
  existing_table text;
  existing_id uuid;
  current_revision bigint;
  now_value timestamptz := now();
  domain_lock text;
  name_lock text;
  core_owner_id uuid;
  audit_id uuid;
  roster_target_id uuid;
  inserted_id uuid;
  inserted_row jsonb;
  source_capture_id uuid;
  id_list uuid[];
  event_key_value text;
  source_record_mapping public.prospect_source_record_map%ROWTYPE;
BEGIN
  PERFORM set_config('app.prospect_enrichment_mutation','apply',true);
  SELECT * INTO package_row FROM public.prospect_enrichment_packages WHERE id=p_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'package_not_found'; END IF;
  IF package_row.state='applied' THEN
    IF package_row.review_sha256 IS DISTINCT FROM p_review_sha256
       OR package_row.expected_revision_sha256 IS DISTINCT FROM p_expected_revision_sha256
       OR package_row.apply_receipt IS NULL THEN RAISE EXCEPTION 'review_changed'; END IF;
    RETURN package_row.apply_receipt || jsonb_build_object('outcome','already_applied');
  END IF;
  IF package_row.state <> 'ready_for_review' OR package_row.review_json IS NULL
     OR package_row.review_sha256 IS DISTINCT FROM p_review_sha256
     OR package_row.expected_revision_sha256 IS DISTINCT FROM p_expected_revision_sha256
     OR package_row.review_expires_at IS NULL OR package_row.review_expires_at <= now()
     OR p_operator_id IS NULL THEN RAISE EXCEPTION 'review_changed'; END IF;

  IF package_row.review_json->'identity'->>'choice'='existing' THEN
    firm_id_value := (package_row.review_json->'identity'->>'firmId')::uuid;
    SELECT * INTO firm_row FROM public.gta_prospect_firms WHERE id=firm_id_value FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'identity_conflict'; END IF;
    expected_revision := public.prospect_enrichment_firm_revision_sha256_v1(firm_row.id,firm_row.enrichment_revision);
  ELSIF package_row.review_json->'identity'->>'choice'='new' THEN
    core_input := package_row.review_json #> '{identity,coreInput}';
    name_lock := lower(regexp_replace(btrim(core_input->>'firmName'), '\s+', ' ', 'g'));
    domain_lock := lower(regexp_replace(split_part(split_part(regexp_replace(coalesce(core_input->>'websiteUrl',''),'^https?://','','i'),'/','1'),':','1'), '^www\.', ''));
    FOR source_id IN SELECT lock_value FROM (VALUES ('name:' || name_lock),('domain:' || coalesce(domain_lock,''))) AS keys(lock_value) ORDER BY lock_value LOOP
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('prospect-enrichment-identity:' || source_id,620260923));
    END LOOP;
    expected_revision := public.prospect_enrichment_new_firm_precondition_sha256_v1(p_package_id,package_row.payload_sha256);
  ELSE
    RAISE EXCEPTION 'invalid_identity';
  END IF;
  firm_id_value := public.prospect_enrichment_validate_review_v1(p_package_id,package_row.review_json);
  IF firm_id_value IS NOT NULL THEN
    SELECT * INTO firm_row FROM public.gta_prospect_firms WHERE id=firm_id_value FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'identity_conflict'; END IF;
    expected_revision := public.prospect_enrichment_firm_revision_sha256_v1(firm_row.id,firm_row.enrichment_revision);
  END IF;
  IF expected_revision IS DISTINCT FROM p_expected_revision_sha256 THEN RAISE EXCEPTION 'review_changed'; END IF;

  -- Lock linked existing rows in a stable table/id order before any canonical
  -- writes. Their reviewed hashes cannot drift between validation and receipt.
  FOR existing_table, existing_id IN
    SELECT stored.data #>> '{existingRecord,table}', (stored.data #>> '{existingRecord,id}')::uuid
    FROM public.prospect_enrichment_items stored
    JOIN jsonb_array_elements(package_row.review_json->'items') requested(value)
      ON requested.value->>'itemId'=stored.id::text
    WHERE stored.package_id=p_package_id AND requested.value->>'disposition'='link_existing'
    ORDER BY 1,2
  LOOP
    existing_hash := public.prospect_enrichment_lock_existing_target_v1(existing_table,existing_id);
    IF existing_hash IS NULL OR existing_hash IS DISTINCT FROM (
      SELECT stored.data #>> '{existingRecord,rowSha256}'
      FROM public.prospect_enrichment_items stored
      WHERE stored.package_id=p_package_id AND stored.data #>> '{existingRecord,table}'=existing_table
        AND stored.data #>> '{existingRecord,id}'=existing_id::text
      ORDER BY stored.client_item_id LIMIT 1
    ) THEN RAISE EXCEPTION 'invalid_item'; END IF;
  END LOOP;

  -- Source-bound bootstrap and an explicit selected roster update use the
  -- existing core importer so prior reconciliation status remains in audit.
  SELECT stored.* INTO roster_item
  FROM public.prospect_enrichment_items stored
  JOIN jsonb_array_elements(package_row.review_json->'items') choice(value)
    ON choice.value->>'itemId'=stored.id::text
  WHERE stored.package_id=p_package_id AND stored.item_kind='roster'
    AND choice.value->>'disposition' IN ('accept_new','link_existing')
  ORDER BY stored.client_item_id LIMIT 1;
  IF package_row.review_json->'identity'->>'choice'='new' OR roster_item.id IS NOT NULL THEN
    IF package_row.review_json->'identity'->>'choice'='new' THEN
      core_input := package_row.review_json #> '{identity,coreInput}';
      source_record_key := core_input->>'id';
      core_record := jsonb_build_object(
        'sourceRecordKey',source_record_key,'firmName',core_input->>'firmName',
        'normalizedFirmName',lower(regexp_replace(btrim(core_input->>'firmName'),'\s+',' ','g')),
        'city',core_input->>'city','practiceAreas',core_input->'practiceAreas',
        'legacyCrosswalk',NULL,'legacyClusterLawyerCount',NULL,
        'websiteUrl',core_input->'websiteUrl','officeCities',core_input->'officeCities',
        'roster',jsonb_build_object('sourceUrl',core_input->>'rosterSourceUrl','observedOn',core_input->>'rosterCheckedAt',
          'lawyerCount',core_input->'observedLawyerCount','qualifier',core_input->>'observedLawyerCountQualifier',
          'display',core_input->'observedLawyerCountDisplay'),
        'reconciliation',jsonb_build_object('status','provisional_new','basis',core_input->>'reconciliationNote'),
        'evidence',jsonb_build_array(jsonb_build_object('type','roster','sourceUrl',core_input->>'rosterSourceUrl',
          'observedOn',core_input->>'rosterCheckedAt','value',core_input->'observedLawyerCountDisplay')) ||
          CASE WHEN core_input->'websiteUrl' <> 'null'::jsonb THEN jsonb_build_array(jsonb_build_object(
            'type','website','sourceUrl',core_input->>'websiteUrl','observedOn',core_input->>'rosterCheckedAt','value',core_input->>'websiteUrl')) ELSE '[]'::jsonb END,
        'publicContacts','[]'::jsonb
      );
      core_owner_id := (core_input #>> '{coreEvidence,roster,itemId}')::uuid;
    ELSE
      SELECT firm.source_record_key,firm.id INTO source_record_key,firm_id_value
      FROM public.gta_prospect_firms firm WHERE firm.id=firm_id_value FOR UPDATE;
      SELECT audit.canonical_record INTO current_core_record
      FROM public.gta_prospect_import_audit audit
      JOIN public.gta_prospect_import_batches batch ON batch.id=audit.import_batch_id AND batch.state='applied'
      WHERE audit.firm_id=firm_id_value AND audit.validation_state='accepted'
      ORDER BY batch.applied_at DESC,audit.created_at DESC LIMIT 1;
      IF current_core_record IS NULL THEN RAISE EXCEPTION 'invalid_identity'; END IF;
      SELECT * INTO roster_source FROM public.prospect_enrichment_items source_item
      WHERE source_item.package_id=p_package_id AND source_item.client_item_id='src:' || (roster_item.data->'sourceIds'->>0)
        AND source_item.item_kind='source';
      IF NOT FOUND OR roster_source.data->>'policyState'<>'public-source' THEN RAISE EXCEPTION 'invalid_item'; END IF;
      observation_date := coalesce(roster_item.observed_on,(roster_item.observed_at AT TIME ZONE 'UTC')::date);
      IF observation_date IS NULL THEN RAISE EXCEPTION 'invalid_item'; END IF;
      core_record := current_core_record || jsonb_build_object(
        'sourceRecordKey',source_record_key,
        'roster',jsonb_build_object('sourceUrl',roster_source.data->>'url','observedOn',to_char(observation_date,'YYYY-MM-DD'),
          'lawyerCount',roster_item.data #> '{data,lawyerCount}','qualifier',roster_item.data #>> '{data,countQualifier}',
          'display',roster_item.data #> '{data,display}'),
        'websiteUrl',NULL,
        'reconciliation',jsonb_build_object('status','update_existing','basis',
          'Prior status: ' || coalesce(firm_row.reconciliation_status,'unknown') || '. Reviewed source-linked roster item ' || roster_item.client_item_id || ' in package ' || package_row.client_package_id || '.'),
        'evidence',jsonb_build_array(jsonb_build_object('type','roster','sourceUrl',roster_source.data->>'url',
          'observedOn',to_char(observation_date,'YYYY-MM-DD'),'value',roster_item.data #> '{data,display}')),
        'publicContacts','[]'::jsonb
      );
      core_owner_id := roster_item.id;
    END IF;
    core_batch := public.begin_gta_prospect_operator_import_batch(
      'pe-' || replace(p_package_id::text,'-',''),package_row.payload_sha256,1);
    IF core_batch->>'state' <> 'ready' THEN RAISE EXCEPTION 'package_terminal'; END IF;
    core_batch_id := (core_batch->>'batch_id')::uuid;
    core_apply := public.apply_gta_prospect_research_record_with_contacts(
      core_batch_id,core_record,public.gta_prospect_research_record_with_contacts_sha256(core_record));
    IF package_row.review_json->'identity'->>'choice'='new' AND core_apply->>'state'<>'created' THEN RAISE EXCEPTION 'identity_conflict'; END IF;
    IF package_row.review_json->'identity'->>'choice'='existing' AND core_apply->>'state'<>'updated' THEN RAISE EXCEPTION 'review_changed'; END IF;
    firm_id_value := (core_apply->>'firm_id')::uuid;
    PERFORM public.complete_gta_prospect_import_batch(core_batch_id);
    SELECT * INTO firm_row FROM public.gta_prospect_firms WHERE id=firm_id_value FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'application_failed'; END IF;
    target_map := public.prospect_enrichment_pending_target_add_v1(target_map,core_owner_id,'gta_prospect_firms',firm_id_value,
      CASE WHEN core_apply->>'state'='created' THEN 'inserted' ELSE 'existing' END);
    SELECT audit.id INTO audit_id FROM public.gta_prospect_import_audit audit
    WHERE audit.import_batch_id=core_batch_id AND audit.source_record_key=source_record_key;
    IF audit_id IS NULL THEN RAISE EXCEPTION 'application_failed'; END IF;
    target_map := public.prospect_enrichment_pending_target_add_v1(target_map,core_owner_id,'gta_prospect_import_audit',audit_id,'inserted');
    SELECT roster.id INTO roster_target_id FROM public.gta_prospect_roster_observations roster
    WHERE roster.import_batch_id=core_batch_id AND roster.firm_id=firm_id_value
    ORDER BY roster.created_at DESC,roster.id DESC LIMIT 1;
    IF roster_target_id IS NULL THEN RAISE EXCEPTION 'application_failed'; END IF;
    target_map := public.prospect_enrichment_pending_target_add_v1(target_map,core_owner_id,'gta_prospect_roster_observations',roster_target_id,'inserted');
  END IF;

  IF firm_id_value IS NULL THEN RAISE EXCEPTION 'invalid_identity'; END IF;

  -- Materialize website intake and assessment through the established
  -- supplemental import writer, preserving its audit and applied-batch rules.
  supplemental_record := jsonb_build_object('sourceRecordKey',firm_row.source_record_key,
    'identityMappings','[]'::jsonb,'downtownGeography','[]'::jsonb,
    'websiteIntakeFindings','[]'::jsonb,'qualificationAssessments','[]'::jsonb);
  FOR item_row IN SELECT * FROM public.prospect_enrichment_items WHERE package_id=p_package_id ORDER BY client_item_id LOOP
    choice := (SELECT value FROM jsonb_array_elements(package_row.review_json->'items') AS requested(value)
               WHERE requested.value->>'itemId'=item_row.id::text LIMIT 1);
    IF choice->>'disposition' NOT IN ('accept_new','link_existing') THEN CONTINUE; END IF;
    item_data := item_row.data->'data';
    observation_date := coalesce(item_row.observed_on,(item_row.observed_at AT TIME ZONE 'UTC')::date);
    IF item_row.item_kind='website_intake' AND choice->>'disposition'='accept_new' THEN
      IF observation_date IS NULL THEN RAISE EXCEPTION 'invalid_item'; END IF;
      evidence_urls := coalesce((SELECT jsonb_agg(source_item.data->>'url' ORDER BY source_item.client_item_id)
        FROM jsonb_array_elements_text(item_row.data->'sourceIds') AS ids(source_id)
        JOIN public.prospect_enrichment_items source_item ON source_item.package_id=p_package_id
          AND source_item.client_item_id='src:' || ids.source_id AND source_item.item_kind='source'),'[]'::jsonb);
      supplemental_record := jsonb_set(supplemental_record,'{websiteIntakeFindings}',
        supplemental_record->'websiteIntakeFindings' || jsonb_build_array(jsonb_build_object(
          'findingId',replace(item_row.client_item_id,'obs:',''),'sourceUrl',item_data->>'pageUrl',
          'observedAt',to_char(observation_date,'YYYY-MM-DD'),'intakeChannels',item_data->'visibleChannels',
          'opportunityState',item_data->>'opportunityState','opportunityNote',item_data->>'summary',
          'evidenceUrls',evidence_urls,'rawObservation',item_row.data
        )));
    ELSIF item_row.item_kind='assessment' AND choice->>'disposition'='accept_new' THEN
      IF observation_date IS NULL THEN RAISE EXCEPTION 'invalid_item'; END IF;
      evidence_urls := coalesce((SELECT jsonb_agg(source_item.data->>'url' ORDER BY source_item.client_item_id)
        FROM jsonb_array_elements_text(item_row.data->'sourceIds') AS ids(source_id)
        JOIN public.prospect_enrichment_items source_item ON source_item.package_id=p_package_id
          AND source_item.client_item_id='src:' || ids.source_id AND source_item.item_kind='source'),'[]'::jsonb);
      supplemental_record := jsonb_set(supplemental_record,'{qualificationAssessments}',
        supplemental_record->'qualificationAssessments' || jsonb_build_array(jsonb_build_object(
          'assessmentId',replace(item_row.client_item_id,'assessment:',''),
          'qualificationState',CASE WHEN item_data->>'selectionDisposition'='disqualified' OR item_data->>'fitDecision'='fail' THEN 'disqualified' ELSE 'needs_evidence' END,
          'qualificationCohort',item_data->>'cohortId','assessedAt',to_char(observation_date,'YYYY-MM-DD'),
          'criteria',jsonb_build_object('sourceAssessment',item_data),
          'evidenceUrls',evidence_urls,'note',item_data->>'rationale','rawAssessment',item_row.data
        )));
    END IF;
  END LOOP;
  IF jsonb_array_length(supplemental_record->'websiteIntakeFindings') + jsonb_array_length(supplemental_record->'qualificationAssessments') > 0 THEN
    supplemental_batch := public.begin_gta_prospect_supplemental_evidence_import(
      'pe-' || replace(p_package_id::text,'-',''),package_row.payload_sha256,1);
    IF supplemental_batch->>'state'<>'ready' THEN RAISE EXCEPTION 'package_terminal'; END IF;
    supplemental_batch_id := (supplemental_batch->>'batch_id')::uuid;
    supplemental_apply := public.apply_gta_prospect_supplemental_evidence_record(
      supplemental_batch_id,supplemental_record,public.gta_prospect_supplemental_evidence_record_sha256(supplemental_record));
    IF supplemental_apply->>'state'<>'applied' THEN RAISE EXCEPTION 'application_failed'; END IF;
    PERFORM public.complete_gta_prospect_supplemental_evidence_import(supplemental_batch_id);
  END IF;

  -- Each accepted item's source captures are created from that package's
  -- cited public sources and become explicit targets owned by the item.
  FOR item_row IN SELECT * FROM public.prospect_enrichment_items WHERE package_id=p_package_id ORDER BY client_item_id LOOP
    choice := (SELECT value FROM jsonb_array_elements(package_row.review_json->'items') AS requested(value)
               WHERE requested.value->>'itemId'=item_row.id::text LIMIT 1);
    item_disposition := choice->>'disposition';
    IF item_disposition='retain_only' OR item_row.item_kind='source' THEN CONTINUE; END IF;
    item_data := item_row.data->'data';
    FOR source_id IN SELECT jsonb_array_elements_text(item_row.data->'sourceIds') LOOP
      IF capture_map ? source_id THEN
        source_capture_id := (capture_map->>source_id)::uuid;
      ELSE
        SELECT * INTO source_row FROM public.prospect_enrichment_items source_item
        WHERE source_item.package_id=p_package_id AND source_item.client_item_id='src:' || source_id AND source_item.item_kind='source';
        IF NOT FOUND THEN RAISE EXCEPTION 'invalid_item'; END IF;
        observation_time := nullif(source_row.data->>'observedAt','')::timestamptz;
        observation_date := CASE WHEN observation_time IS NULL THEN nullif(source_row.data->>'observedOn','')::date ELSE NULL END;
        INSERT INTO public.prospect_source_captures(
          firm_id,requested_url,final_url,publisher,retrieval_method,http_status,observed_at,source_observed_on,
          source_observed_precision,sha256,retained_artifact,policy_state
        ) VALUES (
          firm_id_value,source_row.data->>'requestedUrl',source_row.data->>'finalUrl',source_row.data->>'publisher',
          coalesce(source_row.data->>'retrievalMethod','public-source'),nullif(source_row.data->>'httpStatus','')::integer,
          observation_time,observation_date,
          CASE WHEN observation_time IS NOT NULL THEN 'exact_time' WHEN observation_date IS NOT NULL THEN 'date_only' ELSE 'unknown' END,
          source_row.data->>'bodySha256',NULL,source_row.data->>'policyState'
        ) RETURNING * INTO source_capture;
        source_capture_id := source_capture.id;
        capture_map := jsonb_set(capture_map,ARRAY[source_id],to_jsonb(source_capture_id::text),true);
      END IF;
      target_map := public.prospect_enrichment_pending_target_add_v1(target_map,item_row.id,'prospect_source_captures',source_capture_id,'inserted');
    END LOOP;

    IF item_disposition='link_existing' THEN
      existing_table := item_row.data #>> '{existingRecord,table}';
      existing_id := (item_row.data #>> '{existingRecord,id}')::uuid;
      existing_hash := public.prospect_enrichment_lock_existing_target_v1(existing_table,existing_id);
      IF existing_hash IS NULL OR existing_hash IS DISTINCT FROM item_row.data #>> '{existingRecord,rowSha256}' THEN RAISE EXCEPTION 'invalid_item'; END IF;
      target_map := public.prospect_enrichment_pending_target_add_v1(target_map,item_row.id,existing_table,existing_id,'existing');
      CONTINUE;
    END IF;

    evidence_ids := coalesce((SELECT jsonb_agg((capture_map->>ids.source_id)::uuid ORDER BY ids.ordinality)
      FROM jsonb_array_elements_text(item_row.data->'sourceIds') WITH ORDINALITY AS ids(source_id,ordinality)),'[]'::jsonb);
    observation_time := item_row.observed_at;
    observation_date := item_row.observed_on;
    target_table_name := NULL;
    inserted_id := NULL;
    inserted_row := NULL;
    IF item_row.item_kind='firm_fit' THEN
      target_table_name := 'prospect_firm_fit_observations';
      INSERT INTO public.prospect_firm_fit_observations(
        firm_id,target_practice_areas,office_geography,lawyer_count,size_band,independence_status,fit_status,
        source_url,observed_at,source_observed_on,source_observed_precision,evidence_ids
      ) VALUES (
        firm_id_value,coalesce(item_data->'practiceAreas','[]'::jsonb),
        CASE WHEN item_data->'office'='null'::jsonb THEN '[]'::jsonb ELSE jsonb_build_array(item_data->'office') END,
        nullif(item_data->>'lawyerCount','')::integer,
        CASE WHEN (item_data->>'lawyerCount') IS NULL THEN 'unknown'
          WHEN (item_data->>'lawyerCount')::integer=1 THEN 'solo'
          WHEN (item_data->>'lawyerCount')::integer BETWEEN 2 AND 5 THEN '2-5'
          WHEN (item_data->>'lawyerCount')::integer BETWEEN 6 AND 15 THEN '6-15'
          WHEN (item_data->>'lawyerCount')::integer BETWEEN 16 AND 50 THEN '16-50' ELSE '51-plus' END,
        item_data->>'independence',item_data->>'fit',
        (SELECT data->>'url' FROM public.prospect_enrichment_items WHERE package_id=p_package_id AND client_item_id='src:' || (item_row.data->'sourceIds'->>0)),
        observation_time,observation_date,
        CASE WHEN observation_time IS NOT NULL THEN 'exact_time' WHEN observation_date IS NOT NULL THEN 'date_only' ELSE 'unknown' END,evidence_ids
      ) RETURNING to_jsonb(prospect_firm_fit_observations.*),id INTO inserted_row,inserted_id;
    ELSIF item_row.item_kind='service' THEN
      target_table_name := 'prospect_service_observations';
      INSERT INTO public.prospect_service_observations(
        firm_id,service_name,matter_fit,source_url,observed_at,source_observed_on,source_observed_precision,evidence_ids
      ) VALUES (
        firm_id_value,item_data->>'name',item_data->>'matterFit',
        (SELECT data->>'url' FROM public.prospect_enrichment_items WHERE package_id=p_package_id AND client_item_id='src:' || (item_row.data->'sourceIds'->>0)),
        observation_time,observation_date,
        CASE WHEN observation_time IS NOT NULL THEN 'exact_time' WHEN observation_date IS NOT NULL THEN 'date_only' ELSE 'unknown' END,evidence_ids
      ) RETURNING to_jsonb(prospect_service_observations.*),id INTO inserted_row,inserted_id;
    ELSIF item_row.item_kind='contact' THEN
      target_table_name := 'prospect_decision_maker_contacts';
      INSERT INTO public.prospect_decision_maker_contacts(
        firm_id,person_name,role_label,role_verification,contact_type,contact_value,contact_quality,source_url,
        observed_at,source_observed_on,source_observed_precision,deliverability_state
      ) VALUES (
        firm_id_value,item_data->>'personName',item_data->>'roleLabel',item_data->>'roleVerification',
        item_data->>'contactType',item_data->>'contactValue',item_data->>'contactQuality',
        (SELECT data->>'url' FROM public.prospect_enrichment_items WHERE package_id=p_package_id AND client_item_id='src:' || (item_row.data->'sourceIds'->>0)),
        observation_time,observation_date,
        CASE WHEN observation_time IS NOT NULL THEN 'exact_time' WHEN observation_date IS NOT NULL THEN 'date_only' ELSE 'unknown' END,
        item_data->>'deliverability'
      ) RETURNING to_jsonb(prospect_decision_maker_contacts.*),id INTO inserted_row,inserted_id;
    ELSIF item_row.item_kind='advertising' THEN
      target_table_name := 'prospect_advertising_observations';
      INSERT INTO public.prospect_advertising_observations(
        firm_id,evidence_type,vendor,signal_type,signal_id,advertiser_identity,advertised_service,destination_url,
        observed_at,source_observed_on,source_observed_precision,effective_date,last_shown_date,recency_basis,source_url,
        capture_id,identity_state,reviewed,attributable
      ) VALUES (
        firm_id_value,item_data->>'evidenceType',item_data->>'vendor',item_data->>'signalType',item_data->>'signalId',
        item_data->>'advertiserIdentity',item_data->>'advertisedService',item_data->>'destinationUrl',
        observation_time,observation_date,
        CASE WHEN observation_time IS NOT NULL THEN 'exact_time' WHEN observation_date IS NOT NULL THEN 'date_only' ELSE 'unknown' END,
        nullif(item_data->>'effectiveDate','')::date,nullif(item_data->>'lastShownDate','')::date,item_data->>'recencyBasis',
        (SELECT data->>'url' FROM public.prospect_enrichment_items WHERE package_id=p_package_id AND client_item_id='src:' || (item_row.data->'sourceIds'->>0)),
        (capture_map->>(item_row.data->'sourceIds'->>0))::uuid,item_data->>'identityState',true,
        coalesce((item_data->>'attributable')::boolean,false)
      ) RETURNING to_jsonb(prospect_advertising_observations.*),id INTO inserted_row,inserted_id;
    ELSIF item_row.item_kind='opportunity' THEN
      target_table_name := 'prospect_opportunity_observations';
      INSERT INTO public.prospect_opportunity_observations(
        firm_id,opportunity_type,finding,recommendation_hypothesis,source_url,observed_at,source_observed_on,
        source_observed_precision,evidence_ids,confidence
      ) VALUES (
        firm_id_value,item_data->>'type',item_data->>'observation',item_data->>'recommendation',
        (SELECT data->>'url' FROM public.prospect_enrichment_items WHERE package_id=p_package_id AND client_item_id='src:' || (item_row.data->'sourceIds'->>0)),
        observation_time,observation_date,
        CASE WHEN observation_time IS NOT NULL THEN 'exact_time' WHEN observation_date IS NOT NULL THEN 'date_only' ELSE 'unknown' END,
        evidence_ids,item_data->>'confidence'
      ) RETURNING to_jsonb(prospect_opportunity_observations.*),id INTO inserted_row,inserted_id;
    ELSIF item_row.item_kind='website_intake' THEN
      target_table_name := 'gta_prospect_website_intake_observations';
      SELECT intake.id,to_jsonb(intake.*) INTO inserted_id,inserted_row
      FROM public.gta_prospect_website_intake_observations intake
      WHERE intake.evidence_import_batch_id=supplemental_batch_id
        AND intake.finding_id=replace(item_row.client_item_id,'obs:','');
    ELSIF item_row.item_kind='roster' THEN
      target_table_name := 'gta_prospect_roster_observations';
      SELECT roster.id,to_jsonb(roster.*) INTO inserted_id,inserted_row
      FROM public.gta_prospect_roster_observations roster
      WHERE roster.import_batch_id=core_batch_id AND roster.firm_id=firm_id_value
        AND roster.source_url=(SELECT data->>'url' FROM public.prospect_enrichment_items
          WHERE package_id=p_package_id AND client_item_id='src:' || (item_row.data->'sourceIds'->>0))
        AND roster.observed_on=observation_date
      ORDER BY roster.created_at DESC,roster.id DESC LIMIT 1;
      IF inserted_id IS NULL THEN
        INSERT INTO public.gta_prospect_roster_observations(
          firm_id,source_type,source_url,observed_on,observed_lawyer_count,count_qualifier,count_display,canonical_observation
        ) VALUES (
          firm_id_value,'reviewed_roster',
          (SELECT data->>'url' FROM public.prospect_enrichment_items WHERE package_id=p_package_id AND client_item_id='src:' || (item_row.data->'sourceIds'->>0)),
          coalesce(observation_date,(observation_time AT TIME ZONE 'UTC')::date),
          nullif(item_data->>'lawyerCount','')::integer,item_data->>'countQualifier',item_data->>'display',item_data
        ) RETURNING to_jsonb(gta_prospect_roster_observations.*),id INTO inserted_row,inserted_id;
      END IF;
    ELSIF item_row.item_kind='research_attempt' THEN
      target_table_name := 'prospect_research_attempts';
      INSERT INTO public.prospect_research_attempts(
        firm_id,provider,query_or_url,outcome,coverage,failure_reason,observed_at,source_observed_on,
        source_observed_precision,evidence_ids
      ) VALUES (
        firm_id_value,item_data->>'provider',item_data->>'queryOrUrl',item_data->>'outcome',item_data->>'coverage',
        item_data->>'failureReason',observation_time,observation_date,
        CASE WHEN observation_time IS NOT NULL THEN 'exact_time' WHEN observation_date IS NOT NULL THEN 'date_only' ELSE 'unknown' END,evidence_ids
      ) RETURNING to_jsonb(prospect_research_attempts.*),id INTO inserted_row,inserted_id;
    ELSIF item_row.item_kind='assessment' THEN
      target_table_name := 'prospect_qualification_decisions';
      INSERT INTO public.prospect_qualification_decisions(
        firm_id,run_id,rule_version,advertising_status,advertising_status_state,fit_decision,commercial_relevance,
        decision_maker_access,opportunity_decision,selection_disposition,evidence_ids,rationale,decided_at,
        source_observed_on,source_observed_precision,cohort_id
      ) VALUES (
        firm_id_value,package_row.payload->>'runId',item_data->>'ruleVersion',item_data->>'advertisingStatus',
        item_data->>'advertisingStatusState',item_data->>'fitDecision',item_data->>'commercialRelevance',
        item_data->>'decisionMakerAccess',item_data->>'opportunityDecision',item_data->>'selectionDisposition',
        evidence_ids,item_data->>'rationale',observation_time,observation_date,
        CASE WHEN observation_time IS NOT NULL THEN 'exact_time' WHEN observation_date IS NOT NULL THEN 'date_only' ELSE 'unknown' END,
        item_data->>'cohortId'
      ) RETURNING to_jsonb(prospect_qualification_decisions.*),id INTO inserted_row,inserted_id;
    ELSE
      RAISE EXCEPTION 'invalid_item';
    END IF;
    IF inserted_id IS NULL OR inserted_row IS NULL THEN RAISE EXCEPTION 'application_failed'; END IF;
    target_map := public.prospect_enrichment_pending_target_add_v1(target_map,item_row.id,target_table_name,inserted_id,'inserted');
    IF item_row.item_kind='assessment' AND supplemental_batch_id IS NOT NULL THEN
      SELECT assessment.id,to_jsonb(assessment.*) INTO inserted_id,inserted_row
      FROM public.gta_prospect_qualification_assessments assessment
      WHERE assessment.evidence_import_batch_id=supplemental_batch_id
        AND assessment.assessment_id=replace(item_row.client_item_id,'assessment:','');
      IF inserted_id IS NULL THEN RAISE EXCEPTION 'application_failed'; END IF;
      target_map := public.prospect_enrichment_pending_target_add_v1(target_map,item_row.id,
        'gta_prospect_qualification_assessments',inserted_id,'inserted');
      SELECT audit.id INTO audit_id FROM public.gta_prospect_supplemental_evidence_import_audit audit
      WHERE audit.evidence_import_batch_id=supplemental_batch_id AND audit.source_record_key=firm_row.source_record_key;
      IF audit_id IS NOT NULL THEN target_map := public.prospect_enrichment_pending_target_add_v1(target_map,item_row.id,
        'gta_prospect_supplemental_evidence_import_audit',audit_id,'inserted'); END IF;
    ELSIF item_row.item_kind='website_intake' AND supplemental_batch_id IS NOT NULL THEN
      SELECT audit.id INTO audit_id FROM public.gta_prospect_supplemental_evidence_import_audit audit
      WHERE audit.evidence_import_batch_id=supplemental_batch_id AND audit.source_record_key=firm_row.source_record_key;
      IF audit_id IS NOT NULL THEN target_map := public.prospect_enrichment_pending_target_add_v1(target_map,item_row.id,
        'gta_prospect_supplemental_evidence_import_audit',audit_id,'inserted'); END IF;
    END IF;
  END LOOP;

  -- Cross-system source key is recorded as reviewed research identity. It is
  -- never used to allocate a stable firm ID or infer a canonical domain.
  SELECT * INTO source_record_mapping FROM public.prospect_source_record_map
  WHERE source_system=package_row.payload->>'sourceSystem' AND source_record_id=package_row.research_key FOR UPDATE;
  IF FOUND AND source_record_mapping.firm_id IS DISTINCT FROM firm_id_value THEN RAISE EXCEPTION 'identity_conflict'; END IF;
  IF NOT FOUND THEN
    INSERT INTO public.prospect_source_record_map(source_system,source_record_id,firm_id,mapping_status,evidence_ids,reviewed_by,reviewed_at)
    VALUES (package_row.payload->>'sourceSystem',package_row.research_key,firm_id_value,'confirmed',
      coalesce((SELECT jsonb_agg(value::text) FROM jsonb_each_text(capture_map)),'[]'::jsonb),p_operator_id::text,now_value)
    RETURNING * INTO source_record_mapping;
  END IF;

  -- Persist only explicitly reviewed, allowlisted profile choices.
  FOR item_row IN SELECT * FROM public.prospect_enrichment_items WHERE package_id=p_package_id ORDER BY client_item_id LOOP
    choice := (SELECT value FROM jsonb_array_elements(package_row.review_json->'items') AS requested(value)
               WHERE requested.value->>'itemId'=item_row.id::text LIMIT 1);
    IF jsonb_typeof(choice->'profileChoice') <> 'object' THEN CONTINUE; END IF;
    item_data := item_row.data->'data';
    source_ids := item_row.data->'sourceIds';
    IF item_row.data->>'evidenceState' IS DISTINCT FROM 'asserted'
       OR item_row.data->'missingProvenanceReason' IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION 'invalid_profile_choice';
    END IF;
    field_key_value := choice->'profileChoice'->>'fieldKey';
    source_selector_value := choice->'profileChoice'->>'sourceSelector';
    selected_value := choice->'profileChoice'->'selectedValue';
    SELECT jsonb_build_object('schemaVersion','prospect-enrichment-profile-source/v1','packageId',p_package_id,
      'payloadSha256',package_row.payload_sha256,'itemId',item_row.id,'clientItemId',item_row.client_item_id,
      'sourceEventKey',event.source_event_key,'semanticSha256',item_row.normalized_sha256,'selector',source_selector_value,
      'sources',coalesce(jsonb_agg(jsonb_build_object('sourceId',refs.source_id,'clientItemId',source_item.client_item_id,
        'sourceEventKey',source_event.source_event_key,'semanticSha256',source_item.normalized_sha256,'url',source_item.data->>'url',
        'observedAt',source_item.data->>'observedAt','observedOn',source_item.data->>'observedOn','bodySha256',source_item.data->>'bodySha256')
        ORDER BY refs.source_id),'[]'::jsonb)) INTO profile_provenance
    FROM public.prospect_enrichment_source_events event
    JOIN jsonb_array_elements_text(source_ids) AS refs(source_id) ON true
    JOIN public.prospect_enrichment_items source_item ON source_item.package_id=p_package_id AND source_item.client_item_id='src:' || refs.source_id
    JOIN public.prospect_enrichment_source_events source_event ON source_event.id=source_item.source_event_id
    WHERE event.id=item_row.source_event_id;
    IF profile_provenance IS NULL OR jsonb_array_length(profile_provenance->'sources') <> jsonb_array_length(source_ids) THEN
      RAISE EXCEPTION 'invalid_profile_choice';
    END IF;
    IF item_row.item_kind='website_intake' AND (
         jsonb_typeof(item_data->'pageUrl') <> 'string'
         OR NOT EXISTS (SELECT 1 FROM public.prospect_enrichment_items cited_source
           WHERE cited_source.package_id=p_package_id AND cited_source.item_kind='source'
             AND cited_source.client_item_id='src:' || (source_ids->>0)
             AND cited_source.data->>'policyState'='public-source'
             AND cited_source.data->>'url'=item_data->>'pageUrl'))
       OR item_row.item_kind='firm_fit' AND jsonb_typeof(item_data->'office') <> 'object'
       OR item_row.item_kind='contact' AND (
         item_data->'contactValue' IS NULL OR item_data->'contactValue'='null'::jsonb
         OR item_data->>'contactType'='not-observed' OR item_data->>'contactQuality'='not-observed') THEN
      RAISE EXCEPTION 'invalid_profile_choice';
    END IF;
    SELECT existing_choice.id INTO previous_choice_id
    FROM public.prospect_enrichment_profile_choices existing_choice
    WHERE existing_choice.firm_id=firm_id_value AND existing_choice.field_key=field_key_value
      AND NOT EXISTS (SELECT 1 FROM public.prospect_enrichment_profile_choices successor
                      WHERE successor.supersedes_choice_id=existing_choice.id)
    ORDER BY existing_choice.chosen_at DESC,existing_choice.id DESC LIMIT 1 FOR UPDATE;
    INSERT INTO public.prospect_enrichment_profile_choices(
      firm_id,field_key,target_table,target_id,source_selector,selected_value,selected_provenance,
      package_id,reviewed_by,supersedes_choice_id,rationale
    ) VALUES (
      firm_id_value,field_key_value,'prospect_enrichment_items',item_row.id,source_selector_value,selected_value,
      profile_provenance,p_package_id,p_operator_id,previous_choice_id,
      coalesce(nullif(btrim(choice->>'reason'),''),'Explicitly selected in the reviewed prospect-enrichment package.')
    ) RETURNING * INTO choice_row;
    profile_choice_receipt := profile_choice_receipt || jsonb_build_array(jsonb_build_object(
      'choiceId',choice_row.id,'fieldKey',choice_row.field_key,'targetTable',choice_row.target_table,
      'targetId',choice_row.target_id,'sourceSelector',choice_row.source_selector,'selectedValue',choice_row.selected_value,
      'selectedProvenance',choice_row.selected_provenance,'sourceItemId',item_row.id
    ));
    profile_provenance := NULL;
  END LOOP;

  -- Final hashes are read after every canonical insert, batch transition and
  -- profile-choice revision bump. Those exact rows are then linked immutably.
  FOR item_row IN SELECT * FROM public.prospect_enrichment_items WHERE package_id=p_package_id ORDER BY client_item_id LOOP
    choice := (SELECT value FROM jsonb_array_elements(package_row.review_json->'items') AS requested(value)
               WHERE requested.value->>'itemId'=item_row.id::text LIMIT 1);
    item_disposition := choice->>'disposition';
    targets_for_item := coalesce(target_map->item_row.id::text,'[]'::jsonb);
    target_receipt := '[]'::jsonb;
    FOR target_value IN SELECT value FROM jsonb_array_elements(targets_for_item) LOOP
      target_table_name := target_value->>'targetTable';
      target_id_value := (target_value->>'targetId')::uuid;
      target_kind := target_value->>'applicationKind';
      target_sha := public.prospect_enrichment_lock_existing_target_v1(target_table_name,target_id_value);
      IF target_sha IS NULL THEN RAISE EXCEPTION 'application_failed'; END IF;
      INSERT INTO public.prospect_enrichment_item_targets(item_id,target_table,target_id,target_row_sha256,application_kind)
      VALUES (item_row.id,target_table_name,target_id_value,target_sha,target_kind);
      target_receipt := target_receipt || jsonb_build_array(jsonb_build_object(
        'targetTable',target_table_name,'targetId',target_id_value,'targetRowSha256',target_sha,'applicationKind',target_kind));
    END LOOP;
    IF item_disposition IN ('accept_new','link_existing') AND jsonb_array_length(target_receipt)=0 THEN RAISE EXCEPTION 'application_failed'; END IF;
    receipt_items := receipt_items || jsonb_build_array(jsonb_build_object(
      'itemId',item_row.id,'clientItemId',item_row.client_item_id,'disposition',item_disposition,'targets',target_receipt));
  END LOOP;

  SELECT enrichment_revision INTO current_revision FROM public.gta_prospect_firms WHERE id=firm_id_value FOR UPDATE;
  resulting_revision := public.prospect_enrichment_firm_revision_sha256_v1(firm_id_value,current_revision);
  receipt := jsonb_build_object(
    'schemaVersion','prospect-enrichment-apply-receipt/v1','packageId',p_package_id,
    'clientPackageId',package_row.client_package_id,'payloadSha256',package_row.payload_sha256,
    'reviewSha256',package_row.review_sha256,'appliedBy',p_operator_id,'appliedAt',now_value,
    'firmId',firm_id_value,'stableFirmId',NULL,'sourceRecordKey',firm_row.source_record_key,
    'expectedRevisionSha256',expected_revision,'resultingRevisionSha256',resulting_revision,
    'items',receipt_items,'profileChoices',profile_choice_receipt
  );
  UPDATE public.prospect_enrichment_packages SET state='applied',firm_id=firm_id_value,
    apply_receipt=receipt,applied_at=now_value WHERE id=p_package_id;
  INSERT INTO public.prospect_enrichment_events(package_id,event_key,event_type,actor,details)
  VALUES (p_package_id,'applied:' || package_row.review_sha256,'applied',p_operator_id::text,
    jsonb_build_object('payloadSha256',package_row.payload_sha256,'reviewSha256',package_row.review_sha256,
      'expectedRevisionSha256',expected_revision,'resultingRevisionSha256',resulting_revision,
      'applyReceiptSha256',public.prospect_enrichment_row_sha256_v1(receipt)))
  ON CONFLICT (package_id,event_key) DO NOTHING;
  RETURN receipt || jsonb_build_object('outcome','applied');
END;
$$;

-- Record only hashes and counts after the authenticated application read path
-- has independently compared the stored package or canonical destinations.
CREATE OR REPLACE FUNCTION public.record_prospect_enrichment_verification_v1(
  p_package_id uuid,p_payload_sha256 text,p_visibility_scope text,p_details jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  package_row public.prospect_enrichment_packages%ROWTYPE;
  firm_row public.gta_prospect_firms%ROWTYPE;
  item_count_value bigint;
  source_count_value bigint;
  target_count_value bigint;
  receipt_sha text;
  expected_event_type text;
  event_key_value text;
  target_row record;
  actual_target_sha text;
  existing_event public.prospect_enrichment_events%ROWTYPE;
BEGIN
  IF p_visibility_scope NOT IN ('package','canonical')
     OR jsonb_typeof(p_details) <> 'object'
     OR p_details - ARRAY['visibilityScope','payloadSha256','readbackSha256','expectedReceiptSha256',
       'sourceCount','itemCount','targetCount','verificationVersion']::text[] <> '{}'::jsonb
     OR NOT (p_details ?& ARRAY['visibilityScope','payloadSha256','readbackSha256','expectedReceiptSha256',
       'sourceCount','itemCount','targetCount','verificationVersion'])
     OR p_details->>'visibilityScope' IS DISTINCT FROM p_visibility_scope
     OR p_details->>'payloadSha256' IS DISTINCT FROM p_payload_sha256
     OR p_payload_sha256 !~ '^[a-f0-9]{64}$'
     OR coalesce(p_details->>'readbackSha256','') !~ '^[a-f0-9]{64}$'
     OR p_details->>'verificationVersion' IS DISTINCT FROM 'prospect-enrichment-readback/v1'
     OR jsonb_typeof(p_details->'sourceCount') <> 'number'
     OR jsonb_typeof(p_details->'itemCount') <> 'number'
     OR jsonb_typeof(p_details->'targetCount') <> 'number'
     OR (p_details->>'sourceCount')::numeric < 0 OR (p_details->>'sourceCount')::numeric <> trunc((p_details->>'sourceCount')::numeric)
     OR (p_details->>'itemCount')::numeric < 0 OR (p_details->>'itemCount')::numeric <> trunc((p_details->>'itemCount')::numeric)
     OR (p_details->>'targetCount')::numeric < 0 OR (p_details->>'targetCount')::numeric <> trunc((p_details->>'targetCount')::numeric)
     OR (p_visibility_scope='package' AND p_details->'expectedReceiptSha256' IS DISTINCT FROM 'null'::jsonb)
     OR (p_visibility_scope='canonical' AND coalesce(p_details->>'expectedReceiptSha256','') !~ '^[a-f0-9]{64}$') THEN
    RAISE EXCEPTION 'invalid_review';
  END IF;

  SELECT * INTO package_row FROM public.prospect_enrichment_packages WHERE id=p_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'package_not_found'; END IF;
  IF package_row.payload_sha256 IS DISTINCT FROM p_payload_sha256 THEN RAISE EXCEPTION 'payload_mismatch'; END IF;
  SELECT count(*),count(*) FILTER (WHERE item.item_kind='source')
    INTO item_count_value,source_count_value
    FROM public.prospect_enrichment_items item WHERE item.package_id=p_package_id;
  SELECT count(*) INTO target_count_value
    FROM public.prospect_enrichment_item_targets target
    JOIN public.prospect_enrichment_items item ON item.id=target.item_id
    WHERE item.package_id=p_package_id;
  IF (p_details->>'itemCount')::bigint IS DISTINCT FROM item_count_value
     OR (p_details->>'sourceCount')::bigint IS DISTINCT FROM source_count_value
     OR (p_details->>'targetCount')::bigint IS DISTINCT FROM target_count_value THEN
    RAISE EXCEPTION 'readback_changed';
  END IF;

  IF p_visibility_scope='package' THEN
    IF package_row.state NOT IN ('received','identity_hold','evidence_hold','ready_for_review') THEN
      RAISE EXCEPTION 'invalid_state';
    END IF;
    expected_event_type := 'package_verified';
  ELSE
    IF package_row.state <> 'applied' OR package_row.apply_receipt IS NULL OR package_row.firm_id IS NULL
       OR package_row.apply_receipt->>'schemaVersion' IS DISTINCT FROM 'prospect-enrichment-apply-receipt/v1'
       OR package_row.apply_receipt->>'packageId' IS DISTINCT FROM p_package_id::text
       OR package_row.apply_receipt->>'payloadSha256' IS DISTINCT FROM package_row.payload_sha256
       OR package_row.apply_receipt->>'reviewSha256' IS DISTINCT FROM package_row.review_sha256
       OR package_row.apply_receipt->>'firmId' IS DISTINCT FROM package_row.firm_id::text THEN
      RAISE EXCEPTION 'invalid_state';
    END IF;
    SELECT * INTO firm_row FROM public.gta_prospect_firms WHERE id=package_row.firm_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'readback_changed'; END IF;
    receipt_sha := public.prospect_enrichment_row_sha256_v1(package_row.apply_receipt);
    IF receipt_sha IS DISTINCT FROM p_details->>'expectedReceiptSha256' THEN RAISE EXCEPTION 'receipt_mismatch'; END IF;
    IF package_row.apply_receipt->>'resultingRevisionSha256' IS DISTINCT FROM
       public.prospect_enrichment_firm_revision_sha256_v1(firm_row.id,firm_row.enrichment_revision) THEN
      RAISE EXCEPTION 'revision_changed';
    END IF;
    -- Keep all linked destination rows stable while their stored hashes are
    -- rechecked. Lock order is deterministic across concurrent verifications.
    FOR target_row IN
      SELECT target.target_table,target.target_id,target.target_row_sha256
      FROM public.prospect_enrichment_item_targets target
      JOIN public.prospect_enrichment_items item ON item.id=target.item_id
      WHERE item.package_id=p_package_id
      ORDER BY target.target_table,target.target_id
    LOOP
      actual_target_sha := public.prospect_enrichment_lock_existing_target_v1(target_row.target_table,target_row.target_id);
      IF actual_target_sha IS NULL OR actual_target_sha IS DISTINCT FROM target_row.target_row_sha256 THEN
        RAISE EXCEPTION 'readback_changed';
      END IF;
    END LOOP;
    expected_event_type := 'verified';
  END IF;

  event_key_value := 'verify:v1:' || p_visibility_scope || ':' || p_payload_sha256 || ':' || (p_details->>'readbackSha256');
  INSERT INTO public.prospect_enrichment_events(package_id,event_key,event_type,actor,details)
  VALUES (p_package_id,event_key_value,expected_event_type,current_user,p_details)
  ON CONFLICT (package_id,event_key) DO NOTHING;
  SELECT * INTO existing_event FROM public.prospect_enrichment_events
    WHERE package_id=p_package_id AND event_key=event_key_value;
  IF NOT FOUND OR existing_event.event_type IS DISTINCT FROM expected_event_type
     OR existing_event.details IS DISTINCT FROM p_details THEN
    RAISE EXCEPTION 'verification_changed';
  END IF;
  RETURN jsonb_build_object('verified',true,'visibilityScope',p_visibility_scope,
    'payloadSha256',p_payload_sha256,'readbackSha256',p_details->>'readbackSha256');
END;
$$;

-- Verification events have one deliberately small, immutable shape. This also
-- prevents an alternate service-role insertion path from storing readback data.
CREATE OR REPLACE FUNCTION public.guard_prospect_enrichment_verification_event_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  package_row public.prospect_enrichment_packages%ROWTYPE;
  firm_row public.gta_prospect_firms%ROWTYPE;
  item_count_value bigint;
  source_count_value bigint;
  target_count_value bigint;
BEGIN
  IF NEW.event_type NOT IN ('package_verified','verified','readback_failed') THEN RETURN NEW; END IF;
  SELECT * INTO package_row FROM public.prospect_enrichment_packages WHERE id=NEW.package_id;
  IF NOT FOUND OR NEW.details->>'payloadSha256' IS DISTINCT FROM package_row.payload_sha256 THEN
    RAISE EXCEPTION 'verification_changed';
  END IF;

  IF NEW.event_type='readback_failed' THEN
    IF NEW.details - ARRAY['visibilityScope','payloadSha256','reasonCode']::text[] <> '{}'::jsonb
       OR NOT (NEW.details ?& ARRAY['visibilityScope','payloadSha256','reasonCode'])
       OR NEW.details->>'visibilityScope' NOT IN ('package','canonical')
       OR coalesce(NEW.details->>'payloadSha256','') !~ '^[a-f0-9]{64}$'
       OR coalesce(NEW.details->>'reasonCode','') !~ '^[a-z0-9][a-z0-9_-]{0,99}$' THEN
      RAISE EXCEPTION 'invalid_review';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.details - ARRAY['visibilityScope','payloadSha256','readbackSha256','expectedReceiptSha256',
       'sourceCount','itemCount','targetCount','verificationVersion']::text[] <> '{}'::jsonb
     OR NOT (NEW.details ?& ARRAY['visibilityScope','payloadSha256','readbackSha256','expectedReceiptSha256',
       'sourceCount','itemCount','targetCount','verificationVersion'])
     OR NEW.details->>'visibilityScope' IS DISTINCT FROM (CASE WHEN NEW.event_type='package_verified' THEN 'package' ELSE 'canonical' END)
     OR coalesce(NEW.details->>'readbackSha256','') !~ '^[a-f0-9]{64}$'
     OR NEW.details->>'verificationVersion' IS DISTINCT FROM 'prospect-enrichment-readback/v1'
     OR jsonb_typeof(NEW.details->'sourceCount') <> 'number'
     OR jsonb_typeof(NEW.details->'itemCount') <> 'number'
     OR jsonb_typeof(NEW.details->'targetCount') <> 'number'
     OR (NEW.details->>'sourceCount')::numeric < 0 OR (NEW.details->>'sourceCount')::numeric <> trunc((NEW.details->>'sourceCount')::numeric)
     OR (NEW.details->>'itemCount')::numeric < 0 OR (NEW.details->>'itemCount')::numeric <> trunc((NEW.details->>'itemCount')::numeric)
     OR (NEW.details->>'targetCount')::numeric < 0 OR (NEW.details->>'targetCount')::numeric <> trunc((NEW.details->>'targetCount')::numeric) THEN
    RAISE EXCEPTION 'invalid_review';
  END IF;

  SELECT count(*),count(*) FILTER (WHERE item.item_kind='source')
    INTO item_count_value,source_count_value
    FROM public.prospect_enrichment_items item WHERE item.package_id=NEW.package_id;
  SELECT count(*) INTO target_count_value
    FROM public.prospect_enrichment_item_targets target
    JOIN public.prospect_enrichment_items item ON item.id=target.item_id
    WHERE item.package_id=NEW.package_id;
  IF (NEW.details->>'itemCount')::bigint IS DISTINCT FROM item_count_value
     OR (NEW.details->>'sourceCount')::bigint IS DISTINCT FROM source_count_value
     OR (NEW.details->>'targetCount')::bigint IS DISTINCT FROM target_count_value THEN
    RAISE EXCEPTION 'readback_changed';
  END IF;

  IF NEW.event_type='package_verified' THEN
    IF NEW.details->'expectedReceiptSha256' IS DISTINCT FROM 'null'::jsonb
       OR package_row.state NOT IN ('received','identity_hold','evidence_hold','ready_for_review') THEN
      RAISE EXCEPTION 'invalid_state';
    END IF;
  ELSE
    IF coalesce(NEW.details->>'expectedReceiptSha256','') !~ '^[a-f0-9]{64}$'
       OR package_row.state <> 'applied' OR package_row.apply_receipt IS NULL OR package_row.firm_id IS NULL
       OR package_row.apply_receipt->>'schemaVersion' IS DISTINCT FROM 'prospect-enrichment-apply-receipt/v1'
       OR package_row.apply_receipt->>'firmId' IS DISTINCT FROM package_row.firm_id::text
       OR package_row.apply_receipt->>'payloadSha256' IS DISTINCT FROM package_row.payload_sha256
       OR package_row.apply_receipt->>'reviewSha256' IS DISTINCT FROM package_row.review_sha256
       OR public.prospect_enrichment_row_sha256_v1(package_row.apply_receipt) IS DISTINCT FROM NEW.details->>'expectedReceiptSha256' THEN
      RAISE EXCEPTION 'receipt_mismatch';
    END IF;
    SELECT * INTO firm_row FROM public.gta_prospect_firms WHERE id=package_row.firm_id;
    IF NOT FOUND OR package_row.apply_receipt->>'resultingRevisionSha256' IS DISTINCT FROM
       public.prospect_enrichment_firm_revision_sha256_v1(firm_row.id,firm_row.enrichment_revision) THEN
      RAISE EXCEPTION 'revision_changed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prospect_enrichment_verification_event_guard
BEFORE INSERT ON public.prospect_enrichment_events
FOR EACH ROW EXECUTE FUNCTION public.guard_prospect_enrichment_verification_event_v1();

REVOKE ALL ON FUNCTION public.prospect_enrichment_row_sha256_v1(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prospect_enrichment_new_firm_precondition_sha256_v1(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prospect_enrichment_existing_target_sha256_v1(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prospect_enrichment_lock_existing_target_v1(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prospect_enrichment_validate_review_v1(uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_prospect_enrichment_package_v1(uuid,text,jsonb,text,uuid,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_prospect_enrichment_package_v1(uuid,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prospect_enrichment_pending_target_add_v1(jsonb,uuid,text,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_prospect_enrichment_package_v1(uuid,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_prospect_enrichment_verification_v1(uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_prospect_enrichment_verification_event_v1() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.prospect_enrichment_row_sha256_v1(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.prospect_enrichment_new_firm_precondition_sha256_v1(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.prospect_enrichment_existing_target_sha256_v1(text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.prospect_enrichment_lock_existing_target_v1(text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.prospect_enrichment_validate_review_v1(uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_prospect_enrichment_package_v1(uuid,text,jsonb,text,uuid,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_prospect_enrichment_package_v1(uuid,text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.prospect_enrichment_pending_target_add_v1(jsonb,uuid,text,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_prospect_enrichment_package_v1(uuid,text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_prospect_enrichment_verification_v1(uuid,text,text,jsonb) TO service_role;
COMMIT;
