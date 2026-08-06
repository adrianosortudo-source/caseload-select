-- Backfill for the ALREADY LIVE DRG Law Minute deliverable
-- (764cd417-7f71-4b3e-919e-39e720fb9c13, "The DRG Law Minute — The renewal
-- clause that shapes your next rent", created 2026-07-20). This is a data
-- migration, not a schema change; it only runs after
-- 20260719140000_content_deliverables_email_role_widen.sql permits the
-- values it sets.
--
-- Why this exists rather than reusing the original prepared insert
-- (20260719140500_renewal_clause_drg_law_minute_deliverable.sql, prepared
-- 2026-07-19, removed from the tree): that file predates the live
-- deliverable by one day and has different title/copy. Applying it would
-- have inserted a SECOND, different Minute into the same period -- a
-- duplicate, not a backfill. Verified directly against production before
-- writing this file: the live row has a real current_version_id (one
-- version, real body) and requires_individual_review correctly set with a
-- recorded hold reason (the placeholder unsubscribe link) -- it is complete
-- content, only missing the two columns this migration fills in, and its
-- content_placements row, which never existed.
--
-- Both statements are idempotent AND guarded on the target deliverable
-- actually existing. The guard is not defensive decoration: CI's real-
-- Postgres job (see docs/audits/MIGRATION_LINEAGE_PHASE1_EXECUTION_PLAN.md's
-- description of that job's scope) replays every migration against a fresh,
-- empty database on every run -- this specific deliverable row exists only
-- in the one production database this migration is actually for. Without the
-- guard, the INSERT trips
-- validate_content_placement_scope()'s "content placement must reference a
-- deliverable from the same firm" check the moment the referenced
-- deliverable does not exist, and CI fails on every PR, forever. Confirmed
-- by running this migration against a clean local `supabase db reset` before
-- adding the guard: exactly that error, reproduced.
--
-- Net effect: a no-op everywhere except the one production database where
-- 764cd417-7f71-4b3e-919e-39e720fb9c13 is real, where it fills in the two
-- columns and the missing placement row exactly once.

update public.content_deliverables
   set deliverable_role = 'email_newsletter',
       publication_destination = 'email'
 where id = '764cd417-7f71-4b3e-919e-39e720fb9c13'
   and deliverable_role is null
   and publication_destination is null;

insert into public.content_placements (
  firm_id, period_id, deliverable_id, destination, locale,
  required_artifact_type, state, created_by_role
)
select
  'eec1d25e-a047-4827-8e4a-6eb96becca2b', -- DRG Law
  '7ca11880-42a9-4bab-940a-baf2966b9f7e', -- The Renewal Clause
  '764cd417-7f71-4b3e-919e-39e720fb9c13', -- the live Minute deliverable
  'email_delivery', 'en-CA', 'email', 'planned', 'operator'
where exists (
  select 1 from public.content_deliverables
  where id = '764cd417-7f71-4b3e-919e-39e720fb9c13'
)
and not exists (
  select 1 from public.content_placements
  where deliverable_id = '764cd417-7f71-4b3e-919e-39e720fb9c13'
    and destination = 'email_delivery'
);
