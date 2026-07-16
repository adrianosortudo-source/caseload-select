-- Corrective release, workstream 3: publication_placement_claims has zero
-- triggers of its own. Because service_role bypasses RLS entirely, and this
-- table's only RLS posture is "no policy, grant all to service_role,"
-- ordinary application writes can insert/update/delete claim rows directly,
-- bypassing claim_placement_for_publish()'s idempotency, locking, and
-- readiness re-validation entirely.
--
-- Pattern matches the existing, already-audited DR-099 precedent
-- (validate_readiness_activation(), see
-- 20260715210116_content_periods_enforced_monotonic.sql and
-- docs/PUBLICATION_READINESS_OPERATING_MODEL.md): block the mutation for
-- everyone except current_user = 'postgres', and make every legitimate
-- write path (the claim RPC, the receipt-release trigger) a SECURITY
-- DEFINER function owned by postgres so it passes.
--
-- This intentionally does NOT use a session-local GUC flag as the bypass
-- mechanism -- that approach was rejected in this codebase's DR-099
-- discussion precisely because a GUC flag set once in a session authorizes
-- every subsequent statement in that session, not just the one intended.
--
-- Documented limitation, honestly (see workstream 7 doc fix): a Postgres
-- superuser/database owner can still administratively override this
-- (disable the trigger, run as postgres directly, etc). This blocks
-- ordinary service_role application writes, not a determined database
-- owner -- the same boundary DR-099 already documents for content_periods
-- enforcement.
--
-- Dry-run validated against production (checks 10-14 of
-- scripts/verify-publication-receipt-claim-binding.sql) via a rolled-back
-- transaction before being applied for real, including confirming the
-- legitimate RPC and receipt-release paths still function with this trigger
-- active.

create or replace function public.block_publication_placement_claim_direct_mutation()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if current_user <> 'postgres' then
    if tg_op = 'INSERT' then
      raise exception 'publication_placement_claims rows may only be created via claim_placement_for_publish(); direct inserts are not permitted';
    elsif tg_op = 'UPDATE' then
      raise exception 'publication_placement_claims rows may only be updated via claim_placement_for_publish() or the exact-claim receipt-release path; direct updates are not permitted';
    elsif tg_op = 'DELETE' then
      raise exception 'publication_placement_claims rows may never be deleted (append-only claim history); direct deletes are not permitted';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_block_publication_placement_claim_mutation on public.publication_placement_claims;
create trigger trg_block_publication_placement_claim_mutation
before insert or update or delete on public.publication_placement_claims
for each row execute function public.block_publication_placement_claim_direct_mutation();
