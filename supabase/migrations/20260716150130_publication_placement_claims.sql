-- Content Studio publishing evidence system: atomic placement claim and
-- idempotency.
--
-- Corrective-release audit finding 4. buildPreflightReport() (Workstream 7)
-- is, by its own docstring, "read-only, operator-only, never generates
-- content" -- it stays exactly that; this migration does not touch it. But
-- nothing else in the schema atomically reserved a placement/version
-- before an external publish action could begin: two concurrent callers
-- could both read mayPublish=true from the preflight report and both
-- independently proceed, and publication_receipts had no constraint
-- preventing two independent ROOT receipts (both reconciles_receipt_id
-- IS NULL) for the same placement -- only a constraint preventing two
-- receipts from both reconciling the SAME prior receipt
-- (publication_receipts_reconciles_single_chain_idx, unchanged, added by
-- 20260715225139_publication_receipt_integrity_hardening.sql).
--
-- This migration adds the smallest coherent atomic claim primitive
-- consistent with the existing append-only-evidence state model:
--
--   1. publication_placement_claims: a lightweight reservation table,
--      distinct from publication_receipts (evidence of a completed
--      publish) because a claim exists to reserve the right to publish
--      BEFORE any external action has happened and before there is any
--      URL/post-id evidence to record. Unlike receipts, a claim's status
--      column is mutable, but ONLY through claim_placement_for_publish()
--      below -- no direct UPDATE path is granted to any role.
--   2. claim_placement_for_publish(): a SECURITY DEFINER RPC, the same
--      pattern as deactivate_period_readiness_atomic and
--      record_approval_atomic. Locks content_deliverables and
--      content_placements FOR UPDATE, re-runs the same readiness
--      conditions the receipt trigger enforces (approved status, version
--      match, no drift), checks for an already-verified current receipt
--      (nothing to claim if it is already published), and either returns
--      the SAME result for a repeated idempotency_key (true idempotency,
--      no re-validation, no new row) or atomically inserts a new claim,
--      rejecting a competing claim unless the caller explicitly supersedes
--      the current active one.
--   3. Two constraints back this at the schema level, not just in the
--      RPC's own logic: unique(placement_id, idempotency_key) for
--      idempotent replay, and a partial unique index on placement_id
--      WHERE status='active' for "at most one active/root
--      publication-attempt chain per placement" -- the RPC's own
--      competing-claim check is friendly early rejection; this index is
--      the actual, race-proof guarantee.
--   4. A small AFTER INSERT trigger on publication_receipts releases a
--      placement's active claim (status -> 'released') when a receipt for
--      that placement is recorded, so a completed publish does not
--      permanently lock the placement out of a future legitimate
--      re-publish. Best-effort: a receipt created without ever going
--      through a claim (e.g. the existing receipts route, unchanged by
--      this migration) simply has nothing to release.
--
-- Production has zero rows in publication_receipts (confirmed via
-- execute_sql immediately before authoring this migration), so no
-- historical-duplicate inspection blocks any constraint added here.
--
-- Explicitly NOT in scope, per the finding's own instruction: no external
-- publisher is created or wired up in this migration or its application
-- layer. The claim is the atomic authority a future publisher workstream
-- calls before acting; nothing here calls out to LinkedIn, GBP, or any
-- other destination.

create table if not exists public.publication_placement_claims (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.intake_firms(id),
  deliverable_id uuid not null references public.content_deliverables(id),
  placement_id uuid not null references public.content_placements(id),
  approved_version_id uuid not null references public.deliverable_versions(id),
  idempotency_key text not null check (length(btrim(idempotency_key)) > 0),
  status text not null default 'active' check (status in ('active', 'released', 'superseded')),
  supersedes_claim_id uuid references public.publication_placement_claims(id),
  released_receipt_id uuid references public.publication_receipts(id),
  claimed_by_role text not null check (claimed_by_role in ('operator', 'lawyer', 'system')),
  claimed_by_id uuid,
  claimed_by_name text,
  claimed_at timestamptz not null default now(),
  released_at timestamptz,
  created_at timestamptz not null default now()
);

-- Idempotency: repeating the same key for the same placement always
-- resolves to the same row (the RPC looks this up FIRST, before any lock
-- or re-validation, and returns it verbatim).
create unique index if not exists publication_placement_claims_idempotency_key_idx
  on public.publication_placement_claims (placement_id, idempotency_key);

-- At most one active/root publication-attempt chain per placement. A
-- retry/supersession is the only way past this: the RPC flips the prior
-- active row to 'superseded' and inserts the new 'active' row in the same
-- transaction, so this index is never violated even under concurrent
-- callers -- one of two racing claim attempts will always see the other's
-- row (via the same content_placements FOR UPDATE lock the RPC also takes)
-- before this index could be tested twice.
create unique index if not exists publication_placement_claims_one_active_per_placement_idx
  on public.publication_placement_claims (placement_id)
  where status = 'active';

create index if not exists publication_placement_claims_deliverable_idx
  on public.publication_placement_claims (deliverable_id);

alter table public.publication_placement_claims enable row level security;
alter table public.publication_placement_claims force row level security;
revoke all on public.publication_placement_claims from anon, authenticated, public;
grant all on public.publication_placement_claims to service_role;

-- No direct INSERT/UPDATE policy for any role: every write to this table
-- goes through claim_placement_for_publish() (SECURITY DEFINER) or the
-- release trigger below, both of which run as the function/trigger owner
-- regardless of RLS. service_role itself bypasses RLS already (per this
-- repo's Database Access Invariant), but this table carries no policy at
-- all -- consistent with the append-only tables' access pattern, closing
-- the "service-role bypasses RLS but must not bypass the actual
-- invariant" gap by putting the invariant in the RPC and constraints, not
-- in a policy that service-role would skip anyway.

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

  -- Idempotency, checked BEFORE any lock or re-validation: a repeated key
  -- for this placement always returns the exact same prior result, never
  -- re-runs readiness against possibly-changed state and never creates a
  -- second row.
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

-- Releases a placement's active claim when a receipt for that placement is
-- recorded, so a completed publish does not permanently lock the
-- placement out of a future legitimate re-publish (a content update, a
-- correction). Best-effort: a receipt inserted without a prior claim
-- (e.g. via the existing receipts route, unchanged by this migration)
-- simply finds no active claim to release.
create or replace function public.release_placement_claim_on_receipt()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  update public.publication_placement_claims
     set status = 'released',
         released_receipt_id = new.id,
         released_at = now()
   where placement_id = new.placement_id
     and status = 'active';
  return new;
end;
$function$;

drop trigger if exists trg_release_placement_claim_on_receipt on public.publication_receipts;
create trigger trg_release_placement_claim_on_receipt
  after insert on public.publication_receipts
  for each row
  execute function public.release_placement_claim_on_receipt();

-- Finding 4's other explicit requirement: at most one root receipt chain
-- per placement, backed by a real constraint (not only the claim table
-- above, since a caller could in principle still reach createReceipt()
-- directly without ever claiming). Zero rows exist in publication_receipts
-- in production today (confirmed immediately before this migration was
-- authored), so this is a zero-risk addition.
create unique index if not exists publication_receipts_one_root_per_placement_idx
  on public.publication_receipts (placement_id)
  where reconciles_receipt_id is null;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verification (see scripts/verify-publication-placement-claim.sql, run via
-- the Supabase MCP execute_sql tool wrapped in BEGIN/ROLLBACK):
--   1. A first claim on a ready placement/version succeeds.
--   2. Repeating the exact same idempotency_key returns the SAME claim_id,
--      idempotent_replay=true, no second row created.
--   3. A second claim attempt with a DIFFERENT idempotency_key and no
--      supersedes_claim_id is rejected while the first claim is active.
--   4. Supplying supersedes_claim_id matching the current active claim
--      succeeds, flips the old claim to 'superseded', and the new claim
--      becomes the sole 'active' row.
--   5. A claim against a non-approved deliverable, or a drifted version,
--      is rejected under lock.
--   6. Recording a publication_receipts row for the placement flips its
--      active claim to 'released'.
--   7. A direct INSERT attempting two root receipts (both
--      reconciles_receipt_id null) for the same placement is rejected by
--      publication_receipts_one_root_per_placement_idx.
-- ---------------------------------------------------------------------------
