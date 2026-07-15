-- Content Studio Release Integrity, item 4
-- (docs/CONTENT_STUDIO_RELEASE_INTEGRITY_BUILD_PLAN.md): "Enforce
-- append-only approvals in Postgres... Triggers block UPDATE and DELETE on
-- approval_records... Reassignment of firm, deliverable, version, or
-- signer on an existing row is impossible."
--
-- Empirically verified 2026-07-15 against production
-- (information_schema.triggers): the only existing trigger on
-- approval_records is trg_block_approval_with_open_suggestions (BEFORE
-- INSERT, unrelated -- it blocks approving while open suggestions exist).
-- No append-only enforcement exists yet. This closes that gap.
--
-- Pattern matches block_publication_artifact_mutation()
-- (20260714141612_publication_artifacts.sql): unconditional raise, no
-- administrative exception. "Any administrative exception is explicit,
-- narrow, and auditable" is satisfied by having NONE: a genuine correction
-- inserts a new approval_records row instead (the same append-only-history
-- pattern already established for deliverable_versions and
-- publication_artifacts, per DR-085 / DR-094).
--
-- A new, generically-named function (not a reuse of
-- block_publication_artifact_mutation, which raises an artifact-specific
-- message) so the error a caller sees names the table it actually hit.
-- Reused below for publication_receipts in the same migration set.

create or replace function public.block_append_only_mutation()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  raise exception 'this table is append-only: rows may only be inserted, never updated or deleted (table: %)', tg_table_name;
end;
$function$;

drop trigger if exists trg_block_approval_record_mutation on public.approval_records;
create trigger trg_block_approval_record_mutation
before update or delete on public.approval_records
for each row execute function public.block_append_only_mutation();
