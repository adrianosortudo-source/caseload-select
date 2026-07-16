-- Recovered byte-for-byte from the production migration ledger
-- (supabase_migrations.schema_migrations, version 20260716144315), the
-- same ledger-recovery path CLAUDE.md documents for the 2026-06-05
-- security-lockdown migration and PR #37 used for the
-- publication_artifacts dedupe partial index.
--
-- This migration was applied to production by a concurrent session during
-- this corrective release and had no repository file at the time this
-- worktree's own finding-1 migration (see
-- 20260716144510_publication_receipt_concurrency_lock.sql) was applied
-- moments later. Because both migrations used CREATE OR REPLACE FUNCTION
-- on the SAME function and the second was authored from a pre-fetch of the
-- function that predated the first, applying the second silently reverted
-- this one on production. Both fixes were restored together by
-- 20260716144723_publication_receipt_reconcile_concurrency_lock_merge.sql,
-- which is the function's current, correct, live definition. This file
-- exists so the repository's migration history matches the ledger exactly;
-- it is not the live definition on its own.
--
-- Content Studio publishing evidence system: fixes a real correctness
-- defect found by an adversarial audit of the WS1-WS10 corrective release
-- (validate_publication_receipt_scope, most recently edited in
-- 20260715231733_publication_receipt_hardening_supplement.sql, NOT edited
-- by this migration for anything outside the one branch below).
--
-- The bug: verifyReceipt() (src/lib/publication-receipts.ts) records
-- verification by INSERTing a NEW row that reconciles the receipt being
-- checked, copying that receipt's approved_version_id verbatim -- it is
-- re-affirming or disputing an ALREADY-RECORDED publish, not asserting a
-- new one. But the trigger's three publish-time gates (deliverable must be
-- currently 'approved'; approved_version_id must equal the deliverable's
-- CURRENT approved_version_id; no version drift) ran unconditionally on
-- every insert, including this one. The moment ANY new deliverable version
-- posts, src/lib/deliverables.ts's addVersion() resets
-- content_deliverables.approved_version_id to null and status to
-- 'in_review' -- so a receipt whose approved_version_id was v1 can never
-- satisfy "matches the deliverable's own approved_version_id" again, even
-- after the lawyer re-approves at v2 (the receipt's own approved_version_id
-- is immutable at v1 forever; append-only). Net effect: verifying (or
-- marking failed) a legitimately-published historical receipt becomes
-- PERMANENTLY impossible from the moment the deliverable is next revised.
-- Fails closed (no bypass, no unauthorized publish), but the evidence
-- ledger this whole subsystem exists to produce goes silently incomplete
-- for exactly the deliverables that got revised after publishing -- the
-- expected, common case, not an edge case.
--
-- The fix distinguishes, at the trigger level, "a fresh publish claim"
-- from "an opinion about a publish that already happened": a row that
-- reconciles an earlier receipt AND lands in one of the three states that
-- can only ever mean "assessing a prior claim" (verified / failed /
-- reconciling -- 'reconciling' is dormant in the app today but is
-- reserved, per its own existing CHECK constraint, for exactly this same
-- "investigating an earlier receipt" purpose, so it gets the same
-- treatment for free rather than leaving the identical bug latent for
-- whenever it's first used) is exempted from the deliverable's CURRENT
-- state gates. In its place, a narrower, additive check applies: the row
-- must carry the SAME approved_version_id as the receipt it reconciles.
-- This is what keeps the exemption closed to abuse -- it can never be used
-- to smuggle a fresh, unapproved publish claim dressed up as a
-- verification, because it can only ever re-affirm or dispute the EXACT
-- version identity of a receipt that was itself already gated against the
-- deliverable's approval state at ITS OWN insert time (by these same three
-- checks, run then). By induction, the root of every reconciliation chain
-- was checked against approval state at its own moment; every later link
-- in the chain that is verification-shaped inherits that check by being
-- pinned to the same version, forever, rather than re-litigating it
-- against whatever the deliverable's state happens to be later.
--
-- verifyReceipt() already only ever writes verified/failed rows that copy
-- approved_version_id from the original untouched -- so this migration
-- changes no observable behavior for the only caller that exists today. It
-- only removes a false rejection for a case the application was already
-- constructing correctly.
--
-- 'unverified' rows that carry reconciles_receipt_id (the general
-- correction path on createReceipt(), unused by any caller today but part
-- of its public input type) are deliberately NOT exempted: an 'unverified'
-- row is a forward-looking assertion of what was actually published, which
-- is exactly the kind of claim the current-approval gates exist to check,
-- whether or not it happens to reference an earlier row as context.
--
-- A 'verified'/'failed'/'reconciling' row with NO reconciles_receipt_id
-- (a first-ever receipt inserted pre-resolved, skipping 'unverified'
-- entirely) is also NOT exempted -- it has no prior claim to be an opinion
-- about, so it is itself a fresh publish claim and stays on the strict
-- path.

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
  v_reconciles_approved_version uuid; -- NEW (this migration)
  v_reconciling_verification boolean; -- NEW (this migration)
begin
  -- Unchanged from 20260715231733_publication_receipt_hardening_supplement.sql.
  select firm_id, status, approved_version_id, current_version_id, period_id
    into v_deliverable_firm, v_deliverable_status, v_deliverable_approved_version,
         v_deliverable_current_version, v_deliverable_period
    from public.content_deliverables
   where id = new.deliverable_id;
  if not found or v_deliverable_firm is distinct from new.firm_id then
    raise exception 'publication receipt must reference a deliverable from the same firm';
  end if;

  -- NEW (this migration): is this row an opinion about an EARLIER receipt
  -- (verified / failed / reconciling, with reconciles_receipt_id set), or a
  -- fresh publish claim? See the migration header for the full reasoning.
  -- A cheap lookup here only fetches the reconciled receipt's own
  -- approved_version_id; the full firm/deliverable/placement scope check
  -- against reconciles_receipt_id (unchanged, below) still runs regardless
  -- of this branch and is what actually rejects a reconciles_receipt_id
  -- that does not resolve or does not match scope. If it does not resolve,
  -- v_reconciles_approved_version stays null here, which the version check
  -- immediately below treats as "distinct from" any real (NOT NULL)
  -- approved_version_id and rejects on its own; the later unconditional
  -- scope check then raises its own, more specific exception for the same
  -- row regardless.
  v_reconciling_verification := new.reconciles_receipt_id is not null
    and new.verification_state in ('verified', 'failed', 'reconciling');
  if v_reconciling_verification then
    select approved_version_id into v_reconciles_approved_version
      from public.publication_receipts
     where id = new.reconciles_receipt_id;
  end if;

  -- CHANGED (this migration): the three publish-time gates apply only to a
  -- fresh publish claim. A verification/failure/reconciling row instead
  -- carries a narrower, additive check: it must assert the SAME version as
  -- the receipt it reconciles, never a different one.
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

  -- Unchanged below this point.
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
