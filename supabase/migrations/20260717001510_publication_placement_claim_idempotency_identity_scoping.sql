-- Corrective-release follow-up audit, finding 4: idempotent replay scoping.
--
-- claim_placement_for_publish() previously returned an existing
-- placement+idempotency-key claim as soon as it found one, before
-- validating that the REQUESTED firm/deliverable/approved_version/actor
-- matched the STORED claim's own values. A caller could reuse a stale or
-- mistaken idempotency_key against a materially different request (a
-- different approved_version_id, a different actor, even -- in principle,
-- since only placement_id + idempotency_key were checked -- a different
-- deliverable) and silently receive back someone else's claim as if it were
-- their own, both on the fast (unlocked) path and the re-check performed
-- after the placement row is locked.
--
-- Fixed: an idempotency-key match now short-circuits to success ONLY when
-- every field of the stored claim's immutable request identity agrees with
-- the request in hand (deliverable, approved_version, actor role, actor id,
-- and supersedes_claim_id -- firm_id and placement_id are already
-- guaranteed by the WHERE clause that found the row). A same-key request
-- with a different identity fails closed with next_action
-- use_new_idempotency_key instead of silently returning the mismatched
-- claim. The placement-row lock and the existing same-key/different-key
-- concurrency guarantees (see 20260716155746_publication_placement_claim_
-- race_fix.sql) are otherwise unchanged -- both the fast-path check and the
-- post-lock re-check get the same identity guard, applied identically.
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
  v_root_receipt record;
  v_chain_tip record;
  v_current_active record;
  v_new_claim record;
begin
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'idempotency_key is required');
  end if;
  if p_actor_role not in ('operator', 'lawyer', 'system') then
    return jsonb_build_object('ok', false, 'error', 'invalid actor_role');
  end if;

  select * into v_existing
    from public.publication_placement_claims
   where placement_id = p_placement_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.deliverable_id is distinct from p_deliverable_id
       or v_existing.approved_version_id is distinct from p_approved_version_id
       or v_existing.claimed_by_role is distinct from p_actor_role
       or v_existing.claimed_by_id is distinct from p_actor_id
       or v_existing.supersedes_claim_id is distinct from p_supersedes_claim_id then
      return jsonb_build_object(
        'ok', false,
        'error', 'idempotency_key was already used for a different request; the same key must not be reused for a materially different claim',
        'existing_claim_id', v_existing.id,
        'next_action', 'use_new_idempotency_key'
      );
    end if;
    return jsonb_build_object('ok', true, 'claim_id', v_existing.id, 'idempotent_replay', true, 'status', v_existing.status);
  end if;

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

  -- re-check idempotency now that the placement row is locked (Gap 1 fix),
  -- with the same identity guard as the fast-path check above.
  select * into v_existing
    from public.publication_placement_claims
   where placement_id = p_placement_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.deliverable_id is distinct from p_deliverable_id
       or v_existing.approved_version_id is distinct from p_approved_version_id
       or v_existing.claimed_by_role is distinct from p_actor_role
       or v_existing.claimed_by_id is distinct from p_actor_id
       or v_existing.supersedes_claim_id is distinct from p_supersedes_claim_id then
      return jsonb_build_object(
        'ok', false,
        'error', 'idempotency_key was already used for a different request; the same key must not be reused for a materially different claim',
        'existing_claim_id', v_existing.id,
        'next_action', 'use_new_idempotency_key'
      );
    end if;
    return jsonb_build_object('ok', true, 'claim_id', v_existing.id, 'idempotent_replay', true, 'status', v_existing.status);
  end if;

  if v_deliverable.status is distinct from 'approved' then
    return jsonb_build_object('ok', false, 'error', 'deliverable is not approved', 'next_action', 'approve_deliverable');
  end if;
  if v_deliverable.approved_version_id is distinct from p_approved_version_id
     or v_deliverable.approved_version_id is distinct from v_deliverable.current_version_id then
    return jsonb_build_object('ok', false, 'error', 'version drift: not the deliverable''s current approved version', 'next_action', 'resolve_version_drift');
  end if;

  -- Already published and verified for THIS version: nothing left to claim.
  -- Scoped by approved_version_id so a verified v1 receipt never blocks a
  -- fresh claim for a later approved v2.
  select r.* into v_root_receipt
    from public.publication_receipts r
   where r.placement_id = p_placement_id
     and r.approved_version_id = p_approved_version_id
     and r.reconciles_receipt_id is null
   limit 1;
  if found then
    select r.* into v_chain_tip
      from public.publication_receipts r
     where r.placement_id = p_placement_id
       and r.approved_version_id = p_approved_version_id
       and not exists (
         select 1 from public.publication_receipts r2
          where r2.reconciles_receipt_id = r.id
       )
     order by r.created_at desc
     limit 1;
    if found and v_chain_tip.verification_state = 'verified' then
      return jsonb_build_object('ok', false, 'error', 'placement is already published and verified for this approved version', 'next_action', 'already_published');
    end if;
  end if;

  select * into v_current_active
    from public.publication_placement_claims
   where placement_id = p_placement_id and status = 'active';
  if found then
    if p_supersedes_claim_id is null or p_supersedes_claim_id is distinct from v_current_active.id then
      return jsonb_build_object('ok', false, 'error', 'placement already has an active claim', 'existing_claim_id', v_current_active.id, 'next_action', 'needs_reverification');
    end if;
    update public.publication_placement_claims set status = 'superseded' where id = v_current_active.id;
  end if;

  insert into public.publication_placement_claims (
    firm_id, deliverable_id, placement_id, approved_version_id, idempotency_key,
    status, supersedes_claim_id, claimed_by_role, claimed_by_id, claimed_by_name
  ) values (
    p_firm_id, p_deliverable_id, p_placement_id, p_approved_version_id, p_idempotency_key,
    'active', p_supersedes_claim_id, p_actor_role, p_actor_id, p_actor_name
  )
  returning * into v_new_claim;

  return jsonb_build_object('ok', true, 'claim_id', v_new_claim.id, 'idempotent_replay', false, 'status', 'active');
end;
$function$;

-- This function already had EXECUTE revoked from anon/authenticated and
-- granted to service_role prior to this migration (see
-- 20260716150130_publication_placement_claims.sql and
-- 20260716155746_publication_placement_claim_race_fix.sql, both of which
-- reassert the same two statements on every create-or-replace of this
-- function). Matching that established, deliberately defensive pattern
-- here: a SECURITY DEFINER function silently regaining PUBLIC EXECUTE on
-- replace is exactly the class of gap release_placement_claim_on_receipt()
-- hit in this same corrective-release effort
-- (20260716210037_publication_receipt_claim_release_revoke_public_execute.sql).
revoke all on function public.claim_placement_for_publish(uuid, uuid, uuid, uuid, text, text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_placement_for_publish(uuid, uuid, uuid, uuid, text, text, uuid, text, uuid) to service_role;
