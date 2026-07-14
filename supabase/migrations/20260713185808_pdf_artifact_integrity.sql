-- Bind generated artifacts to the immutable deliverable version that was reviewed.
-- Existing rows remain valid with NULL metadata until an artifact is generated.

alter table public.deliverable_versions
  add column if not exists asset_sha256 text,
  add column if not exists asset_validation jsonb;

alter table public.deliverable_versions
  drop constraint if exists deliverable_versions_asset_sha256_format_check,
  add constraint deliverable_versions_asset_sha256_format_check
    check (asset_sha256 is null or asset_sha256 ~ '^[0-9a-f]{64}$');

alter table public.deliverable_versions
  drop constraint if exists deliverable_versions_asset_validation_object_check,
  add constraint deliverable_versions_asset_validation_object_check
    check (asset_validation is null or jsonb_typeof(asset_validation) = 'object');

comment on column public.deliverable_versions.asset_sha256 is
  'SHA-256 of the immutable generated artifact at storage_path.';
comment on column public.deliverable_versions.asset_validation is
  'Machine validation report for the immutable artifact, including profile and checks.';

create index if not exists deliverable_versions_asset_sha256_idx
  on public.deliverable_versions (asset_sha256)
  where asset_sha256 is not null;
