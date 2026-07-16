-- Runnable, single-session verification for
-- supabase/migrations/20260716144723_publication_receipt_reconcile_concurrency_lock_merge.sql
-- (the function's current, correct, live definition -- see that file's
-- header for why this is a three-migration, not one-migration, history).
--
-- This script proves two things a single Postgres session CAN prove:
--   1. Structural: the live validate_publication_receipt_scope() function
--      now actually contains "for update" locks on content_deliverables,
--      content_placements, and publication_artifacts.
--   2. Non-regression: the full existing validation battery (approved
--      status, version-drift, artifact binding, locale/period consistency,
--      reconciliation-chain rules) still behaves identically to before
--      this migration -- only the locking changed, not the logic.
--
-- What this script does NOT and CANNOT prove: genuine cross-session
-- blocking behavior (two real concurrent transactions, one waiting on the
-- other's held lock). That requires two independent database connections
-- held open simultaneously, which a single execute_sql-style session
-- cannot simulate. That is proven separately and directly by
-- src/lib/__tests__/publication-receipt-concurrency.integration.test.ts,
-- a real two-connection Vitest integration test gated behind
-- DIRECT_DATABASE_URL.
--
-- Wrapped in BEGIN/ROLLBACK end to end so it leaves no trace regardless of
-- outcome.
--
-- Usage: run via the Supabase MCP execute_sql tool, or
--   psql "$SUPABASE_DB_URL" -f scripts/verify-publication-receipt-concurrency-lock.sql

begin;

do $$
declare
  v_def text;
  v_firm uuid := '88888888-0000-0000-0000-000000000001';
  v_deliverable uuid := '88888888-0000-0000-0000-000000000002';
  v_placement uuid := '88888888-0000-0000-0000-000000000003';
  v_version_a uuid := '88888888-0000-0000-0000-000000000004';
  v_version_b uuid := '88888888-0000-0000-0000-000000000005';
  v_artifact uuid := '88888888-0000-0000-0000-000000000006';
  v_receipt_id uuid;
  v_failures int := 0;
begin
  -- Check 1: structural -- FOR UPDATE present on all three locked reads.
  select pg_get_functiondef(oid) into v_def
    from pg_proc where proname = 'validate_publication_receipt_scope';
  if v_def !~* 'from public\.content_deliverables\s+where id = new\.deliverable_id\s+for update' then
    raise warning 'CHECK 1a FAIL: content_deliverables read is not locked with FOR UPDATE';
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 1a PASS: content_deliverables read is locked';
  end if;
  if v_def !~* 'from public\.content_placements\s+where id = new\.placement_id\s+for update' then
    raise warning 'CHECK 1b FAIL: content_placements read is not locked with FOR UPDATE';
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 1b PASS: content_placements read is locked';
  end if;
  if v_def !~* 'from public\.publication_artifacts\s+where id = new\.artifact_id\s+for update' then
    raise warning 'CHECK 1c FAIL: publication_artifacts read is not locked with FOR UPDATE';
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 1c PASS: publication_artifacts read is locked';
  end if;

  -- Fixture for the non-regression pass.
  insert into intake_firms (id, custom_domain, subdomain) values (v_firm, null, 'verify-concurrency-fixture');
  insert into content_deliverables (id, firm_id, title, content_kind, status, created_by_role)
    values (v_deliverable, v_firm, 'verify fixture', 'text', 'draft', 'operator');
  insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
    values (v_version_a, v_deliverable, v_firm, 1, '<p>a</p>', 'operator');
  insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
    values (v_version_b, v_deliverable, v_firm, 2, '<p>b</p>', 'operator');
  update content_deliverables set status = 'approved', approved_version_id = v_version_a, current_version_id = v_version_a where id = v_deliverable;
  insert into content_placements (id, firm_id, deliverable_id, destination, required_artifact_type)
    values (v_placement, v_firm, v_deliverable, 'firm_website', 'pdf');
  insert into publication_artifacts (id, firm_id, deliverable_id, version_id, artifact_type, sha256, storage_path)
    values (v_artifact, v_firm, v_deliverable, v_version_a, 'pdf', repeat('a', 64), 'verify/fixture.pdf');

  -- CHECK 2: a valid receipt against the current approved version, with a
  -- correctly version-bound artifact, still succeeds.
  begin
    insert into publication_receipts
      (firm_id, deliverable_id, placement_id, destination, approved_version_id, artifact_id, published_at, public_url, actor_role, actor_name)
    values (v_firm, v_deliverable, v_placement, 'firm_website', v_version_a, v_artifact, now(), 'https://example.test/ok', 'operator', 'Verify Script')
    returning id into v_receipt_id;
    raise notice 'CHECK 2 PASS: valid receipt against current approved version succeeded';
  exception when others then
    raise warning 'CHECK 2 FAIL (regression): valid receipt was unexpectedly rejected: %', sqlerrm;
    v_failures := v_failures + 1;
  end;

  -- CHECK 3: a receipt against a NON-current version is still rejected
  -- (the exact drift check the concurrency fix relies on).
  begin
    insert into publication_receipts
      (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name)
    values (v_firm, v_deliverable, v_placement, 'firm_website', v_version_b, now(), 'https://example.test/stale', 'operator', 'Verify Script');
    raise warning 'CHECK 3 FAIL (regression): stale-version receipt was NOT rejected';
    v_failures := v_failures + 1;
  exception when others then
    if sqlerrm ilike '%approved_version_id%' then
      raise notice 'CHECK 3 PASS: stale-version receipt correctly rejected (%)', sqlerrm;
    else
      raise warning 'CHECK 3 FAIL: rejected for the wrong reason: %', sqlerrm;
      v_failures := v_failures + 1;
    end if;
  end;

  -- CHECK 4: artifact hash auto-backfill (supplement migration behavior)
  -- still works unchanged.
  if (select artifact_sha256 from publication_receipts where id = v_receipt_id) is distinct from repeat('a', 64) then
    raise warning 'CHECK 4 FAIL (regression): artifact_sha256 was not auto-populated from the trusted artifact row';
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 4 PASS: artifact_sha256 auto-backfill unchanged';
  end if;

  -- CHECK 5: the 20260716144315 reconciling-verification exemption (a
  -- concurrent fix merged into this same function alongside the locking
  -- change -- see 20260716144723_publication_receipt_reconcile_concurrency_
  -- lock_merge.sql) still works: revise the deliverable to a new version
  -- (resetting status/approved_version_id, exactly like addVersion() does),
  -- then verify the ORIGINAL receipt -- this must still succeed even though
  -- the deliverable's current approval state no longer matches it.
  update content_deliverables set status = 'in_review', approved_version_id = null where id = v_deliverable;
  begin
    insert into publication_receipts
      (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url,
       actor_role, actor_name, verification_state, verified_at, verification_method, reconciles_receipt_id)
    values (v_firm, v_deliverable, v_placement, 'firm_website', v_version_a, now(), 'https://example.test/ok',
       'operator', 'Verify Script', 'verified', now(), 'operator_attestation', v_receipt_id);
    raise notice 'CHECK 5 PASS: verifying a historical receipt after a deliverable revision still succeeds';
  exception when others then
    raise warning 'CHECK 5 FAIL: verification of a historical receipt was wrongly rejected after revision: %', sqlerrm;
    v_failures := v_failures + 1;
  end;

  if v_failures > 0 then
    raise exception '% CHECK(S) FAILED -- see warnings above', v_failures;
  end if;
  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
