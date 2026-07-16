-- The original publication_artifacts_dedupe_idx (20260714150000_publication_artifacts_uniqueness)
-- was a full-table unique index, so it rejects the supersession insert its own header comment
-- says it exists to support: a new ACTIVE artifact for a slot while the prior row is marked
-- superseded_at = now(). Scope the index to active rows only so historical superseded rows can
-- coexist with a new active row in the same (deliverable_id, version_id, artifact_type, locale,
-- destination) slot, while still enforcing at most one active artifact per slot.

drop index if exists public.publication_artifacts_dedupe_idx;

create unique index publication_artifacts_dedupe_idx
  on public.publication_artifacts (
    deliverable_id,
    version_id,
    artifact_type,
    coalesce(locale, ''),
    coalesce(destination, '')
  )
  where superseded_at is null;
