-- Content Studio publishing evidence system: receipt/version concurrency
-- integrity.
--
-- Corrective-release audit finding 1. The append-only publication_receipts
-- trigger (validate_publication_receipt_scope, most recently redefined by
-- 20260715231733_publication_receipt_hardening_supplement.sql, NOT edited
-- by this migration) reads the deliverable's current/approved version and
-- the placement's scope with plain SELECTs. Under READ COMMITTED (Postgres
-- default), a plain SELECT takes its own snapshot at statement-fire time;
-- nothing stops a concurrent transaction from committing a version change
-- to content_deliverables (a new approved version, or the
-- deliverable_track_current_version trigger repointing current_version_id)
-- between this trigger's read and this INSERT's own commit. The checks
-- introduced by the two prior hardening migrations are real, but they run
-- against a stale, unlocked read -- exactly the TOCTOU gap this migration
-- closes.
--
-- Fix: the two authoritative rows this trigger depends on --
-- content_deliverables and, when an artifact is attached,
-- publication_artifacts -- are now read with SELECT ... FOR UPDATE.
-- content_placements is also locked, per the finding's explicit
-- requirement, even though its columns read here (destination/locale/
-- period_id) are not currently subject to a documented concurrent-writer
-- path; locking it is cheap and closes that door structurally rather than
-- by convention. FOR UPDATE inside a BEFORE INSERT trigger blocks this
-- INSERT until any transaction concurrently holding that row (e.g. the
-- approval RPC advancing approved_version_id, or the version-insert
-- trigger repointing current_version_id) commits or rolls back, then reads
-- the POST-commit values -- so every check below runs against the row's
-- true current state, not a snapshot that could be superseded before this
-- INSERT lands. Every existing validation rule is otherwise byte-identical
-- to the supplement migration; only the row-locking changed.
--
-- No new columns, no new constraints -- purely a locking change to an
-- existing trigger function via CREATE OR REPLACE, the same pattern the
-- two prior hardening migrations already used to extend this function
-- without editing their files.
--
-- HISTORICAL NOTE (kept for an accurate forward-only record): this
-- migration was authored from a pre-fetch of
-- validate_publication_receipt_scope() that predated a concurrent
-- session's fix, applied to production as ledger version 20260716144315
-- and later committed as
-- supabase/migrations/20260716120000_publication_receipt_verification_after_revision_fix.sql
-- via PR #39 (that file's own filename prefix does not match its real
-- applied version -- see docs/audits/MIGRATION-LINEAGE-REPORT-2026-07-16.md,
-- which was updated to record this as a second live instance of the
-- filename-drift class it documents). That fix had already been applied
-- to production by the time this migration ran (both share the same
-- author-observed apply window). Because both use
-- CREATE OR REPLACE FUNCTION on the same function, applying this one
-- reverted that one on production for a few minutes. Both fixes were
-- restored together, immediately upon discovery, by
-- 20260716144723_publication_receipt_reconcile_concurrency_lock_merge.sql,
-- which is the function's current, correct, live definition -- read that
-- file for the actual state of the function today, not this one.

create or replace function public.validate_publication_receipt_scope()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_deliverable_firm uuid;
  v_deliverable_status text;
  v_deliverable_approved_version uuid;
  v_deliverable_current_version uuid;
  v_deliverable_period uuid;
  v_placement_firm uuid;
  v_placement_deliverable uuid;
  v_placement_destination text;
  v_placement_locale text;
  v_placement_period uuid;
  v_version_deliverable uuid;
  v_version_firm uuid;
  v_artifact_firm uuid;
  v_artifact_deliverable uuid;
  v_artifact_version uuid;
  v_artifact_superseded_at timestamptz;
  v_artifact_sha256 text;
  v_reconciles_firm uuid;
  v_reconciles_deliverable uuid;
  v_reconciles_placement uuid;
begin
  -- CHANGED (this migration): FOR UPDATE. Locks the deliverable row for
  -- the remainder of this transaction, blocking any concurrent writer of
  -- current_version_id/approved_version_id/status until this INSERT
  -- commits or rolls back, and guaranteeing this SELECT itself waits out
  -- any writer that already holds the lock before reading.
  select firm_id, status, approved_version_id, current_version_id, period_id
    into v_deliverable_firm, v_deliverable_status, v_deliverable_approved_version,
         v_deliverable_current_version, v_deliverable_period
    from public.content_deliverables
   where id = new.deliverable_id
     for update;
  if not found or v_deliverable_firm is distinct from new.firm_id then
    raise exception 'publication receipt must reference a deliverable from the same firm';
  end if;

  if v_deliverable_status is distinct from 'approved' then
    raise exception 'publication receipt requires an approved deliverable, found status %', v_deliverable_status;
  end if;

  if new.approved_version_id is distinct from v_deliverable_approved_version then
    raise exception 'publication receipt approved_version_id (%) does not match the deliverable''s own approved_version_id (%)',
      new.approved_version_id, v_deliverable_approved_version;
  end if;

  if v_deliverable_approved_version is distinct from v_deliverable_current_version then
    raise exception 'publication receipt requires approved_version_id to equal current_version_id (version drift); approved=%, current=%',
      v_deliverable_approved_version, v_deliverable_current_version;
  end if;

  -- CHANGED (this migration): FOR UPDATE, per the finding's explicit
  -- requirement to lock the placement row during receipt creation.
  select firm_id, deliverable_id, destination, locale, period_id
    into v_placement_firm, v_placement_deliverable, v_placement_destination,
         v_placement_locale, v_placement_period
    from public.content_placements
   where id = new.placement_id
     for update;
  if not found
     or v_placement_firm is distinct from new.firm_id
     or v_placement_deliverable is distinct from new.deliverable_id
     or v_placement_destination is distinct from new.destination then
    raise exception 'publication receipt must reference a placement from the same firm, deliverable, and destination';
  end if;

  if new.locale is not null and v_placement_locale is not null and new.locale is distinct from v_placement_locale then
    raise exception 'publication receipt locale (%) does not match its placement''s locale (%)', new.locale, v_placement_locale;
  end if;

  if new.period_id is not null then
    if v_placement_period is not null and new.period_id is distinct from v_placement_period then
      raise exception 'publication receipt period_id (%) does not match its placement''s period_id (%)', new.period_id, v_placement_period;
    end if;
    if v_deliverable_period is not null and new.period_id is distinct from v_deliverable_period then
      raise exception 'publication receipt period_id (%) does not match its deliverable''s period_id (%)', new.period_id, v_deliverable_period;
    end if;
  end if;

  select deliverable_id, firm_id into v_version_deliverable, v_version_firm
    from public.deliverable_versions
   where id = new.approved_version_id;
  if not found
     or v_version_deliverable is distinct from new.deliverable_id
     or v_version_firm is distinct from new.firm_id then
    raise exception 'publication receipt must reference an approved_version_id from the same firm and deliverable';
  end if;

  if new.artifact_id is not null then
    -- CHANGED (this migration): FOR UPDATE. superseded_at is a mutable
    -- column on publication_artifacts (an artifact can be superseded by a
    -- later one); locking closes the same class of race for "artifact
    -- binding", called out explicitly by the finding.
    select firm_id, deliverable_id, version_id, superseded_at, sha256
      into v_artifact_firm, v_artifact_deliverable, v_artifact_version, v_artifact_superseded_at, v_artifact_sha256
      from public.publication_artifacts
     where id = new.artifact_id
       for update;
    if not found
       or v_artifact_firm is distinct from new.firm_id
       or v_artifact_deliverable is distinct from new.deliverable_id then
      raise exception 'publication receipt must reference an artifact_id from the same firm and deliverable';
    end if;

    if v_artifact_version is distinct from new.approved_version_id then
      raise exception 'publication receipt artifact_id is bound to version % but this receipt approves version %',
        v_artifact_version, new.approved_version_id;
    end if;

    if v_artifact_superseded_at is not null then
      raise exception 'publication receipt artifact_id references a superseded artifact (superseded_at %)', v_artifact_superseded_at;
    end if;

    if new.artifact_sha256 is not null and v_artifact_sha256 is not null and new.artifact_sha256 is distinct from v_artifact_sha256 then
      raise exception 'publication receipt artifact_sha256 (%) does not match the registered artifact''s sha256 (%)',
        new.artifact_sha256, v_artifact_sha256;
    end if;

    if new.artifact_sha256 is null and v_artifact_sha256 is not null then
      new.artifact_sha256 := v_artifact_sha256;
    end if;
  end if;

  if new.reconciles_receipt_id is not null then
    if new.reconciles_receipt_id = new.id then
      raise exception 'publication receipt cannot set reconciles_receipt_id to its own id';
    end if;

    -- Unchanged: publication_receipts rows are append-only/immutable once
    -- inserted (no UPDATE path exists on this table), so no FOR UPDATE is
    -- needed here; the pre-existing partial unique index on
    -- reconciles_receipt_id already serializes the fork-prevention
    -- invariant at commit time.
    select firm_id, deliverable_id, placement_id
      into v_reconciles_firm, v_reconciles_deliverable, v_reconciles_placement
      from public.publication_receipts
     where id = new.reconciles_receipt_id;
    if not found
       or v_reconciles_firm is distinct from new.firm_id
       or v_reconciles_deliverable is distinct from new.deliverable_id
       or v_reconciles_placement is distinct from new.placement_id then
      raise exception 'publication receipt reconciles_receipt_id must reference a receipt from the same firm, deliverable, and placement';
    end if;
  end if;

  if new.verification_state = 'reconciling' and new.reconciles_receipt_id is null then
    raise exception 'publication receipt verification_state ''reconciling'' requires reconciles_receipt_id to be set';
  end if;

  return new;
end;
$function$;

notify pgrst, 'reload schema';
