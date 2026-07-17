-- Runnable, single-session verification for
-- supabase/migrations/20260717010000_publication_placement_claim_idempotency_firm_scoping.sql
-- (Codex independent release review of PR #47, gap 1).
--
-- Wrapped in BEGIN/ROLLBACK end to end so it leaves no trace regardless of
-- outcome. Fixture ids use the aaaaaaaa-... prefix (firm A) and
-- bbbbbbbb-... prefix (firm B) to make the cross-firm scenario legible and
-- to stay clear of this repo's other verify scripts.
--
-- Usage: run via the Supabase MCP execute_sql tool, or
--   psql "$SUPABASE_DB_URL" -f scripts/verify-publication-claim-idempotency-firm-scoping.sql

begin;

do $$
declare
  v_firm_a uuid := 'aaaaaaaa-1111-0000-0000-000000000001';
  v_firm_b uuid := 'bbbbbbbb-1111-0000-0000-000000000001';
  v_deliverable_a uuid := 'aaaaaaaa-1111-0000-0000-000000000002';
  v_placement_a uuid := 'aaaaaaaa-1111-0000-0000-000000000003';
  v_version_a uuid := 'aaaaaaaa-1111-0000-0000-000000000004';
  -- Firm B's own deliverable/version, needed so a same-key request naming
  -- firm B is a plausible, well-formed request for firm B's own data, not
  -- just a mismatched firm_id on firm A's identifiers.
  v_deliverable_b uuid := 'bbbbbbbb-1111-0000-0000-000000000002';
  v_version_b uuid := 'bbbbbbbb-1111-0000-0000-000000000004';
  v_actor uuid := 'aaaaaaaa-1111-0000-0000-0000000000aa';
  v_result jsonb;
  v_result2 jsonb;
  v_claim_a uuid;
  v_fails text[] := '{}';
begin
  insert into intake_firms (id, name, custom_domain, subdomain) values (v_firm_a, 'Firm Scoping Verify A', null, 'firm-scoping-verify-a');
  insert into intake_firms (id, name, custom_domain, subdomain) values (v_firm_b, 'Firm Scoping Verify B', null, 'firm-scoping-verify-b');

  insert into content_deliverables (id, firm_id, title, content_kind, status, created_by_role)
    values (v_deliverable_a, v_firm_a, 'firm scoping fixture A', 'text', 'draft', 'operator');
  insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
    values (v_version_a, v_deliverable_a, v_firm_a, 1, '<p>a</p>', 'operator');
  update content_deliverables set status = 'approved', approved_version_id = v_version_a, current_version_id = v_version_a where id = v_deliverable_a;
  insert into content_placements (id, firm_id, deliverable_id, destination, created_by_role)
    values (v_placement_a, v_firm_a, v_deliverable_a, 'linkedin_post', 'operator');

  insert into content_deliverables (id, firm_id, title, content_kind, status, created_by_role)
    values (v_deliverable_b, v_firm_b, 'firm scoping fixture B', 'text', 'draft', 'operator');
  insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
    values (v_version_b, v_deliverable_b, v_firm_b, 1, '<p>b</p>', 'operator');
  update content_deliverables set status = 'approved', approved_version_id = v_version_b, current_version_id = v_version_b where id = v_deliverable_b;

  -- CHECK 1: baseline legitimate claim for firm A.
  v_result := claim_placement_for_publish(v_firm_a, v_deliverable_a, v_placement_a, v_version_a, 'firm-scope-key-1', 'operator', v_actor, 'Actor A');
  if not (v_result->>'ok')::boolean then
    v_fails := v_fails || ('CHECK1: baseline claim rejected: ' || v_result::text);
  else
    v_claim_a := (v_result->>'claim_id')::uuid;
  end if;

  -- CHECK 2 (the actual vulnerability, pre-fix would have returned an
  -- ok:true "replay" naming firm A's claim): the SAME placement_id +
  -- idempotency_key, but a DIFFERENT p_firm_id, with every other input
  -- otherwise matching (same deliverable/version/actor is not even
  -- possible across firms, so this also implicitly proves the other
  -- fields cannot substitute for the firm_id check). Must fail closed.
  v_result2 := claim_placement_for_publish(v_firm_b, v_deliverable_a, v_placement_a, v_version_a, 'firm-scope-key-1', 'operator', v_actor, 'Actor A');
  if (v_result2->>'ok')::boolean then
    v_fails := v_fails || ('CHECK2: same key + different firm_id was accepted as a replay (THE VULNERABILITY): ' || v_result2::text);
  elsif (v_result2->>'next_action') is distinct from 'use_new_idempotency_key' then
    v_fails := v_fails || ('CHECK2: rejected, but wrong next_action: ' || v_result2::text);
  elsif (v_result2->>'existing_claim_id')::uuid is distinct from v_claim_a then
    v_fails := v_fails || 'CHECK2: existing_claim_id did not point back at the real stored (firm A) claim';
  end if;

  -- CHECK 3: the original firm-A claim is untouched by the rejected
  -- cross-firm attempt -- still active, still bound to firm A.
  declare
    v_row record;
  begin
    select * into v_row from publication_placement_claims where id = v_claim_a;
    if v_row.status <> 'active' or v_row.firm_id <> v_firm_a then
      v_fails := v_fails || 'CHECK3: the original claim was mutated by the cross-firm replay attempt';
    end if;
  end;

  -- CHECK 4 (regression, must still work): the SAME key K1 with the
  -- IDENTICAL request identity (firm A, version A, actor A) is a genuine
  -- replay and must return the SAME claim, ok:true.
  v_result2 := claim_placement_for_publish(v_firm_a, v_deliverable_a, v_placement_a, v_version_a, 'firm-scope-key-1', 'operator', v_actor, 'Actor A');
  if not (v_result2->>'ok')::boolean then
    v_fails := v_fails || ('CHECK4: identical-identity replay was rejected: ' || v_result2::text);
  elsif (v_result2->>'claim_id')::uuid is distinct from v_claim_a then
    v_fails := v_fails || 'CHECK4: identical-identity replay returned a different claim_id';
  elsif not (v_result2->>'idempotent_replay')::boolean then
    v_fails := v_fails || 'CHECK4: identical-identity replay did not report idempotent_replay:true';
  end if;

  -- CHECK 5: exactly one row exists for this key across both firms -- no
  -- duplicate or cross-firm row was ever created.
  declare
    v_row_count int;
  begin
    select count(*)::int into v_row_count
      from publication_placement_claims
     where idempotency_key = 'firm-scope-key-1';
    if v_row_count <> 1 then
      v_fails := v_fails || ('CHECK5: expected exactly 1 row for firm-scope-key-1 across all firms, found ' || v_row_count);
    end if;
  end;

  if array_length(v_fails, 1) > 0 then
    raise exception 'FAILURES: %', array_to_string(v_fails, ' || ');
  end if;
  raise notice 'ALL IDEMPOTENCY-FIRM-SCOPING CHECKS PASSED';
end $$;

rollback;
