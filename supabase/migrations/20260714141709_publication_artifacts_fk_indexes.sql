-- Cover the version_id foreign keys flagged by the performance advisor
-- immediately after 20260714141612_publication_artifacts.sql applied.
create index if not exists publication_artifacts_version_idx
  on public.publication_artifacts (version_id);
create index if not exists publication_release_items_version_idx
  on public.publication_release_items (version_id);
