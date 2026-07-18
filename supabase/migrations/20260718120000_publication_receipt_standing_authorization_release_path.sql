-- PROPOSED, NOT APPLIED. Authored during the Publication Operator
-- architecture-review corrective pass (2026-07-18), in response to a real
-- gap the review surfaced: claim_placement_for_publish() (supabase/
-- migrations/20260717230956_standing_publishing_authorization.sql) already
-- supports releasing a deliverable's CURRENT version under an active
-- standing publishing authorization, without requiring
-- content_deliverables.status = 'approved'. But
-- validate_publication_receipt_scope() (this file's target function, last
-- rewritten by 20260717001444_publication_receipt_actor_binding_and_hash_
-- trust_fix.sql) still hard-requires status = 'approved' for EVERY root
-- receipt, unconditionally, regardless of release_path. The practical
-- effect: a standing-authorization claim can succeed, but the receipt that
-- would prove the resulting publish actually happened can never be
-- created -- the two halves of the same feature disagree with each other.
--
-- This migration is NOT applied to production and this session did not run
-- it against any database. It has not been verified against a real
-- Postgres instance (the real-Postgres integration gate for this repo
-- requires DIRECT_DATABASE_URL and the `pg` npm package, neither of which
-- is available in this session's environment -- confirmed absent, not
-- silently skipped). Per this release's hard safety boundary ("no
-- production database migrations or writes"), it is committed here as a
-- reviewed artifact only, following this repo's own established
-- "database-first deployment" convention (CONTENT_STUDIO_RELEASE_
-- RUNBOOK.md): apply to production first, deploy code that depends on it
-- second, and only after Codex/operator review of the SQL itself. No
-- application code in this release calls claim_placement_for_publish() or
-- writes a publication_receipts row -- this migration exists purely to make
-- the schema internally consistent for the FUTURE execute-mode release
-- ladder step (see docs/PUBLICATION_OPERATOR_ARCHITECTURE.md), not to
-- unlock anything this release itself does.
--
-- Change: the non-reconciling branch of validate_publication_receipt_scope()
-- now branches on new.release_path, mirroring claim_placement_for_publish()'s
-- own path-A/path-B gate exactly:
--   - release_path is null or 'individual_approval': byte-identical to the
--     current, unchanged behavior (status='approved', approved_version_id
--     matches the deliverable's own, no version drift).
--   - release_path is 'standing_authorization': never consults
--     deliverable.status (matching claim_placement_for_publish(), which
--     also never checks it on this path). Requires: (1) this receipt's
--     approved_version_id column (historically named; here it always means
--     "the version this receipt claims to release") equals the
--     deliverable's CURRENT version, since standing authorization releases
--     whatever is current, never a specific "approved" version, because
--     there may not be one; (2) that version is not flagged
--     requires_individual_review -- a version so flagged can never release
--     via this path, full stop, regardless of the firm's authorization
--     state, matching DR-104's own per-version override; (3)
--     standing_authorization_event_id is present and is genuinely the
--     firm's CURRENT latest event with event='enabled' -- never trusted
--     from the caller as a bare foreign key, always re-verified fresh
--     against the append-only ledger, so a receipt can never claim
--     authorization from a stale or already-disabled event.
--   - any other value: rejected outright (defense in depth against a typo
--     or a future third release_path value landing here unreviewed).
--
-- Every other check in the function (placement scope, locale, period,
-- version-row existence, artifact binding, server-trusted hash derivation,
-- reconciliation-chain integrity, claim binding, actor binding) is
-- byte-identical to the current function body -- this migration touches
-- only the eleven lines (current file's lines 92-104) implementing the
-- non-reconciling approval gate, and adds the standing-authorization
-- lookups needed to widen it.
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
  v_version_requires_individual_review boolean;
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
  v_latest_standing_auth_event_id uuid;
  v_latest_standing_auth_event text;
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
  elsif new.release_path is null or new.release_path = 'individual_approval' then
    -- Path A: byte-identical to the pre-existing, unchanged behavior.
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
  elsif new.release_path = 'standing_authorization' then
    -- Path B: mirrors claim_placement_for_publish()'s own path-B gate.
    -- Never consults deliverable.status.
    if new.approved_version_id is distinct from v_deliverable_current_version then
      raise exception 'a standing_authorization receipt must bind to the deliverable''s current_version_id (%), got %',
        v_deliverable_current_version, new.approved_version_id;
    end if;

    select requires_individual_review into v_version_requires_individual_review
      from public.deliverable_versions
     where id = new.approved_version_id;
    if coalesce(v_version_requires_individual_review, true) then
      raise exception 'this version is flagged requires_individual_review (or could not be loaded); it can never release via standing authorization, only individual lawyer approval';
    end if;

    if new.standing_authorization_event_id is null then
      raise exception 'a standing_authorization receipt must carry standing_authorization_event_id';
    end if;

    select id, event
      into v_latest_standing_auth_event_id, v_latest_standing_auth_event
      from public.standing_publishing_authorizations
     where firm_id = new.firm_id
     order by event_seq desc
     limit 1;

    if v_latest_standing_auth_event_id is distinct from new.standing_authorization_event_id then
      raise exception 'standing_authorization_event_id does not reference this firm''s current latest authorization event';
    end if;
    if v_latest_standing_auth_event is distinct from 'enabled' then
      raise exception 'this firm''s latest standing publishing authorization event is not enabled (event=%)', v_latest_standing_auth_event;
    end if;
  else
    raise exception 'unrecognized publication receipt release_path %', new.release_path;
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

  -- Clear unconditionally before any artifact-specific handling, so every
  -- code path (root, reconciliation, PDF, non-PDF, no artifact_id at all)
  -- starts from "no trusted hash" and only ever gains one from the bound
  -- artifact's own registered value below.
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
    -- regardless of anything the caller supplied on this row.
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

  -- Root receipts must bind to, and be authorized by, exactly one
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
    if v_claim.claimed_by_id is not null
       and (new.actor_id is null or new.actor_id is distinct from v_claim.claimed_by_id) then
      raise exception 'publication receipt actor does not match the claim''s authenticated operator identity'
        using errcode = 'CLM01';
    end if;
  end if;

  return new;
end;
$function$;
