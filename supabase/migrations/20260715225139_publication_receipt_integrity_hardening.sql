-- Content Studio publishing evidence system: receipt integrity hardening.
--
-- An adversarial review of the append-only publication_receipts trigger
-- (validate_publication_receipt_scope, in
-- 20260715191243_20260715130200_publication_receipts.sql, NOT edited by
-- this migration) found it checks ownership scope only: same firm, same
-- placement/deliverable, same destination. It never checks that the
-- version being published is actually the CURRENT approved one, that an
-- attached artifact is bound to that same version and not superseded,
-- that a supplied hash agrees with the artifact's own recorded hash, that
-- a reconciliation link stays within its own placement and forms a single
-- chain rather than a fork, or that the verification-state columns are
-- internally consistent beyond the bare verified_at/verification_method
-- pairing already enforced. This migration closes those gaps by
-- extending the same trigger function in place (create or replace, same
-- function name and trigger, matching the pattern already used for
-- validate_readiness_activation in
-- 20260715210116_content_periods_enforced_monotonic.sql) and adding new
-- table-level CHECK constraints and a partial unique index.
--
-- Nothing here weakens the append-only trigger already in force
-- (trg_block_publication_receipt_mutation); every new rule is enforced at
-- INSERT time only, since publication_receipts never accepts UPDATE.

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
  -- Unchanged from the original migration: same-firm deliverable scope,
  -- now extended to also pull status/approved_version_id/current_version_id
  -- /period_id, which the original check never looked at.
  select firm_id, status, approved_version_id, current_version_id, period_id
    into v_deliverable_firm, v_deliverable_status, v_deliverable_approved_version,
         v_deliverable_current_version, v_deliverable_period
    from public.content_deliverables
   where id = new.deliverable_id;
  if not found or v_deliverable_firm is distinct from new.firm_id then
    raise exception 'publication receipt must reference a deliverable from the same firm';
  end if;

  -- NEW: a receipt can only ever claim to publish an APPROVED deliverable.
  if v_deliverable_status is distinct from 'approved' then
    raise exception 'publication receipt requires an approved deliverable, found status %', v_deliverable_status;
  end if;

  -- NEW: the version this receipt binds to must be the deliverable's own
  -- current approved_version_id, not merely SOME version belonging to the
  -- same deliverable. Without this, a receipt could bind approval to an
  -- arbitrary earlier or later version of the same deliverable.
  if new.approved_version_id is distinct from v_deliverable_approved_version then
    raise exception 'publication receipt approved_version_id (%) does not match the deliverable''s own approved_version_id (%)',
      new.approved_version_id, v_deliverable_approved_version;
  end if;

  -- NEW: guard against version drift at the DB layer too (the app layer
  -- already resets approved_version_id to null when a new version posts;
  -- this is defense in depth against any path that bypasses that logic).
  if v_deliverable_approved_version is distinct from v_deliverable_current_version then
    raise exception 'publication receipt requires approved_version_id to equal current_version_id (version drift); approved=%, current=%',
      v_deliverable_approved_version, v_deliverable_current_version;
  end if;

  -- Unchanged from the original migration: same-firm/deliverable/destination
  -- placement scope, now extended to also pull locale/period_id.
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

  -- NEW: locale consistency. Null semantics: either side left null is
  -- "unspecified", not a mismatch -- content_placements.locale and
  -- publication_receipts.locale are both genuinely optional (a
  -- non-localized destination, e.g. a single-language firm, may never set
  -- either). This only rejects a REAL disagreement: both sides non-null
  -- and different.
  if new.locale is not null and v_placement_locale is not null and new.locale is distinct from v_placement_locale then
    raise exception 'publication receipt locale (%) does not match its placement''s locale (%)', new.locale, v_placement_locale;
  end if;

  -- NEW: period consistency, checked against both the placement's own
  -- period_id and the deliverable's period_id. Null semantics: a null
  -- period_id anywhere (receipt, placement, or deliverable) is
  -- "unspecified", never treated as a wildcard that matches anything a
  -- caller supplies -- this only rejects a receipt whose OWN non-null
  -- period_id actively disagrees with a non-null period_id already on
  -- record, which is exactly the "silent cross-period evidence" case this
  -- check exists to close.
  if new.period_id is not null then
    if v_placement_period is not null and new.period_id is distinct from v_placement_period then
      raise exception 'publication receipt period_id (%) does not match its placement''s period_id (%)', new.period_id, v_placement_period;
    end if;
    if v_deliverable_period is not null and new.period_id is distinct from v_deliverable_period then
      raise exception 'publication receipt period_id (%) does not match its deliverable''s period_id (%)', new.period_id, v_deliverable_period;
    end if;
  end if;

  -- Unchanged from the original migration: version scope.
  select deliverable_id, firm_id into v_version_deliverable, v_version_firm
    from public.deliverable_versions
   where id = new.approved_version_id;
  if not found
     or v_version_deliverable is distinct from new.deliverable_id
     or v_version_firm is distinct from new.firm_id then
    raise exception 'publication receipt must reference an approved_version_id from the same firm and deliverable';
  end if;

  if new.artifact_id is not null then
    -- Unchanged: same-firm/deliverable artifact scope, now extended to
    -- also pull version_id/superseded_at/sha256.
    select firm_id, deliverable_id, version_id, superseded_at, sha256
      into v_artifact_firm, v_artifact_deliverable, v_artifact_version, v_artifact_superseded_at, v_artifact_sha256
      from public.publication_artifacts
     where id = new.artifact_id;
    if not found
       or v_artifact_firm is distinct from new.firm_id
       or v_artifact_deliverable is distinct from new.deliverable_id then
      raise exception 'publication receipt must reference an artifact_id from the same firm and deliverable';
    end if;

    -- NEW: the artifact must be bound to the SAME version this receipt
    -- claims to publish. Without this, a receipt for version 2's approval
    -- could attach an artifact that was only ever registered against
    -- version 1.
    if v_artifact_version is distinct from new.approved_version_id then
      raise exception 'publication receipt artifact_id is bound to version % but this receipt approves version %',
        v_artifact_version, new.approved_version_id;
    end if;

    -- NEW: a superseded artifact is stale evidence by definition.
    if v_artifact_superseded_at is not null then
      raise exception 'publication receipt artifact_id references a superseded artifact (superseded_at %)', v_artifact_superseded_at;
    end if;

    -- NEW: if the receipt itself carries a hash, it must not silently
    -- disagree with the artifact's own recorded hash. Null semantics:
    -- either side null means "nothing to compare", not a pass by
    -- omission for a real conflict -- only a genuine both-present
    -- disagreement is rejected. (Workstream 2, separately, ensures the
    -- application layer sources artifact_sha256 from this same trusted
    -- column rather than trusting a caller-supplied value in the first
    -- place; this check is the database's own backstop regardless of
    -- what the application does.)
    if new.artifact_sha256 is not null and v_artifact_sha256 is not null and new.artifact_sha256 is distinct from v_artifact_sha256 then
      raise exception 'publication receipt artifact_sha256 (%) does not match the registered artifact''s sha256 (%)',
        new.artifact_sha256, v_artifact_sha256;
    end if;
  end if;

  if new.reconciles_receipt_id is not null then
    -- NEW: a receipt cannot reconcile itself. new.id is already populated
    -- by this point (BEFORE INSERT fires after column defaults, so
    -- gen_random_uuid() has already run).
    if new.reconciles_receipt_id = new.id then
      raise exception 'publication receipt cannot set reconciles_receipt_id to its own id';
    end if;

    -- NEW: the receipt being reconciled must belong to the same firm,
    -- deliverable, AND placement. Without this, a receipt for one
    -- placement could claim to "correct" a receipt that actually belongs
    -- to a different placement entirely.
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

  -- NEW: 'reconciling' is only meaningful as "this receipt is actively
  -- correcting/investigating an earlier one" -- it must always carry
  -- reconciles_receipt_id. A bare first-time receipt with no prior row to
  -- reconcile uses 'unverified', never 'reconciling'.
  if new.verification_state = 'reconciling' and new.reconciles_receipt_id is null then
    raise exception 'publication receipt verification_state ''reconciling'' requires reconciles_receipt_id to be set';
  end if;

  return new;
end;
$function$;

-- NEW: a single reconciliation chain per original receipt. Without this,
-- two different receipts could both claim reconciles_receipt_id = X,
-- forking X's correction history into two branches instead of one linear
-- chain (the model getCurrentReceiptForPlacement's currentReceiptFromChain
-- already assumes: "the tip is the one row nothing else points back at").
create unique index if not exists publication_receipts_reconciles_single_chain_idx
  on public.publication_receipts (reconciles_receipt_id)
  where reconciles_receipt_id is not null;

-- NEW: verification-state internal consistency, beyond the existing
-- symmetric verified_at/verification_method pairing
-- (publication_receipts_verification_pair_check, unchanged). These four
-- rules tie the STATE VALUE itself to what evidence it must carry:
--   - verified or failed must carry both verified_at and verification_method
--     (the pairing check alone does not tie either to the state value)
--   - failed must carry a real, non-empty failure_reason
--   - verified must NOT carry a failure_reason (a passing check has none
--     to explain)
alter table public.publication_receipts
  add constraint publication_receipts_verified_failed_require_metadata_check
  check (
    verification_state not in ('verified', 'failed')
    or (verified_at is not null and verification_method is not null)
  );

alter table public.publication_receipts
  add constraint publication_receipts_failed_requires_reason_check
  check (
    verification_state <> 'failed'
    or (failure_reason is not null and length(btrim(failure_reason)) > 0)
  );

alter table public.publication_receipts
  add constraint publication_receipts_verified_forbids_reason_check
  check (
    verification_state <> 'verified'
    or failure_reason is null
  );

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verification (NOT executed by this migration; see
-- scripts/verify-publication-receipt-integrity-hardening.sql for the
-- runnable version, wrapped in BEGIN/ROLLBACK, run via the Supabase MCP
-- execute_sql tool before this migration is ever applied to production):
--
--   1. A receipt bound to a deliverable's CURRENT approved version, with a
--      correctly version-bound, non-superseded artifact whose sha256
--      matches -- succeeds.
--   2. approved_version_id set to a DIFFERENT version of the same
--      deliverable (not the deliverable's own approved_version_id) --
--      rejected.
--   3. artifact_id bound to a different version than approved_version_id
--      -- rejected.
--   4. artifact_id whose sha256 disagrees with the receipt's own
--      artifact_sha256 -- rejected.
--   5. period_id that disagrees with the placement's own period_id --
--      rejected.
--   6. verification_state = 'verified' inserted with verified_at/
--      verification_method left null -- rejected.
--   7. verification_state = 'failed' inserted with an empty/null
--      failure_reason -- rejected.
--   8. reconciles_receipt_id pointing at a receipt belonging to a
--      DIFFERENT placement -- rejected.
--   9. reconciles_receipt_id set to the new row's own id -- rejected.
--  10. Two receipts both setting reconciles_receipt_id to the same
--      original receipt -- the second insert is rejected by the unique
--      partial index.
--  11. verification_state = 'reconciling' with reconciles_receipt_id left
--      null -- rejected.
--  12. A deliverable not in 'approved' status, or with approved_version_id
--      distinct from current_version_id -- rejected before any of the
--      above checks run.
-- ---------------------------------------------------------------------------
