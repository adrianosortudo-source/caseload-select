-- Preserve the exact Meta-channel intake exchange that produced a screened
-- lead. The envelope is intentionally bounded because this table also stores
-- open/abandoned sessions and message bodies contain personal information.
alter table public.channel_intake_sessions
  add column if not exists intake_exchanges jsonb not null
    default '{"version":1,"events":[],"truncated":false}'::jsonb;

-- Sessions already open at deployment can only record exchanges observed from
-- this release onward. Mark the envelope incomplete so a later report never
-- presents that partial sequence as the whole intake.
update public.channel_intake_sessions
   set intake_exchanges = '{"version":1,"events":[],"truncated":true}'::jsonb
 where finalized = false
   and intake_exchanges = '{"version":1,"events":[],"truncated":false}'::jsonb;

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conname = 'channel_intake_sessions_intake_exchanges_valid'
       and conrelid = 'public.channel_intake_sessions'::regclass
  ) then
    alter table public.channel_intake_sessions
      add constraint channel_intake_sessions_intake_exchanges_valid
      check ((
        pg_catalog.jsonb_typeof(intake_exchanges) = 'object'
        and intake_exchanges -> 'version' = '1'::jsonb
        and pg_catalog.jsonb_typeof(intake_exchanges -> 'events') = 'array'
        and pg_catalog.jsonb_array_length(intake_exchanges -> 'events') <= 64
        and pg_catalog.jsonb_typeof(intake_exchanges -> 'truncated') = 'boolean'
        and pg_catalog.pg_column_size(intake_exchanges) <= 1048576
      ) is true);
  end if;
end
$$;

comment on column public.channel_intake_sessions.intake_exchanges is
  'Bounded v1 exact inbound/question history for a Meta intake. Copied into screened_leads.slot_answers on successful finalization and cleared for unsuccessful or privacy-redacted sessions.';

-- The existing privacy RPC replaces engine_state with this exact sentinel.
-- Clear the new body-bearing envelope in the same row mutation without
-- rewriting the already-applied privacy migration or its large RPC body.
create or replace function private.clear_channel_intake_exchanges_on_redaction()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.engine_state = '{"anonymized":true}'::jsonb then
    new.intake_exchanges := '{"version":1,"events":[],"truncated":false}'::jsonb;
  end if;
  return new;
end;
$$;

revoke all privileges on function private.clear_channel_intake_exchanges_on_redaction()
  from public, anon, authenticated, service_role;

drop trigger if exists channel_intake_sessions_05_clear_intake_exchanges_on_redaction
  on public.channel_intake_sessions;
create trigger channel_intake_sessions_05_clear_intake_exchanges_on_redaction
  before update on public.channel_intake_sessions
  for each row execute function private.clear_channel_intake_exchanges_on_redaction();

-- This service-only table was already protected by RLS and explicit privilege
-- revocation. Adding a column must not create a client-visible history path.
revoke all privileges on table public.channel_intake_sessions from anon, authenticated;
grant select, insert, update, delete on table public.channel_intake_sessions to service_role;

notify pgrst, 'reload schema';
