-- Content Studio publishing evidence system, Workstream 4: destination
-- placements, modeled independently from editorial format.
--
-- A single deliverable (a Counsel Note, a Clause in the Margin) commonly
-- needs MULTIPLE independent destinations at once (a DRG website article
-- AND a LinkedIn companion post; a GBP post pointing back at the same
-- article). The existing single-row columns on content_deliverables
-- (deliverable_role, publication_destination, publication_path, added by
-- 20260714101200_publication_metadata.sql / DR-096) can express only ONE
-- destination per deliverable and remain untouched here: they still drive
-- the existing Publication Readiness evaluator unchanged. content_placements
-- is ADDITIVE: the authoritative multi-destination model consumed by the
-- new preflight/receipts system, never a replacement for the existing
-- columns.
--
-- Ownership trigger + identity-lock trigger follow the same pattern as
-- publication_artifacts (validate-scope on insert) and publication_releases
-- (block only IDENTITY field mutation, allow the lifecycle fields to
-- change) from 20260714101300_publication_artifacts.sql. A placement is
-- NOT append-only like an approval or a receipt: its state legitimately
-- progresses planned -> ready -> published -> retired, and its schedule/
-- path can be corrected before publication. What must never change once
-- created is WHICH deliverable, WHICH destination, WHICH locale, and WHICH
-- firm a placement represents.

create table if not exists public.content_placements (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.intake_firms(id) on delete restrict,
  period_id uuid references public.content_periods(id) on delete restrict,
  deliverable_id uuid not null references public.content_deliverables(id) on delete restrict,
  destination text not null check (destination in (
    'firm_website', 'linkedin_article', 'linkedin_post', 'linkedin_company_page',
    'google_business_profile', 'email_delivery'
  )),
  locale text,
  intended_path text,
  required_artifact_type text check (
    required_artifact_type is null or required_artifact_type in (
      'hero_image', 'social_image', 'pdf', 'webpage', 'email',
      'thank_you_page', 'form', 'external_post'
    )
  ),
  scheduled_publish_date date,
  state text not null default 'planned' check (state in ('planned', 'ready', 'published', 'retired')),
  created_by_role text not null check (created_by_role in ('operator', 'lawyer', 'system')),
  created_by_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_placements_locale_format_check
    check (locale is null or locale ~ '^[a-z]{2,3}-[A-Z]{2}$'),
  unique (deliverable_id, destination, locale)
);

comment on table public.content_placements is
  'Standing intent record: this deliverable belongs at this destination, in this locale. Independent of editorial format (deliverable_role); one deliverable may have several placements. Never itself proof of publication -- see publication_receipts.';

create index if not exists content_placements_deliverable_idx
  on public.content_placements (deliverable_id);
create index if not exists content_placements_firm_state_idx
  on public.content_placements (firm_id, state);
create index if not exists content_placements_period_idx
  on public.content_placements (period_id);

create or replace function public.validate_content_placement_scope()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_deliverable_firm uuid;
  v_period_firm uuid;
begin
  select firm_id into v_deliverable_firm
    from public.content_deliverables
   where id = new.deliverable_id;

  if not found or v_deliverable_firm is distinct from new.firm_id then
    raise exception 'content placement must reference a deliverable from the same firm';
  end if;

  if new.period_id is not null then
    select firm_id into v_period_firm
      from public.content_periods
     where id = new.period_id;

    if not found or v_period_firm is distinct from new.firm_id then
      raise exception 'content placement must reference a period from the same firm';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_validate_content_placement_scope on public.content_placements;
create trigger trg_validate_content_placement_scope
before insert on public.content_placements
for each row execute function public.validate_content_placement_scope();

create or replace function public.block_content_placement_identity_mutation()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'content placements cannot be deleted; retire them instead (state = ''retired'')';
  end if;
  if new.firm_id is distinct from old.firm_id
     or new.deliverable_id is distinct from old.deliverable_id
     or new.destination is distinct from old.destination
     or new.locale is distinct from old.locale
     or new.created_at is distinct from old.created_at
     or new.id is distinct from old.id then
    raise exception 'content placement identity fields (firm_id, deliverable_id, destination, locale, id, created_at) cannot change; state, intended_path, required_artifact_type, scheduled_publish_date, period_id, and updated_at may';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_block_content_placement_identity_mutation on public.content_placements;
create trigger trg_block_content_placement_identity_mutation
before update or delete on public.content_placements
for each row execute function public.block_content_placement_identity_mutation();

alter table public.content_placements enable row level security;
alter table public.content_placements force row level security;
revoke all on public.content_placements from anon, authenticated, public;

notify pgrst, 'reload schema';
