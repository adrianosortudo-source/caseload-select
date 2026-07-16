-- Runnable, single-session verification for
-- supabase/migrations/20260716150130_publication_placement_claims.sql.
--
-- Wrapped in BEGIN/ROLLBACK end to end so it leaves no trace regardless of
-- outcome.
--
-- Usage: run via the Supabase MCP execute_sql tool, or
--   psql "$SUPABASE_DB_URL" -f scripts/verify-publication-placement-claim.sql

begin;

do $$
declare
  v_firm uuid := '77777777-0000-0000-0000-000000000001';
  v_deliverable uuid := '77777777-0000-0000-0000-000000000002';
  v_placement uuid := '77777777-0000-0000-0000-000000000003';
  v_version uuid := '77777777-0000-0000-0000-000000000004';
  v_result jsonb;
  v_claim1 uuid;
  v_claim2 uuid;
  v_failures int := 0;
  v_active_count int;
  v_receipt_id uuid;
begin
  insert into intake_firms (id, name, custom_domain, subdomain) values (v_firm, 'Claim Verify Fixture', null, 'claim-verify-fixture');
  insert into content_deliverables (id, firm_id, title, content_kind, status, created_by_role)
    values (v_deliverable, v_firm, 'claim fixture', 'text', 'draft', 'operator');
  insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
    values (v_version, v_deliverable, v_firm, 1, '<p>a</p>', 'operator');
  update content_deliverables set status = 'approved', approved_version_id = v_version, current_version_id = v_version where id = v_deliverable;
  insert into content_placements (id, firm_id, deliverable_id, destination, created_by_role)
    values (v_placement, v_firm, v_deliverable, 'linkedin_post', 'operator');

  -- CHECK 1: first claim succeeds.
  v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version, 'key-1', 'operator', null, 'Verify Script');
  if not (v_result->>'ok')::boolean then
    raise warning 'CHECK 1 FAIL: first claim rejected: %', v_result;
    v_failures := v_failures + 1;
  else
    v_claim1 := (v_result->>'claim_id')::uuid;
    raise notice 'CHECK 1 PASS: first claim succeeded (%)', v_claim1;
  end if;

  -- CHECK 2: repeating the SAME idempotency key returns the same claim.
  v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version, 'key-1', 'operator', null, 'Verify Script');
  if (v_result->>'claim_id')::uuid is distinct from v_claim1 or (v_result->>'idempotent_replay')::boolean is not true then
    raise warning 'CHECK 2 FAIL: idempotent replay did not return the same claim: %', v_result;
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 2 PASS: idempotent replay returned the same claim';
  end if;

  -- CHECK 3: a DIFFERENT idempotency key while the first is active is rejected.
  v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version, 'key-2', 'operator', null, 'Verify Script');
  if (v_result->>'ok')::boolean is not false then
    raise warning 'CHECK 3 FAIL: competing claim was NOT rejected: %', v_result;
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 3 PASS: competing claim correctly rejected';
  end if;

  -- CHECK 4: explicit supersession succeeds and flips the old claim.
  v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version, 'key-3', 'operator', null, 'Verify Script', v_claim1);
  if not (v_result->>'ok')::boolean then
    raise warning 'CHECK 4 FAIL: explicit supersession was rejected: %', v_result;
    v_failures := v_failures + 1;
  else
    v_claim2 := (v_result->>'claim_id')::uuid;
    raise notice 'CHECK 4a PASS: supersession succeeded (%)', v_claim2;
  end if;
  if (select status from publication_placement_claims where id = v_claim1) <> 'superseded' then
    raise warning 'CHECK 4b FAIL: old claim was not marked superseded';
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 4b PASS: old claim marked superseded';
  end if;
  select count(*) into v_active_count from publication_placement_claims where placement_id = v_placement and status = 'active';
  if v_active_count <> 1 then
    raise warning 'CHECK 4c FAIL: expected exactly 1 active claim, found %', v_active_count;
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 4c PASS: exactly one active claim remains';
  end if;

  -- CHECK 5: version drift is rejected under lock.
  update content_deliverables set status = 'in_review', approved_version_id = null where id = v_deliverable;
  v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version, 'key-4', 'operator', null, 'Verify Script');
  if (v_result->>'ok')::boolean is not false then
    raise warning 'CHECK 5 FAIL: claim against a non-approved deliverable was NOT rejected: %', v_result;
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 5 PASS: claim against a non-approved deliverable correctly rejected';
  end if;
  update content_deliverables set status = 'approved', approved_version_id = v_version, current_version_id = v_version where id = v_deliverable;

  -- CHECK 6: recording a receipt releases the active claim.
  insert into publication_receipts (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name)
    values (v_firm, v_deliverable, v_placement, 'linkedin_post', v_version, now(), 'https://example.test/li', 'operator', 'Verify Script')
    returning id into v_receipt_id;
  if (select status from publication_placement_claims where id = v_claim2) <> 'released' then
    raise warning 'CHECK 6 FAIL: active claim was not released on receipt creation';
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 6 PASS: active claim released on receipt creation';
  end if;

  -- CHECK 7: a second root receipt for the same placement is rejected.
  begin
    insert into publication_receipts (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name)
      values (v_firm, v_deliverable, v_placement, 'linkedin_post', v_version, now(), 'https://example.test/li2', 'operator', 'Verify Script');
    raise warning 'CHECK 7 FAIL: a second root receipt for the same placement was NOT rejected';
    v_failures := v_failures + 1;
  exception when unique_violation then
    raise notice 'CHECK 7 PASS: second root receipt correctly rejected by the unique index';
  end;

  if v_failures > 0 then
    raise exception '% CHECK(S) FAILED -- see warnings above', v_failures;
  end if;
  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
