-- Publication Readiness, Codex second-pass correction: closes the
-- enforcement-downgrade gap in trg_validate_readiness_activation
-- (20260715193131_20260715120000_content_periods_readiness_activation.sql,
-- already applied to production, NOT edited by this migration). DR-099
-- (supersedes DR-098's activation-invariant clause; see the registry).
--
-- The gap: trg_validate_readiness_activation only runs its check when
-- NEW.readiness_lifecycle = 'enforced'. An ordinary privileged UPDATE that
-- sets readiness_lifecycle back to 'setup_required' or
-- 'legacy_unreconciled' (and clears readiness_enforced_at to satisfy the
-- existing pairing CHECK) passes through with zero validation. Because the
-- app always writes through the Supabase service role, no RLS policy
-- watches that statement either. A period that was genuinely enforced,
-- and is failing a real requirement, could be silently un-enforced by any
-- code path (or a mistaken direct SQL edit) with a single UPDATE,
-- collapsing "Blocked" back to "Setup required" or "Historical, not
-- reconciled" and hiding a genuine blocker. That is exactly the failure
-- mode this whole feature exists to prevent (DR-093).
--
-- The fix makes `enforced` monotonic under ordinary writes: once a period
-- is enforced, only the audited RPC below (deactivate_period_readiness_atomic)
-- can move it away from `enforced`. Authorization is proven by
-- current_user, not by a settable flag: the RPC is SECURITY DEFINER,
-- owned by postgres, so current_user is 'postgres' only for the duration
-- of that function's own execution; the app's own writes always run as
-- service_role (Database Access Invariant), never as postgres, so an
-- ordinary UPDATE issued directly (by this app, a future admin script, or
-- a Studio session connected as service_role) is refused with an
-- exception, exactly as an unmet activation preflight already is refused.
--
-- A third-review correction (Codex, second pass) replaced the first draft
-- of this fix, which used a transaction-local custom GUC
-- (publication_readiness.downgrade_authorized) as the authorization
-- signal. That was rejected: PostgreSQL lets any session SET a custom
-- GUC with no privilege check, so a session already holding UPDATE on
-- this table (service_role, the app's own normal write path) could set
-- the flag itself and bypass the guard with zero audit row -- the exact
-- silent-downgrade failure this migration exists to close. current_user,
-- by contrast, cannot be forged by a plain SET/SET LOCAL; it only becomes
-- 'postgres' by actually executing inside a function postgres owns.

-- ---------------------------------------------------------------------------
-- 1) Append-only audit trail for the one exceptional path that IS allowed
--    to move a period off `enforced`.
-- ---------------------------------------------------------------------------

create table if not exists public.content_periods_enforcement_audit (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.content_periods(id) on delete restrict,
  firm_id uuid not null,
  from_lifecycle text not null,
  to_lifecycle text not null,
  reason text not null check (length(btrim(reason)) > 0),
  actor_role text not null check (actor_role = 'operator'),
  actor_id uuid,
  actor_name text,
  created_at timestamptz not null default now()
);

comment on table public.content_periods_enforcement_audit is
  'Append-only record of every exceptional enforced->(setup_required|legacy_unreconciled) transition. Written exclusively by deactivate_period_readiness_atomic; never updated or deleted. actor_role is fixed to operator because this is, by design, not a lawyer- or client-reachable action.';

create index if not exists content_periods_enforcement_audit_period_idx
  on public.content_periods_enforcement_audit (period_id, created_at desc);
create index if not exists content_periods_enforcement_audit_firm_idx
  on public.content_periods_enforcement_audit (firm_id, created_at desc);

create or replace function public.block_content_periods_enforcement_audit_mutation()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  raise exception 'content_periods_enforcement_audit is append-only';
end;
$function$;

drop trigger if exists trg_block_content_periods_enforcement_audit_mutation
  on public.content_periods_enforcement_audit;
create trigger trg_block_content_periods_enforcement_audit_mutation
before update or delete on public.content_periods_enforcement_audit
for each row execute function public.block_content_periods_enforcement_audit_mutation();

alter table public.content_periods_enforcement_audit enable row level security;
alter table public.content_periods_enforcement_audit force row level security;
revoke all on public.content_periods_enforcement_audit from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 2) Make `enforced` monotonic: replace validate_readiness_activation() in
--    place (same function name, same trigger, no edit to the original
--    migration file) so the existing activation-preflight branch is
--    untouched and a new downgrade-guard branch is added alongside it.
-- ---------------------------------------------------------------------------

create or replace function public.validate_readiness_activation()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_incomplete_count integer;
begin
  if new.readiness_lifecycle = 'enforced' then
    -- Unchanged from 20260715193131_20260715120000_content_periods_readiness_activation.sql:
    -- the activation preflight.
    select count(*) into v_incomplete_count
    from public.content_deliverables d
    where d.period_id = new.id
      and d.status <> 'archived'
      and (
        d.deliverable_role is null
        or d.locale is null
        or d.publication_destination is null
        or (
          d.deliverable_role in ('article', 'landing_page', 'lead_magnet_pdf')
          and d.publication_path is null
        )
      );
    if v_incomplete_count > 0 then
      raise exception 'cannot activate readiness for period %: % active deliverable(s) missing role, locale, destination, or placement', new.id, v_incomplete_count;
    end if;
  elsif tg_op = 'UPDATE' and old.readiness_lifecycle = 'enforced' and new.readiness_lifecycle is distinct from 'enforced' then
    -- NEW: enforced is monotonic under ordinary writes. The app always
    -- writes through service_role (Database Access Invariant), never as
    -- postgres. deactivate_period_readiness_atomic is SECURITY DEFINER,
    -- owned by postgres, so current_user becomes 'postgres' only for the
    -- duration of that function's own execution (including the UPDATE
    -- that fires this trigger) -- a property no ordinary session can
    -- forge by setting a GUC or any other session-local value; it can
    -- only be true by actually running inside that function.
    --
    -- A bare custom GUC (the first draft of this migration, reviewed and
    -- rejected before ever reaching production) fails this: PostgreSQL
    -- lets any session SET a custom-namespaced GUC with no privilege
    -- check at all, so a session already holding UPDATE on this table
    -- (service_role, exactly the app's own normal write path) could set
    -- the flag itself and bypass the guard with zero audit row, which is
    -- the same "ordinary write silently un-enforces the period" failure
    -- this whole migration exists to close.
    if current_user <> 'postgres' then
      raise exception 'cannot move period % from enforced to % via an ordinary update; use deactivate_period_readiness_atomic, which records an audited reason', new.id, new.readiness_lifecycle;
    end if;
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3) The one audited, operator-only exceptional path. Mirrors the atomic
--    lock-check-write-audit shape of record_approval_atomic
--    (20260623_approval_rpc_atomic.sql): a single transaction that sets the
--    downgrade-authorized flag, performs the UPDATE the trigger above would
--    otherwise refuse, and writes the append-only audit row, so the two
--    either both happen or neither does. actor_role/actor_id/actor_name are
--    supplied by the caller (this app has no Supabase-Auth session for the
--    database to inspect); the application-layer route calling this RPC
--    remains responsible for actually verifying the caller is an operator,
--    exactly as activatePeriodReadiness's own route does today. This
--    function additionally refuses a non-'operator' actor_role itself, as
--    defense in depth against any future caller that skips that check.
-- ---------------------------------------------------------------------------

create or replace function public.deactivate_period_readiness_atomic(
  p_period_id    uuid,
  p_firm_id      uuid,
  p_to_lifecycle text,
  p_reason       text,
  p_actor_role   text,
  p_actor_id     uuid,
  p_actor_name   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_lifecycle text;
  v_audit_id       uuid;
  v_created_at     timestamptz;
begin
  if p_actor_role <> 'operator' then
    return jsonb_build_object('ok', false, 'error', 'only an operator may deactivate readiness enforcement');
  end if;

  if p_to_lifecycle not in ('setup_required', 'legacy_unreconciled') then
    return jsonb_build_object('ok', false, 'error', 'to_lifecycle must be setup_required or legacy_unreconciled');
  end if;

  if p_reason is null or length(btrim(p_reason)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'a reason is required to deactivate enforcement');
  end if;

  select readiness_lifecycle into v_from_lifecycle
  from public.content_periods
  where id = p_period_id and firm_id = p_firm_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'period not found for this firm');
  end if;

  if v_from_lifecycle <> 'enforced' then
    return jsonb_build_object('ok', false, 'error', format('period is %s, not enforced; nothing to deactivate', v_from_lifecycle));
  end if;

  -- No flag to set: current_user is 'postgres' for the duration of this
  -- SECURITY DEFINER call by virtue of the function's own ownership, which
  -- is what the trigger above actually checks. Nothing here authorizes
  -- the write; the fact that we are running inside this function does.
  update public.content_periods
     set readiness_lifecycle   = p_to_lifecycle,
         readiness_enforced_at = null,
         updated_at            = now()
   where id = p_period_id and firm_id = p_firm_id;

  insert into public.content_periods_enforcement_audit (
    period_id, firm_id, from_lifecycle, to_lifecycle, reason,
    actor_role, actor_id, actor_name
  ) values (
    p_period_id, p_firm_id, v_from_lifecycle, p_to_lifecycle, p_reason,
    p_actor_role, p_actor_id, p_actor_name
  )
  returning id, created_at into v_audit_id, v_created_at;

  return jsonb_build_object(
    'ok', true,
    'audit_id', v_audit_id,
    'created_at', v_created_at,
    'from_lifecycle', v_from_lifecycle,
    'to_lifecycle', p_to_lifecycle
  );
end;
$$;

revoke all on function public.deactivate_period_readiness_atomic from public, anon, authenticated;
grant execute on function public.deactivate_period_readiness_atomic to service_role;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verification (NOT executed by this migration; run manually against a
-- Supabase development branch or staging copy before this migration is
-- ever applied to production). See
-- scripts/verify-content-periods-enforced-monotonic.sql for the runnable
-- version of the checks below:
--
--   1. Activate a test period (ordinary UPDATE ... SET readiness_lifecycle
--      = 'enforced' on a period whose deliverables already satisfy the
--      preflight) -- succeeds, matching existing behavior.
--   2. Attempt an ordinary UPDATE ... SET readiness_lifecycle =
--      'setup_required' on that now-enforced period -- must raise
--      "cannot move period ... via an ordinary update".
--   3. Attempt an ordinary UPDATE ... SET readiness_lifecycle =
--      'legacy_unreconciled' on the same period -- must also raise.
--   4. Call deactivate_period_readiness_atomic(..., p_actor_role =>
--      'lawyer') -- must return {"ok": false, "error": "only an
--      operator..."} and must NOT change the row or write an audit row.
--   5. Call deactivate_period_readiness_atomic(..., p_reason => '') --
--      must return {"ok": false, ...} and must NOT change the row.
--   6. Call deactivate_period_readiness_atomic with valid operator
--      arguments -- must succeed, the period's readiness_lifecycle and
--      readiness_enforced_at must update, and exactly one new row must
--      appear in content_periods_enforcement_audit with the correct
--      from/to/reason/actor fields.
--   7. Attempt to UPDATE or DELETE the audit row just written -- must
--      raise "content_periods_enforcement_audit is append-only".
--   8. Call deactivate_period_readiness_atomic a second time on the same
--      (now setup_required) period -- must return {"ok": false, "error":
--      "period is setup_required, not enforced..."}.
--   9. Regression check against the rejected first draft: re-activate the
--      period to enforced, then run
--      "SET LOCAL publication_readiness.downgrade_authorized = 'true';"
--      followed by an ordinary UPDATE ... SET readiness_lifecycle =
--      'setup_required' in the SAME transaction -- must still raise "cannot
--      move period ... via an ordinary update", proving the GUC has no
--      effect under the current_user-based design.
--   10. readiness_enforced_at must be non-null after check 1 (activation)
--       and null again after check 6 (deactivation) -- assert the column
--       value directly, not only readiness_lifecycle.
-- ---------------------------------------------------------------------------
