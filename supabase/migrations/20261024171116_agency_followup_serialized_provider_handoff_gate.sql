-- Database-authoritative Agency provider handoff gate. It returns a point-in-time
-- authorization; the external provider request occurs after this transaction.

CREATE OR REPLACE FUNCTION public.agency_followup_js_ws()
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
 SELECT pg_catalog.chr(9)||pg_catalog.chr(10)||pg_catalog.chr(11)||pg_catalog.chr(12)||pg_catalog.chr(13)||pg_catalog.chr(32)||pg_catalog.chr(160)||pg_catalog.chr(5760)||pg_catalog.chr(8192)||pg_catalog.chr(8193)||pg_catalog.chr(8194)||pg_catalog.chr(8195)||pg_catalog.chr(8196)||pg_catalog.chr(8197)||pg_catalog.chr(8198)||pg_catalog.chr(8199)||pg_catalog.chr(8200)||pg_catalog.chr(8201)||pg_catalog.chr(8202)||pg_catalog.chr(8232)||pg_catalog.chr(8233)||pg_catalog.chr(8239)||pg_catalog.chr(8287)||pg_catalog.chr(12288)||pg_catalog.chr(65279)
$$;
CREATE OR REPLACE FUNCTION public.agency_followup_js_trim(p text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
 SELECT pg_catalog.btrim(p,public.agency_followup_js_ws())
$$;
CREATE OR REPLACE FUNCTION public.agency_followup_js_collapse(p text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
 SELECT pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.translate(p,public.agency_followup_js_ws(),pg_catalog.repeat(' ',pg_catalog.char_length(public.agency_followup_js_ws()))),' +',' ','g'),' ')
$$;

CREATE OR REPLACE FUNCTION public.agency_followup_canonical_json(p jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path = '' AS $$
DECLARE k text:=pg_catalog.jsonb_typeof(p); r text;
BEGIN
 IF k='object' THEN
  SELECT '{'||coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(x.key)::text||':'||public.agency_followup_canonical_json(x.value),',' ORDER BY x.key COLLATE "C"),'')||'}' INTO r FROM pg_catalog.jsonb_each(p) x(key,value);
  RETURN r;
 ELSIF k='array' THEN
  SELECT '['||coalesce(pg_catalog.string_agg(public.agency_followup_canonical_json(x.value),',' ORDER BY x.ordinality),'')||']' INTO r FROM pg_catalog.jsonb_array_elements(p) WITH ORDINALITY x(value,ordinality);
  RETURN r;
 END IF;
 RETURN p::text;
END $$;
CREATE OR REPLACE FUNCTION public.agency_followup_email_sha256(p text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = '' AS $$
 SELECT pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.lower(public.agency_followup_js_trim(p)),'UTF8'),'sha256'),'hex')
$$;
CREATE OR REPLACE FUNCTION public.agency_followup_content_sha256(c text,s text,b text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = '' AS $$
 SELECT pg_catalog.encode(extensions.digest(pg_catalog.convert_to(public.agency_followup_canonical_json(pg_catalog.jsonb_build_object('channel',c,'subject',public.agency_followup_js_collapse(s),'body',public.agency_followup_js_trim(pg_catalog.replace(b,E'\r\n',E'\n')))),'UTF8'),'sha256'),'hex')
$$;
CREATE OR REPLACE FUNCTION public.agency_followup_recipient_sha256(pid text,firm text,contact text,email text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
 SELECT pg_catalog.encode(extensions.digest(pg_catalog.convert_to(public.agency_followup_canonical_json(pg_catalog.jsonb_build_object('prospectId',pg_catalog.lower(public.agency_followup_js_trim(pid)),'firmName',pg_catalog.lower(public.agency_followup_js_collapse(firm)),'contactName',CASE WHEN contact IS NULL OR contact='' THEN NULL ELSE pg_catalog.lower(public.agency_followup_js_collapse(contact)) END,'contactEmail',pg_catalog.lower(public.agency_followup_js_trim(email)))),'UTF8'),'sha256'),'hex')
$$;

-- This low-volume CRM path uses one mapping-catalog mutex before resolving
-- identity relationships, then the per-prospect lock. It prevents a writer
-- from changing a source/conversation mapping while another trigger is
-- discovering which prospect identities it must serialize.
CREATE OR REPLACE FUNCTION public.lock_agency_followup_mapping_catalog()
RETURNS void LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
 SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('agency-followup-mapping-catalog',0))
$$;
-- UPDATE/DELETE row triggers run after PostgreSQL has locked the target tuple.
-- Acquire the catalog mutex at statement start so every mapping mutation obeys
-- catalog -> identity -> tuple lock order, avoiding gate/writer deadlocks.
CREATE OR REPLACE FUNCTION public.lock_agency_followup_mapping_catalog_before_statement()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
 PERFORM public.lock_agency_followup_mapping_catalog();
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION public.lock_agency_followup_identity(pid uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
 IF pid IS NULL THEN RAISE EXCEPTION 'invalid Agency follow-up identity lock scope'; END IF;
 PERFORM public.lock_agency_followup_mapping_catalog();
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('agency-followup-identity:'||pid::text,0));
END $$;
-- Compatibility signature for consent writers; all Agency rows now serialize
-- on the prospect identity regardless of source, conversation, or email hash.
CREATE OR REPLACE FUNCTION public.lock_agency_followup_opt_in_scope(pid uuid,sid uuid,cid uuid,email_hash text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
 IF pid IS NULL THEN RAISE EXCEPTION 'invalid Agency follow-up consent lock scope'; END IF;
 PERFORM public.lock_agency_followup_mapping_catalog();
 PERFORM public.lock_agency_followup_identity(pid);
END $$;

-- Serialize grants/withdrawals and dispatch on the prospect identity.
CREATE OR REPLACE FUNCTION public.record_agency_followup_opt_in_event(
 p_agency_prospect_id uuid,p_source_link_id uuid,p_conversation_id uuid,p_recipient_email_sha256 text,p_event_type text,p_captured_at timestamptz,p_capture_source text,p_consent_text_version text,p_consent_text_sha256 text,p_evidence_reference text,p_evidence_sha256 text,p_actor_operator_id uuid,p_idempotency_key text)
RETURNS TABLE(event_id uuid,replayed boolean) LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE added uuid; old public.agency_followup_opt_in_events%ROWTYPE;
BEGIN
 PERFORM public.lock_agency_followup_opt_in_scope(p_agency_prospect_id,p_source_link_id,p_conversation_id,p_recipient_email_sha256);
 INSERT INTO public.agency_followup_opt_in_events(agency_prospect_id,source_link_id,conversation_id,recipient_email_sha256,event_type,captured_at,capture_source,consent_text_version,consent_text_sha256,evidence_reference,evidence_sha256,actor_operator_id,idempotency_key)
 VALUES(p_agency_prospect_id,p_source_link_id,p_conversation_id,p_recipient_email_sha256,p_event_type,p_captured_at,p_capture_source,p_consent_text_version,p_consent_text_sha256,p_evidence_reference,p_evidence_sha256,p_actor_operator_id,p_idempotency_key)
 ON CONFLICT((btrim(idempotency_key))) DO NOTHING RETURNING id INTO added;
 IF added IS NOT NULL THEN RETURN QUERY SELECT added,false; RETURN; END IF;
 SELECT * INTO old FROM public.agency_followup_opt_in_events x WHERE x.idempotency_key=p_idempotency_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'Agency follow-up opt-in idempotent event could not be read'; END IF;
 IF old.agency_prospect_id IS DISTINCT FROM p_agency_prospect_id OR old.source_link_id IS DISTINCT FROM p_source_link_id OR old.conversation_id IS DISTINCT FROM p_conversation_id OR old.recipient_email_sha256 IS DISTINCT FROM p_recipient_email_sha256 OR old.channel IS DISTINCT FROM 'email' OR old.purpose IS DISTINCT FROM 'agency_followup_email' OR old.event_type IS DISTINCT FROM p_event_type OR old.captured_at IS DISTINCT FROM p_captured_at OR old.capture_source IS DISTINCT FROM p_capture_source OR old.consent_text_version IS DISTINCT FROM p_consent_text_version OR old.consent_text_sha256 IS DISTINCT FROM p_consent_text_sha256 OR old.evidence_reference IS DISTINCT FROM p_evidence_reference OR old.evidence_sha256 IS DISTINCT FROM p_evidence_sha256 OR old.actor_operator_id IS DISTINCT FROM p_actor_operator_id THEN RAISE EXCEPTION 'Agency follow-up opt-in idempotency key was reused with different event content'; END IF;
 RETURN QUERY SELECT old.id,true;
END $$;
REVOKE ALL ON FUNCTION public.lock_agency_followup_opt_in_scope(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lock_agency_followup_opt_in_scope(uuid,uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.lock_agency_followup_identity(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lock_agency_followup_identity(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.lock_agency_followup_mapping_catalog() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lock_agency_followup_mapping_catalog() TO service_role;
REVOKE ALL ON FUNCTION public.record_agency_followup_opt_in_event(uuid,uuid,uuid,text,text,timestamptz,text,text,text,text,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_agency_followup_opt_in_event(uuid,uuid,uuid,text,text,timestamptz,text,text,text,text,text,uuid,text) TO service_role;

-- BEFORE INSERT is intentional: webhook FKs must not be held while waiting for
-- the shared Agency prospect identity advisory lock.
CREATE OR REPLACE FUNCTION public.lock_agency_followup_opt_in_event_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
 PERFORM public.lock_agency_followup_opt_in_scope(NEW.agency_prospect_id,NEW.source_link_id,NEW.conversation_id,NEW.recipient_email_sha256);
 RETURN NEW;
END $$;
CREATE TRIGGER agency_followup_opt_in_events_00_lock_scope
 BEFORE INSERT ON public.agency_followup_opt_in_events
 FOR EACH ROW EXECUTE FUNCTION public.lock_agency_followup_opt_in_event_before_insert();

CREATE OR REPLACE FUNCTION public.lock_agency_followup_activity_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE row_scope record;
BEGIN
 PERFORM public.lock_agency_followup_mapping_catalog();
 FOR row_scope IN
  SELECT DISTINCT prospect.id AS prospect_id
  FROM public.prospect_conversation_sources association
  JOIN public.prospect_source_links source_link ON source_link.id=association.source_link_id
  JOIN public.agency_prospects prospect ON prospect.id::text=source_link.source_record_key
  WHERE association.conversation_id=NEW.conversation_id
    AND source_link.source_system IN ('agency_crm','agency_crm_contact')
    AND source_link.source_system=CASE WHEN EXISTS(
      SELECT 1 FROM public.prospect_source_links preferred
      WHERE preferred.source_system='agency_crm_contact'
        AND preferred.source_record_key=prospect.id::text
    ) THEN 'agency_crm_contact' ELSE 'agency_crm' END
  ORDER BY prospect.id,source_link.id
 LOOP
  PERFORM public.lock_agency_followup_identity(row_scope.prospect_id);
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER prospect_activities_00_lock_agency_identity
 BEFORE INSERT ON public.prospect_activities
 FOR EACH ROW EXECUTE FUNCTION public.lock_agency_followup_activity_before_insert();

CREATE OR REPLACE FUNCTION public.lock_agency_followup_provider_event_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE prospect_id uuid;
BEGIN
 IF NEW.processing_result IS DISTINCT FROM 'matched' OR NEW.conversation_id IS NULL OR NEW.source_link_id IS NULL THEN RETURN NEW; END IF;
 PERFORM public.lock_agency_followup_mapping_catalog();
 SELECT prospect.id INTO prospect_id
 FROM public.prospect_source_links source_link
 JOIN public.agency_prospects prospect ON prospect.id::text=source_link.source_record_key
 WHERE source_link.id=NEW.source_link_id
   AND source_link.source_system IN ('agency_crm','agency_crm_contact');
 IF prospect_id IS NOT NULL THEN PERFORM public.lock_agency_followup_identity(prospect_id); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agency_followup_provider_events_00_lock_scope
 BEFORE INSERT ON public.agency_followup_provider_events
 FOR EACH ROW EXECUTE FUNCTION public.lock_agency_followup_provider_event_before_insert();
REVOKE ALL ON FUNCTION public.lock_agency_followup_opt_in_event_before_insert() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.lock_agency_followup_activity_before_insert() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.lock_agency_followup_provider_event_before_insert() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lock_agency_followup_opt_in_event_before_insert() TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_agency_followup_activity_before_insert() TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_agency_followup_provider_event_before_insert() TO service_role;

CREATE OR REPLACE FUNCTION public.lock_agency_followup_identity_set(p_prospect_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE prospect_id uuid;
BEGIN
 IF coalesce(cardinality(p_prospect_ids),0)=0 THEN RETURN; END IF;
 PERFORM public.lock_agency_followup_mapping_catalog();
 FOR prospect_id IN SELECT DISTINCT item.id FROM pg_catalog.unnest(coalesce(p_prospect_ids,ARRAY[]::uuid[])) AS item(id) WHERE item.id IS NOT NULL ORDER BY item.id LOOP
  PERFORM public.lock_agency_followup_identity(prospect_id);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.lock_agency_followup_prospect_before_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE prospect_ids uuid[]:=ARRAY[]::uuid[];
BEGIN
 PERFORM public.lock_agency_followup_mapping_catalog();
 IF TG_OP<>'INSERT' THEN prospect_ids:=pg_catalog.array_append(prospect_ids,OLD.id); END IF;
 IF TG_OP<>'DELETE' THEN prospect_ids:=pg_catalog.array_append(prospect_ids,NEW.id); END IF;
 PERFORM public.lock_agency_followup_identity_set(prospect_ids);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agency_prospects_00_lock_agency_identity
 BEFORE INSERT OR UPDATE OR DELETE ON public.agency_prospects
 FOR EACH ROW EXECUTE FUNCTION public.lock_agency_followup_prospect_before_write();

CREATE OR REPLACE FUNCTION public.lock_agency_followup_source_link_before_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE prospect_ids uuid[]:=ARRAY[]::uuid[]; is_agency boolean;
BEGIN
 IF TG_OP<>'INSERT' AND OLD.source_system IN('agency_crm','agency_crm_contact') AND OLD.source_record_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN prospect_ids:=pg_catalog.array_append(prospect_ids,OLD.source_record_key::uuid); END IF;
 IF TG_OP<>'DELETE' AND NEW.source_system IN('agency_crm','agency_crm_contact') AND NEW.source_record_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN prospect_ids:=pg_catalog.array_append(prospect_ids,NEW.source_record_key::uuid); END IF;
 PERFORM public.lock_agency_followup_identity_set(prospect_ids);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER prospect_source_links_00_lock_agency_identity
 BEFORE INSERT OR UPDATE OR DELETE ON public.prospect_source_links
 FOR EACH ROW EXECUTE FUNCTION public.lock_agency_followup_source_link_before_write();

CREATE OR REPLACE FUNCTION public.lock_agency_followup_conversation_source_before_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE source_ids uuid[]:=ARRAY[]::uuid[]; prospect_ids uuid[]:=ARRAY[]::uuid[];
BEGIN
 PERFORM public.lock_agency_followup_mapping_catalog();
 IF TG_OP<>'INSERT' THEN source_ids:=pg_catalog.array_append(source_ids,OLD.source_link_id); END IF;
 IF TG_OP<>'DELETE' THEN source_ids:=pg_catalog.array_append(source_ids,NEW.source_link_id); END IF;
 SELECT coalesce(pg_catalog.array_agg(DISTINCT source_link.source_record_key::uuid ORDER BY source_link.source_record_key::uuid),ARRAY[]::uuid[])
 INTO prospect_ids FROM public.prospect_source_links source_link WHERE source_link.id=ANY(source_ids)
  AND source_link.source_system IN('agency_crm','agency_crm_contact')
  AND source_link.source_record_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
 PERFORM public.lock_agency_followup_identity_set(prospect_ids);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER prospect_conversation_sources_00_lock_agency_identity
 BEFORE INSERT OR UPDATE OR DELETE ON public.prospect_conversation_sources
 FOR EACH ROW EXECUTE FUNCTION public.lock_agency_followup_conversation_source_before_write();

CREATE OR REPLACE FUNCTION public.lock_agency_followup_contactability_before_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE conversation_ids uuid[]:=ARRAY[]::uuid[]; prospect_ids uuid[]:=ARRAY[]::uuid[];
BEGIN
 PERFORM public.lock_agency_followup_mapping_catalog();
 IF TG_OP<>'INSERT' THEN conversation_ids:=pg_catalog.array_append(conversation_ids,OLD.conversation_id); END IF;
 IF TG_OP<>'DELETE' THEN conversation_ids:=pg_catalog.array_append(conversation_ids,NEW.conversation_id); END IF;
 SELECT coalesce(pg_catalog.array_agg(DISTINCT source_link.source_record_key::uuid ORDER BY source_link.source_record_key::uuid),ARRAY[]::uuid[])
 INTO prospect_ids FROM public.prospect_conversation_sources association
 JOIN public.prospect_source_links source_link ON source_link.id=association.source_link_id
 WHERE association.conversation_id=ANY(conversation_ids)
  AND source_link.source_system IN('agency_crm','agency_crm_contact')
  AND source_link.source_record_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
 PERFORM public.lock_agency_followup_identity_set(prospect_ids);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER prospect_contactability_00_lock_agency_identity
 BEFORE INSERT OR UPDATE OR DELETE ON public.prospect_contactability
 FOR EACH ROW EXECUTE FUNCTION public.lock_agency_followup_contactability_before_write();

CREATE OR REPLACE FUNCTION public.lock_agency_followup_conversation_before_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE conversation_ids uuid[]:=ARRAY[]::uuid[]; prospect_ids uuid[]:=ARRAY[]::uuid[];
BEGIN
 PERFORM public.lock_agency_followup_mapping_catalog();
 IF TG_OP<>'INSERT' THEN conversation_ids:=pg_catalog.array_append(conversation_ids,OLD.id); END IF;
 IF TG_OP<>'DELETE' THEN conversation_ids:=pg_catalog.array_append(conversation_ids,NEW.id); END IF;
 SELECT coalesce(pg_catalog.array_agg(DISTINCT source_link.source_record_key::uuid ORDER BY source_link.source_record_key::uuid),ARRAY[]::uuid[])
 INTO prospect_ids FROM public.prospect_conversation_sources association
 JOIN public.prospect_source_links source_link ON source_link.id=association.source_link_id
 WHERE association.conversation_id=ANY(conversation_ids)
  AND source_link.source_system IN('agency_crm','agency_crm_contact')
  AND source_link.source_record_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
 PERFORM public.lock_agency_followup_identity_set(prospect_ids);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER prospect_conversations_00_lock_agency_identity
 BEFORE INSERT OR UPDATE OR DELETE ON public.prospect_conversations
 FOR EACH ROW EXECUTE FUNCTION public.lock_agency_followup_conversation_before_write();

CREATE OR REPLACE FUNCTION public.lock_agency_followup_suppression_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE prospect_ids uuid[]:=ARRAY[]::uuid[];
BEGIN
 PERFORM public.lock_agency_followup_mapping_catalog();
 SELECT coalesce(pg_catalog.array_agg(DISTINCT source_link.source_record_key::uuid ORDER BY source_link.source_record_key::uuid),ARRAY[]::uuid[])
 INTO prospect_ids FROM public.prospect_conversation_sources association
 JOIN public.prospect_source_links source_link ON source_link.id=association.source_link_id
 WHERE association.conversation_id=NEW.conversation_id
  AND source_link.source_system IN('agency_crm','agency_crm_contact')
  AND source_link.source_record_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
 PERFORM public.lock_agency_followup_identity_set(prospect_ids);
 RETURN NEW;
END $$;
CREATE TRIGGER prospect_contactability_provider_suppressions_00_lock_agency_identity
 BEFORE INSERT ON public.prospect_contactability_provider_suppressions
 FOR EACH ROW EXECUTE FUNCTION public.lock_agency_followup_suppression_before_insert();

CREATE OR REPLACE FUNCTION public.lock_agency_followup_person_before_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE person_ids uuid[]:=ARRAY[]::uuid[]; prospect_ids uuid[]:=ARRAY[]::uuid[];
BEGIN
 PERFORM public.lock_agency_followup_mapping_catalog();
 IF TG_OP<>'INSERT' THEN person_ids:=pg_catalog.array_append(person_ids,OLD.id); END IF;
 IF TG_OP<>'DELETE' THEN person_ids:=pg_catalog.array_append(person_ids,NEW.id); END IF;
 SELECT coalesce(pg_catalog.array_agg(DISTINCT source_link.source_record_key::uuid ORDER BY source_link.source_record_key::uuid),ARRAY[]::uuid[])
 INTO prospect_ids FROM public.prospect_source_links source_link
 WHERE source_link.person_id=ANY(person_ids)
  AND source_link.source_system IN('agency_crm','agency_crm_contact')
  AND source_link.source_record_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
 PERFORM public.lock_agency_followup_identity_set(prospect_ids);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER prospect_people_00_lock_agency_identity
 BEFORE INSERT OR UPDATE OR DELETE ON public.prospect_people
 FOR EACH ROW EXECUTE FUNCTION public.lock_agency_followup_person_before_write();

CREATE OR REPLACE FUNCTION public.lock_agency_followup_person_role_before_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE person_ids uuid[]:=ARRAY[]::uuid[]; organization_ids uuid[]:=ARRAY[]::uuid[]; prospect_ids uuid[]:=ARRAY[]::uuid[];
BEGIN
 PERFORM public.lock_agency_followup_mapping_catalog();
 IF TG_OP<>'INSERT' THEN person_ids:=pg_catalog.array_append(person_ids,OLD.person_id); organization_ids:=pg_catalog.array_append(organization_ids,OLD.organization_id); END IF;
 IF TG_OP<>'DELETE' THEN person_ids:=pg_catalog.array_append(person_ids,NEW.person_id); organization_ids:=pg_catalog.array_append(organization_ids,NEW.organization_id); END IF;
 SELECT coalesce(pg_catalog.array_agg(DISTINCT source_link.source_record_key::uuid ORDER BY source_link.source_record_key::uuid),ARRAY[]::uuid[])
 INTO prospect_ids FROM public.prospect_source_links source_link
 WHERE source_link.person_id=ANY(person_ids) AND source_link.organization_id=ANY(organization_ids)
  AND source_link.source_system IN('agency_crm','agency_crm_contact')
  AND source_link.source_record_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
 PERFORM public.lock_agency_followup_identity_set(prospect_ids);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER prospect_person_firm_roles_00_lock_agency_identity
 BEFORE INSERT OR UPDATE OR DELETE ON public.prospect_person_firm_roles
 FOR EACH ROW EXECUTE FUNCTION public.lock_agency_followup_person_role_before_write();

CREATE TRIGGER agency_prospects_00_lock_agency_catalog
 BEFORE INSERT OR UPDATE OR DELETE ON public.agency_prospects
 FOR EACH STATEMENT EXECUTE FUNCTION public.lock_agency_followup_mapping_catalog_before_statement();
CREATE TRIGGER prospect_source_links_00_lock_agency_catalog
 BEFORE INSERT OR UPDATE OR DELETE ON public.prospect_source_links
 FOR EACH STATEMENT EXECUTE FUNCTION public.lock_agency_followup_mapping_catalog_before_statement();
CREATE TRIGGER prospect_conversation_sources_00_lock_agency_catalog
 BEFORE INSERT OR UPDATE OR DELETE ON public.prospect_conversation_sources
 FOR EACH STATEMENT EXECUTE FUNCTION public.lock_agency_followup_mapping_catalog_before_statement();
CREATE TRIGGER prospect_contactability_00_lock_agency_catalog
 BEFORE INSERT OR UPDATE OR DELETE ON public.prospect_contactability
 FOR EACH STATEMENT EXECUTE FUNCTION public.lock_agency_followup_mapping_catalog_before_statement();
CREATE TRIGGER prospect_conversations_00_lock_agency_catalog
 BEFORE INSERT OR UPDATE OR DELETE ON public.prospect_conversations
 FOR EACH STATEMENT EXECUTE FUNCTION public.lock_agency_followup_mapping_catalog_before_statement();
CREATE TRIGGER prospect_contactability_provider_suppressions_00_lock_agency_catalog
 BEFORE INSERT OR UPDATE OR DELETE ON public.prospect_contactability_provider_suppressions
 FOR EACH STATEMENT EXECUTE FUNCTION public.lock_agency_followup_mapping_catalog_before_statement();
CREATE TRIGGER prospect_people_00_lock_agency_catalog
 BEFORE INSERT OR UPDATE OR DELETE ON public.prospect_people
 FOR EACH STATEMENT EXECUTE FUNCTION public.lock_agency_followup_mapping_catalog_before_statement();
CREATE TRIGGER prospect_person_firm_roles_00_lock_agency_catalog
 BEFORE INSERT OR UPDATE OR DELETE ON public.prospect_person_firm_roles
 FOR EACH STATEMENT EXECUTE FUNCTION public.lock_agency_followup_mapping_catalog_before_statement();
CREATE TRIGGER prospect_activities_00_lock_agency_catalog
 BEFORE INSERT OR UPDATE OR DELETE ON public.prospect_activities
 FOR EACH STATEMENT EXECUTE FUNCTION public.lock_agency_followup_mapping_catalog_before_statement();
CREATE TRIGGER agency_followup_provider_events_00_lock_agency_catalog
 BEFORE INSERT OR UPDATE OR DELETE ON public.agency_followup_provider_events
 FOR EACH STATEMENT EXECUTE FUNCTION public.lock_agency_followup_mapping_catalog_before_statement();
CREATE TRIGGER agency_followup_opt_in_events_00_lock_agency_catalog
 BEFORE INSERT OR UPDATE OR DELETE ON public.agency_followup_opt_in_events
 FOR EACH STATEMENT EXECUTE FUNCTION public.lock_agency_followup_mapping_catalog_before_statement();

REVOKE ALL ON FUNCTION public.lock_agency_followup_mapping_catalog_before_statement() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.lock_agency_followup_identity_set(uuid[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.lock_agency_followup_prospect_before_write() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.lock_agency_followup_source_link_before_write() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.lock_agency_followup_conversation_source_before_write() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.lock_agency_followup_contactability_before_write() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.lock_agency_followup_conversation_before_write() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.lock_agency_followup_suppression_before_insert() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.lock_agency_followup_person_before_write() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.lock_agency_followup_person_role_before_write() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lock_agency_followup_identity_set(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_agency_followup_mapping_catalog_before_statement() TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_agency_followup_prospect_before_write() TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_agency_followup_source_link_before_write() TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_agency_followup_conversation_source_before_write() TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_agency_followup_contactability_before_write() TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_agency_followup_conversation_before_write() TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_agency_followup_suppression_before_insert() TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_agency_followup_person_before_write() TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_agency_followup_person_role_before_write() TO service_role;

CREATE OR REPLACE FUNCTION public.authorize_agency_followup_provider_handoff(
 p_message_id uuid,p_enrollment_id uuid,p_lease_owner text,p_attempt_count integer,p_lease_seconds integer DEFAULT 120,p_max_idempotency_age_seconds integer DEFAULT 82800)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
 m public.agency_followup_messages%ROWTYPE; e public.agency_followup_enrollments%ROWTYPE; p public.agency_prospects%ROWTYPE;
 j public.agency_followup_journeys%ROWTYPE; s public.agency_followup_steps%ROWTYPE; t public.agency_followup_template_versions%ROWTYPE;
 src public.prospect_source_links%ROWTYPE; cv public.prospect_conversations%ROWTYPE; person public.prospect_people%ROWTYPE; ca public.prospect_contactability%ROWTYPE; reviewer public.firm_lawyers%ROWTYPE;
 src_system text; nsrc integer:=0; nassoc integer:=0; cid uuid; identity_prospect_id uuid; association_invalid boolean:=false; hash_email_now text; recipient_hash text; prior_at timestamptz; first_used timestamptz; retry_at timestamptz; spacing_at timestamptz; prior_unresolved boolean:=false; prior_pending boolean:=false; now_at timestamptz:=clock_timestamp(); local_now timestamp without time zone; blockers text[]:=ARRAY[]::text[];
BEGIN
 IF p_message_id IS NULL OR p_enrollment_id IS NULL OR p_lease_owner IS NULL OR char_length(btrim(p_lease_owner)) NOT BETWEEN 1 AND 200 OR p_attempt_count IS NULL OR p_attempt_count<1 OR p_lease_seconds NOT BETWEEN 10 AND 900 OR p_max_idempotency_age_seconds NOT BETWEEN 3600 AND 82800 THEN RAISE EXCEPTION 'invalid Agency follow-up provider handoff request'; END IF;
 -- Nonlocking lookup only derives the broad identity lock. Re-read all facts under locks.
 PERFORM public.lock_agency_followup_mapping_catalog();
 SELECT en.prospect_id INTO identity_prospect_id FROM public.agency_followup_enrollments en JOIN public.agency_followup_messages msg ON msg.enrollment_id=en.id WHERE en.id=p_enrollment_id AND msg.id=p_message_id;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result','stale'); END IF;
 PERFORM public.lock_agency_followup_identity(identity_prospect_id);
 SELECT * INTO p FROM public.agency_prospects WHERE id=identity_prospect_id FOR SHARE;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result','blocked','blockers',pg_catalog.jsonb_build_array('contactability_unknown')); END IF;
 SELECT * INTO e FROM public.agency_followup_enrollments WHERE id=p_enrollment_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result','stale'); END IF;
 IF e.prospect_id IS DISTINCT FROM identity_prospect_id THEN RETURN pg_catalog.jsonb_build_object('result','blocked','blockers',pg_catalog.jsonb_build_array('contactability_unknown')); END IF;
 src_system:=CASE WHEN EXISTS(SELECT 1 FROM public.prospect_source_links x WHERE x.source_system='agency_crm_contact' AND x.source_record_key=identity_prospect_id::text) THEN 'agency_crm_contact' ELSE 'agency_crm' END;
 PERFORM 1 FROM public.prospect_source_links x WHERE x.source_system=src_system AND x.source_record_key=identity_prospect_id::text ORDER BY x.id FOR SHARE;
 SELECT count(*) INTO nsrc FROM public.prospect_source_links x WHERE x.source_system=src_system AND x.source_record_key=identity_prospect_id::text AND x.active AND x.person_id IS NOT NULL;
 IF nsrc=1 THEN
  SELECT * INTO src FROM public.prospect_source_links x WHERE x.source_system=src_system AND x.source_record_key=identity_prospect_id::text AND x.active AND x.person_id IS NOT NULL;
  PERFORM 1 FROM public.prospect_conversation_sources a WHERE a.source_link_id=src.id ORDER BY a.conversation_id FOR SHARE;
  SELECT count(*) INTO nassoc FROM public.prospect_conversation_sources a WHERE a.source_link_id=src.id;
  IF nassoc=1 THEN SELECT a.conversation_id INTO cid FROM public.prospect_conversation_sources a WHERE a.source_link_id=src.id; ELSE association_invalid:=true; END IF;
 ELSE association_invalid:=true;
 END IF;
 IF nsrc=1 AND nassoc=1 THEN
  SELECT * INTO src FROM public.prospect_source_links WHERE id=src.id FOR SHARE;
  SELECT * INTO person FROM public.prospect_people WHERE id=src.person_id FOR SHARE;
  PERFORM 1 FROM public.prospect_person_firm_roles r WHERE r.organization_id=src.organization_id AND r.person_id=src.person_id AND r.active ORDER BY r.id FOR SHARE;
  SELECT * INTO cv FROM public.prospect_conversations WHERE id=cid FOR SHARE;
  SELECT * INTO ca FROM public.prospect_contactability WHERE conversation_id=cid FOR NO KEY UPDATE;
 END IF;
 SELECT * INTO m FROM public.agency_followup_messages WHERE id=p_message_id AND enrollment_id=p_enrollment_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result','stale'); END IF;
 now_at:=clock_timestamp();
 IF m.state IS DISTINCT FROM 'claimed' OR m.lease_owner IS DISTINCT FROM btrim(p_lease_owner) OR m.attempt_count IS DISTINCT FROM p_attempt_count OR m.lease_until IS NULL OR m.lease_until<=now_at THEN RETURN pg_catalog.jsonb_build_object('result','stale'); END IF;
 IF association_invalid THEN RETURN pg_catalog.jsonb_build_object('result','blocked','blockers',pg_catalog.jsonb_build_array('contactability_unknown')); END IF;
 SELECT * INTO p FROM public.agency_prospects WHERE id=e.prospect_id;
 SELECT * INTO j FROM public.agency_followup_journeys WHERE id=e.journey_id FOR SHARE;
 SELECT * INTO s FROM public.agency_followup_steps WHERE id=m.step_id FOR SHARE;
 SELECT * INTO t FROM public.agency_followup_template_versions WHERE id=m.template_version_id FOR SHARE;
 IF m.reviewed_by_operator_id IS NOT NULL THEN SELECT * INTO reviewer FROM public.firm_lawyers WHERE id=m.reviewed_by_operator_id FOR SHARE; END IF;
 hash_email_now:=public.agency_followup_email_sha256(p.contact_email);
 IF nsrc<>1 OR nassoc<>1 OR src.id IS NULL OR cv.id IS NULL OR src.active IS DISTINCT FROM true OR src.source_system IS DISTINCT FROM src_system OR src.source_record_key IS DISTINCT FROM e.prospect_id::text OR src.organization_id IS NULL OR src.person_id IS NULL OR person.id IS NULL OR person.primary_email IS NULL OR p.contact_email IS NULL OR public.agency_followup_email_sha256(person.primary_email) IS DISTINCT FROM hash_email_now OR cv.organization_id IS DISTINCT FROM src.organization_id OR cv.person_id IS DISTINCT FROM src.person_id OR NOT EXISTS(SELECT 1 FROM public.prospect_person_firm_roles r WHERE r.organization_id=src.organization_id AND r.person_id=src.person_id AND r.active) THEN blockers:=pg_catalog.array_append(blockers,'contactability_unknown'); END IF;
 IF ca.conversation_id IS NULL THEN blockers:=pg_catalog.array_append(blockers,'contactability_unknown'); ELSIF ca.state IS DISTINCT FROM 'eligible' THEN blockers:=pg_catalog.array_append(blockers,'contactability_blocked'); END IF;
 IF cv.id IS NOT NULL AND EXISTS(SELECT 1 FROM public.prospect_contactability_provider_suppressions x WHERE x.conversation_id=cv.id) THEN blockers:=pg_catalog.array_append(blockers,'contactability_blocked'); END IF;
 IF cv.status IN('replied','unreachable','declined','meeting_scheduled','completed') OR (cv.id IS NOT NULL AND EXISTS(SELECT 1 FROM public.prospect_activities a WHERE a.conversation_id=cv.id AND a.kind IN('human_reply','meeting','bounce'))) THEN blockers:=pg_catalog.array_append(blockers,'conversation_stopped'); END IF;
 IF p.stage IN('won','lost') THEN blockers:=pg_catalog.array_append(blockers,'prospect_status_stopped'); END IF;
 IF e.state IS DISTINCT FROM 'active' OR e.released_at IS NULL OR e.released_by_operator_id IS NULL OR nullif(btrim(e.release_basis),'') IS NULL THEN blockers:=pg_catalog.array_append(blockers,'sequence_not_released'); END IF;
 IF e.eligibility_state IS DISTINCT FROM 'eligible' THEN blockers:=pg_catalog.array_append(blockers,'eligibility_not_approved'); END IF;
 IF nullif(btrim(e.eligibility_evidence_ref),'') IS NULL THEN blockers:=pg_catalog.array_append(blockers,'eligibility_evidence_missing'); END IF;
 IF p.contact_email IS NULL OR p.contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN blockers:=pg_catalog.array_append(blockers,'recipient_email_invalid'); END IF;
 IF p.id IS NULL OR nullif(public.agency_followup_js_collapse(p.firm_name),'') IS NULL THEN blockers:=pg_catalog.array_append(blockers,'recipient_identity_missing'); END IF;
 IF src.id IS NOT NULL AND cv.id IS NOT NULL AND hash_email_now IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.agency_followup_current_opt_ins o WHERE o.agency_prospect_id=p.id AND o.source_link_id=src.id AND o.conversation_id=cv.id AND o.recipient_email_sha256=hash_email_now AND o.purpose='agency_followup_email' AND o.event_type='opt_in_granted') THEN
   IF EXISTS(SELECT 1 FROM public.agency_followup_current_opt_ins o WHERE o.agency_prospect_id=p.id AND o.source_link_id=src.id AND o.conversation_id=cv.id AND o.recipient_email_sha256=hash_email_now AND o.purpose='agency_followup_email' AND o.event_type='opt_in_withdrawn') THEN blockers:=pg_catalog.array_append(blockers,'explicit_opt_in_withdrawn'); ELSE blockers:=pg_catalog.array_append(blockers,'explicit_opt_in_missing'); END IF;
  END IF;
 ELSE blockers:=pg_catalog.array_append(blockers,'explicit_opt_in_missing'); END IF;
 recipient_hash:=public.agency_followup_recipient_sha256(p.id::text,p.firm_name,p.contact_name,p.contact_email);
 IF m.recipient_email_snapshot IS DISTINCT FROM e.recipient_email_snapshot OR public.agency_followup_email_sha256(m.recipient_email_snapshot) IS DISTINCT FROM hash_email_now OR m.recipient_name_snapshot IS DISTINCT FROM e.recipient_name_snapshot OR m.recipient_name_snapshot IS DISTINCT FROM p.contact_name OR m.recipient_sha256 IS DISTINCT FROM recipient_hash OR e.recipient_sha256 IS DISTINCT FROM recipient_hash OR m.approved_recipient_sha256 IS DISTINCT FROM recipient_hash THEN blockers:=pg_catalog.array_append(blockers,'approval_stale_recipient'); END IF;
 IF m.reviewed_by_operator_id IS NULL OR m.reviewed_at IS NULL THEN blockers:=pg_catalog.array_append(blockers,'approval_missing'); END IF;
 IF reviewer.id IS NULL OR reviewer.role IS DISTINCT FROM 'operator' OR reviewer.disabled IS DISTINCT FROM false OR m.reviewed_at IS NULL OR m.reviewed_at>now_at THEN blockers:=pg_catalog.array_append(blockers,'approval_invalid_reviewer_or_time'); END IF;
 IF m.approved_content_sha256 IS NULL OR m.approved_content_sha256 IS DISTINCT FROM m.content_sha256 THEN blockers:=pg_catalog.array_append(blockers,'approval_stale_content'); END IF;
 IF s.id IS NULL OR j.id IS NULL OR t.id IS NULL OR s.journey_id IS DISTINCT FROM j.id OR s.template_version_id IS DISTINCT FROM t.id OR s.step_number IS DISTINCT FROM m.step_number OR t.channel IS DISTINCT FROM 'email' OR t.state IS DISTINCT FROM 'approved' OR t.approved_by_operator_id IS NULL OR t.approved_at IS NULL OR jsonb_typeof(m.content_snapshot) IS DISTINCT FROM 'object' OR jsonb_typeof(m.content_snapshot->'channel') IS DISTINCT FROM 'string' OR jsonb_typeof(m.content_snapshot->'subject') IS DISTINCT FROM 'string' OR jsonb_typeof(m.content_snapshot->'body') IS DISTINCT FROM 'string' OR m.content_snapshot-ARRAY['channel','subject','body']::text[]<>'{}'::jsonb OR m.content_snapshot->>'channel' IS DISTINCT FROM t.channel OR m.content_snapshot->>'subject' IS DISTINCT FROM t.subject OR m.content_snapshot->>'body' IS DISTINCT FROM t.body OR m.content_sha256 IS DISTINCT FROM public.agency_followup_content_sha256(m.content_snapshot->>'channel',m.content_snapshot->>'subject',m.content_snapshot->>'body') OR t.content_sha256 IS DISTINCT FROM m.content_sha256 THEN blockers:=pg_catalog.array_append(blockers,'approval_stale_content'); END IF;
 PERFORM 1 FROM public.agency_followup_messages pm WHERE pm.enrollment_id=e.id AND pm.step_number<m.step_number ORDER BY pm.step_number,pm.id FOR SHARE;
 SELECT coalesce(bool_or(pm.id IS NULL OR (pm.state='accepted' AND pm.provider_accepted_at IS NULL) OR (pm.state='scheduled' AND pm.scheduled_at IS NULL) OR (pm.state='claimed' AND (pm.lease_until IS NULL OR pm.lease_until<=now_at)) OR pm.state NOT IN('accepted','scheduled','claimed')),false),
        coalesce(bool_or(pm.state='scheduled' OR (pm.state='claimed' AND pm.lease_until>now_at)),false),
        max(CASE WHEN pm.state='scheduled' THEN pm.scheduled_at WHEN pm.state='claimed' THEN pm.lease_until END)
 INTO prior_unresolved,prior_pending,retry_at
 FROM public.agency_followup_steps ps LEFT JOIN public.agency_followup_messages pm ON pm.enrollment_id=e.id AND pm.step_id=ps.id
 WHERE ps.journey_id=j.id AND ps.step_number<s.step_number;
 IF prior_unresolved THEN blockers:=pg_catalog.array_append(blockers,'previous_step_unresolved'); END IF;
 SELECT max(pm.provider_accepted_at) INTO prior_at FROM public.agency_followup_messages pm WHERE pm.enrollment_id=e.id AND pm.step_number<m.step_number AND pm.state='accepted' AND pm.provider_accepted_at IS NOT NULL;
 IF m.scheduled_at IS NULL THEN blockers:=pg_catalog.array_append(blockers,'invalid_schedule'); ELSIF m.scheduled_at>now_at THEN blockers:=pg_catalog.array_append(blockers,'not_due'); END IF;
 IF j.timezone IS NULL OR j.timezone='' OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name=j.timezone) OR cardinality(j.business_days) NOT BETWEEN 1 AND 7 OR j.local_window_end<=j.local_window_start THEN blockers:=pg_catalog.array_append(blockers,'invalid_schedule'); ELSE local_now:=now_at AT TIME ZONE j.timezone; IF NOT(extract(isodow FROM local_now)::integer=ANY(j.business_days)) OR local_now::time<j.local_window_start OR local_now::time>=j.local_window_end THEN blockers:=pg_catalog.array_append(blockers,'outside_send_window'); END IF; END IF;
 IF prior_at IS NOT NULL THEN IF j.minimum_spacing_hours<0 THEN blockers:=pg_catalog.array_append(blockers,'invalid_schedule'); ELSIF now_at<prior_at+pg_catalog.make_interval(hours=>j.minimum_spacing_hours) THEN blockers:=pg_catalog.array_append(blockers,'minimum_spacing_not_elapsed'); END IF; END IF;
 IF prior_pending AND blockers <@ ARRAY['not_due','minimum_spacing_not_elapsed']::text[] THEN
  spacing_at:=CASE WHEN prior_at IS NOT NULL AND j.minimum_spacing_hours>=0 THEN prior_at+pg_catalog.make_interval(hours=>j.minimum_spacing_hours) END;
  retry_at:=greatest(coalesce(retry_at,now_at+interval '1 second'),coalesce(spacing_at,now_at),coalesce(m.scheduled_at,now_at));

  RETURN pg_catalog.jsonb_build_object('result','deferred','blocker','previous_step_pending','retryAt',retry_at);
 END IF;
 IF blockers <@ ARRAY['not_due','minimum_spacing_not_elapsed']::text[] AND cardinality(blockers)>0 AND 'minimum_spacing_not_elapsed'=ANY(blockers) THEN
  retry_at:=prior_at+pg_catalog.make_interval(hours=>j.minimum_spacing_hours);

  RETURN pg_catalog.jsonb_build_object('result','deferred','blocker','minimum_spacing_not_elapsed','retryAt',retry_at);
 END IF;
 IF cardinality(blockers)=1 AND blockers[1]='not_due' THEN
  RETURN pg_catalog.jsonb_build_object('result','deferred','blocker','not_due','retryAt',m.scheduled_at);
 END IF;
 IF cardinality(blockers)>0 THEN
  SELECT pg_catalog.array_agg(DISTINCT b ORDER BY b) INTO blockers FROM pg_catalog.unnest(blockers) b;

  RETURN pg_catalog.jsonb_build_object('result','blocked','blockers',pg_catalog.to_jsonb(blockers));
 END IF;
 first_used:=coalesce(m.provider_idempotency_first_used_at,now_at);
 IF now_at>=first_used+pg_catalog.make_interval(secs=>p_max_idempotency_age_seconds) THEN
  UPDATE public.agency_followup_messages SET state='unknown',scheduled_at=NULL,lease_owner=NULL,lease_until=NULL,unknown_since=now_at,last_error_code='resend_idempotency_window_expired',updated_at=now_at WHERE id=p_message_id AND enrollment_id=p_enrollment_id AND state='claimed' AND lease_owner=btrim(p_lease_owner) AND attempt_count=p_attempt_count AND lease_until>now_at;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result','stale'); END IF;
  INSERT INTO public.agency_followup_events(enrollment_id,message_id,event_type,idempotency_key,event_payload,occurred_at) VALUES(p_enrollment_id,p_message_id,'provider_unknown','resend-window-expired:'||p_message_id::text,pg_catalog.jsonb_build_object('detail','resend_idempotency_window_expired','automaticRetry',false,'firstProviderUseAt',first_used),now_at) ON CONFLICT(idempotency_key) DO NOTHING;
  RETURN pg_catalog.jsonb_build_object('result','expired','code','resend_idempotency_window_expired');
 END IF;
 UPDATE public.agency_followup_messages SET provider_idempotency_first_used_at=coalesce(provider_idempotency_first_used_at,now_at),lease_until=greatest(lease_until,now_at+pg_catalog.make_interval(secs=>p_lease_seconds)),updated_at=now_at WHERE id=p_message_id AND enrollment_id=p_enrollment_id AND state='claimed' AND lease_owner=btrim(p_lease_owner) AND attempt_count=p_attempt_count AND lease_until>now_at RETURNING provider_idempotency_first_used_at INTO first_used;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result','stale'); END IF;
 RETURN pg_catalog.jsonb_build_object('result','ready','request',pg_catalog.jsonb_build_object('idempotencyKey',m.provider_idempotency_key,'recipientEmail',p.contact_email,'subject',m.content_snapshot->>'subject','body',m.content_snapshot->>'body'),'messageId',m.id,'enrollmentId',e.id,'attemptCount',m.attempt_count,'recipientEmailHash',hash_email_now,'preparedAt',now_at,'firstProviderUseAt',first_used);
END $$;
REVOKE ALL ON FUNCTION public.authorize_agency_followup_provider_handoff(uuid,uuid,text,integer,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_agency_followup_provider_handoff(uuid,uuid,text,integer,integer,integer) TO service_role;

-- Later live steps are claimable only after all configured earlier steps accepted.
CREATE OR REPLACE FUNCTION public.claim_agency_followup_live_messages(p_worker_id text,p_now timestamptz,p_lease_seconds integer,p_limit integer,p_allowed_enrollment_ids uuid[])
RETURNS SETOF public.agency_followup_messages LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
 IF p_worker_id IS NULL OR char_length(btrim(p_worker_id)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'worker id is required'; END IF;
 IF p_now IS NULL THEN RAISE EXCEPTION 'claim time is required'; END IF;
 IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 900 THEN RAISE EXCEPTION 'invalid lease duration'; END IF;
 IF p_limit IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'live mode may claim exactly one message'; END IF;
 IF p_allowed_enrollment_ids IS NULL OR cardinality(p_allowed_enrollment_ids) NOT BETWEEN 1 AND 100 OR array_position(p_allowed_enrollment_ids,NULL::uuid) IS NOT NULL THEN RAISE EXCEPTION 'live enrollment allowlist is invalid'; END IF;
 WITH expired AS(UPDATE public.agency_followup_messages SET state='unknown',unknown_since=p_now,last_error_code='lease_expired_outcome_unknown',lease_owner=NULL,lease_until=NULL,updated_at=p_now WHERE state='claimed' AND lease_until<=p_now AND enrollment_id=ANY(p_allowed_enrollment_ids) RETURNING id,enrollment_id)
 INSERT INTO public.agency_followup_events(enrollment_id,message_id,event_type,idempotency_key,event_payload) SELECT expired.enrollment_id,expired.id,'provider_unknown','lease-expired:'||expired.id::text,pg_catalog.jsonb_build_object('reason','lease_expired_outcome_unknown','observedAt',p_now) FROM expired ON CONFLICT(idempotency_key) DO NOTHING;
 WITH unresolved AS(
  UPDATE public.agency_followup_messages message SET state='blocked',scheduled_at=NULL,last_error_code='previous_step_unresolved',updated_at=p_now
  FROM public.agency_followup_enrollments enrollment,public.agency_followup_steps step
  WHERE message.enrollment_id=enrollment.id AND step.id=message.step_id AND step.journey_id=enrollment.journey_id
   AND message.state='scheduled' AND message.enrollment_id=ANY(p_allowed_enrollment_ids)
   AND EXISTS(SELECT 1 FROM public.agency_followup_steps prior_step LEFT JOIN public.agency_followup_messages prior_message ON prior_message.enrollment_id=message.enrollment_id AND prior_message.step_id=prior_step.id
    WHERE prior_step.journey_id=enrollment.journey_id AND prior_step.step_number<step.step_number
     AND (prior_message.id IS NULL OR (prior_message.state='accepted' AND prior_message.provider_accepted_at IS NULL) OR (prior_message.state='scheduled' AND prior_message.scheduled_at IS NULL) OR (prior_message.state='claimed' AND (prior_message.lease_until IS NULL OR prior_message.lease_until<=p_now)) OR prior_message.state NOT IN('accepted','scheduled','claimed')))
  RETURNING message.id,message.enrollment_id
 )
 INSERT INTO public.agency_followup_events(enrollment_id,message_id,event_type,idempotency_key,event_payload,occurred_at)
 SELECT unresolved.enrollment_id,unresolved.id,'message_blocked','previous-step-unresolved:'||unresolved.id::text,pg_catalog.jsonb_build_object('blockers',pg_catalog.jsonb_build_array('previous_step_unresolved'),'checkedAt',p_now),p_now
 FROM unresolved ON CONFLICT(idempotency_key) DO NOTHING;
 RETURN QUERY WITH candidates AS(
  SELECT message.id FROM public.agency_followup_messages message JOIN public.agency_followup_enrollments enrollment ON enrollment.id=message.enrollment_id JOIN public.agency_followup_steps step ON step.id=message.step_id
  WHERE message.state='scheduled' AND message.scheduled_at<=p_now AND message.enrollment_id=ANY(p_allowed_enrollment_ids) AND step.journey_id=enrollment.journey_id AND step.step_number=message.step_number
   AND NOT EXISTS(SELECT 1 FROM public.agency_followup_steps prior_step LEFT JOIN public.agency_followup_messages prior_message ON prior_message.enrollment_id=message.enrollment_id AND prior_message.step_id=prior_step.id WHERE prior_step.journey_id=enrollment.journey_id AND prior_step.step_number<step.step_number AND (prior_message.id IS NULL OR prior_message.state IS DISTINCT FROM 'accepted' OR prior_message.provider_accepted_at IS NULL))
  ORDER BY message.scheduled_at,message.created_at,message.id FOR UPDATE OF message SKIP LOCKED LIMIT 1)
 UPDATE public.agency_followup_messages message SET state='claimed',lease_owner=btrim(p_worker_id),lease_until=p_now+pg_catalog.make_interval(secs=>p_lease_seconds),attempt_count=message.attempt_count+1,updated_at=p_now FROM candidates WHERE message.id=candidates.id RETURNING message.*;
END $$;
REVOKE ALL ON FUNCTION public.claim_agency_followup_live_messages(text,timestamptz,integer,integer,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_agency_followup_live_messages(text,timestamptz,integer,integer,uuid[]) TO service_role;

REVOKE ALL ON FUNCTION public.agency_followup_js_ws() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.agency_followup_js_trim(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.agency_followup_js_collapse(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.agency_followup_canonical_json(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.agency_followup_email_sha256(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.agency_followup_content_sha256(text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.agency_followup_recipient_sha256(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agency_followup_js_ws() TO service_role;
GRANT EXECUTE ON FUNCTION public.agency_followup_js_trim(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agency_followup_js_collapse(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agency_followup_canonical_json(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.agency_followup_email_sha256(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agency_followup_content_sha256(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agency_followup_recipient_sha256(text,text,text,text) TO service_role;
COMMENT ON FUNCTION public.authorize_agency_followup_provider_handoff(uuid,uuid,text,integer,integer,integer) IS 'Service-role-only point-in-time final provider gate. HTTP delivery remains outside the database transaction.';


-- Accept the terminal predecessor blocker emitted by the serialized gate and live claim.
CREATE OR REPLACE FUNCTION public.persist_agency_followup_disposition(
  p_message_id uuid,
  p_enrollment_id uuid,
  p_lease_owner text,
  p_attempt_count integer,
  p_disposition jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_state text;
  v_event_type text;
  v_at timestamptz;
  v_scheduled_at timestamptz;
  v_accepted_at timestamptz;
  v_provider_message_id text;
  v_recipient_email_sha256 text;
  v_error_code text;
  v_blockers jsonb;
  v_enrollment_id uuid;
  v_payload jsonb;
BEGIN
  IF p_message_id IS NULL OR p_enrollment_id IS NULL
     OR p_lease_owner IS NULL OR char_length(btrim(p_lease_owner)) NOT BETWEEN 1 AND 200
     OR p_attempt_count IS NULL OR p_attempt_count < 1
     OR p_disposition IS NULL OR jsonb_typeof(p_disposition) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid Agency follow-up disposition request';
  END IF;
  v_state := p_disposition->>'state';
  IF v_state IS NULL OR v_state NOT IN ('blocked', 'accepted', 'scheduled', 'failed', 'unknown') THEN
    RAISE EXCEPTION 'unsupported Agency follow-up disposition state';
  END IF;
  v_at := (p_disposition->>'at')::timestamptz;
  IF v_at IS NULL THEN RAISE EXCEPTION 'disposition timestamp is required'; END IF;

  IF v_state = 'blocked' THEN
    IF p_disposition - ARRAY['state', 'blockers', 'at']::text[] <> '{}'::jsonb
       OR jsonb_typeof(p_disposition->'blockers') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid blocked disposition';
    END IF;
    IF jsonb_array_length(p_disposition->'blockers') NOT BETWEEN 1 AND 30
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(p_disposition->'blockers') AS blocker(value)
         WHERE blocker.value NOT IN (
           'prospect_mismatch', 'recipient_identity_missing', 'recipient_email_invalid',
           'eligibility_pending', 'eligibility_unknown', 'eligibility_not_approved',
           'eligibility_evidence_missing', 'explicit_opt_in_missing',
           'explicit_opt_in_withdrawn', 'contactability_unknown', 'contactability_blocked',
           'conversation_stopped', 'prospect_status_stopped', 'sequence_not_released',
           'message_not_approved', 'approval_missing', 'approval_invalid_reviewer_or_time',
           'approval_stale_content', 'approval_stale_recipient', 'cancelled', 'invalid_schedule',
           'not_due', 'minimum_spacing_not_elapsed', 'previous_step_unresolved', 'outside_send_window',
           'send_mode_off', 'resend_api_key_missing', 'resend_webhook_secret_missing',
           'followup_sender_missing_or_unverified',
           'followup_reply_to_missing_or_unverified', 'test_recipient_allowlist_empty',
           'test_record_allowlist_empty_or_invalid', 'live_enrollment_allowlist_empty',
           'send_config_not_ready', 'logical_message_identity_invalid', 'send_target_invalid',
           'test_recipient_not_allowlisted', 'test_enrollment_message_recipient_not_allowlisted',
           'live_enrollment_not_allowlisted', 'followup_sender_or_reply_to_missing'
         )
       ) THEN RAISE EXCEPTION 'invalid blocked disposition'; END IF;
    v_event_type := 'message_blocked';
    v_blockers := p_disposition->'blockers';
    v_payload := jsonb_build_object('blockers', v_blockers, 'checkedAt', v_at);
  ELSIF v_state = 'accepted' THEN
    IF p_disposition - ARRAY['state', 'providerMessageId', 'recipientEmailHash', 'acceptedAt', 'at']::text[] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'invalid accepted disposition fields';
    END IF;
    v_provider_message_id := btrim(p_disposition->>'providerMessageId');
    IF char_length(v_provider_message_id) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid provider message id'; END IF;
    v_recipient_email_sha256 := p_disposition->>'recipientEmailHash';
    IF v_recipient_email_sha256 IS NULL OR v_recipient_email_sha256 !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'invalid recipient email fingerprint';
    END IF;
    v_accepted_at := (p_disposition->>'acceptedAt')::timestamptz;
    v_event_type := 'provider_accepted';
    v_payload := jsonb_build_object('providerMessageId', v_provider_message_id,
                                    'recipientEmailHash', v_recipient_email_sha256,
                                    'acceptedAt', v_accepted_at);
  ELSIF v_state = 'scheduled' THEN
    IF p_disposition - ARRAY['state', 'retryAt', 'errorCode', 'at']::text[] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'invalid scheduled disposition fields';
    END IF;
    v_scheduled_at := (p_disposition->>'retryAt')::timestamptz;
    v_error_code := p_disposition->>'errorCode';
    IF v_error_code IS NULL OR char_length(v_error_code) NOT BETWEEN 1 AND 300
       OR v_error_code !~ '^[A-Za-z0-9_.:-]+$' THEN RAISE EXCEPTION 'invalid retry error code'; END IF;
    v_event_type := 'provider_attempted';
    v_payload := jsonb_build_object('retryAt', v_scheduled_at, 'errorCode', v_error_code, 'sameIdempotencyKey', true);
  ELSIF v_state = 'failed' THEN
    IF p_disposition - ARRAY['state', 'errorCode', 'at']::text[] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'invalid failed disposition fields';
    END IF;
    v_error_code := p_disposition->>'errorCode';
    IF v_error_code IS NULL OR char_length(v_error_code) NOT BETWEEN 1 AND 300
       OR v_error_code !~ '^[A-Za-z0-9_.:-]+$' THEN RAISE EXCEPTION 'invalid failure error code'; END IF;
    v_event_type := 'provider_failed';
    v_payload := jsonb_build_object('errorCode', v_error_code);
  ELSE
    IF p_disposition - ARRAY['state', 'detail', 'at']::text[] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'invalid unknown disposition fields';
    END IF;
    v_error_code := p_disposition->>'detail';
    IF v_error_code IS NULL OR char_length(v_error_code) NOT BETWEEN 1 AND 300
       OR v_error_code !~ '^[A-Za-z0-9_.:-]+$' THEN RAISE EXCEPTION 'unknown disposition detail must be a sanitized code'; END IF;
    v_event_type := 'provider_unknown';
    v_payload := jsonb_build_object('detail', v_error_code, 'automaticRetry', false);
  END IF;

  UPDATE public.agency_followup_messages AS message
  SET state = v_state,
      scheduled_at = CASE WHEN v_state = 'scheduled' THEN v_scheduled_at
                          WHEN v_state IN ('blocked', 'failed', 'unknown') THEN NULL
                          ELSE message.scheduled_at END,
      provider_message_id = CASE WHEN v_state = 'accepted' THEN v_provider_message_id ELSE message.provider_message_id END,
      provider_accepted_at = CASE WHEN v_state = 'accepted' THEN v_accepted_at ELSE message.provider_accepted_at END,
      provider_recipient_email_sha256 = CASE WHEN v_state = 'accepted' THEN v_recipient_email_sha256 ELSE message.provider_recipient_email_sha256 END,
      provider_delivery_status = CASE WHEN v_state = 'accepted' THEN 'accepted' ELSE message.provider_delivery_status END,
      provider_delivery_status_at = CASE WHEN v_state = 'accepted' THEN v_accepted_at ELSE message.provider_delivery_status_at END,
      last_error_code = CASE WHEN v_state = 'blocked' THEN 'blocked_by_current_policy'
                             WHEN v_state IN ('scheduled', 'failed') THEN v_error_code
                             WHEN v_state = 'unknown' THEN v_error_code ELSE NULL END,
      unknown_since = CASE WHEN v_state = 'unknown' THEN v_at ELSE NULL END,
      lease_owner = NULL,
      lease_until = NULL,
      updated_at = v_at
  WHERE message.id = p_message_id
    AND message.enrollment_id = p_enrollment_id
    AND message.state = 'claimed'
    AND message.lease_owner = btrim(p_lease_owner)
    AND message.lease_until > clock_timestamp()
    AND message.attempt_count = p_attempt_count
  RETURNING message.enrollment_id INTO v_enrollment_id;
  IF NOT FOUND THEN RETURN false; END IF;

  v_payload := v_payload || jsonb_build_object('attemptCount', p_attempt_count, 'workerId', btrim(p_lease_owner));
  INSERT INTO public.agency_followup_events (
    enrollment_id, message_id, event_type, idempotency_key, event_payload, occurred_at
  ) VALUES (
    v_enrollment_id, p_message_id, v_event_type,
    'worker:' || p_message_id::text || ':' || p_attempt_count::text || ':' || v_event_type,
    v_payload, v_at
  );
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.persist_agency_followup_disposition(uuid,uuid,text,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persist_agency_followup_disposition(uuid,uuid,text,integer,jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.prepare_agency_followup_provider_attempt(uuid,uuid,text,integer,integer,integer) FROM service_role;
