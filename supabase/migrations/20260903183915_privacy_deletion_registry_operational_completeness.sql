-- Operational-completeness hardening for the encrypted deletion registry.
-- This migration is intentionally fail-closed and is not production approval.
begin;

alter table private.privacy_recovery_control
  add column if not exists schema_version text,
  add column if not exists cycle_id uuid,
  add column if not exists cycle_started_at timestamptz,
  add column if not exists initial_backfill_started_at timestamptz,
  add column if not exists required_operation text,
  add column if not exists reconciliation_operation_id uuid,
  add column if not exists reconciliation_completed_at timestamptz;

alter table private.privacy_recovery_control
  drop constraint if exists privacy_recovery_control_required_operation_check;
alter table private.privacy_recovery_control
  add constraint privacy_recovery_control_required_operation_check
  check (required_operation is null or required_operation in ('backfill', 'replay'));

create table if not exists private.privacy_recovery_firm_completions (
  cycle_id uuid not null,
  firm_id uuid not null references public.intake_firms(id) on delete restrict,
  operation text not null check (operation in ('backfill', 'replay')),
  operation_id uuid not null,
  completed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (cycle_id, firm_id, operation)
);
revoke all on table private.privacy_recovery_firm_completions from public, anon, authenticated, service_role;

create index if not exists privacy_deletion_requests_registry_backfill_keyset_idx
  on public.privacy_deletion_requests (firm_id, requested_at, id)
  where database_redacted_at is not null;

-- Applying the current migration is itself a lock boundary. A backup that
-- predates this schema cannot become operational merely because old state
-- happened to say open.
update private.privacy_recovery_control
   set state = 'locked',
       schema_version = '20260903183915',
       cycle_id = pg_catalog.gen_random_uuid(),
       cycle_started_at = pg_catalog.clock_timestamp(),
       initial_backfill_started_at = null,
       required_operation = null,
       reconciliation_operation_id = null,
       reconciliation_completed_at = null,
       changed_at = pg_catalog.clock_timestamp(),
       changed_by = 'migration_fail_closed'
 where singleton;

create or replace function private.set_privacy_recovery_state_impl(p_state text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_current text;
begin
  select state into v_current from private.privacy_recovery_control where singleton for update;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery control is unavailable'); end if;
  if p_state <> 'locked' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'replaying and open require the reconciliation RPCs');
  end if;
  update private.privacy_recovery_control
     set state = 'locked',
         cycle_id = case when v_current = 'open' then pg_catalog.gen_random_uuid() else cycle_id end,
         cycle_started_at = case when v_current = 'open' then pg_catalog.clock_timestamp() else cycle_started_at end,
         initial_backfill_started_at = case when v_current = 'open' then null else initial_backfill_started_at end,
         required_operation = case when v_current = 'open' then null else required_operation end,
         reconciliation_operation_id = case when v_current = 'open' then null else reconciliation_operation_id end,
         reconciliation_completed_at = case when v_current = 'open' then null else reconciliation_completed_at end,
         changed_at = pg_catalog.clock_timestamp(), changed_by = 'service_recovery'
   where singleton;
  return pg_catalog.jsonb_build_object('ok', true, 'state', 'locked');
end; $$;

revoke all on function private.set_privacy_recovery_state_impl(text) from public, anon, authenticated, service_role;
grant execute on function private.set_privacy_recovery_state_impl(text) to service_role;
revoke all on function public.set_privacy_recovery_state(text) from public, anon, authenticated, service_role;
grant execute on function public.set_privacy_recovery_state(text) to service_role;

create or replace function private.begin_privacy_registry_reconciliation_impl(
  p_operation text, p_registry_activated boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_control private.privacy_recovery_control%rowtype; v_now timestamptz;
begin
  if p_operation not in ('backfill', 'replay') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid reconciliation operation');
  end if;
  if p_registry_activated is null or (p_operation = 'backfill' and p_registry_activated) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid registry activation state');
  end if;
  select * into v_control from private.privacy_recovery_control where singleton for update;
  if not found or v_control.state <> 'locked' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'reconciliation requires locked state');
  end if;
  if v_control.schema_version <> '20260903183915' or v_control.cycle_id is null or v_control.cycle_started_at is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'privacy registry migrations are not current');
  end if;
  -- The initial seed cutoff is established when activation work actually
  -- starts, not when this disabled-by-default migration happens to deploy.
  -- This captures deletions made between migration and later activation.
  if not p_registry_activated and p_operation = 'backfill'
     and v_control.initial_backfill_started_at is null then
    v_now := pg_catalog.clock_timestamp();
    update private.privacy_recovery_control
       set cycle_id = pg_catalog.gen_random_uuid(),
           cycle_started_at = v_now,
           initial_backfill_started_at = v_now,
           required_operation = null,
           reconciliation_operation_id = null,
           reconciliation_completed_at = null,
           changed_at = v_now,
           changed_by = 'service_recovery'
     where singleton
     returning * into v_control;
  end if;
  if not p_registry_activated and p_operation = 'replay'
     and v_control.initial_backfill_started_at is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'initial registry backfill is not initialized');
  end if;
  -- Before the permanent external activation marker exists, every firm with
  -- historical redactions through the frozen DB cycle must have a completed
  -- seed/backfill operation. Firm completions deliberately survive the
  -- locked -> backfill -> locked -> replay transition.
  if p_operation = 'replay' and not p_registry_activated and exists (
    select request.firm_id from public.privacy_deletion_requests as request
     where request.database_redacted_at is not null and request.requested_at <= v_control.cycle_started_at
    except
    select completion.firm_id from private.privacy_recovery_firm_completions as completion
     where completion.cycle_id = v_control.cycle_id and completion.operation = 'backfill'
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'initial registry backfill is incomplete');
  end if;
  update private.privacy_recovery_control
     set state = 'replaying', required_operation = p_operation,
         reconciliation_operation_id = null, reconciliation_completed_at = null,
         changed_at = pg_catalog.clock_timestamp(), changed_by = 'service_recovery'
   where singleton;
  return pg_catalog.jsonb_build_object('ok', true, 'state', 'replaying',
    'operation', p_operation, 'cycle_id', v_control.cycle_id,
    'cycle_started_at', v_control.cycle_started_at);
end; $$;

create or replace function public.begin_privacy_registry_reconciliation(
  p_operation text, p_registry_activated boolean
)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.begin_privacy_registry_reconciliation_impl(p_operation, p_registry_activated);
$$;
revoke all on function private.begin_privacy_registry_reconciliation_impl(text, boolean) from public, anon, authenticated, service_role;
grant execute on function private.begin_privacy_registry_reconciliation_impl(text, boolean) to service_role;
revoke all on function public.begin_privacy_registry_reconciliation(text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.begin_privacy_registry_reconciliation(text, boolean) to service_role;

create or replace function private.resolve_screened_lead_privacy_coordinate_impl(
  p_firm_id uuid, p_lead_id text, p_deletion_request_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_screened_lead_id uuid; v_request_id uuid; v_bound_lead_id text; v_subject_key_hash text;
begin
  if p_firm_id is null or p_deletion_request_id is null or p_lead_id is null or pg_catalog.btrim(p_lead_id) = '' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid privacy coordinate');
  end if;
  select request.screened_lead_id, request.id, lead.lead_id, request.subject_key_hash
    into v_screened_lead_id, v_request_id, v_bound_lead_id, v_subject_key_hash
    from public.privacy_deletion_requests as request
    join public.screened_leads as lead
      on lead.id = request.screened_lead_id and lead.firm_id = request.firm_id
   where request.id = p_deletion_request_id and request.firm_id = p_firm_id;
  if found
     and v_bound_lead_id is distinct from p_lead_id
     and v_subject_key_hash is distinct from pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(
         p_firm_id::text || ':' || p_lead_id || ':' || p_deletion_request_id::text,
         'UTF8'
       )),
       'hex'
     ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'deletion request coordinate mismatch');
  elsif not found then
    select lead.id into v_screened_lead_id from public.screened_leads as lead
     where lead.firm_id = p_firm_id and lead.lead_id = p_lead_id limit 1;
    v_request_id := p_deletion_request_id;
  end if;
  if v_screened_lead_id is null then return pg_catalog.jsonb_build_object('ok', true, 'found', false); end if;
  return pg_catalog.jsonb_build_object('ok', true, 'found', true,
    'screened_lead_id', v_screened_lead_id, 'deletion_request_id', v_request_id);
end; $$;

create or replace function public.resolve_screened_lead_privacy_coordinate(
  p_firm_id uuid, p_lead_id text, p_deletion_request_id uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.resolve_screened_lead_privacy_coordinate_impl(p_firm_id, p_lead_id, p_deletion_request_id);
$$;
revoke all on function private.resolve_screened_lead_privacy_coordinate_impl(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function private.resolve_screened_lead_privacy_coordinate_impl(uuid, text, uuid) to service_role;
revoke all on function public.resolve_screened_lead_privacy_coordinate(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.resolve_screened_lead_privacy_coordinate(uuid, text, uuid) to service_role;

create or replace function private.redact_screened_lead_subject_by_id_impl(
  p_firm_id uuid, p_screened_lead_id uuid, p_reason text, p_deletion_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_lead_id text;
begin
  if p_firm_id is null or p_screened_lead_id is null or p_deletion_request_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid stable privacy coordinate');
  end if;
  if not exists (select 1 from private.privacy_recovery_control where singleton
    and schema_version = '20260903183915'
    and (state = 'open' or (state = 'replaying' and required_operation = 'replay'))) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'stable-id redaction is not active');
  end if;
  select lead.lead_id into v_lead_id from public.screened_leads as lead
   where lead.id = p_screened_lead_id and lead.firm_id = p_firm_id
   for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', true, 'redacted_count', 0,
      'deletion_request_id', p_deletion_request_id, 'external_cleanup_status', 'not_applicable',
      'external_cleanup_manifest', '{}'::jsonb);
  end if;
  return private.redact_screened_lead_subject_impl(p_firm_id, v_lead_id, p_reason, p_deletion_request_id);
end; $$;

create or replace function public.redact_screened_lead_subject_by_id(
  p_firm_id uuid, p_screened_lead_id uuid, p_reason text, p_deletion_request_id uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.redact_screened_lead_subject_by_id_impl(p_firm_id, p_screened_lead_id, p_reason, p_deletion_request_id);
$$;
revoke all on function private.redact_screened_lead_subject_by_id_impl(uuid, uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function private.redact_screened_lead_subject_by_id_impl(uuid, uuid, text, uuid) to service_role;
revoke all on function public.redact_screened_lead_subject_by_id(uuid, uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.redact_screened_lead_subject_by_id(uuid, uuid, text, uuid) to service_role;

create or replace function private.list_privacy_deletion_registry_backfill_firms_impl(
  p_cycle_id uuid, p_after_firm_id uuid default null, p_limit integer default 100
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_control private.privacy_recovery_control%rowtype; v_firms jsonb;
begin
  if p_cycle_id is null or p_limit is null or p_limit < 1 or p_limit > 100 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid firm discovery cursor');
  end if;
  select * into v_control from private.privacy_recovery_control where singleton;
  if not found or v_control.state <> 'replaying' or v_control.required_operation <> 'backfill'
     or v_control.schema_version <> '20260903183915' or v_control.cycle_id is distinct from p_cycle_id then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'backfill reconciliation is not active');
  end if;
  select coalesce(pg_catalog.jsonb_agg(candidate.firm_id order by candidate.firm_id), '[]'::jsonb)
    into v_firms
    from (
      select distinct request.firm_id
        from public.privacy_deletion_requests as request
       where request.database_redacted_at is not null
         and request.requested_at <= v_control.cycle_started_at
         and (p_after_firm_id is null or request.firm_id > p_after_firm_id)
       order by request.firm_id limit p_limit
    ) as candidate;
  return pg_catalog.jsonb_build_object('ok', true, 'firm_ids', v_firms,
    'exhausted', pg_catalog.jsonb_array_length(v_firms) < p_limit);
end; $$;

create or replace function public.list_privacy_deletion_registry_backfill_firms(
  p_cycle_id uuid, p_after_firm_id uuid default null, p_limit integer default 100
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.list_privacy_deletion_registry_backfill_firms_impl(p_cycle_id, p_after_firm_id, p_limit);
$$;
revoke all on function private.list_privacy_deletion_registry_backfill_firms_impl(uuid, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function private.list_privacy_deletion_registry_backfill_firms_impl(uuid, uuid, integer) to service_role;
revoke all on function public.list_privacy_deletion_registry_backfill_firms(uuid, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_privacy_deletion_registry_backfill_firms(uuid, uuid, integer) to service_role;

create or replace function private.list_privacy_deletion_registry_backfill_candidates_impl(
  p_firm_id uuid,
  p_cycle_id uuid,
  p_after_requested_at timestamptz default null,
  p_after_request_id uuid default null,
  p_before_or_at timestamptz default pg_catalog.clock_timestamp(),
  p_limit integer default 100
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_candidates jsonb; v_control private.privacy_recovery_control%rowtype;
begin
  if p_firm_id is null or p_before_or_at is null or p_limit is null or p_limit < 1 or p_limit > 100
     or ((p_after_requested_at is null) <> (p_after_request_id is null)) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid bounded backfill cursor');
  end if;
  select * into v_control from private.privacy_recovery_control where singleton;
  if not found or v_control.state <> 'replaying' or v_control.required_operation <> 'backfill'
     or v_control.schema_version <> '20260903183915' or v_control.cycle_id is distinct from p_cycle_id
     or v_control.cycle_started_at is distinct from p_before_or_at then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'backfill reconciliation is not active');
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'deletion_request_id', candidate.id, 'firm_id', candidate.firm_id,
    'screened_lead_id', candidate.screened_lead_id, 'reason', candidate.reason,
    'recorded_at', candidate.requested_at
  ) order by candidate.requested_at, candidate.id), '[]'::jsonb)
  into v_candidates
  from (
    select request.id, request.firm_id, request.screened_lead_id, request.reason, request.requested_at
      from public.privacy_deletion_requests as request
     where request.firm_id = p_firm_id and request.database_redacted_at is not null
       and request.requested_at <= p_before_or_at
       and (p_after_requested_at is null or (request.requested_at, request.id) > (p_after_requested_at, p_after_request_id))
     order by request.requested_at, request.id limit p_limit
  ) as candidate;
  return pg_catalog.jsonb_build_object('ok', true, 'candidate_count', pg_catalog.jsonb_array_length(v_candidates), 'candidates', v_candidates);
end; $$;

create or replace function public.list_privacy_deletion_registry_backfill_candidates(
  p_firm_id uuid, p_cycle_id uuid, p_after_requested_at timestamptz default null, p_after_request_id uuid default null,
  p_before_or_at timestamptz default pg_catalog.clock_timestamp(), p_limit integer default 100
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.list_privacy_deletion_registry_backfill_candidates_impl(
    p_firm_id, p_cycle_id, p_after_requested_at, p_after_request_id, p_before_or_at, p_limit);
$$;
revoke all on function private.list_privacy_deletion_registry_backfill_candidates_impl(uuid, uuid, timestamptz, uuid, timestamptz, integer) from public, anon, authenticated, service_role;
grant execute on function private.list_privacy_deletion_registry_backfill_candidates_impl(uuid, uuid, timestamptz, uuid, timestamptz, integer) to service_role;
revoke all on function public.list_privacy_deletion_registry_backfill_candidates(uuid, uuid, timestamptz, uuid, timestamptz, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_privacy_deletion_registry_backfill_candidates(uuid, uuid, timestamptz, uuid, timestamptz, integer) to service_role;

create or replace function private.mark_privacy_registry_reconciliation_complete_impl(
  p_operation text, p_operation_id uuid, p_cycle_id uuid, p_firm_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_control private.privacy_recovery_control%rowtype;
begin
  select * into v_control from private.privacy_recovery_control where singleton for update;
  if not found or v_control.state <> 'replaying' or v_control.schema_version <> '20260903183915'
     or v_control.cycle_id is distinct from p_cycle_id
     or v_control.required_operation <> p_operation or p_operation_id is null
     or (p_operation = 'backfill' and p_firm_id is null)
     or (p_operation = 'replay' and p_firm_id is not null) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'reconciliation completion refused');
  end if;
  if p_operation = 'replay' then
    update private.privacy_recovery_control
       set reconciliation_operation_id = p_operation_id,
           reconciliation_completed_at = pg_catalog.clock_timestamp()
     where singleton;
  else
    insert into private.privacy_recovery_firm_completions(cycle_id, firm_id, operation, operation_id)
    values (v_control.cycle_id, p_firm_id, p_operation, p_operation_id)
    on conflict (cycle_id, firm_id, operation) do update
      set operation_id = excluded.operation_id, completed_at = pg_catalog.clock_timestamp();
  end if;
  return pg_catalog.jsonb_build_object('ok', true);
end; $$;

create or replace function public.mark_privacy_registry_reconciliation_complete(
  p_operation text, p_operation_id uuid, p_cycle_id uuid, p_firm_id uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.mark_privacy_registry_reconciliation_complete_impl(p_operation, p_operation_id, p_cycle_id, p_firm_id);
$$;
revoke all on function private.mark_privacy_registry_reconciliation_complete_impl(text, uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.mark_privacy_registry_reconciliation_complete_impl(text, uuid, uuid, uuid) to service_role;
revoke all on function public.mark_privacy_registry_reconciliation_complete(text, uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mark_privacy_registry_reconciliation_complete(text, uuid, uuid, uuid) to service_role;

create or replace function private.open_privacy_recovery_impl(p_cycle_id uuid, p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_control private.privacy_recovery_control%rowtype;
begin
  select * into v_control from private.privacy_recovery_control where singleton for update;
  if not found or v_control.schema_version <> '20260903183915'
     or v_control.cycle_id is distinct from p_cycle_id
     or v_control.required_operation <> 'replay'
     or v_control.reconciliation_operation_id is distinct from p_operation_id
     or v_control.reconciliation_completed_at is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'privacy recovery is not ready to open');
  end if;
  -- Idempotence lets the service retry the external circuit write if the
  -- database committed open but the following Upstash write failed.
  if v_control.state = 'open' then
    return pg_catalog.jsonb_build_object('ok', true, 'state', 'open');
  end if;
  if v_control.state <> 'replaying' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'privacy recovery is not replaying');
  end if;
  update private.privacy_recovery_control set state = 'open', reconciliation_completed_at = pg_catalog.clock_timestamp(),
    changed_at = pg_catalog.clock_timestamp(), changed_by = 'service_recovery' where singleton;
  return pg_catalog.jsonb_build_object('ok', true, 'state', 'open');
end; $$;

create or replace function public.open_privacy_recovery(p_cycle_id uuid, p_operation_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.open_privacy_recovery_impl(p_cycle_id, p_operation_id);
$$;
revoke all on function private.open_privacy_recovery_impl(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.open_privacy_recovery_impl(uuid, uuid) to service_role;
revoke all on function public.open_privacy_recovery(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.open_privacy_recovery(uuid, uuid) to service_role;

commit;
