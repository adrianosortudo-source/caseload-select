-- Corrective release, workstreams 1+2+4: bind root publication_receipts to
-- exactly one active publication_placement_claims row, correct root-receipt
-- uniqueness to (placement_id, approved_version_id) instead of a
-- placement-lifetime rule, version-scope claim_placement_for_publish's
-- "already published" check, release claims by exact id only, and remove
-- caller-controlled PDF hash trust from the receipt-scope trigger (folded in
-- here because it touches the same function rewritten by workstream 1).
--
-- Dry-run validated against production (14/14 checks) via a rolled-back
-- transaction before being applied for real -- see
-- scripts/verify-publication-receipt-claim-binding.sql.

-- 1. New column: nullable at the table level (reconciliation/verification
--    receipts must not carry one), required for root receipts via CHECK.
alter table public.publication_receipts
  add column if not exists claim_id uuid references public.publication_placement_claims(id);

alter table public.publication_receipts
  add constraint publication_receipts_claim_id_required_for_root_check
  check (
    (reconciles_receipt_id is null and claim_id is not null)
    or
    (reconciles_receipt_id is not null and claim_id is null)
  );

-- A claim can release into at most one root receipt (a plain UNIQUE
-- constraint excludes NULLs, so reconciling receipts -- forced to NULL
-- claim_id above -- are unaffected).
alter table public.publication_receipts
  add constraint publication_receipts_claim_id_unique unique (claim_id);

-- 2. Correct root-receipt uniqueness: (placement_id, approved_version_id),
--    not placement_id alone. A later approved version may receive its own
--    root receipt for the same placement.
drop index if exists public.publication_receipts_one_root_per_placement_idx;
create unique index publication_receipts_one_root_per_placement_version_idx
  on public.publication_receipts (placement_id, approved_version_id)
  where reconciles_receipt_id is null;

-- 3. validate_publication_receipt_scope(): add claim_id binding/lock
--    validation for root receipts, and remove caller-controlled PDF hash
--    trust (workstream 4) in the same rewrite since both touch this
--    function's artifact_id branch.
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
  v_artifact_type text;
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
  v_claim public.publication_placement_claims%rowtype;
begin
  select firm_id, status, approved_version_id, current_version_id, period_id
    into v_deliverable_firm, v_deliverable_status, v_deliverable_approved_version,
         v_deliverable_current_version, v_deliverable_period
    from public.content_deliverables
   where id = new.deliverable_id
     for update;
  if not found or v_deliverable_firm is distinct from new.firm_id then
    raise exception 'publication receipt must reference a deliverable from the same firm';
  end if;

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
    select artifact_type, firm_id, deliverable_id, version_id, superseded_at, sha256
      into v_artifact_type, v_artifact_firm, v_artifact_deliverable, v_artifact_version, v_artifact_superseded_at, v_artifact_sha256
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
    if v_artifact_type = 'pdf' and v_artifact_sha256 is null then
      raise exception 'publication receipt references an active PDF artifact with no registered immutable sha256; it cannot serve as publication evidence until the artifact''s hash is recorded';
    end if;
    -- Server-trusted only: the registered artifact hash always wins,
    -- regardless of anything the caller supplied on this row. This closes
    -- the caller-controlled-hash gap even for writers other than the
    -- application route.
    new.artifact_sha256 := v_artifact_sha256;
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

  -- Workstream 1: root receipts must bind to, and be authorized by, exactly
  -- one still-active claim; reconciliation/verification receipts must not
  -- carry a claim at all (also enforced by a table CHECK constraint above --
  -- this is the deeper cross-table validation a CHECK cannot express).
  if new.reconciles_receipt_id is null then
    select * into v_claim
      from public.publication_placement_claims
     where id = new.claim_id
       for update;
    if not found then
      raise exception 'publication receipt claim_id % does not reference an existing placement claim', new.claim_id;
    end if;
    if v_claim.status <> 'active' then
      raise exception 'publication receipt claim_id % is not active (status=%); claims must still be active at receipt insertion time', new.claim_id, v_claim.status;
    end if;
    if v_claim.firm_id is distinct from new.firm_id
       or v_claim.deliverable_id is distinct from new.deliverable_id
       or v_claim.placement_id is distinct from new.placement_id
       or v_claim.approved_version_id is distinct from new.approved_version_id then
      raise exception 'publication receipt claim_id % does not match this receipt''s firm, deliverable, placement, and approved_version', new.claim_id;
    end if;
    if v_claim.claimed_by_role is distinct from new.actor_role then
      raise exception 'publication receipt actor_role (%) does not match the claim''s claimed_by_role (%)', new.actor_role, v_claim.claimed_by_role;
    end if;
    if new.actor_id is not null and v_claim.claimed_by_id is distinct from new.actor_id then
      raise exception 'publication receipt actor does not match the claim''s authenticated operator identity';
    end if;
  end if;

  return new;
end;
$function$;

-- 4. claim_placement_for_publish(): the "already published" check must
--    consider only the requested approved_version_id, not any historical
--    version of the same placement.
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

  -- re-check idempotency now that the placement row is locked (Gap 1 fix)
  select * into v_existing
    from public.publication_placement_claims
   where placement_id = p_placement_id and idempotency_key = p_idempotency_key;
  if found then
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

-- 5. release_placement_claim_on_receipt(): release only the exact claim the
--    receipt names by claim_id, never any other active claim on the same
--    placement. SECURITY DEFINER (owned by postgres, matching the DR-099
--    precedent) so its internal UPDATE passes the workstream-3 mutation-lock
--    trigger added in the next migration.
create or replace function public.release_placement_claim_on_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.reconciles_receipt_id is null and new.claim_id is not null then
    update public.publication_placement_claims
       set status = 'released',
           released_receipt_id = new.id,
           released_at = now()
     where id = new.claim_id
       and status = 'active';
  end if;
  return new;
end;
$function$;
