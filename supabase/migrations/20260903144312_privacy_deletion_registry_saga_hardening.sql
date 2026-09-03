-- Corrective hardening for the external deletion registry. This migration does
-- not apply the registry or open the feature; PR/application approval does
-- that separately. All public wrappers remain service-role-only.
begin;

create or replace function private.set_privacy_recovery_state_impl(p_state text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
begin
  if p_state not in ('open', 'locked', 'replaying') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid recovery state');
  end if;

  select state into v_current
    from private.privacy_recovery_control
   where singleton
   for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery control is unavailable');
  end if;

  -- A restore must explicitly pass locked -> replaying -> open. This prevents
  -- a one-call reopen from accidentally bypassing external replay.
  if (v_current = 'locked' and p_state not in ('locked', 'replaying'))
     or (v_current = 'replaying' and p_state not in ('replaying', 'open', 'locked'))
     or (v_current = 'open' and p_state not in ('open', 'locked')) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid recovery state transition');
  end if;

  update private.privacy_recovery_control
     set state = p_state,
         changed_at = pg_catalog.clock_timestamp(),
         changed_by = 'service_recovery'
   where singleton;
  return pg_catalog.jsonb_build_object('ok', true, 'state', p_state);
end;
$$;

revoke all on function private.set_privacy_recovery_state_impl(text) from public, anon, authenticated, service_role;
grant execute on function private.set_privacy_recovery_state_impl(text) to service_role;
revoke all on function public.set_privacy_recovery_state(text) from public, anon, authenticated, service_role;
grant execute on function public.set_privacy_recovery_state(text) to service_role;

-- Tenant-scoped coordinator source. It exposes only current surrogate lead
-- identifiers and request UUIDs to the service role, never the manifest.
create or replace function private.list_privacy_recovery_candidates_impl(
  p_firm_id uuid,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_requests jsonb;
begin
  if p_firm_id is null or p_limit is null or p_limit < 1 or p_limit > 100 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'firm_id and a limit from 1 to 100 are required');
  end if;
  if not exists (select 1 from private.privacy_recovery_control where singleton and state = 'replaying') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'recovery replay is not active');
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'deletion_request_id', candidate.id,
    'lead_id', candidate.lead_id,
    'reason', candidate.reason
  ) order by candidate.requested_at, candidate.id), '[]'::jsonb)
  into v_requests
  from (
    select request.id, lead.lead_id, request.reason, request.requested_at
      from public.privacy_deletion_requests as request
      join public.screened_leads as lead
        on lead.id = request.screened_lead_id
       and lead.firm_id = request.firm_id
     where request.firm_id = p_firm_id
       and request.database_redacted_at is not null
     order by request.requested_at, request.id
     limit p_limit
  ) as candidate;

  return pg_catalog.jsonb_build_object('ok', true, 'firm_id', p_firm_id, 'candidate_count', pg_catalog.jsonb_array_length(v_requests), 'candidates', v_requests);
end;
$$;

create or replace function public.list_privacy_recovery_candidates(
  p_firm_id uuid,
  p_limit integer default 100
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.list_privacy_recovery_candidates_impl(p_firm_id, p_limit); $$;

revoke all on function private.list_privacy_recovery_candidates_impl(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function private.list_privacy_recovery_candidates_impl(uuid, integer) to service_role;
revoke all on function public.list_privacy_recovery_candidates(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_privacy_recovery_candidates(uuid, integer) to service_role;

-- Existing recovery list is corrected to the same bounded limit so a damaged
-- deployment cannot turn a replay request into an unbounded PII export.
create or replace function private.list_pending_screened_lead_privacy_cleanups_impl(
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_requests jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'p_limit must be between 1 and 100');
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'deletion_request_id', pending.id, 'firm_id', pending.firm_id,
    'screened_lead_id', pending.screened_lead_id, 'current_lead_id', pending.current_lead_id
  ) order by pending.requested_at, pending.id), '[]'::jsonb)
  into v_requests
  from (
    select request.id, request.firm_id, request.screened_lead_id, request.requested_at,
           lead.lead_id as current_lead_id
      from public.privacy_deletion_requests as request
      join public.screened_leads as lead on lead.id = request.screened_lead_id and lead.firm_id = request.firm_id
     where request.external_cleanup_status = 'pending' and request.database_redacted_at is not null
     order by request.requested_at, request.id
     limit p_limit
  ) as pending;
  return pg_catalog.jsonb_build_object('ok', true, 'pending_count', pg_catalog.jsonb_array_length(v_requests), 'requests', v_requests);
end;
$$;

revoke all on function private.list_pending_screened_lead_privacy_cleanups_impl(integer) from public, anon, authenticated, service_role;
grant execute on function private.list_pending_screened_lead_privacy_cleanups_impl(integer) to service_role;
revoke all on function public.list_pending_screened_lead_privacy_cleanups(integer) from public, anon, authenticated, service_role;
grant execute on function public.list_pending_screened_lead_privacy_cleanups(integer) to service_role;

-- Completion still admits legacy provider_managed evidence, but enabled
-- external-first operations can now record completed/not_applicable evidence.
create or replace function private.complete_screened_lead_external_cleanup_impl(
  p_firm_id uuid, p_deletion_request_id uuid, p_cleanup_summary jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.privacy_deletion_requests%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_firm_id is null or p_deletion_request_id is null or p_cleanup_summary is null
     or pg_catalog.jsonb_typeof(p_cleanup_summary) <> 'object'
     or exists (
       select 1 from pg_catalog.jsonb_object_keys(p_cleanup_summary) as supplied(key)
        where not (supplied.key = any(array['storage_deleted_count', 'ghl_status', 'meta_status', 'resend_status']))
     )
     or not (p_cleanup_summary ?& array['storage_deleted_count', 'ghl_status', 'meta_status', 'resend_status'])
     or pg_catalog.jsonb_typeof(p_cleanup_summary->'storage_deleted_count') <> 'number'
     or (p_cleanup_summary->>'storage_deleted_count') !~ '^[0-9]+$'
     or p_cleanup_summary->>'ghl_status' not in ('completed', 'not_applicable', 'provider_managed')
     or p_cleanup_summary->>'meta_status' not in ('completed', 'not_applicable', 'provider_managed')
     or p_cleanup_summary->>'resend_status' not in ('completed', 'not_applicable', 'provider_managed') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'cleanup_summary must contain only required non-identifying count/status fields');
  end if;
  select request.* into v_request from public.privacy_deletion_requests as request
   where request.id = p_deletion_request_id and request.firm_id = p_firm_id for update;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'error', 'deletion request not found'); end if;
  if v_request.external_cleanup_status = 'complete' then
    return pg_catalog.jsonb_build_object('ok', true, 'deletion_request_id', v_request.id, 'external_cleanup_status', 'complete', 'cleanup_summary', v_request.cleanup_summary);
  end if;
  update public.privacy_deletion_requests
     set external_cleanup_status = 'complete', external_cleanup_manifest = '{}'::jsonb,
         external_cleanup_completed_at = v_now, cleanup_summary = p_cleanup_summary, updated_at = v_now
   where id = p_deletion_request_id and firm_id = p_firm_id;
  return pg_catalog.jsonb_build_object('ok', true, 'deletion_request_id', p_deletion_request_id, 'external_cleanup_status', 'complete', 'external_cleanup_completed_at', v_now, 'cleanup_summary', p_cleanup_summary);
end;
$$;

revoke all on function private.complete_screened_lead_external_cleanup_impl(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function private.complete_screened_lead_external_cleanup_impl(uuid, uuid, jsonb) to service_role;
revoke all on function public.complete_screened_lead_external_cleanup(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.complete_screened_lead_external_cleanup(uuid, uuid, jsonb) to service_role;

commit;
