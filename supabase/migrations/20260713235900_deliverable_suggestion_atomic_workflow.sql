-- Atomic suggestion creation and application. The application uses the
-- service-role client, so these functions are deliberately not exposed to
-- anon/authenticated callers; route-level authorization remains mandatory.

create or replace function public.create_deliverable_suggestion_atomic(
  p_deliverable_id uuid,
  p_version_id uuid,
  p_firm_id uuid,
  p_author_role text,
  p_author_id uuid,
  p_author_name text,
  p_operation text,
  p_annotation jsonb,
  p_original_text text,
  p_replacement_text text,
  p_rationale text,
  p_source_body_sha256 text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_suggestion public.deliverable_suggestions;
begin
  insert into public.deliverable_suggestions (
    deliverable_id, version_id, firm_id, author_role, author_id,
    author_name, operation, annotation, original_text, replacement_text,
    rationale, source_body_sha256
  ) values (
    p_deliverable_id, p_version_id, p_firm_id, p_author_role, p_author_id,
    p_author_name, p_operation, p_annotation, p_original_text,
    p_replacement_text, p_rationale, p_source_body_sha256
  ) returning * into v_suggestion;

  insert into public.deliverable_suggestion_events (
    suggestion_id, firm_id, event_type, actor_role, actor_id
  ) values (
    v_suggestion.id, p_firm_id, 'created', p_author_role, p_author_id
  );

  return to_jsonb(v_suggestion);
end;
$$;

create or replace function public.create_deliverable_version_from_suggestions_atomic(
  p_deliverable_id uuid,
  p_firm_id uuid,
  p_source_version_id uuid,
  p_body_html text,
  p_note text,
  p_created_by_role text,
  p_created_by_id uuid,
  p_suggestion_ids uuid[],
  p_responds_to_approval_id uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_deliverable public.content_deliverables;
  v_version public.deliverable_versions;
  v_id uuid;
  v_state text;
  v_count integer;
begin
  if coalesce(cardinality(p_suggestion_ids), 0) = 0 then
    raise exception 'at least one suggestion is required';
  end if;

  select * into v_deliverable
    from public.content_deliverables
   where id = p_deliverable_id
     and firm_id = p_firm_id
   for update;
  if not found then raise exception 'deliverable not found for firm'; end if;
  if v_deliverable.current_version_id is distinct from p_source_version_id then
    raise exception 'source version is no longer current';
  end if;

  select count(*) into v_count
    from unnest(p_suggestion_ids) as ids(id)
    join public.deliverable_suggestions s on s.id = ids.id
   where s.deliverable_id = p_deliverable_id
     and s.firm_id = p_firm_id
     and s.version_id = p_source_version_id;
  if v_count <> cardinality(p_suggestion_ids) then
    raise exception 'suggestion scope does not match current deliverable version';
  end if;

  foreach v_id in array p_suggestion_ids loop
    select e.event_type into v_state
      from public.deliverable_suggestion_events e
     where e.suggestion_id = v_id
     order by e.created_at desc, e.id desc
     limit 1;
    if v_state is distinct from 'created' and v_state is distinct from 'needs_discussion' then
      raise exception 'suggestion % is not open', v_id;
    end if;
  end loop;

  insert into public.deliverable_versions (
    deliverable_id, firm_id, version_number, body_html, storage_path,
    asset_mime, asset_size_bytes, asset_name, asset_sha256, asset_validation,
    note, responds_to_approval_id, created_by_role, created_by_id
  )
  select p_deliverable_id, p_firm_id,
         coalesce(max(version_number), 0) + 1,
         p_body_html, null, null, null, null, null, null,
         p_note, p_responds_to_approval_id, p_created_by_role, p_created_by_id
  from public.deliverable_versions
   where deliverable_id = p_deliverable_id
   returning * into v_version;

  update public.content_deliverables
     set current_version_id = v_version.id,
         status = 'in_review',
         approved_version_id = null,
         approved_at = null,
         updated_at = now()
   where id = p_deliverable_id;

  insert into public.deliverable_suggestion_events (
    suggestion_id, firm_id, event_type, actor_role, actor_id,
    note, resulting_version_id
  )
  select ids.id, p_firm_id, 'applied', p_created_by_role, p_created_by_id,
         p_note, v_version.id
    from unnest(p_suggestion_ids) as ids(id);

  return jsonb_build_object('version_id', v_version.id,
                            'version_number', v_version.version_number);
end;
$$;

revoke all on function public.create_deliverable_suggestion_atomic(uuid, uuid, uuid, text, uuid, text, text, jsonb, text, text, text, text) from public, anon, authenticated;
revoke all on function public.create_deliverable_version_from_suggestions_atomic(uuid, uuid, uuid, text, text, text, uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.create_deliverable_suggestion_atomic(uuid, uuid, uuid, text, uuid, text, text, jsonb, text, text, text, text) to service_role;
grant execute on function public.create_deliverable_version_from_suggestions_atomic(uuid, uuid, uuid, text, text, text, uuid, uuid[], uuid) to service_role;
