-- A client request for changes holds the entire deliverable, not only the
-- version they reviewed. The opened event keeps its original version_id as
-- immutable audit evidence; a later operator version must not bypass it.

create or replace function public.has_unresolved_deliverable_client_change_hold(
  p_firm_id uuid,
  p_deliverable_id uuid,
  p_version_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.deliverable_client_change_hold_events opened
    where opened.firm_id = p_firm_id
      and opened.deliverable_id = p_deliverable_id
      and opened.event = 'opened'
      and not exists (
        select 1
        from public.deliverable_client_change_hold_events resolved
        where resolved.event = 'resolved'
          and resolved.resolves_open_event_id = opened.id
      )
  );
$$;
comment on function public.has_unresolved_deliverable_client_change_hold(uuid, uuid, uuid) is
  'Returns whether any unresolved client change hold blocks the deliverable. p_version_id is retained for trigger compatibility and is intentionally not a scope limiter.';
revoke all on function public.has_unresolved_deliverable_client_change_hold(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.has_unresolved_deliverable_client_change_hold(uuid, uuid, uuid) to service_role;

-- Resolve exactly the opened hold selected by the client. The caller must
-- name its recorded version, and the resolution row always copies that value
-- from the open event rather than trusting request input.
create or replace function public.set_deliverable_client_change_hold(
  p_firm_id uuid,
  p_deliverable_id uuid,
  p_version_id uuid,
  p_event text,
  p_resolves_open_event_id uuid,
  p_actor_role text,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_email text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open public.deliverable_client_change_hold_events%rowtype;
  v_actor_name text;
  v_actor_email text;
  v_event_version_id uuid;
begin
  if p_event not in ('opened', 'resolved') or p_actor_role is distinct from 'lawyer' then
    return jsonb_build_object('ok', false, 'error', 'only an authorized firm lawyer may open or resolve a client change hold');
  end if;
  if p_actor_id is null then
    return jsonb_build_object('ok', false, 'error', 'authenticated lawyer identity is required');
  end if;
  select coalesce(display_name, name), email into v_actor_name, v_actor_email
    from public.firm_lawyers
    where id = p_actor_id and firm_id = p_firm_id and role in ('lawyer', 'admin') and disabled = false;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'actor is not an active client decision-maker for this firm');
  end if;
  perform 1 from public.content_deliverables where id = p_deliverable_id and firm_id = p_firm_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'deliverable not found for this firm'); end if;
  perform 1 from public.deliverable_versions where id = p_version_id and deliverable_id = p_deliverable_id and firm_id = p_firm_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'version does not belong to this deliverable and firm'); end if;
  v_event_version_id := p_version_id;
  if p_event = 'resolved' then
    select * into v_open
    from public.deliverable_client_change_hold_events
    where id = p_resolves_open_event_id
      and firm_id = p_firm_id
      and deliverable_id = p_deliverable_id
      and event = 'opened'
    for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'open client change hold not found for this deliverable'); end if;
    if p_version_id is distinct from v_open.version_id then
      return jsonb_build_object('ok', false, 'error', 'resolution version does not match the selected open client change hold');
    end if;
    if exists (
      select 1 from public.deliverable_client_change_hold_events
      where event = 'resolved' and resolves_open_event_id = p_resolves_open_event_id
    ) then
      return jsonb_build_object('ok', false, 'error', 'client change hold is already resolved');
    end if;
    v_event_version_id := v_open.version_id;
  end if;
  insert into public.deliverable_client_change_hold_events (
    firm_id, deliverable_id, version_id, event, resolves_open_event_id,
    actor_role, actor_id, actor_name, actor_email, reason
  ) values (
    p_firm_id, p_deliverable_id, v_event_version_id, p_event, p_resolves_open_event_id,
    p_actor_role, p_actor_id, coalesce(v_actor_name, p_actor_name), v_actor_email, p_reason
  ) returning id into v_open.id;
  return jsonb_build_object('ok', true, 'event_id', v_open.id, 'event', p_event);
end;
$$;
revoke all on function public.set_deliverable_client_change_hold(uuid, uuid, uuid, text, uuid, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.set_deliverable_client_change_hold(uuid, uuid, uuid, text, uuid, text, uuid, text, text, text) to service_role;

notify pgrst, 'reload schema';
