-- Content Studio publishing evidence system: closes two real races found by
-- an adversarial review of 20260716150130_publication_placement_claims.sql
-- (NOT edited by this migration; that migration is already applied to
-- production and its file has only been extended, never modified, in the
-- functions/trigger it defines, via CREATE OR REPLACE).
--
-- Gap 1: claim_placement_for_publish()'s idempotency lookup ran BEFORE any
-- row lock, so two callers submitting the SAME NEW idempotency_key
-- concurrently both passed the unlocked "not found" check, then serialized
-- on the content_placements FOR UPDATE lock. The winner inserted and
-- returned ok:true. The loser, once unblocked, never re-checked
-- idempotency -- it fell straight into the competing-claim check, saw the
-- winner's now-committed active claim, and was wrongly rejected
-- (ok:false, needs_reverification) instead of receiving the exact same
-- idempotent-replay result its own retry deserved. This directly
-- contradicts the finding's own requirement: "Repeating the same
-- idempotency key must return the same claim/result."
--
-- Fix: re-check idempotency a second time, AFTER the deliverable and
-- placement locks are acquired. A caller that loses the race to a
-- same-key concurrent claim now blocks on the placement lock (as before),
-- but once unblocked it re-reads the table it holds a lock on and finds
-- the winner's committed row, returning the correct idempotent-replay
-- result instead of a competing-claim rejection. The original unlocked
-- check is kept as a fast path for the overwhelmingly common case (a
-- genuine replay of an already-resolved key, not a live race), so this
-- adds no lock contention for that case; only a genuine same-key race
-- pays for the second lookup, and it now gets the correct answer.
--
-- Gap 2: release_placement_claim_on_receipt() released a placement's
-- active claim on ANY publication_receipts insert for that placement,
-- including a row that merely verifies or disputes an OLDER, unrelated
-- receipt (reconciles_receipt_id IS NOT NULL, verification_state in
-- ('verified','failed','reconciling') -- the exact "reconciling
-- verification" category the main scope trigger, in the same original
-- migration, deliberately distinguishes from a fresh publish claim via
-- v_reconciling_verification, two lines away in the sibling function).
-- Concrete failure: operator A claims a placement to attempt a
-- republish; before A's external action completes, anyone verifies an
-- OLDER, already-existing receipt on the same placement -- that insert
-- unconditionally released A's unrelated, still-in-progress claim, and a
-- second caller could then obtain a fresh active claim while A still
-- believed theirs was valid. The whole point of this migration was to
-- prevent exactly that double-claim outcome.
--
-- Fix: only a receipt with reconciles_receipt_id IS NULL (a genuine fresh
-- publish claim, never a verification/correction of a prior one) releases
-- the active claim. Mirrors the existing v_reconciling_verification
-- distinction exactly.

create or replace function public.claim_placement_for_publish(
  p_firm_id uuid,
  p_deliverable_id uuid,
  p_placement_id uuid,
  p_approved_version_id uuid,
  p_idempotency_key text,
  p_actor_role text,
  p_actor_id uuid,
  p_actor_name text,
  p_supersedes_claim_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_existing record;
  v_deliverable record;
  v_placement record;
  v_current_active record;
  v_current_receipt record;
  v_new_claim record;
begin
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'idempotency_key is required');
  end if;
  if p_actor_role not in ('operator', 'lawyer', 'system') then
    return jsonb_build_object('ok', false, 'error', 'invalid actor_role');
  end if;

  -- Fast path, unlocked: the overwhelmingly common case is a genuine
  -- replay of an already-resolved key, not a live race -- this avoids
  -- lock contention for that case. NOT sufficient on its own; see the
  -- re-check after the locks below (CHANGED, this migration).
  select * into v_existing
    from public.publication_placement_claims
   where placement_id = p_placement_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'ok', true,
      'claim_id', v_existing.id,
      'idempotent_replay', true,
      'status', v_existing.status
    );
  end if;

  -- Lock the authoritative deliverable and placement rows for the
  -- remainder of this transaction, the same discipline the receipt
  -- trigger's own concurrency fix uses (see
  -- 20260716144723_publication_receipt_reconcile_concurrency_lock_merge.sql).
  select * into v_deliverable from public.content_deliverables where id = p_deliverable_id for update;
  if not found or v_deliverable.firm_id is distinct from p_firm_id then
    return jsonb_build_object('ok', false, 'error', 'deliverable not found for this firm');
  end if;

  select * into v_placement from public.content_placements where id = p_placement_id for update;
  if not found
     or v_placement.firm_id is distinct from p_firm_id
     or v_placement.deliverable_id is distinct from p_deliverable_id then
    return jsonb_build_object('ok', false, 'error', 'placement not found for this deliverable');
  end if;

  -- CHANGED (this migration): re-check idempotency now that the placement
  -- row is locked. A caller that lost the race to a same-key concurrent
  -- claim was blocked on the FOR UPDATE lock above; once unblocked, the
  -- winner's row is now visible (committed) or this lookup itself blocks
  -- until it is. Closes the TOCTOU gap the unlocked check alone left
  -- open -- see "Gap 1" above.
  select * into v_existing
    from public.publication_placement_claims
   where placement_id = p_placement_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'ok', true,
      'claim_id', v_existing.id,
      'idempotent_replay', true,
      'status', v_existing.status
    );
  end if;

  -- Re-run readiness under lock: approved, and the exact current version --
  -- never a version that has drifted since the caller last read the
  -- preflight report.
  if v_deliverable.status is distinct from 'approved' then
    return jsonb_build_object('ok', false, 'error', 'deliverable is not approved', 'next_action', 'approve_deliverable');
  end if;
  if v_deliverable.approved_version_id is distinct from p_approved_version_id
     or v_deliverable.approved_version_id is distinct from v_deliverable.current_version_id then
    return jsonb_build_object('ok', false, 'error', 'version drift: not the deliverable''s current approved version', 'next_action', 'resolve_version_drift');
  end if;

  -- Already published and verified: nothing left to claim.
  select r.* into v_current_receipt
    from public.publication_receipts r
   where r.placement_id = p_placement_id
     and r.reconciles_receipt_id is null
   order by r.created_at desc
   limit 1;
  if found then
    -- Walk the reconciliation chain's tip the same way
    -- currentReceiptFromChain (publication-receipts.ts) does: the most
    -- recent row nothing else points back at.
    select r.* into v_current_receipt
      from public.publication_receipts r
     where r.placement_id = p_placement_id
       and not exists (
         select 1 from public.publication_receipts r2
          where r2.reconciles_receipt_id = r.id
       )
     order by r.created_at desc
     limit 1;
    if found and v_current_receipt.verification_state = 'verified' then
      return jsonb_build_object('ok', false, 'error', 'placement is already published and verified', 'next_action', 'already_published');
    end if;
  end if;

  -- Competing claim: an existing active claim blocks a fresh claim attempt
  -- unless the caller explicitly supersedes it (an explicit
  -- retry/supersession relationship, not an implicit override).
  select * into v_current_active
    from public.publication_placement_claims
   where placement_id = p_placement_id and status = 'active';
  if found then
    if p_supersedes_claim_id is null or p_supersedes_claim_id is distinct from v_current_active.id then
      return jsonb_build_object(
        'ok', false,
        'error', 'placement already has an active claim',
        'existing_claim_id', v_current_active.id,
        'next_action', 'needs_reverification'
      );
    end if;
    update public.publication_placement_claims
       set status = 'superseded'
     where id = v_current_active.id;
  end if;

  insert into public.publication_placement_claims (
    firm_id, deliverable_id, placement_id, approved_version_id, idempotency_key,
    status, supersedes_claim_id, claimed_by_role, claimed_by_id, claimed_by_name
  ) values (
    p_firm_id, p_deliverable_id, p_placement_id, p_approved_version_id, p_idempotency_key,
    'active', p_supersedes_claim_id, p_actor_role, p_actor_id, p_actor_name
  )
  returning * into v_new_claim;

  return jsonb_build_object(
    'ok', true,
    'claim_id', v_new_claim.id,
    'idempotent_replay', false,
    'status', 'active'
  );
end;
$function$;

revoke all on function public.claim_placement_for_publish(uuid, uuid, uuid, uuid, text, text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_placement_for_publish(uuid, uuid, uuid, uuid, text, text, uuid, text, uuid) to service_role;

-- CHANGED (this migration): only a fresh root receipt (reconciles_receipt_id
-- IS NULL) releases the active claim -- see "Gap 2" above.
create or replace function public.release_placement_claim_on_receipt()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if new.reconciles_receipt_id is null then
    update public.publication_placement_claims
       set status = 'released',
           released_receipt_id = new.id,
           released_at = now()
     where placement_id = new.placement_id
       and status = 'active';
  end if;
  return new;
end;
$function$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verification (see scripts/verify-publication-placement-claim-race-fix.sql,
-- run via the Supabase MCP execute_sql tool wrapped in BEGIN/ROLLBACK):
--   1. All 7 checks from the original migration's verify script still pass
--      unchanged (non-regression).
--   2. A reconciling-verification receipt (reconciles_receipt_id set,
--      verification_state='verified') does NOT release an active claim on
--      the same placement.
--   3. A fresh root receipt (reconciles_receipt_id null) DOES release an
--      active claim, as before.
-- ---------------------------------------------------------------------------
