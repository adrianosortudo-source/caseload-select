-- Permit the already-reconciled recovery cycle to open after a deliberate
-- locked verification window. This migration changes no control-row state.
begin;

create or replace function private.open_privacy_recovery_impl(
  p_cycle_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_control private.privacy_recovery_control%rowtype;
begin
  select *
    into v_control
    from private.privacy_recovery_control
   where singleton
   for update;

  if not found
     or v_control.schema_version <> '20260903183915'
     or v_control.cycle_id is distinct from p_cycle_id
     or v_control.required_operation <> 'replay'
     or v_control.reconciliation_operation_id is distinct from p_operation_id
     or v_control.reconciliation_completed_at is null then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'privacy recovery is not ready to open'
    );
  end if;

  -- Retain idempotence after all cycle and completion checks have passed.
  if v_control.state = 'open' then
    return pg_catalog.jsonb_build_object('ok', true, 'state', 'open');
  end if;

  -- A completed replay may be deliberately locked while aggregate registry
  -- evidence is checked. That lock preserves the exact cycle and replay proof,
  -- so it may open without an unnecessary second replay. No other state may.
  if v_control.state not in ('locked', 'replaying') then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'privacy recovery is not ready to open'
    );
  end if;

  update private.privacy_recovery_control
     set state = 'open',
         reconciliation_completed_at = pg_catalog.clock_timestamp(),
         changed_at = pg_catalog.clock_timestamp(),
         changed_by = 'service_recovery'
   where singleton;

  return pg_catalog.jsonb_build_object('ok', true, 'state', 'open');
end;
$$;

revoke all on function private.open_privacy_recovery_impl(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.open_privacy_recovery_impl(uuid, uuid)
  to service_role;

revoke all on function public.open_privacy_recovery(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.open_privacy_recovery(uuid, uuid)
  to service_role;

commit;
