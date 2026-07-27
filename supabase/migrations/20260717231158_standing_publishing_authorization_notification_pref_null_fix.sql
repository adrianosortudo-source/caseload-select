-- Reconstructed 2026-07-27 from the production ledger's own statements column
-- (supabase_migrations.schema_migrations, version 20260717231158) by the
-- migration-lineage remediation. Classified GENUINELY_UNTRACEABLE by the
-- 2026-07-18 investigation, which searched git -- the SQL was in the ledger's
-- statements column the whole time. Content below is the recorded SQL,
-- verbatim; only this header was added.
-- Idempotent: CREATE OR REPLACE FUNCTION. Applies after
-- 20260717230956_standing_publishing_authorization.sql, which creates the
-- original function this fix replaces.

-- Fix: p_notification_preference NOT IN (...) evaluates to NULL (not TRUE)
-- when the value is NULL, so an omitted notification_preference on an
-- 'enabled' event silently skipped this guard and fell through to the
-- table's own CHECK constraint, which raises a hard, ungraceful exception
-- instead of the intended ok:false response. Caught by
-- scripts/verify-standing-publishing-authorization.sql CHECK 2 before this
-- ever reached the application layer.
create or replace function public.set_standing_publishing_authorization(
  p_firm_id uuid,
  p_event text,
  p_actor_role text,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_email text,
  p_authorization_text text,
  p_policy_version text,
  p_scope text,
  p_notification_preference text,
  p_reason text,
  p_ip_address text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_row record;
begin
  if p_event not in ('enabled', 'disabled') then
    return jsonb_build_object('ok', false, 'error', 'event must be ''enabled'' or ''disabled''');
  end if;
  if p_actor_role is distinct from 'lawyer' then
    return jsonb_build_object('ok', false, 'error', 'only an authorized firm lawyer/client decision-maker may change standing publishing authorization');
  end if;
  if p_actor_name is null or length(btrim(p_actor_name)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'actor_name is required');
  end if;
  if p_actor_email is null or length(btrim(p_actor_email)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'actor_email is required');
  end if;

  if p_event = 'enabled' then
    if p_authorization_text is null or length(btrim(p_authorization_text)) = 0 then
      return jsonb_build_object('ok', false, 'error', 'authorization_text is required to enable standing authorization');
    end if;
    if p_policy_version is null or length(btrim(p_policy_version)) = 0 then
      return jsonb_build_object('ok', false, 'error', 'policy_version is required to enable standing authorization');
    end if;
    if p_scope is null or length(btrim(p_scope)) = 0 then
      return jsonb_build_object('ok', false, 'error', 'scope is required to enable standing authorization');
    end if;
    if p_notification_preference is null or p_notification_preference not in ('per_publication', 'weekly_digest') then
      return jsonb_build_object('ok', false, 'error', 'notification_preference must be ''per_publication'' or ''weekly_digest''');
    end if;
  end if;

  perform 1 from public.intake_firms where id = p_firm_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'firm not found');
  end if;

  insert into public.standing_publishing_authorizations (
    firm_id, event, actor_role, actor_id, actor_name, actor_email,
    authorization_text, policy_version, scope, notification_preference,
    reason, ip_address, user_agent
  ) values (
    p_firm_id, p_event, p_actor_role, p_actor_id, p_actor_name, p_actor_email,
    case when p_event = 'enabled' then p_authorization_text else null end,
    case when p_event = 'enabled' then p_policy_version else null end,
    case when p_event = 'enabled' then p_scope else null end,
    case when p_event = 'enabled' then p_notification_preference else null end,
    p_reason, p_ip_address, p_user_agent
  )
  returning * into v_new_row;

  return jsonb_build_object(
    'ok', true,
    'event_id', v_new_row.id,
    'event_seq', v_new_row.event_seq,
    'event', v_new_row.event,
    'effective_at', v_new_row.effective_at
  );
end;
$$;
