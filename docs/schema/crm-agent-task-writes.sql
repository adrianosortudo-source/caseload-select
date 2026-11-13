-- REVIEW DRAFT. Not in supabase/migrations; NOT applied or activated.
-- Requires existing agency CRM/templates and 20261024171116 follow-up identity locks.
-- No seeded identities/grants.
BEGIN;
CREATE TABLE public.crm_agent_identities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_key text NOT NULL CHECK(project_key='caseload-select'),
 enabled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.crm_agent_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid NOT NULL REFERENCES public.crm_agent_identities,
 mode text NOT NULL CHECK(mode IN('synthetic','production')), origin text NOT NULL,
 workflow_sha text NOT NULL CHECK(workflow_sha ~ '^[a-f0-9]{40}$'),
 approval_ref text NOT NULL CHECK(approval_ref ~ '^[A-Za-z0-9._:/-]{1,200}$'),
 version text NOT NULL CHECK(version ~ '^[a-f0-9]{32}$'), enabled boolean NOT NULL DEFAULT false,
 plan jsonb NOT NULL CHECK(jsonb_typeof(plan)='array' AND jsonb_array_length(plan) BETWEEN 1 AND 100 AND octet_length(plan::text)<=1000000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 run_id text, run_attempt text, job_deadline timestamptz,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '1 hour'),
 CHECK(mode<>'production' OR (origin='https://admin.caseloadselect.ca' AND jsonb_array_length(plan)<=10)),
 CHECK(mode<>'synthetic' OR origin ~ '^https?://(localhost|127[.]0[.]0[.]1|\[::1\])(:[0-9]+)?$')
);
CREATE TABLE public.crm_agent_task_sessions (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'), task_id uuid NOT NULL REFERENCES public.crm_agent_tasks,
 grant_version text NOT NULL, jti_hash text NOT NULL UNIQUE CHECK(jti_hash ~ '^[a-f0-9]{64}$'),
 issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false
);
CREATE INDEX crm_agent_tasks_agent_idx ON public.crm_agent_tasks(agent_id);
CREATE INDEX crm_agent_task_sessions_task_idx ON public.crm_agent_task_sessions(task_id);
CREATE TABLE public.crm_agent_task_receipts (
 task_id uuid NOT NULL REFERENCES public.crm_agent_tasks, operation_id uuid NOT NULL,
 result jsonb NOT NULL, completed_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(task_id,operation_id)
);
CREATE TABLE public.crm_agent_task_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, task_id uuid NOT NULL REFERENCES public.crm_agent_tasks,
 agent_id uuid NOT NULL REFERENCES public.crm_agent_identities, operation_id uuid,
 event text NOT NULL CHECK(event IN('session_issued','session_rotated','operation_completed','task_enabled','task_revoked','identity_enabled','identity_revoked')),
 resource text, action text, record_id uuid, run_id text NOT NULL, run_attempt text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.crm_agent_synthetic_records (
 task_id uuid NOT NULL REFERENCES public.crm_agent_tasks, resource text NOT NULL CHECK(resource IN('prospect','deal','reminder')),
 record_id uuid NOT NULL, PRIMARY KEY(resource,record_id)
);
CREATE INDEX crm_agent_task_audit_task_idx ON public.crm_agent_task_audit(task_id,id);

-- A draft has exactly one explicit author type. Existing operator inserts still work.
ALTER TABLE public.agency_followup_template_versions ADD COLUMN created_by_agent_id uuid REFERENCES public.crm_agent_identities;
ALTER TABLE public.agency_followup_template_versions ALTER COLUMN created_by_operator_id DROP NOT NULL;
ALTER TABLE public.agency_followup_template_versions ADD CONSTRAINT agency_followup_template_one_author
 CHECK((created_by_operator_id IS NULL)<>(created_by_agent_id IS NULL));

CREATE FUNCTION public.crm_agent_task_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 -- Activation/revocation and internal run binding may change; scope never changes in place.
 IF (to_jsonb(NEW)-ARRAY['enabled','run_id','run_attempt','job_deadline']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['enabled','run_id','run_attempt','job_deadline']) THEN
   RAISE EXCEPTION 'crm_task_immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_agent_task_immutable BEFORE UPDATE ON public.crm_agent_tasks
 FOR EACH ROW EXECUTE FUNCTION public.crm_agent_task_immutable();

CREATE FUNCTION public.crm_agent_task_control_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.enabled=OLD.enabled THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='crm_agent_tasks' THEN
  IF NOT NEW.enabled THEN UPDATE public.crm_agent_task_sessions SET revoked=true WHERE task_id=NEW.id; END IF;
  INSERT INTO public.crm_agent_task_audit(task_id,agent_id,event,run_id,run_attempt)
   VALUES(NEW.id,NEW.agent_id,CASE WHEN NEW.enabled THEN 'task_enabled' ELSE 'task_revoked' END,coalesce(NEW.run_id,'unbound'),coalesce(NEW.run_attempt,'unbound'));
 ELSE
  IF NOT NEW.enabled THEN UPDATE public.crm_agent_task_sessions SET revoked=true WHERE task_id IN(SELECT id FROM public.crm_agent_tasks WHERE agent_id=NEW.id); END IF;
  INSERT INTO public.crm_agent_task_audit(task_id,agent_id,event,run_id,run_attempt)
   SELECT id,agent_id,CASE WHEN NEW.enabled THEN 'identity_enabled' ELSE 'identity_revoked' END,coalesce(run_id,'unbound'),coalesce(run_attempt,'unbound') FROM public.crm_agent_tasks WHERE agent_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_agent_task_control_audit AFTER UPDATE OF enabled ON public.crm_agent_tasks
 FOR EACH ROW EXECUTE FUNCTION public.crm_agent_task_control_audit();
CREATE TRIGGER crm_agent_identity_control_audit AFTER UPDATE OF enabled ON public.crm_agent_identities
 FOR EACH ROW EXECUTE FUNCTION public.crm_agent_task_control_audit();

CREATE FUNCTION public.crm_agent_task_authorize(p_task_id uuid,p_token_hash text,p_origin text,p_mode text)
RETURNS public.crm_agent_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.crm_agent_tasks; s public.crm_agent_task_sessions;
BEGIN
 -- Serialize requests with task revocation and each other. Identity row lock serializes its revocation too.
 SELECT * INTO t FROM public.crm_agent_tasks WHERE id=p_task_id FOR NO KEY UPDATE;
 IF t.id IS NULL OR NOT t.enabled OR t.mode IS DISTINCT FROM p_mode OR t.origin IS DISTINCT FROM p_origin OR t.expires_at<=clock_timestamp()
  OR t.job_deadline IS NULL OR t.job_deadline<=clock_timestamp() THEN RAISE EXCEPTION 'crm_task_denied'; END IF;
 PERFORM 1 FROM public.crm_agent_identities WHERE id=t.agent_id AND project_key='caseload-select' AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'crm_task_denied'; END IF;
 SELECT * INTO s FROM public.crm_agent_task_sessions WHERE token_hash=p_token_hash AND task_id=t.id FOR UPDATE;
 IF s.token_hash IS NULL OR s.revoked OR s.grant_version<>t.version OR s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'crm_task_denied'; END IF;
 RETURN t;
END $$;

CREATE FUNCTION public.crm_agent_task_issue(p_task_id uuid,p_token_hash text,p_previous_hash text,p_workflow_sha text,p_run_id text,p_run_attempt text,p_jti_hash text,p_origin text,p_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.crm_agent_tasks; s public.crm_agent_task_sessions; expiry timestamptz;
BEGIN
 SELECT * INTO t FROM public.crm_agent_tasks WHERE id=p_task_id FOR NO KEY UPDATE;
 IF t.id IS NULL OR NOT t.enabled OR t.mode IS DISTINCT FROM p_mode OR t.origin IS DISTINCT FROM p_origin OR t.expires_at<=clock_timestamp()
  OR t.workflow_sha IS DISTINCT FROM p_workflow_sha OR p_run_id !~ '^[1-9][0-9]{0,19}$' OR p_run_attempt !~ '^[1-9][0-9]{0,5}$'
  OR p_run_id IS NULL OR p_run_attempt IS NULL THEN RAISE EXCEPTION 'crm_task_denied'; END IF;
 PERFORM 1 FROM public.crm_agent_identities WHERE id=t.agent_id AND project_key='caseload-select' AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'crm_task_denied'; END IF;
 IF p_previous_hash IS NULL THEN
  IF t.run_id IS NOT NULL THEN RAISE EXCEPTION 'crm_task_already_bound'; END IF;
  UPDATE public.crm_agent_tasks SET run_id=p_run_id,run_attempt=p_run_attempt,job_deadline=least(expires_at,clock_timestamp()+interval '1 hour') WHERE id=t.id RETURNING * INTO t;
 ELSE
  SELECT * INTO t FROM public.crm_agent_task_authorize(p_task_id,p_previous_hash,p_origin,p_mode);
  SELECT * INTO s FROM public.crm_agent_task_sessions WHERE token_hash=p_previous_hash;
  IF t.run_id<>p_run_id OR t.run_attempt<>p_run_attempt OR s.issued_at>clock_timestamp()-interval '10 minutes' THEN RAISE EXCEPTION 'crm_task_rotation_denied'; END IF;
  UPDATE public.crm_agent_task_sessions SET revoked=true WHERE token_hash=p_previous_hash;
 END IF;
 expiry:=least(t.expires_at,t.job_deadline,clock_timestamp()+interval '15 minutes');
 INSERT INTO public.crm_agent_task_sessions(token_hash,task_id,grant_version,jti_hash,issued_at,expires_at)
  VALUES(p_token_hash,t.id,t.version,p_jti_hash,clock_timestamp(),expiry);
 INSERT INTO public.crm_agent_task_audit(task_id,agent_id,event,run_id,run_attempt)
  VALUES(t.id,t.agent_id,CASE WHEN p_previous_hash IS NULL THEN 'session_issued' ELSE 'session_rotated' END,t.run_id,t.run_attempt);
 RETURN jsonb_build_object('expiresAt',floor(extract(epoch FROM expiry)*1000));
END $$;

CREATE FUNCTION public.crm_agent_task_verify(p_task_id uuid,p_token_hash text,p_origin text,p_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.crm_agent_tasks;
BEGIN
 t:=public.crm_agent_task_authorize(p_task_id,p_token_hash,p_origin,p_mode);
 RETURN jsonb_build_object('expiresAt',(SELECT floor(extract(epoch FROM expires_at)*1000) FROM public.crm_agent_task_sessions WHERE token_hash=p_token_hash));
END $$;
CREATE FUNCTION public.crm_agent_task_plan(p_task_id uuid,p_token_hash text,p_origin text,p_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.crm_agent_tasks;
BEGIN
 t:=public.crm_agent_task_authorize(p_task_id,p_token_hash,p_origin,p_mode);
 RETURN jsonb_build_object('taskId',t.id,'operations',t.plan);
END $$;

CREATE FUNCTION public.crm_agent_task_execute(p_task_id uuid,p_token_hash text,p_operation_id uuid,p_request jsonb,p_origin text,p_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE t public.crm_agent_tasks; item jsonb; approved jsonb; prior jsonb; output jsonb; vals jsonb; expected jsonb;
 resource text; action text; record_id uuid; allowed text[]; full_fields text[]; k text; missing boolean;
 p public.agency_prospects; d public.agency_deals; r public.agency_reminders; row_data jsonb; changed integer;
version_number integer; content_hash text; trim_chars text;
BEGIN
 t:=public.crm_agent_task_authorize(p_task_id,p_token_hash,p_origin,p_mode);
 IF p_request IS NULL OR jsonb_typeof(p_request)<>'object' OR octet_length(p_request::text)>40000 THEN RAISE EXCEPTION 'crm_task_invalid'; END IF;
 -- Exact semantic JSON match, operation order and one receipt. No client-selected expansion.
 FOR item IN SELECT value FROM jsonb_array_elements(t.plan) LOOP
  IF (item->>'id')::uuid=p_operation_id THEN approved:=item->'request'; EXIT; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_agent_task_receipts WHERE task_id=t.id AND operation_id=(item->>'id')::uuid) THEN RAISE EXCEPTION 'crm_task_operation_order'; END IF;
 END LOOP;
 IF approved IS NULL OR approved<>p_request THEN RAISE EXCEPTION 'crm_task_manifest_mismatch'; END IF;
 SELECT result INTO prior FROM public.crm_agent_task_receipts WHERE task_id=t.id AND operation_id=p_operation_id;
 IF FOUND THEN RETURN prior; END IF;
 resource:=p_request->>'resource'; action:=p_request->>'action'; record_id:=(p_request->>'id')::uuid;
 IF record_id IS NULL OR resource IS NULL OR action IS NULL THEN RAISE EXCEPTION 'crm_task_invalid'; END IF;
 vals:=coalesce(p_request->'values','{}'::jsonb); expected:=coalesce(p_request->'expected','{}'::jsonb);
 IF jsonb_typeof(vals)<>'object' OR jsonb_typeof(expected)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_request) x WHERE x NOT IN('resource','action','id','values','expected')) THEN RAISE EXCEPTION 'crm_task_invalid'; END IF;
 IF resource='template_draft' THEN
  IF action<>'create' OR expected<>'{}'::jsonb OR
   (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(vals) x)<>ARRAY['body','expected_version','subject','template_key'] THEN RAISE EXCEPTION 'crm_task_draft_invalid'; END IF;
  IF jsonb_typeof(vals->'body')<>'string' OR jsonb_typeof(vals->'subject')<>'string' OR jsonb_typeof(vals->'template_key')<>'string'
   OR jsonb_typeof(vals->'expected_version') IS DISTINCT FROM 'number' OR vals->>'expected_version' !~ '^(0|[1-9][0-9]{0,8})$'
   OR length(vals->>'template_key') NOT BETWEEN 1 AND 120 OR length(btrim(vals->>'subject')) NOT BETWEEN 1 AND 1000 OR length(btrim(vals->>'body')) NOT BETWEEN 1 AND 20000 THEN RAISE EXCEPTION 'crm_task_draft_invalid'; END IF;
  -- Serialize version assignment with agent and operator writers, including empty keys.
  LOCK TABLE public.agency_followup_template_versions IN SHARE ROW EXCLUSIVE MODE;
  SELECT coalesce(max(version),0) INTO version_number FROM public.agency_followup_template_versions WHERE template_key=vals->>'template_key';
  IF version_number IS DISTINCT FROM (vals->>'expected_version')::integer THEN RAISE EXCEPTION 'crm_task_conflict'; END IF;
  -- Same canonical JSON as agencyFollowupContentHash: ordered body, channel, subject.
  -- JavaScript trim/\s includes these Unicode spaces, independent of database locale.
  SELECT string_agg(chr(c),'') INTO trim_chars FROM unnest(ARRAY[9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279]) c;
  content_hash:=encode(sha256(convert_to('{"body":'||to_json(replace(btrim(vals->>'body',trim_chars),E'\r\n',E'\n'))::text||',"channel":"email","subject":'||to_json(regexp_replace(btrim(vals->>'subject',trim_chars),'['||trim_chars||']+',' ','g'))::text||'}','UTF8')),'hex');
  INSERT INTO public.agency_followup_template_versions(id,template_key,version,channel,subject,body,content_sha256,state,created_by_operator_id,created_by_agent_id)
   VALUES(record_id,vals->>'template_key',version_number+1,'email',btrim(vals->>'subject',trim_chars),btrim(vals->>'body',trim_chars),content_hash,'draft',NULL,t.agent_id);
 ELSE
  IF resource='prospect' THEN
   full_fields:=ARRAY['firm_name','contact_name','contact_email','contact_phone','city','practice_area','source','stage','fit_score','notes'];
   allowed:=CASE WHEN t.mode='production' THEN ARRAY['notes','fit_score','practice_area'] ELSE full_fields END;
  ELSIF resource='deal' THEN
   full_fields:=ARRAY['prospect_id','title','stage','monthly_value','expected_close','notes'];
   allowed:=CASE WHEN t.mode='production' THEN ARRAY['title','notes','expected_close','monthly_value'] ELSE full_fields END;
  ELSIF resource='reminder' THEN
   full_fields:=ARRAY['prospect_id','deal_id','due_at','note','done'];
   allowed:=CASE WHEN t.mode='production' THEN ARRAY['note','due_at','done'] ELSE full_fields END;
  ELSE RAISE EXCEPTION 'crm_task_resource_denied'; END IF;
  IF t.mode='production' AND action<>'update' THEN RAISE EXCEPTION 'crm_task_action_denied'; END IF;
  IF action NOT IN('create','read','update','delete') THEN RAISE EXCEPTION 'crm_task_action_denied'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(vals) x WHERE NOT x=ANY(allowed)) OR EXISTS(SELECT 1 FROM jsonb_each(vals) x WHERE octet_length(x.value::text)>20002) THEN RAISE EXCEPTION 'crm_task_field_denied'; END IF;
  -- Foreign keys are immutable after creation, including in a synthetic task.
  IF action='update' AND vals ?| ARRAY['prospect_id','deal_id'] THEN RAISE EXCEPTION 'crm_task_field_denied'; END IF;
  IF action='update' AND (vals='{}'::jsonb OR (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(vals) x) IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(expected) x)) THEN RAISE EXCEPTION 'crm_task_expected_required'; END IF;
  IF action='delete' AND (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(expected) x) IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(full_fields) x) THEN RAISE EXCEPTION 'crm_task_expected_required'; END IF;
  IF (action IN('read','delete') AND vals<>'{}'::jsonb) OR (action IN('read','create') AND expected<>'{}'::jsonb) THEN RAISE EXCEPTION 'crm_task_invalid'; END IF;
  IF t.mode='synthetic' AND action<>'create' AND NOT EXISTS(SELECT 1 FROM public.crm_agent_synthetic_records WHERE task_id=t.id AND crm_agent_synthetic_records.resource=resource AND crm_agent_synthetic_records.record_id=record_id) THEN RAISE EXCEPTION 'crm_task_ownership_denied'; END IF;
  IF t.mode='synthetic' AND action='create' THEN
   FOREACH k IN ARRAY ARRAY['prospect_id','deal_id'] LOOP
    IF vals->>k IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.crm_agent_synthetic_records o WHERE task_id=t.id AND o.resource=CASE WHEN k='prospect_id' THEN 'prospect' ELSE 'deal' END AND o.record_id=(vals->>k)::uuid) THEN RAISE EXCEPTION 'crm_task_ownership_denied'; END IF;
   END LOOP;
  END IF;
  IF action<>'create' THEN
   -- Existing human writers/provider handoff use catalog -> identity -> tuple.
   -- Acquire that order before our SELECT FOR UPDATE, not later in UPDATE's trigger.
   IF resource='prospect' THEN PERFORM public.lock_agency_followup_identity(record_id); END IF;
   IF resource='prospect' THEN SELECT to_jsonb(a) INTO row_data FROM public.agency_prospects a WHERE a.id=record_id FOR UPDATE;
   ELSIF resource='deal' THEN SELECT to_jsonb(a) INTO row_data FROM public.agency_deals a WHERE a.id=record_id FOR UPDATE;
   ELSE SELECT to_jsonb(a) INTO row_data FROM public.agency_reminders a WHERE a.id=record_id FOR UPDATE; END IF;
   IF row_data IS NULL OR NOT row_data @> expected THEN RAISE EXCEPTION 'crm_task_conflict'; END IF;
  END IF;
  IF action='read' THEN output:=jsonb_build_object('ok',true,'id',record_id,'record',row_data);
  ELSIF action='delete' THEN
   -- Never let ON DELETE CASCADE reach a dependent record, owned or otherwise.
   IF resource='prospect' AND (EXISTS(SELECT 1 FROM public.agency_deals WHERE prospect_id=record_id) OR EXISTS(SELECT 1 FROM public.agency_reminders WHERE prospect_id=record_id)) THEN RAISE EXCEPTION 'crm_task_dependency_denied'; END IF;
   IF resource='deal' AND EXISTS(SELECT 1 FROM public.agency_reminders WHERE deal_id=record_id) THEN RAISE EXCEPTION 'crm_task_dependency_denied'; END IF;
   IF resource='prospect' THEN DELETE FROM public.agency_prospects WHERE id=record_id;
   ELSIF resource='deal' THEN DELETE FROM public.agency_deals WHERE id=record_id;
   ELSE DELETE FROM public.agency_reminders WHERE id=record_id; END IF;
   DELETE FROM public.crm_agent_synthetic_records o WHERE o.resource=resource AND o.record_id=record_id;
  ELSE
   -- Explicit columns: adding a table column cannot silently expand an agent's write access.
   IF resource='prospect' THEN
    p:=jsonb_populate_record(NULL::public.agency_prospects,coalesce(row_data,'{"stage":"new"}'::jsonb)||vals);
    IF action='create' THEN INSERT INTO public.agency_prospects(id,firm_name,contact_name,contact_email,contact_phone,city,practice_area,source,stage,fit_score,notes) VALUES(record_id,p.firm_name,p.contact_name,p.contact_email,p.contact_phone,p.city,p.practice_area,p.source,p.stage,p.fit_score,p.notes);
    ELSIF t.mode='production' THEN UPDATE public.agency_prospects SET practice_area=p.practice_area,fit_score=p.fit_score,notes=p.notes,updated_at=clock_timestamp() WHERE id=record_id;
    ELSE UPDATE public.agency_prospects SET firm_name=p.firm_name,contact_name=p.contact_name,contact_email=p.contact_email,contact_phone=p.contact_phone,city=p.city,practice_area=p.practice_area,source=p.source,stage=p.stage,fit_score=p.fit_score,notes=p.notes,updated_at=clock_timestamp() WHERE id=record_id; END IF;
   ELSIF resource='deal' THEN
    d:=jsonb_populate_record(NULL::public.agency_deals,coalesce(row_data,'{"stage":"proposal"}'::jsonb)||vals);
    IF action='create' THEN INSERT INTO public.agency_deals(id,prospect_id,title,stage,monthly_value,expected_close,notes) VALUES(record_id,d.prospect_id,d.title,d.stage,d.monthly_value,d.expected_close,d.notes);
    ELSE UPDATE public.agency_deals SET title=d.title,stage=d.stage,monthly_value=d.monthly_value,expected_close=d.expected_close,notes=d.notes,updated_at=clock_timestamp() WHERE id=record_id; END IF;
   ELSE
    r:=jsonb_populate_record(NULL::public.agency_reminders,coalesce(row_data,'{"done":false}'::jsonb)||vals);
    IF action='create' THEN INSERT INTO public.agency_reminders(id,prospect_id,deal_id,due_at,note,done) VALUES(record_id,r.prospect_id,r.deal_id,r.due_at,r.note,r.done);
    ELSE UPDATE public.agency_reminders SET due_at=r.due_at,note=r.note,done=r.done WHERE id=record_id; END IF;
   END IF;
   IF action='create' THEN INSERT INTO public.crm_agent_synthetic_records VALUES(t.id,resource,record_id); END IF;
  END IF;
 END IF;
 output:=coalesce(output,jsonb_build_object('ok',true,'id',record_id));
 INSERT INTO public.crm_agent_task_receipts(task_id,operation_id,result) VALUES(t.id,p_operation_id,output);
 INSERT INTO public.crm_agent_task_audit(task_id,agent_id,operation_id,event,resource,action,record_id,run_id,run_attempt)
 VALUES(t.id,t.agent_id,p_operation_id,'operation_completed',resource,action,record_id,t.run_id,t.run_attempt);
 RETURN output;
EXCEPTION WHEN OTHERS THEN
 -- Do not let constraint/type/trigger DETAIL expose record values to provider error logs.
 -- Re-raise only our fixed denial vocabulary, without the original DETAIL or HINT.
 IF SQLSTATE='P0001' AND SQLERRM ~ '^crm_task_[a-z_]+$' THEN
  RAISE EXCEPTION '%',SQLERRM;
 END IF;
 RAISE EXCEPTION 'crm_task_rejected';
END $$;

-- No application API can create/activate tasks or identities. Control-plane provisioning is a separate approval.
REVOKE ALL ON SEQUENCE public.crm_agent_task_audit_id_seq FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE n text; f regprocedure; BEGIN
 FOREACH n IN ARRAY ARRAY['crm_agent_identities','crm_agent_tasks','crm_agent_task_sessions','crm_agent_task_receipts','crm_agent_task_audit','crm_agent_synthetic_records'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',n);
 END LOOP;
 -- Only the four fixed RPCs are exposed to the server's existing service role.
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'crm_agent_task_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);
  IF split_part(f::text,'(',1) IN('crm_agent_task_issue','crm_agent_task_verify','crm_agent_task_plan','crm_agent_task_execute') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f); END IF;
 END LOOP;
END $$;
COMMIT;
