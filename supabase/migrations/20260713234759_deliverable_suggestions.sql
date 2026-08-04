-- Ported verbatim from commit 8b97eb8 (branch fix/restore-marketing-homepage,
-- also present identically as fe6ab8f on feat/deliverable-suggestions-release,
-- diff-confirmed byte-identical). Neither branch is merged to main, but this
-- migration and its three siblings (atomic_workflow, fk_indexes,
-- release_hardening) were already applied to production
-- (ssxryjxifwiivghglqer): ledger versions 20260713234759, 20260713235455,
-- 20260714001604, 20260714011950. Filenames here are reconciled to those
-- actual applied ledger versions (the branch's original filenames used the
-- author's local timestamps: 20260713234632, 20260713235900, 20260713235930,
-- 20260714004511). No content was altered from the source branch.
--
-- Full evidence trail: docs/BASELINE_MIGRATION_DECISION_RECORD.md

-- Structured Google-Docs-style suggestions, kept separate from ordinary
-- comments and immutable deliverable versions.

create table if not exists public.deliverable_suggestions (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references public.content_deliverables(id) on delete restrict,
  version_id uuid not null references public.deliverable_versions(id) on delete restrict,
  firm_id uuid not null,
  author_role text not null check (author_role in ('operator', 'lawyer')),
  author_id uuid,
  author_name text,
  operation text not null check (operation in ('replace', 'delete')),
  annotation jsonb not null,
  original_text text not null,
  replacement_text text,
  rationale text,
  source_body_sha256 text,
  created_at timestamptz not null default now(),
  constraint deliverable_suggestions_annotation_object_check
    check (jsonb_typeof(annotation) = 'object'),
  constraint deliverable_suggestions_replacement_check
    check (
      (operation = 'delete' and replacement_text is null)
      or (operation = 'replace' and replacement_text is not null and length(replacement_text) > 0)
    ),
  constraint deliverable_suggestions_sha256_check
    check (source_body_sha256 is null or source_body_sha256 ~ '^[0-9a-f]{64}$')
);

create table if not exists public.deliverable_suggestion_events (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.deliverable_suggestions(id) on delete restrict,
  firm_id uuid not null,
  event_type text not null check (event_type in (
    'created', 'needs_discussion', 'applied', 'declined', 'withdrawn', 'superseded'
  )),
  actor_role text not null check (actor_role in ('operator', 'lawyer')),
  actor_id uuid,
  note text,
  resulting_version_id uuid references public.deliverable_versions(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint deliverable_suggestion_events_result_check
    check ((event_type = 'applied') = (resulting_version_id is not null))
);

create index if not exists deliverable_suggestions_version_idx
  on public.deliverable_suggestions (deliverable_id, version_id, created_at);
create index if not exists deliverable_suggestion_events_suggestion_idx
  on public.deliverable_suggestion_events (suggestion_id, created_at);
create index if not exists deliverable_suggestion_events_firm_idx
  on public.deliverable_suggestion_events (firm_id, created_at);

create or replace function public.validate_deliverable_suggestion_scope()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_deliverable_firm uuid;
  v_version_deliverable uuid;
  v_version_firm uuid;
begin
  select d.firm_id, v.deliverable_id, v.firm_id
    into v_deliverable_firm, v_version_deliverable, v_version_firm
  from public.content_deliverables d
  join public.deliverable_versions v on v.deliverable_id = d.id
  where d.id = new.deliverable_id and v.id = new.version_id;

  if not found
     or v_deliverable_firm is distinct from new.firm_id
     or v_version_deliverable is distinct from new.deliverable_id
     or v_version_firm is distinct from new.firm_id then
    raise exception 'suggestion must reference a version from the same firm and deliverable';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_validate_deliverable_suggestion_scope on public.deliverable_suggestions;
create trigger trg_validate_deliverable_suggestion_scope
before insert on public.deliverable_suggestions
for each row execute function public.validate_deliverable_suggestion_scope();

create or replace function public.validate_deliverable_suggestion_event_scope()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_deliverable_id uuid;
  v_suggestion_firm uuid;
  v_version_firm uuid;
begin
  select s.deliverable_id, s.firm_id
    into v_deliverable_id, v_suggestion_firm
  from public.deliverable_suggestions s
  where s.id = new.suggestion_id;

  if not found or v_suggestion_firm is distinct from new.firm_id then
    raise exception 'suggestion event must reference a suggestion from the same firm';
  end if;

  if new.resulting_version_id is not null then
    select firm_id into v_version_firm
    from public.deliverable_versions
    where id = new.resulting_version_id and deliverable_id = v_deliverable_id;
    if not found or v_version_firm is distinct from new.firm_id then
      raise exception 'applied suggestion event must reference a version from the same firm and deliverable';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_validate_deliverable_suggestion_event_scope on public.deliverable_suggestion_events;
create trigger trg_validate_deliverable_suggestion_event_scope
before insert on public.deliverable_suggestion_events
for each row execute function public.validate_deliverable_suggestion_event_scope();

create or replace function public.block_deliverable_suggestion_mutation()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  raise exception 'deliverable suggestions and their events are append-only';
end;
$function$;

drop trigger if exists trg_block_deliverable_suggestion_mutation on public.deliverable_suggestions;
create trigger trg_block_deliverable_suggestion_mutation
before update or delete on public.deliverable_suggestions
for each row execute function public.block_deliverable_suggestion_mutation();

drop trigger if exists trg_block_deliverable_suggestion_event_mutation on public.deliverable_suggestion_events;
create trigger trg_block_deliverable_suggestion_event_mutation
before update or delete on public.deliverable_suggestion_events
for each row execute function public.block_deliverable_suggestion_mutation();

alter table public.deliverable_suggestions enable row level security;
alter table public.deliverable_suggestion_events enable row level security;

comment on table public.deliverable_suggestions is
  'Immutable client/operator wording proposals anchored to an immutable deliverable version.';
comment on table public.deliverable_suggestion_events is
  'Append-only lifecycle events for deliverable suggestions.';
