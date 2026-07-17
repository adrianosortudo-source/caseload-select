-- Corrective-release follow-up audit, findings 1 + 2. Both fixes touch
-- validate_publication_receipt_scope() (rewritten by
-- 20260716205822_publication_receipt_claim_binding.sql), so -- matching that
-- migration's own precedent of folding same-function fixes together -- they
-- land in one create-or-replace here rather than two migrations racing to
-- overwrite each other's version of the function body.
--
-- Finding 1 (claim actor binding): the previous check was
--   if new.actor_id is not null and v_claim.claimed_by_id is distinct from new.actor_id then reject
-- which only enforces a match when the RECEIPT happens to carry an
-- actor_id. A service-role caller inserting actor_id = NULL against a
-- claim that IS actor-owned (claimed_by_id is not null) sailed straight
-- through -- the exact inverse of the intended check, which should key off
-- whether the CLAIM is actor-owned, not whether the receipt supplied an
-- actor. Fixed: when the claim is actor-owned, the receipt's actor_id must
-- be present AND equal. An actorless claim (claimed_by_id is null, e.g. a
-- system-originated claim) is unchanged: any receipt with a matching
-- actor_role may still release it, per the documented "(where available)"
-- policy in the receipts route's own contract comment.
--
-- Finding 2 (caller-controlled hash removal on every path): artifact_sha256
-- was previously only overwritten inside the `if new.artifact_id is not
-- null` branch, so a direct INSERT (or malformed application call) with
-- artifact_id NULL could carry an arbitrary caller-supplied hash straight
-- through untouched, on every receipt kind (root, reconciliation, PDF,
-- non-PDF, no-artifact). Fixed: artifact_sha256 is now cleared
-- unconditionally up front, then re-derived exclusively from the bound
-- artifact's own registered sha256 when (and only when) artifact_id names
-- one. A receipt with no artifact_id now always stores a NULL hash,
-- regardless of what the caller supplied.
--
-- Finding 5 (application diagnostics, DB half): the five claim-binding
-- raises below now carry a stable custom SQLSTATE ('CLM01') instead of the
-- PL/pgSQL default P0001, so the application layer can classify "this
-- insert failed because of the claim" by error code instead of regexing
-- the exception message (see the accompanying app-layer commit removing
-- the /claim_id/i heuristic in the receipts route).
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

  -- Finding 2: clear unconditionally before any artifact-specific handling,
  -- so every code path (root, reconciliation, PDF, non-PDF, no artifact_id
  -- at all) starts from "no trusted hash" and only ever gains one from the
  -- bound artifact's own registered value below.
  new.artifact_sha256 := null;

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

  -- Workstream 1 (claim binding) + finding 1 (actor binding correction):
  -- root receipts must bind to, and be authorized by, exactly one
  -- still-active claim; reconciliation/verification receipts must not carry
  -- a claim at all (also enforced by a table CHECK constraint -- this is the
  -- deeper cross-table validation a CHECK cannot express).
  if new.reconciles_receipt_id is null then
    select * into v_claim
      from public.publication_placement_claims
     where id = new.claim_id
       for update;
    if not found then
      raise exception 'publication receipt claim_id % does not reference an existing placement claim', new.claim_id
        using errcode = 'CLM01';
    end if;
    if v_claim.status <> 'active' then
      raise exception 'publication receipt claim_id % is not active (status=%); claims must still be active at receipt insertion time', new.claim_id, v_claim.status
        using errcode = 'CLM01';
    end if;
    if v_claim.firm_id is distinct from new.firm_id
       or v_claim.deliverable_id is distinct from new.deliverable_id
       or v_claim.placement_id is distinct from new.placement_id
       or v_claim.approved_version_id is distinct from new.approved_version_id then
      raise exception 'publication receipt claim_id % does not match this receipt''s firm, deliverable, placement, and approved_version', new.claim_id
        using errcode = 'CLM01';
    end if;
    if v_claim.claimed_by_role is distinct from new.actor_role then
      raise exception 'publication receipt actor_role (%) does not match the claim''s claimed_by_role (%)', new.actor_role, v_claim.claimed_by_role
        using errcode = 'CLM01';
    end if;
    -- Finding 1: keyed off whether the CLAIM is actor-owned
    -- (claimed_by_id is not null), not whether the receipt happens to
    -- supply an actor_id. An actor-owned claim now requires the receipt's
    -- actor_id to be both present and equal; a NULL actor_id on the receipt
    -- no longer bypasses this check. An actorless claim (claimed_by_id is
    -- null) imposes no further identity requirement here, per the
    -- documented "(where available)" policy.
    if v_claim.claimed_by_id is not null
       and (new.actor_id is null or new.actor_id is distinct from v_claim.claimed_by_id) then
      raise exception 'publication receipt actor does not match the claim''s authenticated operator identity'
        using errcode = 'CLM01';
    end if;
  end if;

  return new;
end;
$function$;
