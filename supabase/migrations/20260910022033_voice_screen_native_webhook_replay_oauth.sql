-- Native signed VoiceAiCallEnd hardening. Durable claims survive inquiry
-- deletion long enough that a still-fresh signed event cannot recreate it.
create table public.voice_screen_event_claims (
  firm_id uuid not null references public.intake_firms(id) on delete cascade,
  location_id text not null check (length(location_id) between 1 and 100),
  agent_id text not null check (length(agent_id) between 1 and 100),
  call_id text not null check (length(call_id) between 1 and 200),
  event_ended_at timestamptz not null,
  discard_after timestamptz not null,
  claimed_at timestamptz not null default now(),
  primary key (firm_id, location_id, agent_id, call_id),
  check (discard_after >= event_ended_at + interval '25 hours')
);
create index voice_screen_event_claims_expiry_idx on public.voice_screen_event_claims (discard_after);

-- A verified erasure creates an indefinite, pseudonymous provider-subject
-- tombstone. Re-authorisation is a separate future operator procedure.
create table public.voice_screen_subject_suppressions (
  firm_id uuid not null references public.intake_firms(id) on delete cascade,
  location_id text not null check (length(location_id) between 1 and 100),
  subject_digest text not null check (subject_digest ~ '^[0-9a-f]{64}$'),
  suppressed_at timestamptz not null default now(),
  primary key (firm_id, location_id, subject_digest)
);

-- OAuth tokens are encrypted by the application with AES-256-GCM before they
-- cross the database boundary. No plaintext token or encryption key is stored.
create table public.voice_screen_ghl_oauth_installations (
  firm_id uuid not null references public.intake_firms(id) on delete cascade,
  location_id text not null check (length(location_id) between 1 and 100),
  marketplace_app_id text not null check (length(marketplace_app_id) between 1 and 100),
  access_token_ciphertext text check (access_token_ciphertext is null or length(access_token_ciphertext) between 40 and 24000),
  refresh_token_ciphertext text check (refresh_token_ciphertext is null or length(refresh_token_ciphertext) between 40 and 24000),
  encryption_key_version smallint not null default 1 check (encryption_key_version > 0),
  token_expires_at timestamptz not null,
  scopes text[] not null default '{}',
  company_id text check (company_id is null or length(company_id) between 1 and 200),
  installed_by_user_id text not null check (length(installed_by_user_id) between 1 and 200),
  status text not null default 'active' check (status in ('active','revoked')),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (firm_id, location_id),
  check ((status='active' and access_token_ciphertext is not null and refresh_token_ciphertext is not null and revoked_at is null)
      or (status='revoked' and access_token_ciphertext is null and refresh_token_ciphertext is null and revoked_at is not null))
);

alter table public.voice_screen_event_claims enable row level security;
alter table public.voice_screen_event_claims force row level security;
alter table public.voice_screen_subject_suppressions enable row level security;
alter table public.voice_screen_subject_suppressions force row level security;
alter table public.voice_screen_ghl_oauth_installations enable row level security;
alter table public.voice_screen_ghl_oauth_installations force row level security;
revoke all privileges on table public.voice_screen_event_claims from public,anon,authenticated,service_role;
revoke all privileges on table public.voice_screen_subject_suppressions from public,anon,authenticated,service_role;
revoke all privileges on table public.voice_screen_ghl_oauth_installations from public,anon,authenticated,service_role;
grant select,insert on table public.voice_screen_event_claims to service_role;
grant select on table public.voice_screen_subject_suppressions to service_role;
grant select,insert,update on table public.voice_screen_ghl_oauth_installations to service_role;

create or replace function public.v2s_ingest(p_inquiry jsonb) returns jsonb
language plpgsql security invoker set search_path=''
as $$
declare
  v_id uuid := coalesce((p_inquiry->>'id')::uuid, gen_random_uuid());
  v_found uuid;
  v_firm uuid := (p_inquiry->>'firm_id')::uuid;
  v_location text := nullif(btrim(p_inquiry->>'location_id'),'');
  v_agent text := nullif(btrim(p_inquiry->>'agent_id'),'');
  v_call text := nullif(btrim(p_inquiry->>'call_id'),'');
  v_contact text := nullif(btrim(p_inquiry->>'contact_id'),'');
  v_app text := nullif(btrim(p_inquiry->>'marketplace_app_id'),'');
  v_subject_digests text[];
  v_current_subject_digest text;
  v_ended timestamptz := (p_inquiry->>'ended_at')::timestamptz;
  v_expires timestamptz := (p_inquiry->>'expires_at')::timestamptz;
  v_facts jsonb := coalesce(p_inquiry->'caller_facts','{}'::jsonb);
  v_permission_at timestamptz;
  v_phone text;
  v_eligible boolean;
  v_claimed integer;
begin
  if jsonb_typeof(p_inquiry->'subject_digests')='array' then
    select array_agg(value order by ordinal) into v_subject_digests
    from jsonb_array_elements_text(p_inquiry->'subject_digests') with ordinality as d(value,ordinal);
  end if;
  if v_firm is null or v_location is null or v_agent is null or v_call is null or v_contact is null or v_app is null or
     v_ended is null or v_expires is null or v_subject_digests is null or cardinality(v_subject_digests) not between 1 and 4 then
    raise exception using errcode='22023', message='invalid_voice_screen_inquiry';
  end if;
  if length(v_location)>100 or length(v_agent)>100 or length(v_call)>200 or length(v_contact)>200 or length(v_app)>100 or
     exists (select 1 from unnest(v_subject_digests) d where d !~ '^[0-9a-f]{64}$') or
     (select count(*) from unnest(v_subject_digests) as d(value)) <>
       (select count(distinct value) from unnest(v_subject_digests) as d(value)) then
    raise exception using errcode='22023', message='invalid_voice_screen_inquiry';
  end if;
  v_current_subject_digest := v_subject_digests[1];

  -- Serialize exact-location uninstall and ingest before checking installation.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'v2s-install' || chr(31) || v_firm::text || chr(31) || v_location, 0));
  if not exists (
    select 1 from public.voice_screen_ghl_oauth_installations
    where firm_id=v_firm and location_id=v_location and marketplace_app_id=v_app
      and status='active' and revoked_at is null
  ) then
    return jsonb_build_object('id',null,'created',false,'reason','integration_not_installed');
  end if;

  -- Serialise erasure and ingestion for the same provider subject. Without
  -- this lock an ingest that checked just before erasure could commit after it.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_firm::text || chr(31) || v_location || chr(31) || v_current_subject_digest, 0));
  if exists (
    select 1 from public.voice_screen_subject_suppressions
    where firm_id=v_firm and location_id=v_location and subject_digest=any(v_subject_digests)
  ) then
    return jsonb_build_object('id',null,'created',false,'reason','subject_suppressed');
  end if;

  insert into public.voice_screen_event_claims
    (firm_id,location_id,agent_id,call_id,event_ended_at,discard_after)
  values
    (v_firm,v_location,v_agent,v_call,v_ended,v_ended+interval '25 hours')
  on conflict (firm_id,location_id,agent_id,call_id) do nothing;
  get diagnostics v_claimed=row_count;
  if v_claimed=0 then
    select id into v_found from public.voice_screen_inquiries
    where firm_id=v_firm and location_id=v_location and agent_id=v_agent and call_id=v_call;
    return jsonb_build_object(
      'id',v_found,'created',false,
      'reason',case when v_found is null then 'event_replay' else 'duplicate' end);
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
    (v_id,v_firm,v_location,v_agent,v_call,v_contact,v_facts,
     coalesce(p_inquiry->'engine_state','{}'::jsonb),coalesce(p_inquiry->'answers','[]'::jsonb),
     lower(p_inquiry->>'token_hash'),p_inquiry->>'token_nonce',v_expires,v_ended,v_eligible)
  on conflict (location_id,agent_id,call_id) do nothing returning id into v_found;
  if v_found is null then
    select id into v_found from public.voice_screen_inquiries
    where location_id=v_location and agent_id=v_agent and call_id=v_call;
    return jsonb_build_object('id',v_found,'created',false,'reason','duplicate');
  end if;
  if v_eligible then insert into public.voice_screen_outbox(inquiry_id) values(v_found); end if;
  return jsonb_build_object('id',v_found,'created',true,'invitation_eligible',v_eligible);
end;
$$;

-- Purge inquiries at their configured expiry, but retain event claims until a
-- signed replay is necessarily outside the receiver's 24-hour freshness gate.
create or replace function public.v2s_purge_expired(p_before timestamptz default now(),p_limit integer default 500)
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
  with expired_claims as (
    select firm_id,location_id,agent_id,call_id from public.voice_screen_event_claims
    where discard_after<=least(coalesce(p_before,now()),now())
    order by discard_after,firm_id,location_id,agent_id,call_id limit p_limit for update skip locked
  ) delete from public.voice_screen_event_claims c
    using expired_claims e
    where c.firm_id=e.firm_id and c.location_id=e.location_id and c.agent_id=e.agent_id and c.call_id=e.call_id;
  return v_deleted;
end;
$$;

drop function public.v2s_erase_subject(uuid,text,text);
create function public.v2s_erase_subject(p_firm_id uuid,p_location_id text,p_contact_id text,p_subject_digest text)
returns integer language plpgsql security definer set search_path=''
as $$
declare
  v_deleted integer;
  v_location text := nullif(btrim(p_location_id),'');
  v_contact text := nullif(btrim(p_contact_id),'');
begin
  if p_firm_id is null or v_location is null or v_contact is null or length(v_location)>100 or length(v_contact)>200 or
     p_subject_digest !~ '^[0-9a-f]{64}$' then raise exception 'invalid_subject'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_firm_id::text || chr(31) || v_location || chr(31) || p_subject_digest, 0));
  insert into public.voice_screen_subject_suppressions(firm_id,location_id,subject_digest)
  values(p_firm_id,v_location,p_subject_digest)
  on conflict (firm_id,location_id,subject_digest) do nothing;
  delete from public.voice_screen_inquiries
  where firm_id=p_firm_id and location_id=v_location and contact_id=v_contact;
  get diagnostics v_deleted=row_count;
  return v_deleted;
end;
$$;

create function public.v2s_revoke_ghl_installation(
  p_firm_id uuid,p_marketplace_app_id text,p_location_id text default null,p_company_id text default null)
returns integer language plpgsql security definer set search_path=''
as $$
declare
  v_changed integer;
  v_location text := nullif(btrim(p_location_id),'');
  v_company text := nullif(btrim(p_company_id),'');
  v_locked_location text;
begin
  if p_firm_id is null or p_marketplace_app_id !~ '^[A-Za-z0-9_-]{1,100}$' or
     ((v_location is null) = (v_company is null)) or
     (v_location is not null and length(v_location)>100) or (v_company is not null and length(v_company)>100) then
    raise exception 'invalid_ghl_uninstall';
  end if;
  for v_locked_location in
    select location_id from public.voice_screen_ghl_oauth_installations
    where firm_id=p_firm_id and marketplace_app_id=p_marketplace_app_id
      and ((v_location is not null and location_id=v_location) or (v_location is null and company_id=v_company))
    order by location_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'v2s-install' || chr(31) || p_firm_id::text || chr(31) || v_locked_location, 0));
  end loop;
  update public.voice_screen_ghl_oauth_installations
  set access_token_ciphertext=null,refresh_token_ciphertext=null,status='revoked',revoked_at=now(),updated_at=now()
  where firm_id=p_firm_id and marketplace_app_id=p_marketplace_app_id and status='active'
    and ((v_location is not null and location_id=v_location) or (v_location is null and company_id=v_company));
  get diagnostics v_changed=row_count;
  return v_changed;
end;
$$;

revoke all privileges on function public.v2s_ingest(jsonb) from public,anon,authenticated;
revoke all privileges on function public.v2s_purge_expired(timestamptz,integer) from public,anon,authenticated;
revoke all privileges on function public.v2s_erase_subject(uuid,text,text,text) from public,anon,authenticated;
revoke all privileges on function public.v2s_revoke_ghl_installation(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.v2s_ingest(jsonb) to service_role;
grant execute on function public.v2s_purge_expired(timestamptz,integer) to service_role;
grant execute on function public.v2s_erase_subject(uuid,text,text,text) to service_role;
grant execute on function public.v2s_revoke_ghl_installation(uuid,text,text,text) to service_role;
notify pgrst,'reload schema';
