-- Standing Publishing Authorization.
--
-- DRG Law has agreed that CaseLoad Select may publish future content
-- without waiting for Damaris (or another firm lawyer) to review every
-- individual version, provided each version still passes the existing
-- internal QA / legal-safety / metadata / artifact / placement release
-- gates. Damaris controls this authorization herself, from the client
-- portal, and can turn it on or off at any time. This is NOT "blanket
-- legal approval" and must never be recorded or displayed as if Damaris
-- reviewed a version she did not review -- see the append-only design
-- below and CONTENT_STUDIO_APPROVAL_PLAYBOOK.md.
--
-- Three pieces:
--
--   1. standing_publishing_authorizations -- an append-only event log
--      (never a mutable boolean) recording every enable/disable, who did
--      it, the exact wording shown, and the policy/scope/notification
--      choices in force. Current state is always DERIVED from the latest
--      row (order by event_seq desc), matching this codebase's existing
--      pattern for content_periods_enforcement_audit and approval_records
--      (see set_standing_publishing_authorization below) rather than a
--      separately-maintained projection, so there is only one source of
--      truth to keep correct.
--
--   2. deliverable_versions.requires_individual_review -- an operator-only
--      per-version exception ("this one needs a human lawyer look, standing
--      authorization does not apply to it"), for unusual/sensitive/
--      uncertain/high-risk content.
--
--   3. claim_placement_for_publish() gains a second, narrower path: a
--      version may be claimed for publish either because it was
--      INDIVIDUALLY APPROVED (existing path, unchanged), or because the
--      firm currently holds an ENABLED standing authorization and this
--      specific version was not flagged for individual review (new path).
--      Every existing QA/artifact/placement/comment gate upstream of this
--      RPC (buildPreflightReport, evaluateDeliverableReadiness,
--      content-validators.ts) is completely untouched -- standing
--      authorization only ever substitutes for the "has a lawyer
--      individually signed this exact version" condition, nothing else.
--      publication_placement_claims records which path authorized a given
--      claim (release_path + standing_authorization_event_id), and since
--      standing_publishing_authorizations rows are append-only and
--      immutable, that foreign key durably preserves the authorization
--      snapshot even if the firm later disables authorization -- no
--      separate snapshot copy is needed.

-- ─── 1. Append-only authorization event log ─────────────────────────────

create table public.standing_publishing_authorizations (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.intake_firms(id) on delete restrict,

  -- Strictly increasing per-row identity, independent of wall-clock
  -- precision. This, not created_at/effective_at, is the authoritative
  -- ordering column: "latest" always means "greatest event_seq", so two
  -- events landing in the same millisecond (or a firm's clock skew) can
  -- never produce an ambiguous "current state" read.
  event_seq bigint generated always as identity,

  event text not null check (event in ('enabled', 'disabled')),

  -- Only a firm lawyer/client decision-maker may ever appear here --
  -- operators cannot enable or disable standing authorization for a
  -- client (see set_standing_publishing_authorization below, which
  -- enforces this as a second, DB-level gate independent of the portal
  -- route's own auth check).
  actor_role text not null check (actor_role = 'lawyer'),
  actor_id uuid references public.firm_lawyers(id) on delete restrict,
  actor_name text not null check (length(btrim(actor_name)) > 0),
  actor_email text not null check (length(btrim(actor_email)) > 0),

  -- Required (and frozen) on an 'enabled' event; not applicable to a
  -- 'disabled' event, which does not grant any authorization.
  authorization_text text,
  policy_version text,
  scope text,
  notification_preference text check (
    notification_preference is null
    or notification_preference in ('per_publication', 'weekly_digest')
  ),

  reason text,
  ip_address text,
  user_agent text,

  -- Distinct from created_at (see the file header): today these are
  -- always equal (no backdating is supported -- both are stamped by the
  -- database at insert time, never accepted from the caller), but they
  -- are modelled separately because "when this authorization takes
  -- effect" and "when this row was written" are different concepts and a
  -- future scheduled-effective-date feature should not need a schema
  -- change to distinguish them.
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint standing_publishing_authorizations_enabled_fields_check check (
    event <> 'enabled'
    or (
      authorization_text is not null and length(btrim(authorization_text)) > 0
      and policy_version is not null and length(btrim(policy_version)) > 0
      and scope is not null and length(btrim(scope)) > 0
      and notification_preference is not null
    )
  )
);

create index idx_standing_publishing_authorizations_firm_seq
  on public.standing_publishing_authorizations (firm_id, event_seq desc);

alter table public.standing_publishing_authorizations enable row level security;
alter table public.standing_publishing_authorizations force row level security;
revoke all on public.standing_publishing_authorizations from anon, authenticated, public;
grant all on public.standing_publishing_authorizations to service_role;
-- Zero policies, deliberately: matching this schema's established
-- convention (content_placements, publication_receipts, approval_records),
-- firm-scoping and role gating are enforced in the RPC / trigger layer
-- below, not via RLS USING clauses, because all application access goes
-- through the service role, which bypasses RLS but not triggers.

create trigger trg_block_standing_publishing_authorization_mutation
  before update or delete on public.standing_publishing_authorizations
  for each row execute function public.block_append_only_mutation();

-- Atomic, audited enable/disable. Locks the intake_firms row so two
-- concurrent enable/disable calls for the SAME firm serialize instead of
-- racing; event_seq (an identity column) then gives the second call a
-- strictly greater sequence number than the first, so "latest wins" is
-- always well-defined and deterministic under concurrency -- never two
-- rows tied on the same instant. actor_role is a required parameter, not
-- inferred, and is independently checked here ('lawyer' only) as
-- defense-in-depth: the calling route must never forward anything but the
-- portal session's own verified role, but a bug there must still not be
-- able to fabricate an operator-issued authorization event.
create function public.set_standing_publishing_authorization(
  p_firm_id uuid,
  p_event text,
  p_actor_role text,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_email text,
  p_authorization_text text,
  p_policy_version text,
  p_scope text,
  p_notification_preference text,
  p_reason text,
  p_ip_address text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_row record;
begin
  if p_event not in ('enabled', 'disabled') then
    return jsonb_build_object('ok', false, 'error', 'event must be ''enabled'' or ''disabled''');
  end if;
  if p_actor_role is distinct from 'lawyer' then
    return jsonb_build_object('ok', false, 'error', 'only an authorized firm lawyer/client decision-maker may change standing publishing authorization');
  end if;
  if p_actor_name is null or length(btrim(p_actor_name)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'actor_name is required');
  end if;
  if p_actor_email is null or length(btrim(p_actor_email)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'actor_email is required');
  end if;

  if p_event = 'enabled' then
    if p_authorization_text is null or length(btrim(p_authorization_text)) = 0 then
      return jsonb_build_object('ok', false, 'error', 'authorization_text is required to enable standing authorization');
    end if;
    if p_policy_version is null or length(btrim(p_policy_version)) = 0 then
      return jsonb_build_object('ok', false, 'error', 'policy_version is required to enable standing authorization');
    end if;
    if p_scope is null or length(btrim(p_scope)) = 0 then
      return jsonb_build_object('ok', false, 'error', 'scope is required to enable standing authorization');
    end if;
    if p_notification_preference is null or p_notification_preference not in ('per_publication', 'weekly_digest') then
      return jsonb_build_object('ok', false, 'error', 'notification_preference must be ''per_publication'' or ''weekly_digest''');
    end if;
  end if;

  -- Lock the firm row so a concurrent enable/disable for this SAME firm
  -- serializes on this transaction rather than racing it. This also
  -- confirms the firm exists.
  perform 1 from public.intake_firms where id = p_firm_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'firm not found');
  end if;

  insert into public.standing_publishing_authorizations (
    firm_id, event, actor_role, actor_id, actor_name, actor_email,
    authorization_text, policy_version, scope, notification_preference,
    reason, ip_address, user_agent
  ) values (
    p_firm_id, p_event, p_actor_role, p_actor_id, p_actor_name, p_actor_email,
    case when p_event = 'enabled' then p_authorization_text else null end,
    case when p_event = 'enabled' then p_policy_version else null end,
    case when p_event = 'enabled' then p_scope else null end,
    case when p_event = 'enabled' then p_notification_preference else null end,
    p_reason, p_ip_address, p_user_agent
  )
  returning * into v_new_row;

  return jsonb_build_object(
    'ok', true,
    'event_id', v_new_row.id,
    'event_seq', v_new_row.event_seq,
    'event', v_new_row.event,
    'effective_at', v_new_row.effective_at
  );
end;
$$;

revoke all on function public.set_standing_publishing_authorization(
  uuid, text, text, uuid, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.set_standing_publishing_authorization(
  uuid, text, text, uuid, text, text, text, text, text, text, text, text, text
) to service_role;

-- ─── 2. Operator-only per-version individual-review exception ──────────

alter table public.deliverable_versions
  add column requires_individual_review boolean not null default false,
  add column requires_individual_review_reason text,
  add column requires_individual_review_set_by_role text
    check (requires_individual_review_set_by_role is null or requires_individual_review_set_by_role = 'operator'),
  add column requires_individual_review_set_by_id uuid,
  add column requires_individual_review_set_by_name text,
  add column requires_individual_review_set_at timestamptz,
  add constraint deliverable_versions_individual_review_reason_check check (
    requires_individual_review = false
    or (requires_individual_review_reason is not null and length(btrim(requires_individual_review_reason)) > 0)
  );

-- Atomic, audited set/clear of the per-version exception. Operator-only:
-- checked here independently of the calling route's own auth, exactly
-- like set_standing_publishing_authorization's lawyer-only check above,
-- so the two exceptions can never be applied by the wrong side.
create function public.set_deliverable_version_individual_review_requirement(
  p_version_id uuid,
  p_firm_id uuid,
  p_required boolean,
  p_actor_role text,
  p_actor_id uuid,
  p_actor_name text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version record;
begin
  if p_actor_role is distinct from 'operator' then
    return jsonb_build_object('ok', false, 'error', 'only an operator may require individual review for a version');
  end if;
  if p_required and (p_reason is null or length(btrim(p_reason)) = 0) then
    return jsonb_build_object('ok', false, 'error', 'a reason is required to require individual review');
  end if;

  select * into v_version
    from public.deliverable_versions
   where id = p_version_id and firm_id = p_firm_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'version not found for this firm');
  end if;

  update public.deliverable_versions
     set requires_individual_review = p_required,
         requires_individual_review_reason = case when p_required then p_reason else null end,
         requires_individual_review_set_by_role = case when p_required then p_actor_role else null end,
         requires_individual_review_set_by_id = case when p_required then p_actor_id else null end,
         requires_individual_review_set_by_name = case when p_required then p_actor_name else null end,
         requires_individual_review_set_at = case when p_required then now() else null end
   where id = p_version_id;

  return jsonb_build_object('ok', true, 'version_id', p_version_id, 'requires_individual_review', p_required);
end;
$$;

revoke all on function public.set_deliverable_version_individual_review_requirement(
  uuid, uuid, boolean, text, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.set_deliverable_version_individual_review_requirement(
  uuid, uuid, boolean, text, uuid, text, text
) to service_role;

-- ─── 3. Release-gate integration: claim_placement_for_publish path B ───

alter table public.publication_placement_claims
  add column release_path text not null default 'individual_approval'
    check (release_path in ('individual_approval', 'standing_authorization')),
  add column standing_authorization_event_id uuid
    references public.standing_publishing_authorizations(id) on delete restrict,
  add constraint publication_placement_claims_release_path_pair_check check (
    (release_path = 'standing_authorization') = (standing_authorization_event_id is not null)
  );

-- Same signature as the existing function (see
-- 20260717015014_publication_placement_claim_idempotency_firm_scoping.sql,
-- the prior definition this replaces) -- every existing caller and test
-- keeps working unchanged. The only behavioral change is what the
-- function accepts in place of "deliverable.status = 'approved'": that
-- condition (path A, individual_approval, byte-for-byte unchanged) is now
-- one of two ways to satisfy the gate, the other being an enabled standing
-- authorization for the firm plus a version not flagged
-- requires_individual_review (path B, standing_authorization). Every other
-- check in this function -- idempotency identity/firm scoping, the
-- already-published guard, the one-active-claim-per-placement guard -- is
-- unchanged.
create or replace function public.claim_placement_for_publish(p_firm_id uuid, p_deliverable_id uuid, p_placement_id uuid, p_approved_version_id uuid, p_idempotency_key text, p_actor_role text, p_actor_id uuid, p_actor_name text, p_supersedes_claim_id uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_existing record;
  v_deliverable record;
  v_placement record;
  v_root_receipt record;
  v_chain_tip record;
  v_current_active record;
  v_new_claim record;
  v_version record;
  v_auth_event record;
  v_release_path text;
  v_standing_authorization_event_id uuid;
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
    if v_existing.firm_id is distinct from p_firm_id
       or v_existing.deliverable_id is distinct from p_deliverable_id
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
    return jsonb_build_object('ok', true, 'claim_id', v_existing.id, 'idempotent_replay', true, 'status', v_existing.status, 'release_path', v_existing.release_path);
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

  -- re-check idempotency now that the placement row is locked (Gap 1 fix,
  -- 20260716155746), with the same identity guard as the fast-path check
  -- above (now including firm_id, Codex follow-up gap 1).
  select * into v_existing
    from public.publication_placement_claims
   where placement_id = p_placement_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.firm_id is distinct from p_firm_id
       or v_existing.deliverable_id is distinct from p_deliverable_id
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
    return jsonb_build_object('ok', true, 'claim_id', v_existing.id, 'idempotent_replay', true, 'status', v_existing.status, 'release_path', v_existing.release_path);
  end if;

  -- The version being claimed must always be the deliverable's CURRENT
  -- version, on either path -- this is unconditional (a claim can never
  -- target a stale draft), unlike the approved-version check below which
  -- only applies to path A.
  if v_deliverable.current_version_id is distinct from p_approved_version_id then
    return jsonb_build_object('ok', false, 'error', 'version drift: not the deliverable''s current version', 'next_action', 'resolve_version_drift');
  end if;

  if v_deliverable.status = 'approved' and v_deliverable.approved_version_id = p_approved_version_id then
    -- Path A: unchanged individual lawyer approval.
    v_release_path := 'individual_approval';
    v_standing_authorization_event_id := null;
  else
    -- Path B: standing publishing authorization. Never available when the
    -- version was flagged for mandatory individual review, and never
    -- available unless the firm's LATEST authorization event is
    -- 'enabled' -- a disabled (or never-authorized) firm falls straight
    -- back to needing an individual approval, same as before this
    -- feature existed.
    select * into v_version
      from public.deliverable_versions
     where id = p_approved_version_id and firm_id = p_firm_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'version not found for this firm');
    end if;
    if coalesce(v_version.requires_individual_review, false) then
      return jsonb_build_object('ok', false, 'error', 'this version requires individual lawyer review and cannot rely on standing publishing authorization', 'next_action', 'approve_deliverable');
    end if;

    select * into v_auth_event
      from public.standing_publishing_authorizations
     where firm_id = p_firm_id
     order by event_seq desc
     limit 1;
    if not found or v_auth_event.event <> 'enabled' then
      return jsonb_build_object('ok', false, 'error', 'deliverable is not individually approved and no active standing publishing authorization covers this firm', 'next_action', 'approve_deliverable');
    end if;

    v_release_path := 'standing_authorization';
    v_standing_authorization_event_id := v_auth_event.id;
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
    status, supersedes_claim_id, claimed_by_role, claimed_by_id, claimed_by_name,
    release_path, standing_authorization_event_id
  ) values (
    p_firm_id, p_deliverable_id, p_placement_id, p_approved_version_id, p_idempotency_key,
    'active', p_supersedes_claim_id, p_actor_role, p_actor_id, p_actor_name,
    v_release_path, v_standing_authorization_event_id
  )
  returning * into v_new_claim;

  return jsonb_build_object('ok', true, 'claim_id', v_new_claim.id, 'idempotent_replay', false, 'status', 'active', 'release_path', v_release_path);
end;
$function$;

revoke all on function public.claim_placement_for_publish(
  uuid, uuid, uuid, uuid, text, text, uuid, text, uuid
) from anon, authenticated, public;
grant execute on function public.claim_placement_for_publish(
  uuid, uuid, uuid, uuid, text, text, uuid, text, uuid
) to service_role;

-- ─── 4. Release evidence: carry the release path through to receipts ───

alter table public.publication_receipts
  add column release_path text
    check (release_path is null or release_path in ('individual_approval', 'standing_authorization')),
  add column standing_authorization_event_id uuid
    references public.standing_publishing_authorizations(id) on delete restrict,
  add constraint publication_receipts_release_path_pair_check check (
    standing_authorization_event_id is null or release_path = 'standing_authorization'
  );

-- Best-effort derivation, not authoritative enforcement: publication_receipts
-- can still be written directly (the manual operator path documented in
-- PUBLICATION_READINESS_OPERATING_MODEL.md, and CHECK 6 of
-- scripts/verify-publication-placement-claim.sql), bypassing
-- claim_placement_for_publish entirely, so this trigger fills in
-- release_path/standing_authorization_event_id from the matching claim
-- ONLY when the caller left them null. It never overrides an explicitly
-- supplied value, and defaults to 'individual_approval' with no event id
-- when no matching claim exists at all, preserving the pre-existing
-- (implicit) assumption for every receipt this feature does not touch.
create function public.derive_publication_receipt_release_path()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_claim record;
begin
  if new.release_path is not null then
    return new;
  end if;

  select * into v_claim
    from public.publication_placement_claims
   where placement_id = new.placement_id
     and approved_version_id = new.approved_version_id
   order by claimed_at desc
   limit 1;

  if found then
    new.release_path := v_claim.release_path;
    new.standing_authorization_event_id := v_claim.standing_authorization_event_id;
  else
    new.release_path := 'individual_approval';
  end if;

  return new;
end;
$$;

revoke all on function public.derive_publication_receipt_release_path() from anon, authenticated, public;

create trigger trg_derive_publication_receipt_release_path
  before insert on public.publication_receipts
  for each row execute function public.derive_publication_receipt_release_path();
