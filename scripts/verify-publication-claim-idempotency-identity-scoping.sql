-- Runnable, single-session verification for
-- supabase/migrations/20260716221000_publication_placement_claim_idempotency_identity_scoping.sql
-- (corrective-release follow-up audit, finding 4).
--
-- Wrapped in BEGIN/ROLLBACK end to end so it leaves no trace regardless of
-- outcome. Fixture ids use the 99999999-... prefix to stay clear of this
-- repo's other verify scripts.
--
-- Usage: run via the Supabase MCP execute_sql tool, or
--   psql "$SUPABASE_DB_URL" -f scripts/verify-publication-claim-idempotency-identity-scoping.sql

begin;

do $$
declare
  v_firm uuid := '99999999-0000-0000-0000-000000000001';
  v_deliverable uuid := '99999999-0000-0000-0000-000000000002';
  v_placement uuid := '99999999-0000-0000-0000-000000000003';
  v_version1 uuid := '99999999-0000-0000-0000-000000000004';
  v_version2 uuid := '99999999-0000-0000-0000-000000000005';
  v_actor_a uuid := '99999999-0000-0000-0000-0000000000aa';
  v_actor_b uuid := '99999999-0000-0000-0000-0000000000bb';
  v_result jsonb;
  v_result2 jsonb;
  v_claim1 uuid;
  v_fails text[] := '{}';
begin
  insert into intake_firms (id, name, custom_domain, subdomain) values (v_firm, 'Idempotency Scoping Verify', null, 'idempotency-scoping-verify');
  insert into content_deliverables (id, firm_id, title, content_kind, status, created_by_role)
    values (v_deliverable, v_firm, 'idempotency scoping fixture', 'text', 'draft', 'operator');
  insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
    values (v_version1, v_deliverable, v_firm, 1, '<p>v1</p>', 'operator');
  insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
    values (v_version2, v_deliverable, v_firm, 2, '<p>v2</p>', 'operator');
  update content_deliverables set status = 'approved', approved_version_id = v_version1, current_version_id = v_version1 where id = v_deliverable;
  insert into content_placements (id, firm_id, deliverable_id, destination, created_by_role)
    values (v_placement, v_firm, v_deliverable, 'linkedin_post', 'operator');

  -- CHECK 1: baseline claim, key K1, actor A, version1.
  v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version1, 'scope-key-1', 'operator', v_actor_a, 'Actor A');
  if not (v_result->>'ok')::boolean then
    v_fails := v_fails || ('CHECK1: baseline claim rejected: ' || v_result::text);
  else
    v_claim1 := (v_result->>'claim_id')::uuid;
  end if;

  -- CHECK 2 (the actual vulnerability, pre-fix would have returned v_claim1
  -- as an ok:true "replay"): the SAME key K1 reused for a DIFFERENT
  -- approved_version_id must fail closed, not silently hand back v_claim1
  -- as if it matched this request.
  v_result2 := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version2, 'scope-key-1', 'operator', v_actor_a, 'Actor A');
  if (v_result2->>'ok')::boolean then
    v_fails := v_fails || ('CHECK2: same key + different approved_version_id was accepted as a replay: ' || v_result2::text);
  elsif (v_result2->>'next_action') is distinct from 'use_new_idempotency_key' then
    v_fails := v_fails || ('CHECK2: rejected, but wrong next_action: ' || v_result2::text);
  elsif (v_result2->>'existing_claim_id')::uuid is distinct from v_claim1 then
    v_fails := v_fails || 'CHECK2: existing_claim_id did not point back at the real stored claim';
  end if;

  -- CHECK 3: the SAME key K1 reused for a DIFFERENT actor (same version)
  -- must also fail closed.
  v_result2 := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version1, 'scope-key-1', 'operator', v_actor_b, 'Actor B');
  if (v_result2->>'ok')::boolean then
    v_fails := v_fails || ('CHECK3: same key + different actor_id was accepted as a replay: ' || v_result2::text);
  elsif (v_result2->>'next_action') is distinct from 'use_new_idempotency_key' then
    v_fails := v_fails || ('CHECK3: rejected, but wrong next_action: ' || v_result2::text);
  end if;

  -- CHECK 4: the SAME key K1 reused for a DIFFERENT actor_role (same
  -- version, same nominal actor_id being not applicable to 'system') must
  -- also fail closed.
  v_result2 := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version1, 'scope-key-1', 'system', null, 'System');
  if (v_result2->>'ok')::boolean then
    v_fails := v_fails || ('CHECK4: same key + different actor_role was accepted as a replay: ' || v_result2::text);
  elsif (v_result2->>'next_action') is distinct from 'use_new_idempotency_key' then
    v_fails := v_fails || ('CHECK4: rejected, but wrong next_action: ' || v_result2::text);
  end if;

  -- CHECK 5 (regression, must still work): the SAME key K1 with the
  -- IDENTICAL request identity (version1, actor A) is a genuine replay and
  -- must return the SAME claim, ok:true.
  v_result2 := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version1, 'scope-key-1', 'operator', v_actor_a, 'Actor A');
  if not (v_result2->>'ok')::boolean then
    v_fails := v_fails || ('CHECK5: identical-identity replay was rejected: ' || v_result2::text);
  elsif (v_result2->>'claim_id')::uuid is distinct from v_claim1 then
    v_fails := v_fails || 'CHECK5: identical-identity replay returned a different claim_id';
  elsif not (v_result2->>'idempotent_replay')::boolean then
    v_fails := v_fails || 'CHECK5: identical-identity replay did not report idempotent_replay:true';
  end if;

  -- CHECK 6: the fixture's real claim was never mutated by any of the
  -- rejected mismatched-identity attempts above -- still exactly one row
  -- for this key, still 'active', still bound to version1/actor A.
  declare
    v_row_count int;
    v_row record;
  begin
    select count(*)::int into v_row_count
      from publication_placement_claims
     where placement_id = v_placement and idempotency_key = 'scope-key-1';
    if v_row_count <> 1 then
      v_fails := v_fails || ('CHECK6: expected exactly 1 row for scope-key-1, found ' || v_row_count);
    end if;
    select * into v_row from publication_placement_claims where id = v_claim1;
    if v_row.status <> 'active'
       or v_row.approved_version_id <> v_version1
       or v_row.claimed_by_id <> v_actor_a then
      v_fails := v_fails || 'CHECK6: the original claim row was mutated by a mismatched-identity replay attempt';
    end if;
  end;

  if array_length(v_fails, 1) > 0 then
    raise exception 'FAILURES: %', array_to_string(v_fails, ' || ');
  end if;
  raise notice 'ALL IDEMPOTENCY-IDENTITY-SCOPING CHECKS PASSED';
end $$;

rollback;
