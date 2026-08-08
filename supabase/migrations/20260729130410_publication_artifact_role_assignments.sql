-- Explicit operator placement for legacy publication artifacts.
-- This table is append-only: it does not mutate or delete the historical
-- publication_artifacts row and is intentionally server-managed.

create table if not exists public.publication_artifact_role_assignments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  artifact_id uuid not null references public.publication_artifacts(id) on delete restrict,
  deliverable_id uuid not null references public.content_deliverables(id) on delete restrict,
  version_id uuid not null references public.deliverable_versions(id) on delete restrict,
  asset_role text not null check (asset_role in (
    'website_article_hero_overlay',
    'website_homepage_cta_textless'
  )),
  assigned_by_role text not null default 'operator' check (assigned_by_role = 'operator'),
  assigned_by_id uuid,
  created_at timestamptz not null default now(),
  superseded_at timestamptz
);

create unique index if not exists publication_artifact_role_assignments_active_artifact_uidx
  on public.publication_artifact_role_assignments (artifact_id)
  where superseded_at is null;

create unique index if not exists publication_artifact_role_assignments_active_slot_uidx
  on public.publication_artifact_role_assignments (deliverable_id, version_id, asset_role)
  where superseded_at is null;

create index if not exists publication_artifact_role_assignments_deliverable_idx
  on public.publication_artifact_role_assignments (deliverable_id, version_id);

alter table public.publication_artifact_role_assignments enable row level security;
alter table public.publication_artifact_role_assignments force row level security;

revoke all on table public.publication_artifact_role_assignments from anon, authenticated;
