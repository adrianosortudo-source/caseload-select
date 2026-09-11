-- Service-only atomic importer for the reconciled 50 BA / 50 AE Control Plane cohort.
-- One PostgREST RPC invocation is one PostgreSQL transaction. Any exception from
-- validation, conflict preflight, provisioning, or assertions rolls it all back.

CREATE OR REPLACE FUNCTION public.provision_prospect_source_batch(
  p_manifest jsonb,
  p_operator_id uuid,
  p_apply boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_record jsonb;
  v_evidence jsonb;
  v_cls_record_id text;
  v_arm text;
  v_expected_method text;
  v_source_url text;
  v_website_url text;
  v_source_host text;
  v_website_host text;
  v_evidence_host text;
  v_attribution_url text;
  v_attribution_host text;
  v_person_email text;
  v_person_local_part text;
  v_idempotency_key text;
  v_source_link_id uuid;
  v_organization_id uuid;
  v_person_id uuid;
  v_existing_organization_name text;
  v_existing_organization_city text;
  v_existing_organization_website text;
  v_existing_person_name text;
  v_existing_person_email text;
  v_existing_person_phone text;
  v_existing_conversation_organization_id uuid;
  v_existing_conversation_person_id uuid;
  v_existing_source_active boolean;
  v_existing_source_url text;
  v_existing_source_payload jsonb;
  v_expected_source_payload jsonb;
  v_effective_source_payload jsonb;
  v_conversation_id uuid;
  v_event_source_link_id uuid;
  v_event_conversation_id uuid;
  v_event_source_system text;
  v_event_source_record_key text;
  v_event_idempotency_key text;
  v_event_provisioning_basis text;
  v_source_found boolean;
  v_event_found boolean;
  v_source_event_count integer;
  v_source_association_count integer;
  v_role_count integer;
  v_first_party_evidence boolean;
  v_ba_count integer;
  v_ae_count integer;
  v_existing_count integer := 0;
  v_absent_count integer := 0;
  v_provisioned_count integer := 0;
  v_total_after integer;
  v_receipt_count integer;
  v_organization_count integer;
  v_person_count integer;
  v_expected_person_count integer;
  v_conversation_count integer;
  v_primary_association_count integer;
  v_activity_before bigint;
  v_activity_after bigint;
  v_receipts jsonb := '[]'::jsonb;
BEGIN
  IF p_manifest IS NULL OR jsonb_typeof(p_manifest) <> 'object' THEN
    RAISE EXCEPTION 'manifest must be an object';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_manifest) AS key
    WHERE key NOT IN ('schema_version', 'generated_at', 'records')
  ) THEN RAISE EXCEPTION 'manifest contains unsupported fields'; END IF;
  IF p_manifest->>'schema_version' IS DISTINCT FROM 'prospecting-control-plane-provision-manifest-v1' THEN
    RAISE EXCEPTION 'invalid manifest schema version';
  END IF;
  IF p_manifest->>'generated_at' IS NULL THEN RAISE EXCEPTION 'manifest generated_at is required'; END IF;
  BEGIN
    PERFORM (p_manifest->>'generated_at')::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'manifest generated_at must be a timestamp';
  END;
  IF jsonb_typeof(p_manifest->'records') <> 'array'
     OR jsonb_array_length(p_manifest->'records') <> 100 THEN
    RAISE EXCEPTION 'manifest must contain exactly 100 records';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.firm_lawyers AS lawyer
    WHERE lawyer.id = p_operator_id AND lawyer.role = 'operator' AND lawyer.disabled = false
  ) THEN RAISE EXCEPTION 'active operator identity is required'; END IF;

  SELECT count(*) FILTER (WHERE record->>'arm' = 'BA'),
         count(*) FILTER (WHERE record->>'arm' = 'AE')
    INTO v_ba_count, v_ae_count
    FROM jsonb_array_elements(p_manifest->'records') AS record;
  IF v_ba_count <> 50 OR v_ae_count <> 50 THEN
    RAISE EXCEPTION 'manifest must contain exactly 50 BA and 50 AE records';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_manifest->'records') AS record
    GROUP BY lower(btrim(record->>'cls_record_id')) HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'duplicate CLS record id'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_manifest->'records') AS record
    GROUP BY lower(btrim(record->'organization'->>'display_name')) HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'duplicate organization display name'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_manifest->'records') AS record
    GROUP BY lower(regexp_replace(btrim(record->'organization'->>'website_url'), '/+$', '')) HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'duplicate organization website'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_manifest->'records') AS record
    WHERE nullif(btrim(record->'person'->>'primary_email'), '') IS NOT NULL
    GROUP BY lower(btrim(record->'person'->>'primary_email')) HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'duplicate person primary email'; END IF;

  FOR v_record IN SELECT value FROM jsonb_array_elements(p_manifest->'records') LOOP
    IF jsonb_typeof(v_record) <> 'object' THEN RAISE EXCEPTION 'record must be an object'; END IF;
    IF NOT (v_record ?& ARRAY['cls_record_id', 'arm', 'source_url', 'organization', 'person', 'source_payload', 'provisioning_basis']) THEN
      RAISE EXCEPTION 'record is missing required fields';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(v_record) AS key
      WHERE key NOT IN ('cls_record_id', 'arm', 'source_url', 'organization', 'person', 'source_payload', 'provisioning_basis')
    ) THEN RAISE EXCEPTION 'record contains unsupported fields'; END IF;

    v_cls_record_id := btrim(v_record->>'cls_record_id');
    v_arm := v_record->>'arm';
    IF v_cls_record_id IS NULL OR char_length(v_cls_record_id) NOT BETWEEN 1 AND 300
       OR v_cls_record_id !~ '^(BA|AE)-[A-Z0-9][A-Z0-9_-]*$' THEN
      RAISE EXCEPTION 'invalid CLS record id';
    END IF;
    IF v_arm NOT IN ('BA', 'AE') OR left(v_cls_record_id, char_length(v_arm) + 1) <> v_arm || '-' THEN
      RAISE EXCEPTION '%: arm and CLS record id disagree', v_cls_record_id;
    END IF;
    v_expected_method := CASE v_arm WHEN 'BA' THEN 'beyond_agency' ELSE 'adam_erhart' END;

    IF jsonb_typeof(v_record->'organization') <> 'object'
       OR NOT (v_record->'organization' ?& ARRAY['display_name', 'city', 'website_url'])
       OR EXISTS (
         SELECT 1 FROM jsonb_object_keys(v_record->'organization') AS key
         WHERE key NOT IN ('display_name', 'city', 'website_url')
       )
       OR jsonb_typeof(v_record->'organization'->'display_name') <> 'string'
       OR char_length(btrim(coalesce(v_record->'organization'->>'display_name', ''))) NOT BETWEEN 1 AND 300
       OR jsonb_typeof(v_record->'organization'->'city') NOT IN ('string', 'null')
       OR jsonb_typeof(v_record->'organization'->'website_url') <> 'string' THEN
      RAISE EXCEPTION '%: invalid organization', v_cls_record_id;
    END IF;
    IF v_record->'organization'->>'city' IS NOT NULL
       AND char_length(btrim(v_record->'organization'->>'city')) NOT BETWEEN 1 AND 120 THEN
      RAISE EXCEPTION '%: invalid organization city', v_cls_record_id;
    END IF;

    v_source_url := btrim(v_record->>'source_url');
    v_website_url := btrim(v_record->'organization'->>'website_url');
    v_source_host := lower(regexp_replace(substring(v_source_url from '^https?://([^/:?#]+)'), '^www\.', ''));
    v_website_host := lower(regexp_replace(substring(v_website_url from '^https?://([^/:?#]+)'), '^www\.', ''));
    IF v_source_host IS NULL OR v_website_host IS NULL OR (
      v_source_host <> v_website_host
      AND right(v_source_host, char_length(v_website_host) + 1) <> '.' || v_website_host
      AND right(v_website_host, char_length(v_source_host) + 1) <> '.' || v_source_host
    ) THEN RAISE EXCEPTION '%: source_url must be first-party to organization website', v_cls_record_id; END IF;

    IF jsonb_typeof(v_record->'source_payload') <> 'object'
       OR octet_length((v_record->'source_payload')::text) > 50000
       OR v_record->'source_payload'->>'arm' IS DISTINCT FROM v_arm
       OR v_record->'source_payload'->>'method' IS DISTINCT FROM v_expected_method
       OR jsonb_typeof(v_record->'source_payload'->'evidence') <> 'array'
       OR jsonb_array_length(v_record->'source_payload'->'evidence') = 0
       OR jsonb_typeof(v_record->'source_payload'->'highlevel') <> 'object'
       OR NOT (v_record->'source_payload'->'highlevel' ?& ARRAY['location_id', 'contact_id', 'smart_list_id', 'workflow_ids'])
       OR EXISTS (
         SELECT 1
           FROM jsonb_object_keys(v_record->'source_payload'->'highlevel') AS key
          WHERE key NOT IN ('location_id', 'contact_id', 'smart_list_id', 'workflow_ids')
       )
       OR jsonb_typeof(v_record->'source_payload'->'highlevel'->'location_id') NOT IN ('string', 'null')
       OR jsonb_typeof(v_record->'source_payload'->'highlevel'->'contact_id') NOT IN ('string', 'null')
       OR jsonb_typeof(v_record->'source_payload'->'highlevel'->'smart_list_id') NOT IN ('string', 'null')
       OR (jsonb_typeof(v_record->'source_payload'->'highlevel'->'location_id') = 'string'
           AND char_length(btrim(v_record->'source_payload'->'highlevel'->>'location_id')) NOT BETWEEN 1 AND 300)
       OR (jsonb_typeof(v_record->'source_payload'->'highlevel'->'contact_id') = 'string'
           AND char_length(btrim(v_record->'source_payload'->'highlevel'->>'contact_id')) NOT BETWEEN 1 AND 300)
       OR (jsonb_typeof(v_record->'source_payload'->'highlevel'->'smart_list_id') = 'string'
           AND char_length(btrim(v_record->'source_payload'->'highlevel'->>'smart_list_id')) NOT BETWEEN 1 AND 300)
       OR jsonb_typeof(v_record->'source_payload'->'highlevel'->'workflow_ids') <> 'array'
       OR EXISTS (
         SELECT 1
           FROM jsonb_array_elements(v_record->'source_payload'->'highlevel'->'workflow_ids') AS workflow_id
          WHERE jsonb_typeof(workflow_id) <> 'string'
             OR char_length(btrim(workflow_id #>> '{}')) NOT BETWEEN 1 AND 300
       ) THEN
      RAISE EXCEPTION '%: invalid source payload, method evidence, or HighLevel identity block', v_cls_record_id;
    END IF;
    v_first_party_evidence := false;
    FOR v_evidence IN SELECT value FROM jsonb_array_elements(v_record->'source_payload'->'evidence') LOOP
      IF jsonb_typeof(v_evidence) <> 'object'
         OR NOT (v_evidence ?& ARRAY['url', 'observed_at', 'label']) THEN
        RAISE EXCEPTION '%: malformed evidence item', v_cls_record_id;
      END IF;
      IF EXISTS (
           SELECT 1 FROM jsonb_object_keys(v_evidence) AS key
           WHERE key NOT IN ('url', 'observed_at', 'label')
         )
         OR jsonb_typeof(v_evidence->'url') <> 'string'
         OR jsonb_typeof(v_evidence->'observed_at') <> 'string'
         OR jsonb_typeof(v_evidence->'label') <> 'string'
         OR char_length(btrim(coalesce(v_evidence->>'label', ''))) NOT BETWEEN 1 AND 500
         OR char_length(btrim(coalesce(v_evidence->>'url', ''))) NOT BETWEEN 1 AND 2000
         OR btrim(coalesce(v_evidence->>'observed_at', '')) = ''
         OR position('T' IN v_evidence->>'observed_at') = 0 THEN
        RAISE EXCEPTION '%: malformed evidence item', v_cls_record_id;
      END IF;
      BEGIN
        PERFORM (v_evidence->>'observed_at')::timestamptz;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION '%: evidence observed_at must be a timestamp', v_cls_record_id;
      END;
      v_evidence_host := lower(regexp_replace(substring(btrim(v_evidence->>'url') from '^https?://([^/:?#]+)'), '^www\.', ''));
      IF v_evidence_host = v_website_host
         OR right(v_evidence_host, char_length(v_website_host) + 1) = '.' || v_website_host
         OR right(v_website_host, char_length(v_evidence_host) + 1) = '.' || v_evidence_host THEN
        v_first_party_evidence := true;
      END IF;
    END LOOP;
    IF NOT v_first_party_evidence THEN RAISE EXCEPTION '%: first-party evidence is required', v_cls_record_id; END IF;

    IF jsonb_typeof(v_record->'provisioning_basis') <> 'string'
       OR char_length(btrim(coalesce(v_record->>'provisioning_basis', ''))) NOT BETWEEN 1 AND 5000 THEN
      RAISE EXCEPTION '%: provisioning basis is required', v_cls_record_id;
    END IF;
    IF v_record->'person' IS NOT NULL AND jsonb_typeof(v_record->'person') <> 'null' THEN
      IF jsonb_typeof(v_record->'person') <> 'object'
         OR NOT (v_record->'person' ?& ARRAY['display_name', 'primary_email', 'primary_phone', 'role_title', 'email_attribution'])
         OR EXISTS (
           SELECT 1 FROM jsonb_object_keys(v_record->'person') AS key
           WHERE key NOT IN ('display_name', 'primary_email', 'primary_phone', 'role_title', 'email_attribution')
         )
         OR jsonb_typeof(v_record->'person'->'display_name') <> 'string'
         OR char_length(btrim(coalesce(v_record->'person'->>'display_name', ''))) NOT BETWEEN 1 AND 300
         OR jsonb_typeof(v_record->'person'->'primary_email') NOT IN ('string', 'null')
         OR jsonb_typeof(v_record->'person'->'primary_phone') NOT IN ('string', 'null')
         OR jsonb_typeof(v_record->'person'->'role_title') NOT IN ('string', 'null') THEN
        RAISE EXCEPTION '%: invalid person', v_cls_record_id;
      END IF;
      v_person_email := nullif(lower(btrim(v_record->'person'->>'primary_email')), '');
      IF v_record->'person'->>'primary_email' IS NOT NULL AND (
        char_length(btrim(v_record->'person'->>'primary_email')) NOT BETWEEN 3 AND 320
        OR v_person_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      ) THEN RAISE EXCEPTION '%: invalid person email', v_cls_record_id; END IF;
      IF v_record->'person'->>'primary_phone' IS NOT NULL
         AND char_length(btrim(v_record->'person'->>'primary_phone')) NOT BETWEEN 3 AND 80 THEN
        RAISE EXCEPTION '%: invalid person phone', v_cls_record_id;
      END IF;
      IF v_record->'person'->>'role_title' IS NOT NULL
         AND char_length(btrim(v_record->'person'->>'role_title')) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION '%: invalid person role title', v_cls_record_id;
      END IF;
      IF v_person_email IS NOT NULL THEN
        v_person_local_part := split_part(v_person_email, '@', 1);
        IF regexp_replace(v_person_local_part, '[._+-].*$', '') IN (
          'accounts', 'admin', 'appointments', 'billing', 'bookings', 'business', 'careers', 'clientcare',
          'clients', 'clientservices', 'consultations', 'contact', 'contactus', 'enquiries', 'frontdesk', 'general',
          'hello', 'help', 'hiring', 'info', 'inquiries', 'inquiry', 'intake', 'law', 'lawyers', 'legal', 'mail',
          'marketing', 'media', 'newclients', 'noreply', 'office', 'reception', 'receptiondesk', 'recruiting',
          'service', 'services', 'support', 'team'
        ) THEN
          RAISE EXCEPTION '%: generic firm inbox cannot populate person primary_email; keep the route in source_payload and set primary_email to null', v_cls_record_id;
        END IF;
        IF jsonb_typeof(v_record->'person'->'email_attribution') <> 'object'
           OR EXISTS (
             SELECT 1 FROM jsonb_object_keys(v_record->'person'->'email_attribution') AS key
             WHERE key NOT IN ('mailbox_type', 'person_attribution_proven', 'evidence_url')
           )
           OR v_record->'person'->'email_attribution'->>'mailbox_type' IS DISTINCT FROM 'named_person'
           OR v_record->'person'->'email_attribution'->'person_attribution_proven' IS DISTINCT FROM 'true'::jsonb THEN
          RAISE EXCEPTION '%: person primary_email requires explicit named-person attribution', v_cls_record_id;
        END IF;
        v_attribution_url := btrim(v_record->'person'->'email_attribution'->>'evidence_url');
        v_attribution_host := lower(regexp_replace(substring(v_attribution_url from '^https?://([^/:?#]+)'), '^www\.', ''));
        IF v_attribution_host IS NULL OR (
          v_attribution_host <> v_website_host
          AND right(v_attribution_host, char_length(v_website_host) + 1) <> '.' || v_website_host
          AND right(v_website_host, char_length(v_attribution_host) + 1) <> '.' || v_attribution_host
        ) THEN RAISE EXCEPTION '%: person email attribution evidence must be first-party', v_cls_record_id; END IF;
      END IF;
      IF v_person_email IS NULL AND v_record->'person'->'email_attribution' IS NOT NULL
         AND jsonb_typeof(v_record->'person'->'email_attribution') <> 'null' THEN
        RAISE EXCEPTION '%: email attribution must be null when person primary_email is null', v_cls_record_id;
      END IF;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_activity_before
    FROM public.prospect_activities AS activity
    JOIN public.prospect_source_links AS source_link ON source_link.id = activity.source_link_id
   WHERE source_link.source_system = 'prospecting_control_plane'
     AND source_link.source_record_key IN (
       SELECT value->>'cls_record_id' FROM jsonb_array_elements(p_manifest->'records')
     );

  IF p_apply THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('prospecting_control_plane:100-record-import', 620260910)
    );
  END IF;

  -- Preflight every stable source key and deterministic idempotency key before any write.
  FOR v_record IN SELECT value FROM jsonb_array_elements(p_manifest->'records') LOOP
    v_cls_record_id := btrim(v_record->>'cls_record_id');
    v_idempotency_key := 'prospecting_control_plane:provision:' || v_cls_record_id || ':v1';
    v_source_link_id := NULL;
    v_existing_source_url := NULL;
    v_existing_source_payload := NULL;
    v_effective_source_payload := jsonb_set(
      v_record->'source_payload',
      '{person_email_attribution}',
      coalesce(v_record->'person'->'email_attribution', 'null'::jsonb),
      true
    );
    IF octet_length(v_effective_source_payload::text) > 50000 THEN
      RAISE EXCEPTION '%: source payload exceeds 50000 bytes after attribution preservation', v_cls_record_id;
    END IF;
    v_expected_source_payload := jsonb_build_object(
      'providedSourcePayload', v_effective_source_payload,
      'operatorProvisionedOrganization', jsonb_build_object(
        'displayName', btrim(v_record->'organization'->>'display_name'),
        'city', nullif(btrim(v_record->'organization'->>'city'), ''),
        'websiteUrl', nullif(btrim(v_record->'organization'->>'website_url'), '')
      ),
      'operatorProvisionedPerson', CASE
        WHEN v_record->'person' IS NULL OR jsonb_typeof(v_record->'person') = 'null' THEN NULL
        ELSE jsonb_build_object(
          'displayName', btrim(v_record->'person'->>'display_name'),
          'email', nullif(lower(btrim(v_record->'person'->>'primary_email')), ''),
          'phone', nullif(btrim(v_record->'person'->>'primary_phone'), ''),
          'roleTitle', nullif(btrim(v_record->'person'->>'role_title'), '')
        )
      END
    );
    v_conversation_id := NULL;
    v_event_source_link_id := NULL;
    v_event_conversation_id := NULL;
    v_event_provisioning_basis := NULL;
    v_source_event_count := 0;
    SELECT source_link.id, source_link.organization_id, source_link.person_id, source_link.active,
           source_link.source_url, source_link.source_payload, event.conversation_id,
           event.source_link_id, event.source_system, event.source_record_key, event.idempotency_key,
           event.provisioning_basis
      INTO v_source_link_id, v_organization_id, v_person_id, v_existing_source_active,
           v_existing_source_url, v_existing_source_payload, v_conversation_id,
           v_event_source_link_id, v_event_source_system, v_event_source_record_key, v_event_idempotency_key,
           v_event_provisioning_basis
      FROM public.prospect_source_links AS source_link
      LEFT JOIN public.prospect_source_provisioning_events AS event ON event.source_link_id = source_link.id
     WHERE source_link.source_system = 'prospecting_control_plane'
       AND source_link.source_record_key = v_cls_record_id;
    v_source_found := FOUND;

    IF v_source_found THEN
      SELECT count(*)
        INTO v_source_event_count
        FROM public.prospect_source_provisioning_events AS event
       WHERE event.source_link_id = v_source_link_id;
      IF v_source_event_count <> 1 THEN
        RAISE EXCEPTION '%: expected exactly one provisioning event for existing source', v_cls_record_id;
      END IF;
      IF v_existing_source_url IS DISTINCT FROM btrim(v_record->>'source_url')
         OR v_existing_source_payload IS DISTINCT FROM v_expected_source_payload
         OR v_event_provisioning_basis IS DISTINCT FROM btrim(v_record->>'provisioning_basis') THEN
        RAISE EXCEPTION '%: existing source provenance conflicts with manifest', v_cls_record_id;
      END IF;
      IF v_event_source_link_id IS NULL OR v_event_source_link_id <> v_source_link_id
         OR v_event_source_system IS DISTINCT FROM 'prospecting_control_plane'
         OR v_event_source_record_key IS DISTINCT FROM v_cls_record_id
         OR v_event_idempotency_key IS DISTINCT FROM v_idempotency_key
         OR v_conversation_id IS NULL
         OR v_existing_source_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION '%: existing source/provisioning identity is inconsistent', v_cls_record_id;
      END IF;

      SELECT organization.display_name, organization.city, organization.website_url
        INTO v_existing_organization_name, v_existing_organization_city, v_existing_organization_website
        FROM public.prospect_organizations AS organization
       WHERE organization.id = v_organization_id;
      IF NOT FOUND
         OR v_existing_organization_name IS DISTINCT FROM btrim(v_record->'organization'->>'display_name')
         OR v_existing_organization_city IS DISTINCT FROM nullif(btrim(v_record->'organization'->>'city'), '')
         OR v_existing_organization_website IS DISTINCT FROM nullif(btrim(v_record->'organization'->>'website_url'), '') THEN
        RAISE EXCEPTION '%: existing organization identity conflicts with manifest', v_cls_record_id;
      END IF;

      IF v_record->'person' IS NULL OR jsonb_typeof(v_record->'person') = 'null' THEN
        SELECT count(*) INTO v_role_count
          FROM public.prospect_person_firm_roles AS role
         WHERE role.organization_id = v_organization_id;
        IF v_person_id IS NOT NULL OR v_role_count <> 0 THEN
          RAISE EXCEPTION '%: existing person/role identity conflicts with firm-only manifest record', v_cls_record_id;
        END IF;
      ELSE
        SELECT person.display_name, person.primary_email, person.primary_phone
          INTO v_existing_person_name, v_existing_person_email, v_existing_person_phone
          FROM public.prospect_people AS person
         WHERE person.id = v_person_id;
        IF NOT FOUND
           OR v_existing_person_name IS DISTINCT FROM btrim(v_record->'person'->>'display_name')
           OR v_existing_person_email IS DISTINCT FROM nullif(lower(btrim(v_record->'person'->>'primary_email')), '')
           OR v_existing_person_phone IS DISTINCT FROM nullif(btrim(v_record->'person'->>'primary_phone'), '') THEN
          RAISE EXCEPTION '%: existing person identity conflicts with manifest', v_cls_record_id;
        END IF;
        SELECT count(*) INTO v_role_count
          FROM public.prospect_person_firm_roles AS role
         WHERE role.organization_id = v_organization_id;
        IF v_role_count <> 1 OR NOT EXISTS (
          SELECT 1
            FROM public.prospect_person_firm_roles AS role
           WHERE role.organization_id = v_organization_id
             AND role.person_id = v_person_id
             AND role.role_title IS NOT DISTINCT FROM nullif(btrim(v_record->'person'->>'role_title'), '')
             AND role.is_primary = true
             AND role.active = true
        ) THEN
          RAISE EXCEPTION '%: existing primary person role conflicts with manifest', v_cls_record_id;
        END IF;
      END IF;

      SELECT conversation.organization_id, conversation.person_id
        INTO v_existing_conversation_organization_id, v_existing_conversation_person_id
        FROM public.prospect_conversations AS conversation
       WHERE conversation.id = v_conversation_id;
      IF NOT FOUND
         OR v_existing_conversation_organization_id <> v_organization_id
         OR v_existing_conversation_person_id IS DISTINCT FROM v_person_id THEN
        RAISE EXCEPTION '%: existing conversation identity conflicts with source', v_cls_record_id;
      END IF;
      SELECT count(*) INTO v_source_association_count
        FROM public.prospect_conversation_sources AS association
       WHERE association.source_link_id = v_source_link_id;
      IF v_source_association_count <> 1 OR NOT EXISTS (
        SELECT 1
          FROM public.prospect_conversation_sources AS association
         WHERE association.source_link_id = v_source_link_id
           AND association.conversation_id = v_conversation_id
           AND association.is_primary = true
      ) THEN
        RAISE EXCEPTION '%: existing primary conversation/source association is inconsistent', v_cls_record_id;
      END IF;
      v_existing_count := v_existing_count + 1;
    ELSE
      SELECT event.source_link_id, event.conversation_id, event.source_system, event.source_record_key
        INTO v_event_source_link_id, v_event_conversation_id, v_event_source_system, v_event_source_record_key
        FROM public.prospect_source_provisioning_events AS event
       WHERE event.idempotency_key = v_idempotency_key;
      v_event_found := FOUND;
      IF v_event_found THEN
        RAISE EXCEPTION '%: idempotency key belongs to another source record', v_cls_record_id;
      END IF;
      v_absent_count := v_absent_count + 1;
    END IF;
  END LOOP;

  FOR v_record IN SELECT value FROM jsonb_array_elements(p_manifest->'records') LOOP
    v_cls_record_id := btrim(v_record->>'cls_record_id');
    v_arm := v_record->>'arm';
    v_idempotency_key := 'prospecting_control_plane:provision:' || v_cls_record_id || ':v1';
    v_effective_source_payload := jsonb_set(
      v_record->'source_payload',
      '{person_email_attribution}',
      coalesce(v_record->'person'->'email_attribution', 'null'::jsonb),
      true
    );
    SELECT source_link.id, event.conversation_id
      INTO v_source_link_id, v_conversation_id
      FROM public.prospect_source_links AS source_link
      JOIN public.prospect_source_provisioning_events AS event ON event.source_link_id = source_link.id
     WHERE source_link.source_system = 'prospecting_control_plane'
       AND source_link.source_record_key = v_cls_record_id;
    IF FOUND THEN
      v_receipts := v_receipts || jsonb_build_array(jsonb_build_object(
        'cls_record_id', v_cls_record_id, 'arm', v_arm, 'idempotency_key', v_idempotency_key,
        'state', 'existing', 'source_link_id', v_source_link_id, 'conversation_id', v_conversation_id
      ));
    ELSIF p_apply THEN
      SELECT result.source_link_id, result.conversation_id
        INTO v_source_link_id, v_conversation_id
        FROM public.provision_prospect_source_record(
          'prospecting_control_plane',
          v_cls_record_id,
          btrim(v_record->>'source_url'),
          v_effective_source_payload,
          btrim(v_record->'organization'->>'display_name'),
          nullif(btrim(v_record->'organization'->>'city'), ''),
          btrim(v_record->'organization'->>'website_url'),
          nullif(btrim(v_record->'person'->>'display_name'), ''),
          nullif(lower(btrim(v_record->'person'->>'primary_email')), ''),
          nullif(btrim(v_record->'person'->>'primary_phone'), ''),
          nullif(btrim(v_record->'person'->>'role_title'), ''),
          btrim(v_record->>'provisioning_basis'),
          v_idempotency_key,
          p_operator_id
        ) AS result;
      IF v_source_link_id IS NULL OR v_conversation_id IS NULL THEN
        RAISE EXCEPTION '%: provisioning returned no identity pair', v_cls_record_id;
      END IF;
      v_provisioned_count := v_provisioned_count + 1;
      v_receipts := v_receipts || jsonb_build_array(jsonb_build_object(
        'cls_record_id', v_cls_record_id, 'arm', v_arm, 'idempotency_key', v_idempotency_key,
        'state', 'provisioned', 'source_link_id', v_source_link_id, 'conversation_id', v_conversation_id
      ));
    ELSE
      v_receipts := v_receipts || jsonb_build_array(jsonb_build_object(
        'cls_record_id', v_cls_record_id, 'arm', v_arm, 'idempotency_key', v_idempotency_key,
        'state', 'absent', 'source_link_id', NULL, 'conversation_id', NULL
      ));
    END IF;
  END LOOP;

  SELECT count(*), count(event.id)
    INTO v_total_after, v_receipt_count
    FROM public.prospect_source_links AS source_link
    LEFT JOIN public.prospect_source_provisioning_events AS event ON event.source_link_id = source_link.id
   WHERE source_link.source_system = 'prospecting_control_plane'
     AND source_link.source_record_key IN (
       SELECT value->>'cls_record_id' FROM jsonb_array_elements(p_manifest->'records')
     );
  SELECT count(*) INTO v_activity_after
    FROM public.prospect_activities AS activity
    JOIN public.prospect_source_links AS source_link ON source_link.id = activity.source_link_id
   WHERE source_link.source_system = 'prospecting_control_plane'
     AND source_link.source_record_key IN (
       SELECT value->>'cls_record_id' FROM jsonb_array_elements(p_manifest->'records')
     );

  IF v_activity_after <> v_activity_before THEN
    RAISE EXCEPTION 'activity count changed during provisioning-only batch';
  END IF;
  IF jsonb_array_length(v_receipts) <> 100 THEN
    RAISE EXCEPTION 'batch must return exactly 100 record receipts';
  END IF;
  IF p_apply AND (v_total_after <> 100 OR v_receipt_count <> 100) THEN
    RAISE EXCEPTION 'post-apply source/provision receipt assertion failed';
  END IF;
  IF p_apply THEN
    SELECT count(DISTINCT source_link.organization_id), count(DISTINCT source_link.person_id),
           count(DISTINCT event.conversation_id), count(DISTINCT association.source_link_id)
      INTO v_organization_count, v_person_count, v_conversation_count, v_primary_association_count
      FROM public.prospect_source_links AS source_link
      JOIN public.prospect_source_provisioning_events AS event ON event.source_link_id = source_link.id
      JOIN public.prospect_conversation_sources AS association
        ON association.source_link_id = source_link.id
       AND association.conversation_id = event.conversation_id
       AND association.is_primary = true
     WHERE source_link.source_system = 'prospecting_control_plane'
       AND source_link.source_record_key IN (
         SELECT value->>'cls_record_id' FROM jsonb_array_elements(p_manifest->'records')
       );
    SELECT count(*) INTO v_expected_person_count
      FROM jsonb_array_elements(p_manifest->'records') AS record
     WHERE record->'person' IS NOT NULL AND jsonb_typeof(record->'person') <> 'null';
    IF v_organization_count <> 100
       OR v_person_count <> v_expected_person_count
       OR v_conversation_count <> 100
       OR v_primary_association_count <> 100 THEN
      RAISE EXCEPTION 'post-apply canonical identity cardinality assertion failed';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM jsonb_array_elements(p_manifest->'records') AS manifest_record(record)
        LEFT JOIN public.prospect_source_links AS source_link
          ON source_link.source_system = 'prospecting_control_plane'
         AND source_link.source_record_key = manifest_record.record->>'cls_record_id'
        LEFT JOIN public.prospect_organizations AS organization ON organization.id = source_link.organization_id
        LEFT JOIN public.prospect_people AS person ON person.id = source_link.person_id
        LEFT JOIN public.prospect_source_provisioning_events AS event ON event.source_link_id = source_link.id
        LEFT JOIN public.prospect_conversations AS conversation ON conversation.id = event.conversation_id
        LEFT JOIN public.prospect_conversation_sources AS association
          ON association.source_link_id = source_link.id
         AND association.conversation_id = event.conversation_id
         AND association.is_primary = true
       WHERE source_link.id IS NULL
          OR source_link.active IS DISTINCT FROM true
          OR organization.id IS NULL
          OR organization.display_name IS DISTINCT FROM btrim(manifest_record.record->'organization'->>'display_name')
          OR organization.city IS DISTINCT FROM nullif(btrim(manifest_record.record->'organization'->>'city'), '')
          OR organization.website_url IS DISTINCT FROM nullif(btrim(manifest_record.record->'organization'->>'website_url'), '')
          OR event.id IS NULL
          OR event.conversation_id IS NULL
          OR event.source_system IS DISTINCT FROM 'prospecting_control_plane'
          OR event.source_record_key IS DISTINCT FROM manifest_record.record->>'cls_record_id'
          OR event.idempotency_key IS DISTINCT FROM 'prospecting_control_plane:provision:' || (manifest_record.record->>'cls_record_id') || ':v1'
          OR conversation.id IS NULL
          OR conversation.organization_id IS DISTINCT FROM source_link.organization_id
          OR conversation.person_id IS DISTINCT FROM source_link.person_id
          OR association.source_link_id IS NULL
          OR (
            (manifest_record.record->'person' IS NULL OR jsonb_typeof(manifest_record.record->'person') = 'null')
            AND (source_link.person_id IS NOT NULL OR person.id IS NOT NULL OR EXISTS (
              SELECT 1 FROM public.prospect_person_firm_roles AS role
               WHERE role.organization_id = source_link.organization_id
            ))
          )
          OR (
            manifest_record.record->'person' IS NOT NULL
            AND jsonb_typeof(manifest_record.record->'person') <> 'null'
            AND (
              person.id IS NULL
              OR person.display_name IS DISTINCT FROM btrim(manifest_record.record->'person'->>'display_name')
              OR person.primary_email IS DISTINCT FROM nullif(lower(btrim(manifest_record.record->'person'->>'primary_email')), '')
              OR person.primary_phone IS DISTINCT FROM nullif(btrim(manifest_record.record->'person'->>'primary_phone'), '')
              OR (SELECT count(*) FROM public.prospect_person_firm_roles AS role
                   WHERE role.organization_id = source_link.organization_id) <> 1
              OR NOT EXISTS (
                SELECT 1 FROM public.prospect_person_firm_roles AS role
                 WHERE role.organization_id = source_link.organization_id
                   AND role.person_id = source_link.person_id
                   AND role.role_title IS NOT DISTINCT FROM nullif(btrim(manifest_record.record->'person'->>'role_title'), '')
                   AND role.is_primary = true
                   AND role.active = true
              )
            )
          )
          OR (SELECT count(*) FROM public.prospect_conversation_sources AS source_association
               WHERE source_association.source_link_id = source_link.id) <> 1
          OR (SELECT count(*) FROM public.prospect_source_provisioning_events AS source_event
               WHERE source_event.source_link_id = source_link.id) <> 1
    ) THEN
      RAISE EXCEPTION 'post-apply organization/person/role/conversation/association bijection assertion failed';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'mode', CASE WHEN p_apply THEN 'apply' ELSE 'dry-run' END,
    'source_system', 'prospecting_control_plane',
    'counts', jsonb_build_object(
      'input', 100, 'BA', v_ba_count, 'AE', v_ae_count,
      'existing', v_existing_count, 'absent', v_absent_count,
      'provisioned', v_provisioned_count, 'total_after', v_total_after,
      'activities_before', v_activity_before, 'activities_after', v_activity_after
    ),
    'assertions', jsonb_build_object(
      'exact_record_count', true,
      'exact_arm_split', true,
      'canonical_bijection_after_apply', CASE WHEN p_apply THEN to_jsonb(true) ELSE to_jsonb('not_applicable_dry_run'::text) END,
      'activity_count_unchanged', true,
      'transaction', CASE WHEN p_apply THEN 'rpc_atomic_apply' ELSE 'rpc_read_only' END
    ),
    'records', v_receipts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.provision_prospect_source_batch(jsonb, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provision_prospect_source_batch(jsonb, uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.provision_prospect_source_batch(jsonb, uuid, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.provision_prospect_source_batch(jsonb, uuid, boolean) TO service_role;

COMMENT ON FUNCTION public.provision_prospect_source_batch(jsonb, uuid, boolean) IS
  'Service-only, dry-run-first atomic provisioning of the exact 50 BA and 50 AE Control Plane cohort. Does not log activities, send messages, or merge identities.';
