-- Release safety: standing authorization is limited to the exact current
-- in_review version, and a client request for changes is an append-only,
-- explicit release hold rather than an operator-cleared boolean.

create table public.deliverable_client_change_hold_events (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.intake_firms(id) on delete restrict,
  deliverable_id uuid not null references public.content_deliverables(id) on delete restrict,
  version_id uuid not null references public.deliverable_versions(id) on delete restrict,
  event text not null check (event in ('opened', 'resolved')),
  resolves_open_event_id uuid references public.deliverable_client_change_hold_events(id) on delete restrict,
  actor_role text not null check (actor_role = 'lawyer'),
  actor_id uuid not null references public.firm_lawyers(id) on delete restrict,
  actor_name text not null check (length(btrim(actor_name)) > 0),
  actor_email text not null check (length(btrim(actor_email)) > 0),
  reason text,
  created_at timestamptz not null default now(),
  constraint deliverable_client_change_hold_event_shape check (
    (event = 'opened' and resolves_open_event_id is null and reason is not null and length(btrim(reason)) > 0)
    or (event = 'resolved' and resolves_open_event_id is not null)
  )
);

create unique index deliverable_client_change_hold_one_resolution
  on public.deliverable_client_change_hold_events (resolves_open_event_id)
  where event = 'resolved';
create index deliverable_client_change_hold_open_lookup
  on public.deliverable_client_change_hold_events (firm_id, deliverable_id, version_id, created_at desc);

alter table public.deliverable_client_change_hold_events enable row level security;
alter table public.deliverable_client_change_hold_events force row level security;
revoke all on public.deliverable_client_change_hold_events from public, anon, authenticated;
grant all on public.deliverable_client_change_hold_events to service_role;
create trigger trg_block_deliverable_client_change_hold_event_mutation
  before update or delete on public.deliverable_client_change_hold_events
  for each row execute function public.block_append_only_mutation();

create function public.set_deliverable_client_change_hold(
  p_firm_id uuid,
  p_deliverable_id uuid,
  p_version_id uuid,
  p_event text,
  p_resolves_open_event_id uuid,
  p_actor_role text,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_email text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_open public.deliverable_client_change_hold_events%rowtype;
begin
  if p_event not in ('opened', 'resolved') or p_actor_role is distinct from 'lawyer' then
    return jsonb_build_object('ok', false, 'error', 'only an authorized firm lawyer may open or resolve a client change hold');
  end if;
  perform 1 from public.firm_lawyers where id = p_actor_id and firm_id = p_firm_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'actor is not a lawyer for this firm'); end if;
  perform 1 from public.content_deliverables where id = p_deliverable_id and firm_id = p_firm_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'deliverable not found for this firm'); end if;
  perform 1 from public.deliverable_versions where id = p_version_id and deliverable_id = p_deliverable_id and firm_id = p_firm_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'version does not belong to this deliverable and firm'); end if;
  if p_event = 'resolved' then
    select * into v_open from public.deliverable_client_change_hold_events
      where id = p_resolves_open_event_id and firm_id = p_firm_id and deliverable_id = p_deliverable_id
        and version_id = p_version_id and event = 'opened' for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'open client change hold not found for this version'); end if;
    if exists (select 1 from public.deliverable_client_change_hold_events where event = 'resolved' and resolves_open_event_id = p_resolves_open_event_id) then
      return jsonb_build_object('ok', false, 'error', 'client change hold is already resolved');
    end if;
  end if;
  insert into public.deliverable_client_change_hold_events (
    firm_id, deliverable_id, version_id, event, resolves_open_event_id, actor_role, actor_id, actor_name, actor_email, reason
  ) values (p_firm_id, p_deliverable_id, p_version_id, p_event, p_resolves_open_event_id, p_actor_role, p_actor_id, p_actor_name, p_actor_email, p_reason)
  returning id into v_open.id;
  return jsonb_build_object('ok', true, 'event_id', v_open.id, 'event', p_event);
end;
$$;
revoke all on function public.set_deliverable_client_change_hold(uuid, uuid, uuid, text, uuid, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.set_deliverable_client_change_hold(uuid, uuid, uuid, text, uuid, text, uuid, text, text, text) to service_role;

create function public.has_unresolved_deliverable_client_change_hold(p_firm_id uuid, p_deliverable_id uuid, p_version_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.deliverable_client_change_hold_events opened
    where opened.firm_id = p_firm_id and opened.deliverable_id = p_deliverable_id
      and opened.version_id = p_version_id and opened.event = 'opened'
      and not exists (
        select 1 from public.deliverable_client_change_hold_events resolved
        where resolved.event = 'resolved' and resolved.resolves_open_event_id = opened.id
      )
  );
$$;
revoke all on function public.has_unresolved_deliverable_client_change_hold(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.has_unresolved_deliverable_client_change_hold(uuid, uuid, uuid) to service_role;

create function public.enforce_publication_claim_release_authorization()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_deliverable public.content_deliverables%rowtype; v_version public.deliverable_versions%rowtype; v_auth record;
begin
  select * into v_deliverable from public.content_deliverables where id = new.deliverable_id and firm_id = new.firm_id for update;
  if not found or v_deliverable.current_version_id is distinct from new.approved_version_id then
    raise exception 'release claim must name the exact current deliverable version';
  end if;
  if public.has_unresolved_deliverable_client_change_hold(new.firm_id, new.deliverable_id, new.approved_version_id) then
    raise exception 'release claim is blocked by an unresolved client change hold';
  end if;
  if new.release_path = 'individual_approval' then
    if v_deliverable.status <> 'approved' or v_deliverable.approved_version_id is distinct from new.approved_version_id then
      raise exception 'individual release claim requires exact current individual approval';
    end if;
  elsif new.release_path = 'standing_authorization' then
    if v_deliverable.status <> 'in_review' then raise exception 'standing release claim requires deliverable status in_review'; end if;
    select * into v_version from public.deliverable_versions where id = new.approved_version_id and firm_id = new.firm_id;
    if not found or coalesce(v_version.requires_individual_review, false) then raise exception 'standing release claim requires a version without individual-review hold'; end if;
    select * into v_auth from public.standing_publishing_authorizations where firm_id = new.firm_id order by event_seq desc limit 1;
    if not found or v_auth.event <> 'enabled' or new.standing_authorization_event_id is distinct from v_auth.id then
      raise exception 'standing release claim requires the exact current enabled standing authorization event';
    end if;
  else raise exception 'release claim has an invalid release path'; end if;
  return new;
end;
$$;
revoke all on function public.enforce_publication_claim_release_authorization() from public, anon, authenticated;
create trigger trg_enforce_publication_claim_release_authorization
  before insert on public.publication_placement_claims
  for each row execute function public.enforce_publication_claim_release_authorization();

create function public.enforce_publication_receipt_release_authorization()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_claim public.publication_placement_claims%rowtype;
begin
  if new.reconciles_receipt_id is not null then return new; end if;
  select * into v_claim from public.publication_placement_claims where id = new.claim_id for update;
  if not found or v_claim.status <> 'active' then raise exception 'root publication receipt requires an active release claim' using errcode = 'CLM01'; end if;
  if v_claim.firm_id is distinct from new.firm_id or v_claim.deliverable_id is distinct from new.deliverable_id
     or v_claim.placement_id is distinct from new.placement_id or v_claim.approved_version_id is distinct from new.approved_version_id then
    raise exception 'receipt must bind to the exact active claim evidence' using errcode = 'CLM01';
  end if;
  -- Claim evidence, not caller input or a latest unrelated claim, is the immutable authorization snapshot.
  new.release_path := v_claim.release_path;
  new.standing_authorization_event_id := v_claim.standing_authorization_event_id;
  if public.has_unresolved_deliverable_client_change_hold(new.firm_id, new.deliverable_id, new.approved_version_id) then
    raise exception 'publication receipt is blocked by an unresolved client change hold' using errcode = 'CLM01';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_publication_receipt_release_authorization() from public, anon, authenticated;
create trigger trg_enforce_publication_receipt_release_authorization
  before insert on public.publication_receipts
  for each row execute function public.enforce_publication_receipt_release_authorization();

-- Keep the client request and the release hold atomic. A replacement version
-- deliberately does not resolve this event; resolution is a separate client
-- decision through set_deliverable_client_change_hold().
create or replace function public.record_approval_atomic(
  p_deliverable_id uuid, p_version_id uuid, p_firm_id uuid, p_decision text,
  p_signer_role text, p_signer_id uuid, p_signer_name text, p_signer_email text,
  p_attestation text, p_version_number int, p_deliverable_title text,
  p_ip_address text, p_user_agent text, p_note text, p_attachments jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_current_version uuid; v_record_id uuid; v_created_at timestamptz;
begin
  if p_decision not in ('approved', 'changes_requested') or p_signer_role is distinct from 'lawyer' then
    return jsonb_build_object('ok', false, 'error', 'invalid approval decision or signer role');
  end if;
  select current_version_id into v_current_version from public.content_deliverables
   where id = p_deliverable_id and firm_id = p_firm_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'deliverable not found'); end if;
  if v_current_version is distinct from p_version_id then return jsonb_build_object('ok', false, 'stale', true, 'error', 'a newer version exists'); end if;
  insert into public.approval_records (
    deliverable_id, version_id, firm_id, decision, signer_role, signer_id, signer_name, signer_email,
    attestation, version_number, deliverable_title, ip_address, user_agent, note, attachments
  ) values (
    p_deliverable_id, p_version_id, p_firm_id, p_decision, p_signer_role, p_signer_id, p_signer_name, p_signer_email,
    p_attestation, p_version_number, p_deliverable_title, p_ip_address, p_user_agent, p_note, coalesce(p_attachments, '[]'::jsonb)
  ) returning id, created_at into v_record_id, v_created_at;
  if p_decision = 'approved' then
    update public.content_deliverables set status = 'approved', approved_version_id = p_version_id, approved_at = now(), updated_at = now() where id = p_deliverable_id;
  else
    update public.content_deliverables set status = 'changes_requested', approved_version_id = null, approved_at = null, updated_at = now() where id = p_deliverable_id;
    insert into public.deliverable_client_change_hold_events (
      firm_id, deliverable_id, version_id, event, actor_role, actor_id, actor_name, actor_email, reason
    ) values (
      p_firm_id, p_deliverable_id, p_version_id, 'opened', 'lawyer', p_signer_id, p_signer_name, p_signer_email,
      coalesce(nullif(btrim(p_note), ''), 'Client requested changes')
    );
  end if;
  return jsonb_build_object('ok', true, 'record_id', v_record_id, 'created_at', v_created_at);
end;
$$;
revoke all on function public.record_approval_atomic(uuid, uuid, uuid, text, text, uuid, text, text, text, int, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_approval_atomic(uuid, uuid, uuid, text, text, uuid, text, text, text, int, text, text, text, text, jsonb) to service_role;

notify pgrst, 'reload schema';

-- Authoritative final receipt validator. This replaces the former
-- individual-approval-only root gate while retaining the firm, placement,
-- version, artifact, hash, reconciliation and claim-identity checks.
create or replace function public.validate_publication_receipt_scope()
returns trigger language plpgsql set search_path = public
as $$
declare
  d public.content_deliverables%rowtype;
  p public.content_placements%rowtype;
  c public.publication_placement_claims%rowtype;
  a public.publication_artifacts%rowtype;
  v public.deliverable_versions%rowtype;
  auth record;
  reconciled_version uuid;
begin
  select * into d from public.content_deliverables where id = new.deliverable_id for update;
  if not found or d.firm_id is distinct from new.firm_id then
    raise exception 'publication receipt must reference a deliverable from the same firm';
  end if;

  if new.reconciles_receipt_id is not null and new.verification_state in ('verified', 'failed', 'reconciling') then
    select approved_version_id into reconciled_version from public.publication_receipts where id = new.reconciles_receipt_id;
    if not found or new.approved_version_id is distinct from reconciled_version then
      raise exception 'a verification, failure, or reconciling receipt must carry the reconciled receipt version';
    end if;
  else
    if d.current_version_id is distinct from new.approved_version_id then
      raise exception 'publication receipt must name the exact current version (version drift)';
    end if;
    if public.has_unresolved_deliverable_client_change_hold(new.firm_id, new.deliverable_id, new.approved_version_id) then
      raise exception 'publication receipt is blocked by an unresolved client change hold';
    end if;
    if d.status = 'approved' and d.approved_version_id = new.approved_version_id then
      if new.release_path is not null and new.release_path <> 'individual_approval' then raise exception 'individual approval receipt has wrong release path'; end if;
    elsif d.status = 'in_review' then
      select * into v from public.deliverable_versions where id = new.approved_version_id and firm_id = new.firm_id;
      if not found or coalesce(v.requires_individual_review, false) then raise exception 'standing receipt requires a version without individual-review hold'; end if;
      select * into auth from public.standing_publishing_authorizations where firm_id = new.firm_id order by event_seq desc limit 1;
      if not found or auth.event <> 'enabled' or new.release_path <> 'standing_authorization' or new.standing_authorization_event_id is distinct from auth.id then
        raise exception 'standing receipt requires the exact current enabled standing authorization event';
      end if;
    else
      raise exception 'publication receipt requires exact individual approval or eligible in_review standing authorization';
    end if;
  end if;

  select * into p from public.content_placements where id = new.placement_id for update;
  if not found or p.firm_id is distinct from new.firm_id or p.deliverable_id is distinct from new.deliverable_id or p.destination is distinct from new.destination then
    raise exception 'publication receipt must reference a placement from the same firm, deliverable, and destination';
  end if;
  if new.locale is not null and p.locale is not null and new.locale is distinct from p.locale then raise exception 'publication receipt locale does not match placement'; end if;
  if new.period_id is not null and ((p.period_id is not null and new.period_id is distinct from p.period_id) or (d.period_id is not null and new.period_id is distinct from d.period_id)) then raise exception 'publication receipt period does not match placement or deliverable'; end if;

  select * into v from public.deliverable_versions where id = new.approved_version_id;
  if not found or v.deliverable_id is distinct from new.deliverable_id or v.firm_id is distinct from new.firm_id then raise exception 'publication receipt version is outside its firm and deliverable'; end if;
  new.artifact_sha256 := null;
  if new.artifact_id is not null then
    select * into a from public.publication_artifacts where id = new.artifact_id for update;
    if not found or a.firm_id is distinct from new.firm_id or a.deliverable_id is distinct from new.deliverable_id then raise exception 'publication receipt artifact is outside its firm and deliverable'; end if;
    if a.version_id is distinct from new.approved_version_id or a.superseded_at is not null then raise exception 'publication receipt artifact is stale or bound to another version'; end if;
    if a.artifact_type = 'pdf' and a.sha256 is null then raise exception 'publication receipt PDF artifact lacks immutable sha256'; end if;
    new.artifact_sha256 := a.sha256;
  end if;

  if new.reconciles_receipt_id is not null then
    if new.reconciles_receipt_id = new.id then raise exception 'publication receipt cannot reconcile itself'; end if;
    if not exists (select 1 from public.publication_receipts r where r.id = new.reconciles_receipt_id and r.firm_id = new.firm_id and r.deliverable_id = new.deliverable_id and r.placement_id = new.placement_id) then raise exception 'reconciled receipt is outside this publication scope'; end if;
    if new.verification_state = 'reconciling' and new.reconciles_receipt_id is null then raise exception 'reconciling receipt requires reconciles_receipt_id'; end if;
    return new;
  end if;

  select * into c from public.publication_placement_claims where id = new.claim_id for update;
  if not found or c.status <> 'active' then raise exception 'root publication receipt requires an active claim' using errcode = 'CLM01'; end if;
  if c.firm_id is distinct from new.firm_id or c.deliverable_id is distinct from new.deliverable_id or c.placement_id is distinct from new.placement_id or c.approved_version_id is distinct from new.approved_version_id then raise exception 'receipt claim does not match exact publication scope' using errcode = 'CLM01'; end if;
  if c.claimed_by_role is distinct from new.actor_role or (c.claimed_by_id is not null and (new.actor_id is null or c.claimed_by_id is distinct from new.actor_id)) then raise exception 'receipt actor does not match the authenticated claim actor' using errcode = 'CLM01'; end if;
  if new.release_path is distinct from c.release_path or new.standing_authorization_event_id is distinct from c.standing_authorization_event_id then raise exception 'receipt authorization evidence must match its exact active claim' using errcode = 'CLM01'; end if;
  return new;
end;
$$;
