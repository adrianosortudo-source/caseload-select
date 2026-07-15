-- Content Studio publishing evidence system: closes two remaining gaps in
-- publication_receipts integrity found on adversarial re-review of
-- 20260715225139_publication_receipt_integrity_hardening.sql (NOT edited
-- by this migration; that migration is already applied to production and
-- its file has only been renamed, never modified, to match the version
-- production actually recorded for it).
--
-- Gap 1: 'unverified' and 'reconciling' rows are not constrained to carry
-- empty verified_at/verification_method/failure_reason. The application
-- (createReceipt/verifyReceipt in src/lib/publication-receipts.ts) never
-- violates this today -- every transition into 'verified'/'failed' is a
-- brand NEW row via reconciles_receipt_id, never a mutation of an
-- 'unverified' row in place -- but the database must not rely on that:
-- any future code path, script, or direct service-role write could
-- insert an 'unverified' row carrying stale or forged verification
-- metadata, and nothing at the DB layer currently rejects it. Closed with
-- two new CHECK constraints below. Neither conflicts with any existing
-- row: zero rows currently exist in publication_receipts in production.
--
-- Gap 2: a receipt can bind artifact_id to an artifact that HAS a
-- registered sha256 while the receipt's own artifact_sha256 column stays
-- null. The existing hardening only rejects a REAL disagreement (both
-- sides non-null and different); it never requires the receipt to carry
-- the hash at all. For a receipt meant to preserve proof of the exact
-- bytes published, an artifact-bound receipt with no hash of its own is
-- an incomplete record. Closed by auto-populating artifact_sha256 from
-- the trusted publication_artifacts row whenever the receipt omits it
-- and the artifact has one -- inside the same BEFORE INSERT trigger
-- (confirmed BEFORE INSERT via pg_get_triggerdef before writing this),
-- so it applies uniformly regardless of caller: the application route,
-- a script, or any future direct service-role write. This can only ever
-- WRITE a value the existing disagreement check would already have
-- rejected had the caller supplied a conflicting one, so it never
-- silently overrides a real disagreement, it only fills a gap the caller
-- left open. Placements with no artifact_id (LinkedIn, GBP, and other
-- non-file destinations) are entirely untouched by this change.

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
  -- Unchanged from 20260715225139_publication_receipt_integrity_hardening.sql.
  select firm_id, status, approved_version_id, current_version_id, period_id
    into v_deliverable_firm, v_deliverable_status, v_deliverable_approved_version,
         v_deliverable_current_version, v_deliverable_period
    from public.content_deliverables
   where id = new.deliverable_id;
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

  select firm_id, deliverable_id, destination, locale, period_id
    into v_placement_firm, v_placement_deliverable, v_placement_destination,
         v_placement_locale, v_placement_period
    from public.content_placements
   where id = new.placement_id;
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
    select firm_id, deliverable_id, version_id, superseded_at, sha256
      into v_artifact_firm, v_artifact_deliverable, v_artifact_version, v_artifact_superseded_at, v_artifact_sha256
      from public.publication_artifacts
     where id = new.artifact_id;
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

    -- NEW (this migration): backfill a caller-omitted hash from the
    -- trusted artifact row. See "Gap 2" above.
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

-- NEW (this migration): 'unverified' and 'reconciling' are both "not yet
-- resolved" states. Neither may carry verification metadata; that
-- metadata is written only by the state transition that actually
-- resolves the receipt ('verified' or 'failed'). See "Gap 1" above.
alter table public.publication_receipts
  add constraint publication_receipts_unverified_purity_check
  check (
    verification_state <> 'unverified'
    or (verified_at is null and verification_method is null and failure_reason is null)
  );

alter table public.publication_receipts
  add constraint publication_receipts_reconciling_purity_check
  check (
    verification_state <> 'reconciling'
    or (verified_at is null and verification_method is null and failure_reason is null)
  );

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verification (NOT executed by this migration; see
-- scripts/verify-publication-receipt-integrity-hardening.sql, run via the
-- Supabase MCP execute_sql tool wrapped in BEGIN/ROLLBACK, before this
-- migration is ever applied to production). Checks 1-13 there predate this
-- migration and are unaffected by it; checks 14-18 exercise exactly the
-- three fixes here:
--   14. An artifact with superseded_at set -- rejected (pre-existing
--       behavior, re-verified unchanged after this migration's edit).
--   15. artifact_id set, artifact has a real sha256, the receipt's own
--       artifact_sha256 left null -- succeeds, and the STORED row's
--       artifact_sha256 equals the artifact's sha256 (auto-populated).
--   16. locale disagreeing with the placement's own locale -- rejected
--       (pre-existing behavior, re-verified unchanged after this
--       migration's edit).
--   17. verification_state = 'unverified' with verified_at set -- rejected
--       (NEW).
--   18. verification_state = 'reconciling' (with a valid
--       reconciles_receipt_id, so it passes the pre-existing
--       reconciling-requires-id check) but also carrying verified_at --
--       rejected (NEW).
-- ---------------------------------------------------------------------------
