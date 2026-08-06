-- pg_cron + pg_net wiring for CaseLoad Select.
--
-- Schedules the two cron-protected routes (triage-backstop hourly,
-- webhook-retry every 5 minutes) and wires an invitation-on-add trigger
-- that fires a magic-link email whenever a new firm_lawyers row is inserted.
--
-- The PG_CRON_TOKEN bearer token is read from Supabase Vault. The route
-- handlers accept it via lib/cron-auth.ts (constant-time check against
-- both CRON_SECRET and PG_CRON_TOKEN env vars).
--
-- The migration was applied to the live project on 2026-05-06 via the
-- Supabase MCP. This file mirrors the applied SQL for reproducibility on
-- a fresh project. The token literal in the vault.create_secret call is a
-- placeholder; the live project's secret was generated server-side and is
-- already stored. To re-create the secret on a fresh project, replace
-- `<PG_CRON_TOKEN>` with a 64-char hex string and add the same value to
-- the project's PG_CRON_TOKEN env var on Vercel.

-- 1. Enable extensions ----------------------------------------------------
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- 2. Helper schema for cron internals ------------------------------------
create schema if not exists cron_internal;
revoke all on schema cron_internal from public;

-- 3. Store PG_CRON_TOKEN in Vault (idempotent) ---------------------------
do $$
declare
  existing_id uuid;
begin
  select id into existing_id from vault.secrets where name = 'pg_cron_token';
  if existing_id is null then
    perform vault.create_secret(
      '<PG_CRON_TOKEN>',
      'pg_cron_token',
      'Bearer token for pg_cron + pg_net to call CaseLoad Select cron HTTP routes. Mirrors PG_CRON_TOKEN env var on Vercel.'
    );
  end if;
end $$;

-- 4. Helper: read token + POST to a cron-protected path ------------------
create or replace function cron_internal.call_cron_route(path text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text;
  request_id bigint;
  base_url text := 'https://app.caseloadselect.ca';
begin
  select decrypted_secret
    into token
    from vault.decrypted_secrets
   where name = 'pg_cron_token'
   limit 1;

  if token is null or token = '' then
    raise notice 'pg_cron_token missing from vault, skipping call to %', path;
    return null;
  end if;

  select net.http_get(
    url := base_url || path,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'User-Agent', 'pg_cron/CaseLoadSelect'
    ),
    timeout_milliseconds := 60000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function cron_internal.call_cron_route(text) from public;
grant execute on function cron_internal.call_cron_route(text) to postgres;

-- 5. Schedule the two cron jobs (idempotent — unschedule before reschedule)
do $$
begin
  -- Triage backstop: hourly at :07.
  if exists (select 1 from cron.job where jobname = 'triage-backstop-hourly') then
    perform cron.unschedule('triage-backstop-hourly');
  end if;
  perform cron.schedule(
    'triage-backstop-hourly',
    '7 * * * *',
    $cmd$select cron_internal.call_cron_route('/api/cron/triage-backstop');$cmd$
  );

  -- Webhook retry: every 5 minutes.
  if exists (select 1 from cron.job where jobname = 'webhook-retry-5m') then
    perform cron.unschedule('webhook-retry-5m');
  end if;
  perform cron.schedule(
    'webhook-retry-5m',
    '*/5 * * * *',
    $cmd$select cron_internal.call_cron_route('/api/cron/webhook-retry');$cmd$
  );
end $$;

-- 6. Invitation-on-add trigger -------------------------------------------
-- Fires when a new firm_lawyers row is inserted. Sends a magic-link email
-- via pg_net → /api/portal/request-link. The endpoint is anti-enumeration
-- so it always returns 200; we don't surface delivery state to the trigger.
-- Marks invitation_sent_at = now() after dispatching so re-inserts of the
-- same lawyer don't double-email (deletion + re-add will, by design).
create or replace function public.fn_firm_lawyers_send_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_id bigint;
  base_url text := 'https://app.caseloadselect.ca';
begin
  if NEW.invitation_sent_at is not null then
    return NEW;
  end if;

  -- Fire-and-forget. pg_net writes the response into net._http_response
  -- regardless of outcome.
  select net.http_post(
    url := base_url || '/api/portal/request-link',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'User-Agent', 'pg_net/CaseLoadSelect-invitation'
    ),
    body := jsonb_build_object('email', NEW.email),
    timeout_milliseconds := 30000
  ) into request_id;

  -- Mark dispatched. Don't fail the INSERT if pg_net is misbehaving — that's
  -- a recoverable state (operator can manually re-send via /api/portal/generate).
  update public.firm_lawyers
     set invitation_sent_at = now()
   where id = NEW.id;

  return NEW;
exception when others then
  raise notice 'fn_firm_lawyers_send_invitation: error firing invitation: %', SQLERRM;
  return NEW;
end;
$$;

revoke all on function public.fn_firm_lawyers_send_invitation() from public;

drop trigger if exists trg_firm_lawyers_invite on public.firm_lawyers;
create trigger trg_firm_lawyers_invite
after insert on public.firm_lawyers
for each row
execute function public.fn_firm_lawyers_send_invitation();

comment on function public.fn_firm_lawyers_send_invitation() is
  'Fires a magic-link email to NEW.email via pg_net on firm_lawyers INSERT. Updates invitation_sent_at = now() on dispatch. Failures are logged via NOTICE and do not block the INSERT.';
comment on function cron_internal.call_cron_route(text) is
  'Internal helper: reads pg_cron_token from Vault and POSTs to /api/cron/* on the production app. Used by scheduled pg_cron jobs.';
