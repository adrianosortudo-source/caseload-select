-- Isolated Voice AI -> SMS -> Screen journey. No existing voice tables change.
-- Version generated with Supabase CLI; application requires separate approval.
create table public.voice_screen_inquiries (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.intake_firms(id) on delete cascade,
  location_id text not null check (length(location_id) between 1 and 100),
  agent_id text not null check (length(agent_id) between 1 and 100),
  call_id text not null check (length(call_id) between 1 and 200),
  contact_id text check (contact_id is null or length(contact_id) between 1 and 200),
  caller_facts jsonb not null check (jsonb_typeof(caller_facts) = 'object'),
  engine_state jsonb not null check (jsonb_typeof(engine_state) = 'object'),
  answers jsonb not null default '[]'::jsonb check (jsonb_typeof(answers) = 'array'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- 32 random bytes, base64url. The bearer is HMAC(V2S_TOKEN_KEY, nonce);
  -- only its SHA-256 digest is stored, so neither nonce nor hash is a link.
  token_nonce text not null check (token_nonce ~ '^[A-Za-z0-9_-]{43}$'),
  expires_at timestamptz not null,
  ended_at timestamptz not null,
  revision integer not null default 0 check (revision >= 0),
  status text not null default 'open' check (status in ('open','partial','completed','stopped')),
  human_status text not null default 'pending' check (human_status in ('pending','taken_over')),
  invitation_eligible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, agent_id, call_id),
  check (expires_at > ended_at)
);
create index voice_screen_inquiries_firm_queue_idx on public.voice_screen_inquiries (firm_id, created_at desc);
create index voice_screen_inquiries_expiry_idx on public.voice_screen_inquiries (expires_at) where status in ('open','partial');

create table public.voice_screen_outbox (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null unique references public.voice_screen_inquiries(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','dispatching','sent','unknown','cancelled')),
  provider_message_id text,
  attempt_count integer not null default 0 check (attempt_count between 0 and 10),
  last_error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index voice_screen_outbox_pending_idx on public.voice_screen_outbox (created_at,id) where status='pending';
create index voice_screen_outbox_review_idx on public.voice_screen_outbox (updated_at desc) where status='unknown';

alter table public.voice_screen_inquiries enable row level security;
alter table public.voice_screen_inquiries force row level security;
alter table public.voice_screen_outbox enable row level security;
alter table public.voice_screen_outbox force row level security;
revoke all privileges on table public.voice_screen_inquiries from public,anon,authenticated,service_role;
revoke all privileges on table public.voice_screen_outbox from public,anon,authenticated,service_role;
grant select,insert,update on table public.voice_screen_inquiries to service_role;
grant select,insert,update on table public.voice_screen_outbox to service_role;

-- Immutable current-call ingest. Duplicate delivery returns the first row and
-- never replaces evidence. Eligibility is recomputed from current-call proof.
create function public.v2s_ingest(p_inquiry jsonb) returns jsonb
language plpgsql security invoker set search_path=''
as $$
declare
  v_id uuid := coalesce((p_inquiry->>'id')::uuid, gen_random_uuid());
  v_found uuid;
  v_firm uuid := (p_inquiry->>'firm_id')::uuid;
  v_location text := nullif(btrim(p_inquiry->>'location_id'),'');
  v_agent text := nullif(btrim(p_inquiry->>'agent_id'),'');
  v_call text := nullif(btrim(p_inquiry->>'call_id'),'');
  v_ended timestamptz := (p_inquiry->>'ended_at')::timestamptz;
  v_expires timestamptz := (p_inquiry->>'expires_at')::timestamptz;
  v_facts jsonb := coalesce(p_inquiry->'caller_facts','{}'::jsonb);
  v_permission_at timestamptz;
  v_phone text;
  v_eligible boolean;
begin
  if v_firm is null or v_location is null or v_agent is null or v_call is null or v_ended is null or v_expires is null then
    raise exception using errcode='22023', message='invalid_voice_screen_inquiry';
  end if;
  begin v_permission_at := (v_facts#>>'{permission,capturedAt}')::timestamptz;
  exception when invalid_datetime_format then v_permission_at := null; end;
  v_phone := v_facts#>>'{callback,number}';
  v_eligible := coalesce((
    coalesce((p_inquiry->>'invitation_eligible')::boolean,false)
    and v_facts->>'locationId'=v_location and v_facts->>'agentId'=v_agent and v_facts->>'callId'=v_call
    and (v_facts->>'endedAt')::timestamptz=v_ended
    and v_facts->>'endedAtSource' in ('provider_created_plus_duration','provider_ended_at')
    and v_facts->>'permissionCapturedAtSource'='call_end_bound'
    and v_facts->>'callerType'='new' and v_facts->>'urgency'='routine'
    and (v_facts->>'humanRequested')::boolean is false
    and v_facts#>>'{permission,value}'='granted' and v_facts#>>'{permission,callId}'=v_call
    and v_facts#>>'{safeToText,value}'='yes' and v_facts#>>'{safeToText,callId}'=v_call
    and v_facts#>>'{callback,verifiedOnCallId}'=v_call
    and v_facts#>>'{evidence,callId}'=v_call
    and length(btrim(v_facts#>>'{evidence,consentQuote}'))>=2
    and length(btrim(v_facts#>>'{evidence,safeToTextQuote}'))>=2
    and length(btrim(v_facts#>>'{evidence,callbackQuote}'))>=2
    and v_phone ~ '^\+[1-9][0-9]{7,14}$'
    and v_permission_at is not null and v_permission_at<=v_ended and v_permission_at>=v_ended-interval '1 hour'
    and v_expires>now()
  ),false);

  insert into public.voice_screen_inquiries
    (id,firm_id,location_id,agent_id,call_id,contact_id,caller_facts,engine_state,answers,
     token_hash,token_nonce,expires_at,ended_at,invitation_eligible)
  values
    (v_id,v_firm,v_location,v_agent,v_call,nullif(btrim(p_inquiry->>'contact_id'),''),v_facts,
     coalesce(p_inquiry->'engine_state','{}'::jsonb),coalesce(p_inquiry->'answers','[]'::jsonb),
     lower(p_inquiry->>'token_hash'),p_inquiry->>'token_nonce',v_expires,v_ended,v_eligible)
  on conflict (location_id,agent_id,call_id) do nothing returning id into v_found;
  if v_found is null then
    select id into v_found from public.voice_screen_inquiries
    where location_id=v_location and agent_id=v_agent and call_id=v_call;
    return jsonb_build_object('id',v_found,'created',false);
  end if;
  if v_eligible then insert into public.voice_screen_outbox(inquiry_id) values(v_found); end if;
  return jsonb_build_object('id',v_found,'created',true,'invitation_eligible',v_eligible);
end;
$$;

-- Optimistic revision save: the bearer hash, expiry, revision and human gate
-- must all still match. Two tabs cannot silently overwrite each other.
create function public.v2s_save(p_id uuid,p_hash text,p_revision integer,p_state jsonb,p_answers jsonb,p_status text)
returns boolean language plpgsql security invoker set search_path=''
as $$
declare v_changed integer;
begin
  if p_status not in ('partial','completed','stopped') or jsonb_typeof(p_state)<>'object' or jsonb_typeof(p_answers)<>'array' then return false; end if;
  update public.voice_screen_inquiries
  set engine_state=p_state,answers=p_answers,status=p_status,revision=revision+1,
      invitation_eligible=case when p_status='stopped' then false else invitation_eligible end,
      updated_at=now()
  where id=p_id and token_hash=lower(p_hash) and revision=p_revision and expires_at>now()
    and status in ('open','partial') and human_status='pending';
  get diagnostics v_changed=row_count;
  return v_changed=1;
end;
$$;

-- Lock order is inquiry then outbox, matching takeover, to avoid deadlocks.
-- Unknown/dispatching rows are terminal for automatic claiming.
create function public.v2s_claim(p_id uuid) returns jsonb
language plpgsql security invoker set search_path=''
as $$
declare
  v_inquiry public.voice_screen_inquiries%rowtype;
  v_outbox public.voice_screen_outbox%rowtype;
begin
  select * into v_inquiry from public.voice_screen_inquiries where id=p_id for update;
  if not found then return jsonb_build_object('claimed',false); end if;
  select * into v_outbox from public.voice_screen_outbox where inquiry_id=p_id for update;
  if not found or v_outbox.status<>'pending' then return jsonb_build_object('claimed',false); end if;
  if v_inquiry.invitation_eligible is not true or v_inquiry.human_status<>'pending'
     or v_inquiry.status not in ('open','partial') or v_inquiry.expires_at<=now() then
    update public.voice_screen_outbox set status='cancelled',updated_at=now() where inquiry_id=p_id;
    return jsonb_build_object('claimed',false,'cancelled',true);
  end if;
  update public.voice_screen_outbox
  set status='dispatching',attempt_count=attempt_count+1,claimed_at=now(),updated_at=now()
  where inquiry_id=p_id;
  return jsonb_build_object(
    'claimed',true,'outbox_id',v_outbox.id,'inquiry_id',v_inquiry.id,
    'firm_id',v_inquiry.firm_id,'location_id',v_inquiry.location_id,
    'contact_id',v_inquiry.contact_id,'caller_facts',v_inquiry.caller_facts,
    'token_nonce',v_inquiry.token_nonce,'token_hash',v_inquiry.token_hash,
    'expires_at',v_inquiry.expires_at);
end;
$$;

create function public.v2s_finish_dispatch(p_id uuid,p_status text,p_provider_id text default null,p_error text default null)
returns boolean language plpgsql security invoker set search_path=''
as $$
declare v_changed integer;
begin
  if p_status not in ('sent','unknown','cancelled') then return false; end if;
  update public.voice_screen_outbox
  set status=p_status,provider_message_id=nullif(btrim(p_provider_id),''),
      last_error=case when p_status='sent' then null else left(p_error,500) end,
      sent_at=case when p_status='sent' then now() else sent_at end,updated_at=now()
  where id=p_id and status='dispatching';
  get diagnostics v_changed=row_count;
  return v_changed=1;
end;
$$;

-- Human takeover immediately revokes the link. Pending sends cancel. An
-- already-dispatching request remains dispatching until the worker records
-- sent/unknown; UI must warn that an in-flight SMS may still arrive.
create function public.v2s_takeover(p_id uuid) returns boolean
language plpgsql security invoker set search_path=''
as $$
declare v_changed integer;
begin
  perform 1 from public.voice_screen_inquiries where id=p_id for update;
  update public.voice_screen_inquiries
  set human_status='taken_over',status='stopped',invitation_eligible=false,
      revision=revision+1,updated_at=now()
  where id=p_id and human_status='pending';
  get diagnostics v_changed=row_count;
  if v_changed<>1 then return false; end if;
  update public.voice_screen_outbox
  set status=case when status='pending' then 'cancelled' else status end,
      last_error=case when status='dispatching' then 'human_takeover_during_dispatch_link_revoked' else 'human_takeover_before_dispatch' end,
      updated_at=now()
  where inquiry_id=p_id and status in ('pending','dispatching');
  return true;
end;
$$;

revoke all privileges on function public.v2s_ingest(jsonb) from public,anon,authenticated;
revoke all privileges on function public.v2s_save(uuid,text,integer,jsonb,jsonb,text) from public,anon,authenticated;
revoke all privileges on function public.v2s_claim(uuid) from public,anon,authenticated;
revoke all privileges on function public.v2s_finish_dispatch(uuid,text,text,text) from public,anon,authenticated;
revoke all privileges on function public.v2s_takeover(uuid) from public,anon,authenticated;
grant execute on function public.v2s_ingest(jsonb) to service_role;
grant execute on function public.v2s_save(uuid,text,integer,jsonb,jsonb,text) to service_role;
grant execute on function public.v2s_claim(uuid) to service_role;
grant execute on function public.v2s_finish_dispatch(uuid,text,text,text) to service_role;
grant execute on function public.v2s_takeover(uuid) to service_role;
-- Pilot retention deletes the entire expired inquiry and cascading outbox.
-- Bounded service-only maintenance never accepts a future deletion cutoff.
create function public.v2s_purge_expired(p_before timestamptz default now(),p_limit integer default 500)
returns integer language plpgsql security definer set search_path=''
as $$
declare v_deleted integer;
begin
  if p_limit is null or p_limit<1 or p_limit>500 then raise exception 'invalid_purge_limit'; end if;
  with candidates as (
    select id from public.voice_screen_inquiries
    where expires_at<=least(coalesce(p_before,now()),now())
    order by expires_at,id limit p_limit for update skip locked
  ) delete from public.voice_screen_inquiries where id in (select id from candidates);
  get diagnostics v_deleted=row_count;
  return v_deleted;
end;
$$;

create function public.v2s_erase_subject(p_firm_id uuid,p_location_id text,p_contact_id text)
returns integer language plpgsql security definer set search_path=''
as $$
declare v_deleted integer;
begin
  if p_firm_id is null or nullif(btrim(p_location_id),'') is null or nullif(btrim(p_contact_id),'') is null then raise exception 'invalid_subject'; end if;
  delete from public.voice_screen_inquiries
  where firm_id=p_firm_id and location_id=p_location_id and contact_id=p_contact_id;
  get diagnostics v_deleted=row_count;
  return v_deleted;
end;
$$;

-- A crashed worker remains non-retryable. Expose its uncertain outcome to staff.
create function public.v2s_reconcile_stale_dispatch(p_firm_id uuid,p_location_id text,p_agent_id text)
returns integer language plpgsql security invoker set search_path=''
as $$
declare v_changed integer;
begin
  update public.voice_screen_outbox o set status='unknown',last_error='worker_result_missing_manual_review',updated_at=now()
  from public.voice_screen_inquiries i
  where o.inquiry_id=i.id and i.firm_id=p_firm_id and i.location_id=p_location_id and i.agent_id=p_agent_id
    and o.status='dispatching' and o.claimed_at<now()-interval '5 minutes';
  get diagnostics v_changed=row_count;
  return v_changed;
end;
$$;
revoke all privileges on function public.v2s_purge_expired(timestamptz,integer) from public,anon,authenticated;
revoke all privileges on function public.v2s_erase_subject(uuid,text,text) from public,anon,authenticated;
revoke all privileges on function public.v2s_reconcile_stale_dispatch(uuid,text,text) from public,anon,authenticated;
grant execute on function public.v2s_purge_expired(timestamptz,integer) to service_role;
grant execute on function public.v2s_erase_subject(uuid,text,text) to service_role;
grant execute on function public.v2s_reconcile_stale_dispatch(uuid,text,text) to service_role;
notify pgrst,'reload schema';
