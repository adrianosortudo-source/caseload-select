-- Runnable verification for
-- supabase/migrations/20260715210116_content_periods_enforced_monotonic.sql.
-- (Filename reconciled 2026-07-16; this script previously pointed at the
-- pre-reconciliation name 20260715195701_content_periods_enforced_monotonic.sql,
-- which no longer exists on disk. See docs/audits for the migration-lineage
-- reconciliation this corrective release performed.)
--
-- NOT run automatically by anything. Run this by hand against a Supabase
-- development branch or a staging copy of the database, AFTER applying the
-- migration above there (never against production before the second Codex
-- release review clears it). Wrapped in BEGIN/ROLLBACK end to end so it
-- leaves no trace regardless of outcome; every check below either RAISEs
-- (caught by the DO block, reported, execution continues to the next
-- check) or asserts on the RPC's returned jsonb.
--
-- Usage: psql "$SUPABASE_DB_URL" -f scripts/verify-content-periods-enforced-monotonic.sql

begin;

do $$
declare
  v_firm_id      uuid := '00000000-0000-0000-0000-000000000001';
  v_period_id    uuid;
  v_deliverable  uuid;
  v_version      uuid;
  v_lifecycle    text;
  v_result       jsonb;
  v_audit_count  integer;
  v_raised       boolean;
begin
  raise notice '=== setup: one metadata-complete deliverable, ready to activate ===';

  insert into public.content_periods (id, firm_id, starts_on, ends_on, theme, readiness_lifecycle)
  values (gen_random_uuid(), v_firm_id, current_date, current_date + 4, 'VERIFY monotonic enforcement', 'setup_required')
  returning id into v_period_id;

  insert into public.content_deliverables (
    id, firm_id, period_id, title, status, content_kind,
    locale, deliverable_role, publication_destination, publication_path
  ) values (
    gen_random_uuid(), v_firm_id, v_period_id, 'VERIFY deliverable', 'approved', 'text',
    'en-CA', 'article', 'firm_website', '/journal/verify-monotonic-test'
  ) returning id into v_deliverable;

  insert into public.deliverable_versions (id, deliverable_id, firm_id, version_number, body_html)
  values (gen_random_uuid(), v_deliverable, v_firm_id, 1, '<p>verify</p>')
  returning id into v_version;

  update public.content_deliverables
     set current_version_id = v_version, approved_version_id = v_version
   where id = v_deliverable;

  -- Check 1: ordinary activation still works (existing preflight branch untouched).
  update public.content_periods
     set readiness_lifecycle = 'enforced', readiness_enforced_at = now()
   where id = v_period_id;

  select readiness_lifecycle into v_lifecycle from public.content_periods where id = v_period_id;
  if v_lifecycle = 'enforced' then
    raise notice 'CHECK 1 PASS: ordinary activation still succeeds';
  else
    raise exception 'CHECK 1 FAIL: activation did not stick, lifecycle=%', v_lifecycle;
  end if;

  -- Check 2: ordinary downgrade to setup_required is refused.
  v_raised := false;
  begin
    update public.content_periods set readiness_lifecycle = 'setup_required', readiness_enforced_at = null where id = v_period_id;
  exception when others then
    v_raised := true;
    raise notice 'CHECK 2 PASS: ordinary downgrade to setup_required raised: %', sqlerrm;
  end;
  if not v_raised then
    raise exception 'CHECK 2 FAIL: ordinary downgrade to setup_required was NOT refused';
  end if;

  -- Check 3: ordinary downgrade to legacy_unreconciled is refused too.
  v_raised := false;
  begin
    update public.content_periods set readiness_lifecycle = 'legacy_unreconciled', readiness_enforced_at = null where id = v_period_id;
  exception when others then
    v_raised := true;
    raise notice 'CHECK 3 PASS: ordinary downgrade to legacy_unreconciled raised: %', sqlerrm;
  end;
  if not v_raised then
    raise exception 'CHECK 3 FAIL: ordinary downgrade to legacy_unreconciled was NOT refused';
  end if;

  -- Confirm still enforced after the two refused attempts.
  select readiness_lifecycle into v_lifecycle from public.content_periods where id = v_period_id;
  if v_lifecycle <> 'enforced' then
    raise exception 'CHECK 2/3 FAIL: period lifecycle changed to % despite the refused updates', v_lifecycle;
  end if;

  -- Check 4: RPC refuses a non-operator actor_role.
  v_result := public.deactivate_period_readiness_atomic(v_period_id, v_firm_id, 'setup_required', 'test reason', 'lawyer', null, 'Not An Operator');
  if (v_result->>'ok')::boolean = false and v_result->>'error' ilike 'only an operator%' then
    raise notice 'CHECK 4 PASS: RPC refused lawyer actor_role: %', v_result;
  else
    raise exception 'CHECK 4 FAIL: RPC did not refuse lawyer actor_role: %', v_result;
  end if;
  select readiness_lifecycle into v_lifecycle from public.content_periods where id = v_period_id;
  if v_lifecycle <> 'enforced' then
    raise exception 'CHECK 4 FAIL: period lifecycle changed despite refused actor_role: %', v_lifecycle;
  end if;
  select count(*) into v_audit_count from public.content_periods_enforcement_audit where period_id = v_period_id;
  if v_audit_count <> 0 then
    raise exception 'CHECK 4 FAIL: a refused actor_role must not write an audit row, found %', v_audit_count;
  end if;

  -- Check 5: RPC refuses an empty reason.
  v_result := public.deactivate_period_readiness_atomic(v_period_id, v_firm_id, 'setup_required', '', 'operator', null, 'Test Operator');
  if (v_result->>'ok')::boolean = false then
    raise notice 'CHECK 5 PASS: RPC refused empty reason: %', v_result;
  else
    raise exception 'CHECK 5 FAIL: RPC accepted an empty reason: %', v_result;
  end if;
  select readiness_lifecycle into v_lifecycle from public.content_periods where id = v_period_id;
  if v_lifecycle <> 'enforced' then
    raise exception 'CHECK 5 FAIL: period lifecycle changed despite refused empty reason: %', v_lifecycle;
  end if;
  select count(*) into v_audit_count from public.content_periods_enforcement_audit where period_id = v_period_id;
  if v_audit_count <> 0 then
    raise exception 'CHECK 5 FAIL: a refused empty reason must not write an audit row, found %', v_audit_count;
  end if;

  -- Check 6: RPC succeeds with valid operator arguments; audit row lands.
  select count(*) into v_audit_count from public.content_periods_enforcement_audit where period_id = v_period_id;
  if v_audit_count <> 0 then
    raise exception 'CHECK 6 FAIL: unexpected pre-existing audit rows: %', v_audit_count;
  end if;

  v_result := public.deactivate_period_readiness_atomic(v_period_id, v_firm_id, 'setup_required', 'verification script exceptional-path test', 'operator', gen_random_uuid(), 'Test Operator');
  if (v_result->>'ok')::boolean is not true then
    raise exception 'CHECK 6 FAIL: valid RPC call did not succeed: %', v_result;
  end if;

  select readiness_lifecycle into v_lifecycle from public.content_periods where id = v_period_id;
  if v_lifecycle <> 'setup_required' then
    raise exception 'CHECK 6 FAIL: period lifecycle is % after a successful deactivation, expected setup_required', v_lifecycle;
  end if;

  select count(*) into v_audit_count from public.content_periods_enforcement_audit where period_id = v_period_id;
  if v_audit_count = 1 then
    raise notice 'CHECK 6 PASS: RPC succeeded, lifecycle is setup_required, exactly 1 audit row written';
  else
    raise exception 'CHECK 6 FAIL: expected exactly 1 audit row, found %', v_audit_count;
  end if;

  -- Check 7: the audit row itself is append-only.
  v_raised := false;
  begin
    update public.content_periods_enforcement_audit set reason = 'tampered' where period_id = v_period_id;
  exception when others then
    v_raised := true;
    raise notice 'CHECK 7 PASS: audit row UPDATE raised: %', sqlerrm;
  end;
  if not v_raised then
    raise exception 'CHECK 7 FAIL: audit row UPDATE was NOT refused';
  end if;

  v_raised := false;
  begin
    delete from public.content_periods_enforcement_audit where period_id = v_period_id;
  exception when others then
    v_raised := true;
    raise notice 'CHECK 7 PASS: audit row DELETE raised: %', sqlerrm;
  end;
  if not v_raised then
    raise exception 'CHECK 7 FAIL: audit row DELETE was NOT refused';
  end if;

  -- Check 8: calling the RPC again on an already-non-enforced period is a no-op error, not a silent success.
  v_result := public.deactivate_period_readiness_atomic(v_period_id, v_firm_id, 'legacy_unreconciled', 'second call should fail', 'operator', gen_random_uuid(), 'Test Operator');
  if (v_result->>'ok')::boolean = false and v_result->>'error' ilike 'period is setup_required%' then
    raise notice 'CHECK 8 PASS: second deactivation call on a non-enforced period correctly refused: %', v_result;
  else
    raise exception 'CHECK 8 FAIL: second deactivation call should have been refused: %', v_result;
  end if;

  -- Check 9: regression test against the rejected first draft (a bare
  -- custom GUC as the authorization signal). Re-activate the period, then
  -- set the OLD flag name directly and attempt an ordinary downgrade in
  -- the same transaction -- must still be refused, proving the
  -- current_user-based design is not fooled by it.
  update public.content_periods
     set readiness_lifecycle = 'enforced', readiness_enforced_at = now()
   where id = v_period_id;

  perform set_config('publication_readiness.downgrade_authorized', 'true', true);

  v_raised := false;
  begin
    update public.content_periods set readiness_lifecycle = 'setup_required', readiness_enforced_at = null where id = v_period_id;
  exception when others then
    v_raised := true;
    raise notice 'CHECK 9 PASS: setting the old GUC directly has no effect, ordinary downgrade still raised: %', sqlerrm;
  end;
  if not v_raised then
    raise exception 'CHECK 9 FAIL: an ordinary downgrade succeeded after setting the old (rejected) GUC directly';
  end if;

  -- Check 10: readiness_enforced_at itself, not only readiness_lifecycle,
  -- must be non-null while enforced and null again after deactivation.
  declare
    v_enforced_at timestamptz;
  begin
    select readiness_enforced_at into v_enforced_at from public.content_periods where id = v_period_id;
    if v_enforced_at is null then
      raise exception 'CHECK 10 FAIL: readiness_enforced_at is null while lifecycle is enforced';
    end if;

    v_result := public.deactivate_period_readiness_atomic(v_period_id, v_firm_id, 'setup_required', 'check 10 deactivation', 'operator', gen_random_uuid(), 'Test Operator');
    if (v_result->>'ok')::boolean is not true then
      raise exception 'CHECK 10 FAIL: deactivation call did not succeed: %', v_result;
    end if;

    select readiness_enforced_at into v_enforced_at from public.content_periods where id = v_period_id;
    if v_enforced_at is not null then
      raise exception 'CHECK 10 FAIL: readiness_enforced_at is still set after deactivation: %', v_enforced_at;
    end if;
    raise notice 'CHECK 10 PASS: readiness_enforced_at is non-null while enforced, null again after deactivation';
  end;

  raise notice '=== ALL 10 CHECKS PASSED ===';
end $$;

rollback;
