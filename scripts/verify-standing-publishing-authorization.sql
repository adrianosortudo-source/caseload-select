-- Runnable, single-session verification for
-- supabase/migrations/20260717193000_standing_publishing_authorization.sql.
--
-- Wrapped in BEGIN/ROLLBACK end to end so it leaves no trace regardless of
-- outcome.
--
-- Usage: run via the Supabase MCP execute_sql tool, or
--   psql "$SUPABASE_DB_URL" -f scripts/verify-standing-publishing-authorization.sql

begin;

do $$
declare
  v_firm uuid := '88888888-0000-0000-0000-000000000001';
  v_lawyer uuid := '88888888-0000-0000-0000-000000000002';
  v_deliverable uuid := '88888888-0000-0000-0000-000000000003';
  v_placement uuid := '88888888-0000-0000-0000-000000000004';
  v_version_1 uuid := '88888888-0000-0000-0000-000000000005';
  v_version_2 uuid := '88888888-0000-0000-0000-000000000006';
  v_result jsonb;
  v_failures int := 0;
  v_event_id uuid;
  v_state record;
  v_count int;
begin
  insert into intake_firms (id, name, custom_domain, subdomain) values (v_firm, 'Standing Auth Verify Fixture', null, 'standing-auth-verify-fixture');
  insert into firm_lawyers (id, firm_id, email, name, role, display_name) values (v_lawyer, v_firm, 'damaris@drglaw.test', 'Damaris', 'admin', 'Damaris');
  insert into content_deliverables (id, firm_id, title, content_kind, status, created_by_role)
    values (v_deliverable, v_firm, 'standing auth fixture', 'text', 'in_review', 'operator');
  insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
    values (v_version_1, v_deliverable, v_firm, 1, '<p>v1</p>', 'operator');
  update content_deliverables set current_version_id = v_version_1 where id = v_deliverable;
  insert into content_placements (id, firm_id, deliverable_id, destination, created_by_role)
    values (v_placement, v_firm, v_deliverable, 'linkedin_post', 'operator');

  -- CHECK 1: an operator cannot enable standing authorization (DB-level gate).
  v_result := set_standing_publishing_authorization(
    v_firm, 'enabled', 'operator', v_lawyer, 'Someone', 'someone@caseloadselect.test',
    'authorization text', 'v1', 'all_future_content', 'weekly_digest', null, null, null
  );
  if (v_result->>'ok')::boolean is not false then
    raise warning 'CHECK 1 FAIL: operator-issued enable was NOT rejected: %', v_result;
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 1 PASS: operator-issued enable correctly rejected (%)', v_result->>'error';
  end if;

  -- CHECK 2: enabling with a missing required field (notification_preference) is rejected.
  v_result := set_standing_publishing_authorization(
    v_firm, 'enabled', 'lawyer', v_lawyer, 'Damaris', 'damaris@drglaw.test',
    'authorization text', 'v1', 'all_future_content', null, null, null, null
  );
  if (v_result->>'ok')::boolean is not false then
    raise warning 'CHECK 2 FAIL: enable with missing notification_preference was NOT rejected: %', v_result;
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 2 PASS: enable with missing required field correctly rejected';
  end if;

  -- CHECK 3: a real lawyer enable succeeds and returns an event.
  v_result := set_standing_publishing_authorization(
    v_firm, 'enabled', 'lawyer', v_lawyer, 'Damaris', 'damaris@drglaw.test',
    'By turning this on, you authorize CaseLoad Select to publish future Standing Auth Verify Fixture content...',
    'standing-publishing-authorization-v1', 'all_future_content', 'weekly_digest', null, '203.0.113.5', 'test-agent'
  );
  if not (v_result->>'ok')::boolean then
    raise warning 'CHECK 3 FAIL: valid lawyer enable was rejected: %', v_result;
    v_failures := v_failures + 1;
  else
    v_event_id := (v_result->>'event_id')::uuid;
    raise notice 'CHECK 3 PASS: lawyer enable succeeded (event %)', v_event_id;
  end if;

  -- CHECK 4: state derives from the latest event (order by event_seq desc).
  select * into v_state from standing_publishing_authorizations where firm_id = v_firm order by event_seq desc limit 1;
  if v_state.event <> 'enabled' or v_state.id <> v_event_id then
    raise warning 'CHECK 4 FAIL: latest-event derivation did not return the just-created enable event';
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 4 PASS: latest-event derivation returns the enable event';
  end if;

  -- CHECK 5: append-only enforcement -- UPDATE and DELETE are both rejected.
  begin
    update standing_publishing_authorizations set reason = 'tampered' where id = v_event_id;
    raise warning 'CHECK 5a FAIL: UPDATE on an authorization event was NOT rejected';
    v_failures := v_failures + 1;
  exception when others then
    raise notice 'CHECK 5a PASS: UPDATE correctly rejected (%)', sqlerrm;
  end;
  begin
    delete from standing_publishing_authorizations where id = v_event_id;
    raise warning 'CHECK 5b FAIL: DELETE on an authorization event was NOT rejected';
    v_failures := v_failures + 1;
  exception when others then
    raise notice 'CHECK 5b PASS: DELETE correctly rejected (%)', sqlerrm;
  end;

  -- CHECK 6: claim_placement_for_publish path B succeeds while the
  -- deliverable is merely in_review (never individually approved), because
  -- standing authorization is enabled and the version carries no exception.
  v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version_1, 'standing-auth-key-1', 'operator', null, 'Verify Script');
  if not (v_result->>'ok')::boolean then
    raise warning 'CHECK 6 FAIL: standing-authorization release path was rejected: %', v_result;
    v_failures := v_failures + 1;
  elsif (v_result->>'release_path') <> 'standing_authorization' then
    raise warning 'CHECK 6 FAIL: claim succeeded but release_path was ''%'' not ''standing_authorization''', v_result->>'release_path';
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 6 PASS: claim succeeded via standing_authorization release path';
  end if;
  if (select release_path from publication_placement_claims where placement_id = v_placement and status = 'active') <> 'standing_authorization'
     or (select standing_authorization_event_id from publication_placement_claims where placement_id = v_placement and status = 'active') <> v_event_id then
    raise warning 'CHECK 6b FAIL: the claim row does not durably reference the authorization event used';
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 6b PASS: claim row references the exact authorization event relied upon';
  end if;

  -- CHECK 7: the operator individual-review exception overrides standing
  -- authorization for a new version, even while authorization stays enabled.
  insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
    values (v_version_2, v_deliverable, v_firm, 2, '<p>v2</p>', 'operator');
  update content_deliverables set current_version_id = v_version_2 where id = v_deliverable;

  v_result := set_deliverable_version_individual_review_requirement(v_version_2, v_firm, true, 'lawyer', v_lawyer, 'Damaris', 'looks unusual');
  if (v_result->>'ok')::boolean is not false then
    raise warning 'CHECK 7a FAIL: a lawyer-issued individual-review exception was NOT rejected (operator-only control)';
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 7a PASS: lawyer cannot set the individual-review exception (operator-only)';
  end if;

  v_result := set_deliverable_version_individual_review_requirement(v_version_2, v_firm, true, 'operator', null, 'Adriano', null);
  if (v_result->>'ok')::boolean is not false then
    raise warning 'CHECK 7b FAIL: requiring individual review with no reason was NOT rejected';
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 7b PASS: a reason is required to flag individual review';
  end if;

  v_result := set_deliverable_version_individual_review_requirement(v_version_2, v_firm, true, 'operator', null, 'Adriano', 'contains an unusual jurisdiction claim');
  if not (v_result->>'ok')::boolean then
    raise warning 'CHECK 7c FAIL: valid operator individual-review exception was rejected: %', v_result;
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 7c PASS: operator individual-review exception applied';
  end if;

  v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version_2, 'standing-auth-key-2', 'operator', null, 'Verify Script', (select id from publication_placement_claims where placement_id = v_placement and status = 'active'));
  if (v_result->>'ok')::boolean is not false then
    raise warning 'CHECK 7d FAIL: a version flagged requires_individual_review was NOT blocked from the standing-authorization path: %', v_result;
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 7d PASS: individual-review exception correctly overrides standing authorization (%)', v_result->>'error';
  end if;

  -- CHECK 8: disabling takes effect for the NEXT claim attempt (future-only),
  -- and does not retroactively touch the claim already recorded above.
  v_result := set_standing_publishing_authorization(
    v_firm, 'disabled', 'lawyer', v_lawyer, 'Damaris', 'damaris@drglaw.test',
    null, null, null, null, 'testing revocation', null, null
  );
  if not (v_result->>'ok')::boolean then
    raise warning 'CHECK 8a FAIL: valid disable was rejected: %', v_result;
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 8a PASS: disable succeeded';
  end if;

  -- Clear the individual-review exception on v2 so the only remaining
  -- blocker for a fresh claim attempt is the now-disabled authorization.
  perform set_deliverable_version_individual_review_requirement(v_version_2, v_firm, false, 'operator', null, 'Adriano', null);
  v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version_2, 'standing-auth-key-3', 'operator', null, 'Verify Script', (select id from publication_placement_claims where placement_id = v_placement and status = 'active'));
  if (v_result->>'ok')::boolean is not false then
    raise warning 'CHECK 8b FAIL: a claim after disabling authorization was NOT rejected: %', v_result;
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 8b PASS: claim correctly rejected after authorization was disabled (%)', v_result->>'error';
  end if;
  if (select release_path from publication_placement_claims where idempotency_key = 'standing-auth-key-1') <> 'standing_authorization' then
    raise warning 'CHECK 8c FAIL: disabling authorization retroactively altered a prior claim''s recorded release_path';
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 8c PASS: prior claim''s release_path is unaffected by the later disable';
  end if;

  -- CHECK 9: individual lawyer approval (path A) still works exactly as before.
  update content_deliverables set status = 'approved', approved_version_id = v_version_2 where id = v_deliverable;
  v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version_2, 'standing-auth-key-4', 'operator', null, 'Verify Script', (select id from publication_placement_claims where placement_id = v_placement and status = 'active'));
  if not (v_result->>'ok')::boolean then
    raise warning 'CHECK 9 FAIL: individual-approval release path was rejected: %', v_result;
    v_failures := v_failures + 1;
  elsif (v_result->>'release_path') <> 'individual_approval' then
    raise warning 'CHECK 9 FAIL: claim succeeded but release_path was ''%'' not ''individual_approval''', v_result->>'release_path';
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 9 PASS: individual-approval release path unchanged';
  end if;

  -- CHECK 10: a direct publication_receipts insert (the manual operator
  -- path, bypassing the claim RPC) derives release_path from the matching
  -- claim rather than being left null.
  insert into publication_receipts (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name)
    values (v_firm, v_deliverable, v_placement, 'linkedin_post', v_version_2, now(), 'https://example.test/receipt', 'operator', 'Verify Script');
  select count(*) into v_count from publication_receipts where placement_id = v_placement and release_path = 'individual_approval' and standing_authorization_event_id is null;
  if v_count <> 1 then
    raise warning 'CHECK 10 FAIL: receipt did not derive release_path from the matching claim';
    v_failures := v_failures + 1;
  else
    raise notice 'CHECK 10 PASS: receipt derived release_path=individual_approval from the matching claim';
  end if;

  if v_failures > 0 then
    raise exception '% CHECK(S) FAILED -- see warnings above', v_failures;
  end if;
  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
