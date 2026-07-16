-- Merges two independently-applied fixes to validate_publication_receipt_scope()
-- that landed within seconds of each other from two concurrent sessions
-- during this corrective release:
--   20260716144315 publication_receipt_verification_after_revision_fix --
--     exempts a verification/failure/reconciling row from the strict
--     current-approval gates (a genuine correctness fix: without it,
--     verifying a historical receipt becomes permanently impossible the
--     moment the deliverable is next revised).
--   20260716144510 publication_receipt_concurrency_lock -- adds
--     SELECT ... FOR UPDATE locking on content_deliverables,
--     content_placements, and publication_artifacts (corrective-release
--     audit finding 1: receipt/version concurrency integrity).
--
-- Because both used CREATE OR REPLACE FUNCTION on the same function and
-- the second was authored from a pre-fetch of the function that predated
-- the first, applying the second silently reverted the first (confirmed
-- via pg_get_functiondef immediately after both had run: the live
-- definition contained the FOR UPDATE locks but not the reconciling-
-- verification branch). This migration restores both fixes together in a
-- single, correct definition, applied within minutes of the collision
-- being discovered. No new logic beyond what each of the two source
-- migrations already introduced -- this is a merge, not a third
-- independent change.
--
-- Verified via scripts/verify-publication-receipt-concurrency-lock.sql
-- (checks 1-5, rollback-wrapped) after this migration applied: FOR UPDATE
-- present on all three locked reads, the full pre-existing validation
-- battery unregressed, and the reconciling-verification exemption from
-- 20260716144315 still functions (verifying a historical receipt after a
-- deliverable revision succeeds).

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
  v_reconciles_approved_version uuid;
  v_reconciling_verification boolean;
begin
  -- FOR UPDATE (finding 1): locks the deliverable row for the remainder of
  -- this transaction against any concurrent writer of
  -- current_version_id/approved_version_id/status.
  select firm_id, status, approved_version_id, current_version_id, period_id
    into v_deliverable_firm, v_deliverable_status, v_deliverable_approved_version,
         v_deliverable_current_version, v_deliverable_period
    from public.content_deliverables
   where id = new.deliverable_id
     for update;
  if not found or v_deliverable_firm is distinct from new.firm_id then
    raise exception 'publication receipt must reference a deliverable from the same firm';
  end if;

  -- Is this row an opinion about an EARLIER receipt (verified / failed /
  -- reconciling, with reconciles_receipt_id set), or a fresh publish
  -- claim? See 20260716144315's reasoning: a verification/failure row
  -- re-affirms or disputes an ALREADY-RECORDED publish and must not be
  -- gated against the deliverable's CURRENT approval state, which may have
  -- moved on since the original receipt was recorded.
  v_reconciling_verification := new.reconciles_receipt_id is not null
    and new.verification_state in ('verified', 'failed', 'reconciling');
  if v_reconciling_verification then
    select approved_version_id into v_reconciles_approved_version
      from public.publication_receipts
     where id = new.reconciles_receipt_id;
  end if;

  if v_reconciling_verification then
    if new.approved_version_id is distinct from v_reconciles_approved_version then
      raise exception 'a verification, failure, or reconciling receipt must carry the same approved_version_id (%) as the receipt it reconciles (got %)',
        v_reconciles_approved_version, new.approved_version_id;
    end if;
  else
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
  end if;

  -- FOR UPDATE (finding 1), per its explicit requirement to lock the
  -- placement row during receipt creation.
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
    -- FOR UPDATE (finding 1): closes the same class of race for the
    -- mutable superseded_at column on an artifact binding.
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
