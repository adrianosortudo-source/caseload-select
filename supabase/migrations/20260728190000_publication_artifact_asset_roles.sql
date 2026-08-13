-- Distinguish multiple image renditions for the same website article.
-- Existing rows remain valid with a NULL role and are not classified here.
alter table public.publication_artifacts
  add column if not exists asset_role text;

alter table public.publication_artifacts
  drop constraint if exists publication_artifacts_asset_role_check;

alter table public.publication_artifacts
  add constraint publication_artifacts_asset_role_check
  check (asset_role is null or asset_role in (
    'website_article_hero_overlay',
    'website_homepage_cta_textless'
  ));

drop index if exists public.publication_artifacts_dedupe_idx;

create unique index publication_artifacts_dedupe_idx
  on public.publication_artifacts (
    deliverable_id,
    version_id,
    artifact_type,
    coalesce(asset_role, ''),
    coalesce(locale, ''),
    coalesce(destination, '')
  )
  where superseded_at is null;

comment on column public.publication_artifacts.asset_role is
  'Explicit rendition role within a placement. NULL preserves legacy artifacts whose placement was not recorded.';
