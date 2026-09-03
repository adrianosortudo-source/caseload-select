-- External registry replay gate. The Vercel circuit breaker is set before a
-- restore; this durable state prevents operational reopening before replay.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;
grant usage on schema private to service_role;

create table if not exists private.privacy_recovery_control (
  singleton boolean primary key default true check (singleton),
  state text not null check (state in ('open', 'locked', 'replaying')),
  changed_at timestamptz not null default clock_timestamp(),
  changed_by text not null default 'migration'
);
revoke all on table private.privacy_recovery_control from public, anon, authenticated, service_role;
insert into private.privacy_recovery_control (singleton, state, changed_by)
values (true, 'open', 'migration') on conflict (singleton) do nothing;

create or replace function private.set_privacy_recovery_state_impl(p_state text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_state not in ('open', 'locked', 'replaying') then
    return jsonb_build_object('ok', false, 'error', 'invalid recovery state');
  end if;
  update private.privacy_recovery_control set state = p_state, changed_at = clock_timestamp(), changed_by = 'service_recovery' where singleton;
  return jsonb_build_object('ok', true, 'state', p_state);
end;
$$;
revoke all on function private.set_privacy_recovery_state_impl(text) from public, anon, authenticated, service_role;
grant execute on function private.set_privacy_recovery_state_impl(text) to service_role;

create or replace function public.set_privacy_recovery_state(p_state text)
returns jsonb language sql security invoker set search_path = '' as $$ select private.set_privacy_recovery_state_impl(p_state); $$;
revoke all on function public.set_privacy_recovery_state(text) from public, anon, authenticated;
grant execute on function public.set_privacy_recovery_state(text) to service_role;
commit;
