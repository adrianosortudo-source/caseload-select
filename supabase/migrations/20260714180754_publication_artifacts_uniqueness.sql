-- Release-gate fix: prevent a retried registration from creating
-- duplicate active evidence for the same (deliverable, version, artifact
-- type, locale, destination) slot. publication_artifacts is append-only
-- (no UPDATE/DELETE), so without this a re-run of a registration script
-- would silently accumulate duplicate rows rather than erroring, and the
-- readiness evaluator would just pick whichever one sorts first -- not a
-- correctness bug in the evaluator, but a real data-hygiene gap in the
-- registration path this migration closes at the source.
--
-- locale/destination are nullable, and plain UNIQUE constraints treat NULL
-- as distinct from NULL (no conflict), so this uses an expression index
-- with coalesce() to a sentinel so two NULL-locale rows for the same
-- deliverable/version/type still collide correctly.
create unique index if not exists publication_artifacts_dedupe_idx
  on public.publication_artifacts (
    deliverable_id,
    version_id,
    artifact_type,
    coalesce(locale, ''),
    coalesce(destination, '')
  );
