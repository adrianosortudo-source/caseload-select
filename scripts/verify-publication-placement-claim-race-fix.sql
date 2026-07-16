-- Runnable, single-session verification for
-- supabase/migrations/20260716155746_publication_placement_claim_race_fix.sql.
--
-- Wrapped in BEGIN/ROLLBACK end to end so it leaves no trace regardless of
-- outcome.
--
-- Usage: run via the Supabase MCP execute_sql tool, or
--   psql "$SUPABASE_DB_URL" -f scripts/verify-publication-placement-claim-race-fix.sql

begin;

do $$
declare
  v_firm uuid := '66666666-0000-0000-0000-000000000001';
  v_deliverable uuid := '66666666-0000-0000-0000-000000000002';
  v_placement uuid := '66666666-0000-0000-0000-000000000003';
  v_version uuid := '66666666-0000-0000-0000-000000000004';
  v_result jsonb;
  v_claim1 uuid;
  v_failures int := 0;
  v_receipt_id uuid;
begin
  insert into intake_firms (id, name, custom_domain, subdomain) values (v_firm, 'Race Fix Verify', null, 'race-fix-verify');
  insert into content_deliverables (id, firm_id, title, content_kind, status, created_by_role)
    values (v_deliverable, v_firm, 'race fix fixture', 'text', 'draft', 'operator');
  insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
    values (v_version, v_deliverable, v_firm, 1, '<p>a</p>', 'operator');
  update content_deliverables set status = 'approved', approved_version_id = v_version, current_version_id = v_version where id = v_deliverable;
  insert into content_placements (id, firm_id, deliverable_id, destination, created_by_role)
    values (v_placement, v_firm, v_deliverable, 'linkedin_post', 'operator');

  -- Non-regression: original claim/idempotency/competing-claim contract.
  v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version, 'key-1', 'operator', null, 'Verify');
  if not (v_result->>'ok')::boolean then
    raise warning 'CHECK 1 FAIL: first claim rejected: %', v_result; v_failures := v_failures + 1;
  else
    v_claim1 := (v_result->>'claim_id')::uuid;
    raise notice 'CHECK 1 PASS';
  end if;

  v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version, 'key-1', 'operator', null, 'Verify');
  if (v_result->>'claim_id')::uuid is distinct from v_claim1 or (v_result->>'idempotent_replay')::boolean is not true then
    raise warning 'CHECK 2 FAIL: %', v_result; v_failures := v_failures + 1;
  else
    raise notice 'CHECK 2 PASS';
  end if;

  v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version, 'key-2', 'operator', null, 'Verify');
  if (v_result->>'ok')::boolean is not false then
    raise warning 'CHECK 3 FAIL: competing claim not rejected: %', v_result; v_failures := v_failures + 1;
  else
    raise notice 'CHECK 3 PASS';
  end if;

  if v_failures > 0 then
    raise exception '% CHECK(S) FAILED', v_failures;
  end if;
end $$;

-- Second DO block, fresh placement: isolates the release-trigger fix
-- (bug 2) from the precondition noise of the one-root-per-placement index.
do $$
declare
  v_firm uuid := '66666666-0000-0000-0000-000000000001';
  v_deliverable uuid := '66666666-0000-0000-0000-000000000002';
  v_placement2 uuid := '66666666-0000-0000-0000-000000000005';
  v_version uuid := '66666666-0000-0000-0000-000000000004';
  v_result jsonb;
  v_claim uuid;
  v_root_receipt uuid;
  v_failures int := 0;
begin
  insert into content_placements (id, firm_id, deliverable_id, destination, created_by_role)
    values (v_placement2, v_firm, v_deliverable, 'google_business_profile', 'operator');

  v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement2, v_version, 'key-gbp-1', 'operator', null, 'Verify');
  v_claim := (v_result->>'claim_id')::uuid;

  insert into publication_receipts (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name)
    values (v_firm, v_deliverable, v_placement2, 'google_business_profile', v_version, now(), 'https://example.test/gbp-root', 'operator', 'Verify')
    returning id into v_root_receipt;

  -- CHECK A (non-regression): a fresh root receipt still releases the claim.
  if (select status from publication_placement_claims where id = v_claim) <> 'released' then
    raise warning 'CHECK A FAIL: root receipt did not release the active claim (regression)'; v_failures := v_failures + 1;
  else
    raise notice 'CHECK A PASS: fresh root receipt still releases the claim';
  end if;

  v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement2, v_version, 'key-gbp-2', 'operator', null, 'Verify');
  v_claim := (v_result->>'claim_id')::uuid;
  if not (v_result->>'ok')::boolean then
    raise warning 'CHECK B FAIL: re-claim after release was rejected: %', v_result; v_failures := v_failures + 1;
  else
    raise notice 'CHECK B PASS: re-claim after release succeeded';
  end if;

  -- CHECK C (bug 2 fix): a reconciling-verification receipt on the OLDER,
  -- unrelated root must NOT release this new, unrelated active claim.
  insert into publication_receipts (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url,
       actor_role, actor_name, verification_state, verified_at, verification_method, reconciles_receipt_id)
    values (v_firm, v_deliverable, v_placement2, 'google_business_profile', v_version, now(), 'https://example.test/gbp-root',
       'operator', 'Verify', 'verified', now(), 'operator_attestation', v_root_receipt);
  if (select status from publication_placement_claims where id = v_claim) = 'released' then
    raise warning 'CHECK C FAIL (BUG 2 REGRESSION): a reconciling-verification receipt released an unrelated active claim';
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK C PASS (bug 2 fixed): reconciling-verification receipt did NOT release the unrelated active claim';
  end if;

  if v_failures > 0 then
    raise exception '% CHECK(S) FAILED', v_failures;
  end if;
  raise notice 'ALL RACE-FIX CHECKS PASSED';
end $$;

rollback;
