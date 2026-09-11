-- Prospect operations core. This shared, operator-only history layer never
-- rewrites research evidence or infers an identity from a name, domain, or address.

CREATE TABLE public.prospect_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 300),
  city text NULL CHECK (city IS NULL OR char_length(btrim(city)) BETWEEN 1 AND 120),
  website_url text NULL CHECK (website_url IS NULL OR website_url ~ '^https?://'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.prospect_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 300),
  primary_email text NULL CHECK (primary_email IS NULL OR char_length(btrim(primary_email)) BETWEEN 3 AND 320),
  primary_phone text NULL CHECK (primary_phone IS NULL OR char_length(btrim(primary_phone)) BETWEEN 3 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.prospect_person_firm_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.prospect_organizations(id) ON DELETE RESTRICT,
  person_id uuid NOT NULL REFERENCES public.prospect_people(id) ON DELETE RESTRICT,
  role_title text NULL CHECK (role_title IS NULL OR char_length(btrim(role_title)) BETWEEN 1 AND 200),
  is_primary boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX prospect_person_firm_roles_unique
  ON public.prospect_person_firm_roles (organization_id, person_id, coalesce(role_title, ''));

CREATE TABLE public.prospect_source_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system text NOT NULL CHECK (char_length(btrim(source_system)) BETWEEN 1 AND 120),
  source_record_key text NOT NULL CHECK (char_length(btrim(source_record_key)) BETWEEN 1 AND 300),
  organization_id uuid NOT NULL REFERENCES public.prospect_organizations(id) ON DELETE RESTRICT,
  person_id uuid NULL REFERENCES public.prospect_people(id) ON DELETE RESTRICT,
  source_url text NULL CHECK (source_url IS NULL OR source_url ~ '^https?://'),
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_payload) = 'object'),
  history_coverage text NOT NULL DEFAULT 'history_unknown'
    CHECK (history_coverage IN ('known_empty', 'history_unknown', 'evidenced_activity')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, source_record_key)
);

-- A source record is never merged into another record because a name, email,
-- domain, or address happens to match. This append-only decision log lets an
-- operator explicitly resolve a source record to a canonical person and/or
-- organization while keeping the original source link and its evidence intact.
CREATE TABLE public.prospect_identity_adjudications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_link_id uuid NOT NULL REFERENCES public.prospect_source_links(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('confirmed_link', 'rejected')),
  canonical_organization_id uuid NOT NULL REFERENCES public.prospect_organizations(id) ON DELETE RESTRICT,
  canonical_person_id uuid NULL REFERENCES public.prospect_people(id) ON DELETE RESTRICT,
  adjudication_basis text NOT NULL CHECK (char_length(btrim(adjudication_basis)) BETWEEN 1 AND 5000),
  evidence_url text NULL CHECK (evidence_url IS NULL OR evidence_url ~ '^https?://'),
  idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 500),
  reviewed_by_operator_id uuid NOT NULL REFERENCES public.firm_lawyers(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX prospect_identity_adjudications_idempotency_unique
  ON public.prospect_identity_adjudications (btrim(idempotency_key));
CREATE INDEX prospect_identity_adjudications_source_created_idx
  ON public.prospect_identity_adjudications (source_link_id, created_at DESC, id DESC);
CREATE INDEX prospect_identity_adjudications_target_organization_idx
  ON public.prospect_identity_adjudications (canonical_organization_id)
  WHERE decision = 'confirmed_link';
CREATE INDEX prospect_identity_adjudications_target_person_idx
  ON public.prospect_identity_adjudications (canonical_person_id)
  WHERE decision = 'confirmed_link' AND canonical_person_id IS NOT NULL;

CREATE TABLE public.prospect_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.prospect_organizations(id) ON DELETE RESTRICT,
  person_id uuid NULL REFERENCES public.prospect_people(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'not_contacted' CHECK (status IN (
    'not_contacted', 'awaiting_reply', 'replied', 'unreachable', 'declined', 'meeting_scheduled', 'completed'
  )),
  next_action text NULL CHECK (next_action IS NULL OR char_length(btrim(next_action)) BETWEEN 1 AND 2000),
  next_action_due timestamptz NULL,
  last_activity_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX prospect_conversations_person_unique
  ON public.prospect_conversations (organization_id, person_id) WHERE person_id IS NOT NULL;
CREATE UNIQUE INDEX prospect_conversations_firm_unique
  ON public.prospect_conversations (organization_id) WHERE person_id IS NULL AND organization_id IS NOT NULL;

-- Records the original, operator-supplied creation of a source bridge. This
-- is deliberately distinct from identity adjudication: provisioning always
-- creates a fresh identity and never searches for a matching existing record.
CREATE TABLE public.prospect_source_provisioning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_link_id uuid NOT NULL UNIQUE REFERENCES public.prospect_source_links(id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL REFERENCES public.prospect_conversations(id) ON DELETE RESTRICT,
  source_system text NOT NULL CHECK (char_length(btrim(source_system)) BETWEEN 1 AND 120),
  source_record_key text NOT NULL CHECK (char_length(btrim(source_record_key)) BETWEEN 1 AND 300),
  provisioning_basis text NOT NULL CHECK (char_length(btrim(provisioning_basis)) BETWEEN 1 AND 5000),
  idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 500),
  provisioned_by_operator_id uuid NOT NULL REFERENCES public.firm_lawyers(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, source_record_key),
  UNIQUE (idempotency_key)
);

CREATE TABLE public.prospect_conversation_sources (
  conversation_id uuid NOT NULL REFERENCES public.prospect_conversations(id) ON DELETE RESTRICT,
  source_link_id uuid NOT NULL REFERENCES public.prospect_source_links(id) ON DELETE RESTRICT,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, source_link_id)
);
CREATE UNIQUE INDEX prospect_conversation_sources_one_primary
  ON public.prospect_conversation_sources (conversation_id) WHERE is_primary;

CREATE TABLE public.prospect_contactability (
  conversation_id uuid PRIMARY KEY REFERENCES public.prospect_conversations(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'unknown' CHECK (state IN ('unknown', 'eligible', 'suppressed')),
  reason text NULL CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 2000),
  -- This lets an operator retain truthful, pre-suppression history while
  -- blocking a newly logged outbound attempt after the suppression took effect.
  suppressed_at timestamptz NULL,
  suppressed_by_operator_id uuid NULL REFERENCES public.firm_lawyers(id) ON DELETE RESTRICT,
  reviewed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (state = 'suppressed' AND reason IS NOT NULL AND suppressed_at IS NOT NULL AND suppressed_by_operator_id IS NOT NULL)
    OR state <> 'suppressed'
  )
);

CREATE TABLE public.prospect_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.prospect_conversations(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES public.prospect_organizations(id) ON DELETE RESTRICT,
  person_id uuid NULL REFERENCES public.prospect_people(id) ON DELETE RESTRICT,
  source_link_id uuid NOT NULL REFERENCES public.prospect_source_links(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('message_sent', 'human_reply', 'automated_reply', 'bounce', 'call', 'meeting', 'note')),
  channel text NOT NULL CHECK (channel IN ('email', 'linkedin', 'phone', 'video', 'other')),
  direction text NOT NULL CHECK (direction IN ('outbound', 'inbound', 'internal')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  subject text NULL CHECK (subject IS NULL OR char_length(subject) <= 1000),
  body text NULL CHECK (body IS NULL OR char_length(body) <= 20000),
  from_endpoint text NULL CHECK (from_endpoint IS NULL OR char_length(from_endpoint) <= 320),
  to_endpoints jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(to_endpoints) = 'array'),
  delivery_status text NOT NULL DEFAULT 'unknown' CHECK (delivery_status IN ('unknown', 'sent', 'delivered', 'bounced', 'failed')),
  response_kind text NOT NULL DEFAULT 'none' CHECK (response_kind IN ('none', 'human', 'automated')),
  reply_disposition text NOT NULL DEFAULT 'unknown' CHECK (reply_disposition IN ('unknown', 'positive', 'neutral', 'declined')),
  meeting_outcome text NULL CHECK (meeting_outcome IS NULL OR char_length(meeting_outcome) <= 2000),
  provenance_system text NOT NULL DEFAULT 'operator_manual'
    CHECK (provenance_system ~ '^[a-z][a-z0-9_]{0,79}$'),
  external_event_id text NULL CHECK (external_event_id IS NULL OR char_length(btrim(external_event_id)) BETWEEN 1 AND 500),
  idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 500),
  created_by_operator_id uuid NULL REFERENCES public.firm_lawyers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX prospect_activities_external_event_unique
  ON public.prospect_activities (provenance_system, btrim(external_event_id)) WHERE external_event_id IS NOT NULL;
CREATE UNIQUE INDEX prospect_activities_idempotency_unique
  ON public.prospect_activities (btrim(idempotency_key));
CREATE INDEX prospect_activities_conversation_occurred_idx
  ON public.prospect_activities (conversation_id, occurred_at DESC, id DESC);
CREATE INDEX prospect_source_links_organization_idx ON public.prospect_source_links (organization_id);
CREATE INDEX prospect_source_links_person_idx ON public.prospect_source_links (person_id);

CREATE OR REPLACE FUNCTION public.create_prospect_contactability()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  INSERT INTO public.prospect_contactability(conversation_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prospect_conversations_create_contactability
  AFTER INSERT ON public.prospect_conversations
  FOR EACH ROW EXECUTE FUNCTION public.create_prospect_contactability();

-- Keep the active suppression's original actor, reason, and timestamp stable
-- while it remains in force. An operator may later lift it, but that action
-- cannot erase the prior suppression provenance from the record.
CREATE OR REPLACE FUNCTION public.validate_prospect_contactability_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.state = 'suppressed' THEN
    IF NEW.reason IS NULL OR NEW.suppressed_at IS NULL OR NEW.suppressed_by_operator_id IS NULL THEN
      RAISE EXCEPTION 'suppressed contactability requires reason, timestamp, and operator';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.state = 'suppressed'
       AND (NEW.reason IS DISTINCT FROM OLD.reason
            OR NEW.suppressed_at IS DISTINCT FROM OLD.suppressed_at
            OR NEW.suppressed_by_operator_id IS DISTINCT FROM OLD.suppressed_by_operator_id) THEN
      RAISE EXCEPTION 'active suppression provenance is immutable';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.state = 'suppressed'
     AND (NEW.reason IS DISTINCT FROM OLD.reason
          OR NEW.suppressed_at IS DISTINCT FROM OLD.suppressed_at
          OR NEW.suppressed_by_operator_id IS DISTINCT FROM OLD.suppressed_by_operator_id) THEN
    RAISE EXCEPTION 'lifting suppression must preserve its provenance';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prospect_contactability_validate_update
  BEFORE INSERT OR UPDATE ON public.prospect_contactability
  FOR EACH ROW EXECUTE FUNCTION public.validate_prospect_contactability_update();

CREATE OR REPLACE FUNCTION public.validate_prospect_source_link_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.person_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.prospect_person_firm_roles AS role
    WHERE role.organization_id = NEW.organization_id
      AND role.person_id = NEW.person_id
      AND role.active
  ) THEN RAISE EXCEPTION 'source-link person is not an active contact at its organization'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prospect_source_links_validate_identity
  BEFORE INSERT OR UPDATE OF organization_id, person_id ON public.prospect_source_links
  FOR EACH ROW EXECUTE FUNCTION public.validate_prospect_source_link_identity();

CREATE OR REPLACE FUNCTION public.validate_prospect_conversation_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.person_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.prospect_person_firm_roles AS role
    WHERE role.organization_id = NEW.organization_id
      AND role.person_id = NEW.person_id
      AND role.active
  ) THEN RAISE EXCEPTION 'conversation person is not an active contact at its organization'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prospect_conversations_validate_identity
  BEFORE INSERT OR UPDATE OF organization_id, person_id ON public.prospect_conversations
  FOR EACH ROW EXECUTE FUNCTION public.validate_prospect_conversation_identity();

CREATE OR REPLACE FUNCTION public.validate_prospect_conversation_source_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.prospect_conversations AS conversation
    JOIN public.prospect_source_links AS source_link ON source_link.id = NEW.source_link_id
    WHERE conversation.id = NEW.conversation_id
      AND conversation.organization_id = source_link.organization_id
      AND (source_link.person_id IS NULL OR source_link.person_id IS NOT DISTINCT FROM conversation.person_id)
  ) THEN RAISE EXCEPTION 'conversation and source link must share an organization and compatible person identity'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prospect_conversation_sources_validate_identity
  BEFORE INSERT OR UPDATE OF conversation_id, source_link_id ON public.prospect_conversation_sources
  FOR EACH ROW EXECUTE FUNCTION public.validate_prospect_conversation_source_identity();

CREATE OR REPLACE FUNCTION public.sync_agency_prospect_to_operations(p_prospect_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_agency public.agency_prospects%ROWTYPE;
  v_source_id uuid;
  v_organization_id uuid;
  v_person_id uuid;
  v_conversation_id uuid;
  v_contact_source_id uuid;
  v_contact_person_id uuid;
BEGIN
  SELECT * INTO v_agency FROM public.agency_prospects WHERE id = p_prospect_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'agency prospect not found'; END IF;

  SELECT id, organization_id, person_id INTO v_source_id, v_organization_id, v_person_id
  FROM public.prospect_source_links
  WHERE source_system = 'agency_crm' AND source_record_key = v_agency.id::text;

  IF v_source_id IS NULL THEN
    INSERT INTO public.prospect_organizations(display_name, city)
      VALUES (v_agency.firm_name, NULLIF(btrim(v_agency.city), ''))
      RETURNING id INTO v_organization_id;

    IF NULLIF(btrim(v_agency.contact_name), '') IS NOT NULL THEN
      INSERT INTO public.prospect_people(display_name, primary_email, primary_phone)
        VALUES (
          btrim(v_agency.contact_name),
          NULLIF(btrim(v_agency.contact_email), ''),
          NULLIF(btrim(v_agency.contact_phone), '')
        ) RETURNING id INTO v_person_id;
      INSERT INTO public.prospect_person_firm_roles(organization_id, person_id, is_primary)
        VALUES (v_organization_id, v_person_id, true);
    END IF;

    INSERT INTO public.prospect_source_links(
      source_system, source_record_key, organization_id, person_id, source_payload, history_coverage
    ) VALUES (
      'agency_crm', v_agency.id::text, v_organization_id, v_person_id,
      jsonb_build_object('legacyStage', v_agency.stage, 'source', coalesce(v_agency.source, '')),
      'history_unknown'
    ) RETURNING id INTO v_source_id;
  ELSE
    -- Agency CRM edits refresh the current source view, but do not infer an
    -- activity or reassign an already-recorded event to another identity.
    UPDATE public.prospect_organizations
    SET display_name = v_agency.firm_name, city = NULLIF(btrim(v_agency.city), ''), updated_at = now()
    WHERE id = v_organization_id;
    UPDATE public.prospect_people
    SET display_name = coalesce(NULLIF(btrim(v_agency.contact_name), ''), display_name),
        primary_email = NULLIF(btrim(v_agency.contact_email), ''),
        primary_phone = NULLIF(btrim(v_agency.contact_phone), ''), updated_at = now()
    WHERE id = v_person_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.prospect_conversation_sources AS association
        JOIN public.prospect_activities AS activity ON activity.conversation_id = association.conversation_id
        WHERE association.source_link_id = v_source_id
      );
    UPDATE public.prospect_source_links
    SET source_payload = jsonb_build_object('legacyStage', v_agency.stage, 'source', coalesce(v_agency.source, '')),
        updated_at = now()
    WHERE id = v_source_id;

    -- A contact can be supplied after a firm-only CRM record already has
    -- outreach evidence. Keep that firm-level history where it is and create
    -- a distinct, source-backed person conversation for the newly identified
    -- contact. If there is no activity yet, enriching the original empty
    -- person slot is safe and keeps one continuous conversation.
    IF v_person_id IS NULL AND NULLIF(btrim(v_agency.contact_name), '') IS NOT NULL THEN
      SELECT id, person_id INTO v_contact_source_id, v_contact_person_id
      FROM public.prospect_source_links
      WHERE source_system = 'agency_crm_contact' AND source_record_key = v_agency.id::text;

      IF v_contact_source_id IS NULL THEN
        INSERT INTO public.prospect_people(display_name, primary_email, primary_phone)
          VALUES (
            btrim(v_agency.contact_name),
            NULLIF(btrim(v_agency.contact_email), ''),
            NULLIF(btrim(v_agency.contact_phone), '')
          ) RETURNING id INTO v_contact_person_id;
        INSERT INTO public.prospect_person_firm_roles(organization_id, person_id, is_primary)
          VALUES (v_organization_id, v_contact_person_id, true);
      END IF;

      SELECT conversation_id INTO v_conversation_id
      FROM public.prospect_conversation_sources WHERE source_link_id = v_source_id;

      IF NOT EXISTS (
        SELECT 1 FROM public.prospect_activities WHERE conversation_id = v_conversation_id
      ) THEN
        UPDATE public.prospect_source_links SET person_id = v_contact_person_id, updated_at = now()
        WHERE id = v_source_id;
        UPDATE public.prospect_conversations SET person_id = v_contact_person_id, updated_at = now()
        WHERE id = v_conversation_id;
        v_person_id := v_contact_person_id;
      ELSE
        IF v_contact_source_id IS NULL THEN
          INSERT INTO public.prospect_source_links(
            source_system, source_record_key, organization_id, person_id, source_payload, history_coverage
          ) VALUES (
            'agency_crm_contact', v_agency.id::text, v_organization_id, v_contact_person_id,
            jsonb_build_object('agencyProspectId', v_agency.id, 'source', coalesce(v_agency.source, '')),
            'history_unknown'
          ) RETURNING id INTO v_contact_source_id;
        END IF;
        v_source_id := v_contact_source_id;
        v_person_id := v_contact_person_id;
      END IF;
    END IF;
  END IF;

  SELECT conversation_id INTO v_conversation_id
  FROM public.prospect_conversation_sources WHERE source_link_id = v_source_id;
  IF v_conversation_id IS NULL THEN
    INSERT INTO public.prospect_conversations(organization_id, person_id)
      VALUES (v_organization_id, v_person_id) RETURNING id INTO v_conversation_id;
    INSERT INTO public.prospect_conversation_sources(conversation_id, source_link_id, is_primary)
      VALUES (v_conversation_id, v_source_id, true);
  END IF;
  RETURN v_conversation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_gta_public_contact_to_operations(p_observation_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact public.gta_prospect_public_contact_observations%ROWTYPE;
  v_organization_id uuid;
  v_person_id uuid;
  v_source_id uuid;
  v_conversation_id uuid;
BEGIN
  SELECT observation.* INTO v_contact
  FROM public.gta_prospect_public_contact_observations AS observation
  JOIN public.gta_prospect_import_batches AS batch
    ON batch.id = observation.import_batch_id AND batch.state = 'applied'
  WHERE observation.id = p_observation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'applied GTA public contact observation not found'; END IF;

  SELECT organization_id INTO v_organization_id
  FROM public.prospect_source_links
  WHERE source_system = 'gta_research'
    AND source_record_key = (SELECT source_record_key FROM public.gta_prospect_firms WHERE id = v_contact.firm_id);
  IF v_organization_id IS NULL THEN
    PERFORM public.sync_gta_prospect_firm_to_operations(v_contact.firm_id);
    SELECT organization_id INTO v_organization_id
    FROM public.prospect_source_links
    WHERE source_system = 'gta_research'
      AND source_record_key = (SELECT source_record_key FROM public.gta_prospect_firms WHERE id = v_contact.firm_id);
  END IF;

  SELECT id INTO v_source_id FROM public.prospect_source_links
  WHERE source_system = 'gta_public_contact_observation' AND source_record_key = v_contact.id::text;
  IF v_source_id IS NULL THEN
    -- Each observation remains its own source identity. Similar names or a
    -- repeated inbox create review evidence, not a hidden cross-site merge.
    IF NULLIF(btrim(v_contact.contact_name), '') IS NOT NULL THEN
      INSERT INTO public.prospect_people(display_name, primary_email)
        VALUES (btrim(v_contact.contact_name), NULLIF(btrim(v_contact.public_email), ''))
        RETURNING id INTO v_person_id;
      INSERT INTO public.prospect_person_firm_roles(organization_id, person_id, role_title, is_primary)
        VALUES (v_organization_id, v_person_id, v_contact.relationship, true);
    END IF;
    INSERT INTO public.prospect_source_links(
      source_system, source_record_key, organization_id, person_id, source_url, source_payload, history_coverage
    ) VALUES (
      'gta_public_contact_observation', v_contact.id::text, v_organization_id, v_person_id,
      v_contact.source_url,
      jsonb_build_object('relationship', v_contact.relationship, 'emailKind', v_contact.email_kind, 'publicEmail', v_contact.public_email),
      'history_unknown'
    ) RETURNING id INTO v_source_id;
  ELSE
    SELECT person_id INTO v_person_id FROM public.prospect_source_links WHERE id = v_source_id;
  END IF;

  SELECT conversation_id INTO v_conversation_id
  FROM public.prospect_conversation_sources WHERE source_link_id = v_source_id;
  IF v_conversation_id IS NULL THEN
    IF v_person_id IS NULL THEN
      SELECT conversation_id INTO v_conversation_id
      FROM public.prospect_conversation_sources AS cs
      JOIN public.prospect_source_links AS sl ON sl.id = cs.source_link_id
      WHERE sl.source_system = 'gta_research' AND sl.organization_id = v_organization_id;
    ELSE
      INSERT INTO public.prospect_conversations(organization_id, person_id)
        VALUES (v_organization_id, v_person_id) RETURNING id INTO v_conversation_id;
    END IF;
    INSERT INTO public.prospect_conversation_sources(conversation_id, source_link_id, is_primary)
      VALUES (v_conversation_id, v_source_id, false);
  END IF;
  RETURN v_conversation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.gta_prospect_operations_after_batch_applied()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_firm record; v_contact record;
BEGIN
  IF OLD.state <> 'applied' AND NEW.state = 'applied' THEN
    FOR v_firm IN
      SELECT DISTINCT audit.firm_id
      FROM public.gta_prospect_import_audit AS audit
      WHERE audit.import_batch_id = NEW.id AND audit.validation_state = 'accepted'
    LOOP
      PERFORM public.sync_gta_prospect_firm_to_operations(v_firm.firm_id);
    END LOOP;
    FOR v_contact IN
      SELECT id FROM public.gta_prospect_public_contact_observations WHERE import_batch_id = NEW.id
    LOOP
      PERFORM public.sync_gta_public_contact_to_operations(v_contact.id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER gta_prospect_operations_after_batch_applied
  AFTER UPDATE OF state ON public.gta_prospect_import_batches
  FOR EACH ROW EXECUTE FUNCTION public.gta_prospect_operations_after_batch_applied();

CREATE OR REPLACE FUNCTION public.agency_prospect_operations_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.sync_agency_prospect_to_operations(NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER agency_prospect_operations_after_insert
  AFTER INSERT ON public.agency_prospects
  FOR EACH ROW EXECUTE FUNCTION public.agency_prospect_operations_after_insert();
CREATE TRIGGER agency_prospect_operations_after_update
  AFTER UPDATE OF firm_name, contact_name, contact_email, contact_phone, city, source, stage ON public.agency_prospects
  FOR EACH ROW EXECUTE FUNCTION public.agency_prospect_operations_after_insert();

CREATE OR REPLACE FUNCTION public.sync_gta_prospect_firm_to_operations(p_firm_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_firm public.gta_prospect_firms%ROWTYPE;
  v_source_id uuid;
  v_organization_id uuid;
  v_conversation_id uuid;
  v_city text;
BEGIN
  SELECT * INTO v_firm FROM public.gta_prospect_firms WHERE id = p_firm_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'GTA research firm not found'; END IF;
  SELECT office.city INTO v_city
  FROM public.gta_prospect_offices AS office
  JOIN public.gta_prospect_roster_observations AS roster
    ON roster.firm_id = office.firm_id
   AND roster.source_url = office.source_url
   AND roster.observed_on = office.observed_on
  JOIN public.gta_prospect_import_batches AS batch
    ON batch.id = roster.import_batch_id AND batch.state = 'applied'
  WHERE office.firm_id = p_firm_id AND office.created_at <= batch.applied_at
  ORDER BY roster.observed_on DESC, roster.id DESC
  LIMIT 1;

  SELECT id, organization_id INTO v_source_id, v_organization_id
  FROM public.prospect_source_links
  WHERE source_system = 'gta_research' AND source_record_key = v_firm.source_record_key;
  IF v_source_id IS NULL THEN
    INSERT INTO public.prospect_organizations(display_name, city, website_url)
      VALUES (v_firm.display_name, v_city, v_firm.website_url)
      RETURNING id INTO v_organization_id;
    INSERT INTO public.prospect_source_links(
      source_system, source_record_key, organization_id, source_url, source_payload, history_coverage
    ) VALUES (
      'gta_research', v_firm.source_record_key, v_organization_id, v_firm.website_url,
      jsonb_build_object('firmId', v_firm.id, 'reconciliationStatus', v_firm.reconciliation_status),
      'history_unknown'
    ) RETURNING id INTO v_source_id;
  END IF;

  SELECT conversation_id INTO v_conversation_id
  FROM public.prospect_conversation_sources WHERE source_link_id = v_source_id;
  IF v_conversation_id IS NULL THEN
    INSERT INTO public.prospect_conversations(organization_id) VALUES (v_organization_id)
      RETURNING id INTO v_conversation_id;
    INSERT INTO public.prospect_conversation_sources(conversation_id, source_link_id, is_primary)
      VALUES (v_conversation_id, v_source_id, true);
  END IF;
  RETURN v_conversation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_prospect_activity_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.prospect_conversations AS conversation
    JOIN public.prospect_conversation_sources AS association
      ON association.conversation_id = conversation.id
    JOIN public.prospect_source_links AS source_link
      ON source_link.id = association.source_link_id
    WHERE conversation.id = NEW.conversation_id
      AND association.source_link_id = NEW.source_link_id
      AND conversation.organization_id = NEW.organization_id
      AND source_link.organization_id = NEW.organization_id
      AND source_link.person_id IS NOT DISTINCT FROM NEW.person_id
      AND conversation.person_id IS NOT DISTINCT FROM NEW.person_id
  ) THEN RAISE EXCEPTION 'activity identity does not match its conversation and source link'; END IF;
  IF NEW.person_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.prospect_person_firm_roles AS role
    WHERE role.organization_id = NEW.organization_id
      AND role.person_id = NEW.person_id
      AND role.active
  ) THEN RAISE EXCEPTION 'activity person is not an active contact at this organization'; END IF;
  IF NEW.direction = 'outbound' AND NEW.kind IN ('message_sent', 'call') AND EXISTS (
    SELECT 1 FROM public.prospect_contactability
    WHERE conversation_id = NEW.conversation_id
      AND state = 'suppressed'
      AND NEW.occurred_at >= suppressed_at
  ) THEN RAISE EXCEPTION 'suppressed prospects cannot receive a newly logged outbound contact'; END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.to_endpoints) AS endpoint(value)
    WHERE jsonb_typeof(endpoint.value) <> 'string'
       OR char_length(btrim(endpoint.value #>> '{}')) NOT BETWEEN 1 AND 320
  ) THEN RAISE EXCEPTION 'to_endpoints must contain only non-blank endpoint strings'; END IF;
  IF NEW.kind = 'message_sent' AND (
    NEW.direction <> 'outbound'
    OR NEW.response_kind <> 'none'
    OR NEW.delivery_status NOT IN ('unknown', 'sent', 'delivered')
  ) THEN
    RAISE EXCEPTION 'message_sent must be outbound, cannot be a reply, and cannot carry a failed delivery status';
  END IF;
  IF NEW.kind = 'human_reply' AND (NEW.direction <> 'inbound' OR NEW.response_kind <> 'human') THEN
    RAISE EXCEPTION 'human_reply must be an inbound human response';
  END IF;
  IF NEW.kind = 'automated_reply' AND (NEW.direction <> 'inbound' OR NEW.response_kind <> 'automated') THEN
    RAISE EXCEPTION 'automated_reply must be an inbound automated response';
  END IF;
  IF NEW.kind = 'bounce' AND (NEW.direction <> 'inbound' OR NEW.response_kind <> 'none' OR NEW.delivery_status NOT IN ('bounced', 'failed')) THEN
    RAISE EXCEPTION 'bounce must be an inbound delivery failure';
  END IF;
  IF NEW.kind = 'note' AND NEW.direction <> 'internal' THEN
    RAISE EXCEPTION 'note must be an internal activity';
  END IF;
  IF NEW.kind <> 'human_reply' AND NEW.reply_disposition <> 'unknown' THEN
    RAISE EXCEPTION 'only a human reply may carry a reply disposition';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prospect_activities_validate_insert
  BEFORE INSERT ON public.prospect_activities
  FOR EACH ROW EXECUTE FUNCTION public.validate_prospect_activity_insert();

CREATE OR REPLACE FUNCTION public.apply_prospect_activity_to_conversation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_status text; v_last_activity_at timestamptz;
BEGIN
  SELECT status, last_activity_at INTO v_status, v_last_activity_at
  FROM public.prospect_conversations WHERE id = NEW.conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prospect conversation not found'; END IF;
  -- Older evidence remains visible in the audit trail but cannot regress the
  -- current state after a more recent reply, bounce, or meeting was logged.
  IF v_last_activity_at IS NULL OR NEW.occurred_at >= v_last_activity_at THEN
    IF NEW.kind = 'message_sent' THEN v_status := 'awaiting_reply';
    ELSIF NEW.kind = 'bounce' THEN v_status := 'unreachable';
    ELSIF NEW.kind = 'human_reply' THEN
      v_status := CASE WHEN NEW.reply_disposition = 'declined' THEN 'declined' ELSE 'replied' END;
    ELSIF NEW.kind = 'meeting' THEN
      v_status := CASE WHEN NEW.meeting_outcome IS NULL THEN 'meeting_scheduled' ELSE 'completed' END;
    END IF;
  END IF;
  UPDATE public.prospect_conversations
  SET status = v_status,
      last_activity_at = greatest(coalesce(last_activity_at, NEW.occurred_at), NEW.occurred_at),
      updated_at = now()
  WHERE id = NEW.conversation_id;
  UPDATE public.prospect_source_links AS sl
  SET history_coverage = 'evidenced_activity', updated_at = now()
  FROM public.prospect_conversation_sources AS cs
  WHERE cs.conversation_id = NEW.conversation_id AND cs.source_link_id = sl.id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prospect_activity_updates_conversation
  AFTER INSERT ON public.prospect_activities
  FOR EACH ROW EXECUTE FUNCTION public.apply_prospect_activity_to_conversation();

CREATE OR REPLACE FUNCTION public.reject_prospect_activity_history_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'prospect activity history is append-only';
END;
$$;
CREATE TRIGGER prospect_activities_no_mutation
  BEFORE UPDATE OR DELETE ON public.prospect_activities
  FOR EACH ROW EXECUTE FUNCTION public.reject_prospect_activity_history_mutation();

CREATE OR REPLACE FUNCTION public.prevent_prospect_history_reassignment()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'prospect_conversations'
     AND (OLD.organization_id IS DISTINCT FROM NEW.organization_id OR OLD.person_id IS DISTINCT FROM NEW.person_id)
     AND EXISTS (SELECT 1 FROM public.prospect_activities WHERE conversation_id = OLD.id) THEN
    RAISE EXCEPTION 'a conversation with activity history cannot be reassigned';
  END IF;
  IF TG_TABLE_NAME = 'prospect_source_links'
     AND (OLD.source_system IS DISTINCT FROM NEW.source_system OR OLD.source_record_key IS DISTINCT FROM NEW.source_record_key) THEN
    RAISE EXCEPTION 'source system and source record key are immutable';
  END IF;
  IF TG_TABLE_NAME = 'prospect_source_links'
     AND (OLD.organization_id IS DISTINCT FROM NEW.organization_id OR OLD.person_id IS DISTINCT FROM NEW.person_id)
     AND EXISTS (
       SELECT 1 FROM public.prospect_conversation_sources AS cs
       JOIN public.prospect_activities AS activity ON activity.conversation_id = cs.conversation_id
       WHERE cs.source_link_id = OLD.id
     ) THEN RAISE EXCEPTION 'a source link with activity history cannot be reassigned'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prospect_conversations_no_history_reassignment
  BEFORE UPDATE ON public.prospect_conversations
  FOR EACH ROW EXECUTE FUNCTION public.prevent_prospect_history_reassignment();
CREATE TRIGGER prospect_source_links_no_history_reassignment
  BEFORE UPDATE ON public.prospect_source_links
  FOR EACH ROW EXECUTE FUNCTION public.prevent_prospect_history_reassignment();

CREATE OR REPLACE FUNCTION public.validate_prospect_identity_adjudication()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_prior_confirmation public.prospect_identity_adjudications%ROWTYPE;
  v_source_has_url boolean;
BEGIN
  -- Serialize decisions for a source record. This deliberately does not
  -- inspect or compare names, emails, domains, or addresses.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.source_link_id::text, 620260909)
  );

  SELECT source_url IS NOT NULL INTO v_source_has_url
  FROM public.prospect_source_links
  WHERE id = NEW.source_link_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'identity adjudication source link not found'; END IF;
  IF NEW.evidence_url IS NULL AND NOT coalesce(v_source_has_url, false) THEN
    RAISE EXCEPTION 'identity adjudication requires a source URL or decision evidence URL';
  END IF;

  IF NEW.canonical_person_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.prospect_person_firm_roles AS role
    WHERE role.organization_id = NEW.canonical_organization_id
      AND role.person_id = NEW.canonical_person_id
      AND role.active
  ) THEN RAISE EXCEPTION 'canonical person is not an active contact at the canonical organization'; END IF;

  IF NEW.decision = 'confirmed_link' THEN
    SELECT * INTO v_prior_confirmation
    FROM public.prospect_identity_adjudications
    WHERE source_link_id = NEW.source_link_id
      AND decision = 'confirmed_link'
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    -- A later correction may supersede a confirmation only while the source
    -- has no attached contact history. Once activity exists, changing the
    -- canonical target could misattribute that history, so preserve it and
    -- require a separate source record instead.
    IF FOUND
       AND (v_prior_confirmation.canonical_organization_id IS DISTINCT FROM NEW.canonical_organization_id
            OR v_prior_confirmation.canonical_person_id IS DISTINCT FROM NEW.canonical_person_id)
       AND EXISTS (
         SELECT 1
         FROM public.prospect_conversation_sources AS association
         JOIN public.prospect_activities AS activity ON activity.conversation_id = association.conversation_id
         WHERE association.source_link_id = NEW.source_link_id
       )
    THEN RAISE EXCEPTION 'a source link with contact history cannot change canonical identity'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prospect_identity_adjudications_validate_insert
  BEFORE INSERT ON public.prospect_identity_adjudications
  FOR EACH ROW EXECUTE FUNCTION public.validate_prospect_identity_adjudication();

CREATE OR REPLACE FUNCTION public.reject_prospect_identity_adjudication_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'identity adjudication history is append-only';
END;
$$;
CREATE TRIGGER prospect_identity_adjudications_no_mutation
  BEFORE UPDATE OR DELETE ON public.prospect_identity_adjudications
  FOR EACH ROW EXECUTE FUNCTION public.reject_prospect_identity_adjudication_mutation();

CREATE OR REPLACE FUNCTION public.reject_prospect_source_provisioning_event_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'source provisioning history is append-only';
END;
$$;
CREATE TRIGGER prospect_source_provisioning_events_no_mutation
  BEFORE UPDATE OR DELETE ON public.prospect_source_provisioning_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_prospect_source_provisioning_event_mutation();

CREATE OR REPLACE FUNCTION public.prevent_prospect_history_detach()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.conversation_id IS NOT DISTINCT FROM NEW.conversation_id
     AND OLD.source_link_id IS NOT DISTINCT FROM NEW.source_link_id
     AND OLD.is_primary IS NOT DISTINCT FROM NEW.is_primary THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.prospect_activities
    WHERE conversation_id IN (
      OLD.conversation_id,
      CASE WHEN TG_OP = 'UPDATE' THEN NEW.conversation_id ELSE NULL END
    )
  ) THEN
    RAISE EXCEPTION 'a source link cannot be detached from a conversation with activity history';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prospect_conversation_sources_no_history_detach
  BEFORE UPDATE OR DELETE ON public.prospect_conversation_sources
  FOR EACH ROW EXECUTE FUNCTION public.prevent_prospect_history_detach();

CREATE OR REPLACE FUNCTION public.mark_attached_source_history_coverage()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.prospect_activities WHERE conversation_id = NEW.conversation_id) THEN
    UPDATE public.prospect_source_links SET history_coverage = 'evidenced_activity', updated_at = now()
    WHERE id = NEW.source_link_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prospect_conversation_sources_mark_history
  AFTER INSERT ON public.prospect_conversation_sources
  FOR EACH ROW EXECUTE FUNCTION public.mark_attached_source_history_coverage();

-- Atomic, operator-audited provisioning for source systems that do not yet
-- have an import synchronizer. This procedure intentionally creates new rows
-- for every supplied source record and contains no name/email/domain/address
-- lookup or merge. A later identity adjudication is the only way to resolve
-- multiple independently provisioned source records to one canonical target.
CREATE OR REPLACE FUNCTION public.provision_prospect_source_record(
  p_source_system text,
  p_source_record_key text,
  p_source_url text,
  p_source_payload jsonb,
  p_organization_display_name text,
  p_organization_city text,
  p_organization_website_url text,
  p_person_display_name text,
  p_person_email text,
  p_person_phone text,
  p_person_role_title text,
  p_provisioning_basis text,
  p_idempotency_key text,
  p_operator_id uuid
)
RETURNS TABLE(source_link_id uuid, conversation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing public.prospect_source_provisioning_events%ROWTYPE;
  v_organization_id uuid;
  v_person_id uuid;
  v_source_id uuid;
  v_conversation_id uuid;
BEGIN
  IF p_source_system IS NULL OR p_source_system !~ '^[a-z][a-z0-9_]{0,119}$' THEN
    RAISE EXCEPTION 'invalid source system';
  END IF;
  IF p_source_record_key IS NULL OR char_length(btrim(p_source_record_key)) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'invalid source record key';
  END IF;
  IF p_source_url IS NULL OR p_source_url !~ '^https?://' THEN
    RAISE EXCEPTION 'a first-party source URL is required';
  END IF;
  IF p_source_payload IS NULL OR jsonb_typeof(p_source_payload) <> 'object' THEN
    RAISE EXCEPTION 'source payload must be an object';
  END IF;
  IF p_organization_display_name IS NULL OR char_length(btrim(p_organization_display_name)) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'invalid organization display name';
  END IF;
  IF p_organization_city IS NOT NULL AND char_length(btrim(p_organization_city)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'invalid organization city';
  END IF;
  IF p_organization_website_url IS NOT NULL AND p_organization_website_url !~ '^https?://' THEN
    RAISE EXCEPTION 'invalid organization website URL';
  END IF;
  IF p_person_display_name IS NULL
     AND (p_person_email IS NOT NULL OR p_person_phone IS NOT NULL OR p_person_role_title IS NOT NULL) THEN
    RAISE EXCEPTION 'person contact fields require a person display name';
  END IF;
  IF p_person_display_name IS NOT NULL AND char_length(btrim(p_person_display_name)) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'invalid person display name';
  END IF;
  IF p_person_email IS NOT NULL AND char_length(btrim(p_person_email)) NOT BETWEEN 3 AND 320 THEN
    RAISE EXCEPTION 'invalid person email';
  END IF;
  IF p_person_phone IS NOT NULL AND char_length(btrim(p_person_phone)) NOT BETWEEN 3 AND 80 THEN
    RAISE EXCEPTION 'invalid person phone';
  END IF;
  IF p_person_role_title IS NOT NULL AND char_length(btrim(p_person_role_title)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid person role title';
  END IF;
  IF p_provisioning_basis IS NULL OR char_length(btrim(p_provisioning_basis)) NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'provisioning basis is required';
  END IF;
  IF p_idempotency_key IS NULL OR char_length(btrim(p_idempotency_key)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'idempotency key is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.firm_lawyers AS lawyer
    WHERE lawyer.id = p_operator_id AND lawyer.role = 'operator' AND lawyer.disabled = false
  ) THEN RAISE EXCEPTION 'active operator identity is required'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(btrim(p_source_system) || ':' || btrim(p_source_record_key), 620260910)
  );

  SELECT * INTO v_existing
  FROM public.prospect_source_provisioning_events
  WHERE idempotency_key = btrim(p_idempotency_key);
  IF FOUND THEN
    IF v_existing.source_system IS DISTINCT FROM btrim(p_source_system)
       OR v_existing.source_record_key IS DISTINCT FROM btrim(p_source_record_key) THEN
      RAISE EXCEPTION 'idempotency key already belongs to a different source record';
    END IF;
    source_link_id := v_existing.source_link_id;
    conversation_id := v_existing.conversation_id;
    RETURN NEXT;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.prospect_source_links
    WHERE source_system = btrim(p_source_system) AND source_record_key = btrim(p_source_record_key)
  ) THEN RAISE EXCEPTION 'source record already exists; use its existing source link or an explicit identity adjudication'; END IF;

  INSERT INTO public.prospect_organizations(display_name, city, website_url)
    VALUES (btrim(p_organization_display_name), NULLIF(btrim(p_organization_city), ''), NULLIF(btrim(p_organization_website_url), ''))
    RETURNING id INTO v_organization_id;

  IF p_person_display_name IS NOT NULL THEN
    INSERT INTO public.prospect_people(display_name, primary_email, primary_phone)
      VALUES (btrim(p_person_display_name), NULLIF(btrim(p_person_email), ''), NULLIF(btrim(p_person_phone), ''))
      RETURNING id INTO v_person_id;
    INSERT INTO public.prospect_person_firm_roles(organization_id, person_id, role_title, is_primary)
      VALUES (v_organization_id, v_person_id, NULLIF(btrim(p_person_role_title), ''), true);
  END IF;

  INSERT INTO public.prospect_source_links(
    source_system, source_record_key, organization_id, person_id, source_url, source_payload, history_coverage
  ) VALUES (
    btrim(p_source_system), btrim(p_source_record_key), v_organization_id, v_person_id,
    btrim(p_source_url),
    jsonb_build_object(
      'providedSourcePayload', p_source_payload,
      'operatorProvisionedOrganization', jsonb_build_object(
        'displayName', btrim(p_organization_display_name),
        'city', NULLIF(btrim(p_organization_city), ''),
        'websiteUrl', NULLIF(btrim(p_organization_website_url), '')
      ),
      'operatorProvisionedPerson', CASE WHEN p_person_display_name IS NULL THEN NULL ELSE jsonb_build_object(
        'displayName', btrim(p_person_display_name),
        'email', NULLIF(btrim(p_person_email), ''),
        'phone', NULLIF(btrim(p_person_phone), ''),
        'roleTitle', NULLIF(btrim(p_person_role_title), '')
      ) END
    ),
    'history_unknown'
  ) RETURNING id INTO v_source_id;

  INSERT INTO public.prospect_conversations(organization_id, person_id)
    VALUES (v_organization_id, v_person_id)
    RETURNING id INTO v_conversation_id;
  INSERT INTO public.prospect_conversation_sources(conversation_id, source_link_id, is_primary)
    VALUES (v_conversation_id, v_source_id, true);
  INSERT INTO public.prospect_source_provisioning_events(
    source_link_id, conversation_id, source_system, source_record_key, provisioning_basis, idempotency_key, provisioned_by_operator_id
  ) VALUES (
    v_source_id, v_conversation_id, btrim(p_source_system), btrim(p_source_record_key),
    btrim(p_provisioning_basis), btrim(p_idempotency_key), p_operator_id
  );
  source_link_id := v_source_id;
  conversation_id := v_conversation_id;
  RETURN NEXT;
END;
$$;

DO $$
DECLARE v_row record;
BEGIN
  FOR v_row IN SELECT id FROM public.agency_prospects LOOP
    PERFORM public.sync_agency_prospect_to_operations(v_row.id);
  END LOOP;
  FOR v_row IN
    SELECT firm.id
    FROM public.gta_prospect_firms AS firm
    WHERE EXISTS (
      SELECT 1 FROM public.gta_prospect_import_audit AS audit
      JOIN public.gta_prospect_import_batches AS batch ON batch.id = audit.import_batch_id AND batch.state = 'applied'
      WHERE audit.firm_id = firm.id AND audit.validation_state = 'accepted'
    )
  LOOP
    PERFORM public.sync_gta_prospect_firm_to_operations(v_row.id);
  END LOOP;
  FOR v_row IN
    SELECT observation.id
    FROM public.gta_prospect_public_contact_observations AS observation
    JOIN public.gta_prospect_import_batches AS batch ON batch.id = observation.import_batch_id AND batch.state = 'applied'
  LOOP
    PERFORM public.sync_gta_public_contact_to_operations(v_row.id);
  END LOOP;
END;
$$;

ALTER TABLE public.prospect_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_people FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_person_firm_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_person_firm_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_source_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_source_links FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_identity_adjudications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_identity_adjudications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_source_provisioning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_source_provisioning_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_conversation_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_conversation_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_contactability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_contactability FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_activities FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.prospect_organizations, public.prospect_people,
  public.prospect_person_firm_roles, public.prospect_source_links,
  public.prospect_conversations, public.prospect_conversation_sources, public.prospect_contactability,
  public.prospect_activities, public.prospect_identity_adjudications,
  public.prospect_source_provisioning_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.prospect_organizations, public.prospect_people,
  public.prospect_person_firm_roles, public.prospect_source_links,
  public.prospect_conversations, public.prospect_conversation_sources, public.prospect_contactability,
  public.prospect_activities, public.prospect_identity_adjudications,
  public.prospect_source_provisioning_events TO service_role;
GRANT EXECUTE ON FUNCTION public.provision_prospect_source_record(
  text, text, text, jsonb, text, text, text, text, text, text, text, text, text, uuid
) TO service_role;
REVOKE ALL ON FUNCTION public.sync_agency_prospect_to_operations(uuid),
  public.sync_gta_prospect_firm_to_operations(uuid),
  public.sync_gta_public_contact_to_operations(uuid),
  public.create_prospect_contactability(),
  public.validate_prospect_contactability_update(),
  public.validate_prospect_source_link_identity(),
  public.validate_prospect_conversation_identity(),
  public.validate_prospect_conversation_source_identity(),
  public.gta_prospect_operations_after_batch_applied(),
  public.agency_prospect_operations_after_insert(),
  public.validate_prospect_activity_insert(),
  public.apply_prospect_activity_to_conversation(),
  public.reject_prospect_activity_history_mutation(),
  public.prevent_prospect_history_reassignment(),
  public.prevent_prospect_history_detach(),
  public.mark_attached_source_history_coverage(),
  public.validate_prospect_identity_adjudication(),
  public.reject_prospect_identity_adjudication_mutation(),
  public.reject_prospect_source_provisioning_event_mutation(),
  public.provision_prospect_source_record(text, text, text, jsonb, text, text, text, text, text, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.prospect_activities IS
  'Append-only manual outreach evidence. It is not a mail sender or an inferred CRM record.';
COMMENT ON TABLE public.prospect_source_links IS
  'Stable source-record bridge. Shared names, email addresses, domains, and locations cannot merge identities.';
COMMENT ON TABLE public.prospect_identity_adjudications IS
  'Append-only operator decisions that resolve source records to canonical identities without rewriting source links or activity history.';
COMMENT ON TABLE public.prospect_source_provisioning_events IS
  'Append-only audit record for first-party source provisioning; provisioning always creates a separate source identity.';

NOTIFY pgrst, 'reload schema';
