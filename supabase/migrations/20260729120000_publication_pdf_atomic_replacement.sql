-- Checklist PDF replacement is an artifact correction, not a content-version
-- change. Historical artifact rows remain, with only their superseded marker
-- changing through the guarded atomic function below.

create table if not exists public.publication_artifact_supersessions (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  deliverable_id uuid not null references public.content_deliverables(id) on delete restrict,
  version_id uuid not null references public.deliverable_versions(id) on delete restrict,
  prior_artifact_id uuid not null references public.publication_artifacts(id) on delete restrict,
  replacement_artifact_id uuid not null references public.publication_artifacts(id) on delete restrict,
  reason text not null check (length(btrim(reason)) > 0),
  actor_role text not null check (actor_role = 'operator'),
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint publication_artifact_supersessions_same_slot_check
    check (prior_artifact_id <> replacement_artifact_id)
);

create index if not exists publication_artifact_supersessions_deliverable_idx
  on public.publication_artifact_supersessions (deliverable_id, version_id, created_at desc);

alter table public.publication_artifact_supersessions enable row level security;
alter table public.publication_artifact_supersessions force row level security;
revoke all on table public.publication_artifact_supersessions from anon, authenticated, public;
grant select, insert on table public.publication_artifact_supersessions to service_role;

-- Preserve the append-only protection while permitting the one controlled
-- state transition needed by the existing partial active-slot index:
-- NULL -> timestamp on superseded_at, with every other field unchanged.
create or replace function public.block_publication_artifact_mutation()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if tg_op = 'UPDATE'
     and old.superseded_at is null
     and new.superseded_at is not null
     and (to_jsonb(new) - 'superseded_at') = (to_jsonb(old) - 'superseded_at') then
    return new;
  end if;
  raise exception 'publication artifacts are append-only except for one-way supersession';
end;
$function$;

create or replace function public.register_or_replace_publication_pdf_atomic(
  p_firm_id uuid,
  p_deliverable_id uuid,
  p_version_id uuid,
  p_prior_artifact_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_locale text,
  p_destination text,
  p_mime_type text,
  p_size_bytes integer,
  p_sha256 text,
  p_actor_role text,
  p_actor_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_current_version uuid;
  v_role text;
  v_prior public.publication_artifacts%rowtype;
  v_new_id uuid;
begin
  if p_actor_role <> 'operator' then
    raise exception 'operator role required';
  end if;
  if p_storage_bucket <> 'firm-files' or p_mime_type <> 'application/pdf' then
    raise exception 'invalid PDF storage metadata';
  end if;
  if p_storage_path is null or p_size_bytes is null or p_size_bytes <= 0
     or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'incomplete PDF storage metadata';
  end if;
  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = p_storage_bucket
       and o.name = p_storage_path
  ) then
    raise exception 'PDF storage object does not exist';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'replacement reason is required';
  end if;

  select d.current_version_id, d.deliverable_role
    into v_current_version, v_role
    from public.content_deliverables d
   where d.id = p_deliverable_id
     and d.firm_id = p_firm_id
   for update;
  if not found then raise exception 'deliverable not found'; end if;
  if v_role <> 'lead_magnet_pdf' then raise exception 'deliverable is not a checklist PDF'; end if;
  if v_current_version is distinct from p_version_id then raise exception 'PDF must bind to the current version'; end if;

  if p_prior_artifact_id is not null then
    select * into v_prior
      from public.publication_artifacts a
     where a.id = p_prior_artifact_id
       and a.firm_id = p_firm_id
       and a.deliverable_id = p_deliverable_id
       and a.version_id = p_version_id
       and a.artifact_type = 'pdf'
       and a.superseded_at is null
     for update;
    if not found then raise exception 'prior PDF is not the active current artifact'; end if;
    update public.publication_artifacts
       set superseded_at = now()
     where id = p_prior_artifact_id;
  else
    if exists (
      select 1 from public.publication_artifacts a
       where a.firm_id = p_firm_id
         and a.deliverable_id = p_deliverable_id
         and a.version_id = p_version_id
         and a.artifact_type = 'pdf'
         and a.superseded_at is null
    ) then
      raise exception 'an active PDF already exists';
    end if;
  end if;

  insert into public.publication_artifacts (
    firm_id, deliverable_id, version_id, artifact_type, asset_role,
    locale, destination, storage_bucket, storage_path, mime_type,
    size_bytes, sha256, created_by_role, created_by_id
  ) values (
    p_firm_id, p_deliverable_id, p_version_id, 'pdf', null,
    p_locale, p_destination, p_storage_bucket, p_storage_path, p_mime_type,
    p_size_bytes, p_sha256, 'operator', p_actor_id
  ) returning id into v_new_id;

  if p_prior_artifact_id is not null then
    insert into public.publication_artifact_supersessions (
      firm_id, deliverable_id, version_id, prior_artifact_id,
      replacement_artifact_id, reason, actor_role, actor_id
    ) values (
      p_firm_id, p_deliverable_id, p_version_id, p_prior_artifact_id,
      v_new_id, btrim(p_reason), 'operator', p_actor_id
    );
  end if;

  return v_new_id;
end;
$function$;

revoke all on function public.register_or_replace_publication_pdf_atomic(
  uuid, uuid, uuid, uuid, text, text, text, text, text, integer, text, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.register_or_replace_publication_pdf_atomic(
  uuid, uuid, uuid, uuid, text, text, text, text, text, integer, text, text, uuid, text
) to service_role;
