-- Runnable, single-session verification for
-- supabase/migrations/20260717001444_publication_receipt_actor_binding_and_hash_trust_fix.sql
-- (corrective-release follow-up audit, findings 1 + 2).
--
-- Wrapped in BEGIN/ROLLBACK end to end so it leaves no trace regardless of
-- outcome. Fixture ids use the 88888888-... prefix to stay clear of the
-- 66666666-... and 77777777-... prefixes used by this repo's other verify
-- scripts.
--
-- Usage: run via the Supabase MCP execute_sql tool, or
--   psql "$SUPABASE_DB_URL" -f scripts/verify-publication-receipt-actor-binding-and-hash-fix.sql

begin;

-- Finding 1: claim actor binding. A service-role caller inserting a root
-- receipt with actor_id NULL against a claim that IS actor-owned
-- (claimed_by_id is not null) must be rejected -- this is the exact gap the
-- prior `if new.actor_id is not null and ...` check let through.
do $$
declare
  v_firm uuid := '88888888-0000-0000-0000-000000000001';
  v_deliverable uuid := '88888888-0000-0000-0000-000000000002';
  v_placement uuid := '88888888-0000-0000-0000-000000000003';
  v_version uuid := '88888888-0000-0000-0000-000000000004';
  v_owner_actor uuid := '88888888-0000-0000-0000-0000000000aa';
  v_other_actor uuid := '88888888-0000-0000-0000-0000000000bb';
  v_result jsonb;
  v_claim uuid;
  v_fails text[] := '{}';
begin
  insert into intake_firms (id, name, custom_domain, subdomain) values (v_firm, 'Actor Binding Verify', null, 'actor-binding-verify');
  insert into content_deliverables (id, firm_id, title, content_kind, status, created_by_role)
    values (v_deliverable, v_firm, 'actor binding fixture', 'text', 'draft', 'operator');
  insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
    values (v_version, v_deliverable, v_firm, 1, '<p>v1</p>', 'operator');
  update content_deliverables set status = 'approved', approved_version_id = v_version, current_version_id = v_version where id = v_deliverable;
  insert into content_placements (id, firm_id, deliverable_id, destination, created_by_role)
    values (v_placement, v_firm, v_deliverable, 'linkedin_post', 'operator');

  -- CHECK 1 (the actual vulnerability, pre-fix would have ACCEPTED this): an
  -- actor-owned claim (claimed_by_id = v_owner_actor) must reject a root
  -- receipt whose actor_id is NULL.
  v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version, 'actor-key-1', 'operator', v_owner_actor, 'Owner Operator');
  v_claim := (v_result->>'claim_id')::uuid;
  begin
    insert into publication_receipts (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_id, actor_name, claim_id)
      values (v_firm, v_deliverable, v_placement, 'linkedin_post', v_version, now(), 'https://example.test/null-actor', 'operator', null, 'Anonymous', v_claim);
    v_fails := v_fails || 'CHECK1: NULL actor_id against an actor-owned claim was ACCEPTED (the vulnerability)';
  exception when others then
    if sqlstate <> 'CLM01' then
      v_fails := v_fails || ('CHECK1: rejected, but not with the expected CLM01 errcode (got ' || sqlstate || ')');
    end if;
  end;
  if (select status from publication_placement_claims where id = v_claim) <> 'active' then
    v_fails := v_fails || 'CHECK1: claim was released despite the rejected insert';
  end if;

  -- CHECK 2: a DIFFERENT non-null actor_id against the same actor-owned
  -- claim must also be rejected (regression: this already worked pre-fix,
  -- confirming the fix did not loosen this path).
  begin
    insert into publication_receipts (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_id, actor_name, claim_id)
      values (v_firm, v_deliverable, v_placement, 'linkedin_post', v_version, now(), 'https://example.test/wrong-actor', 'operator', v_other_actor, 'Wrong Operator', v_claim);
    v_fails := v_fails || 'CHECK2: mismatched non-null actor_id was accepted';
  exception when others then
    if sqlstate <> 'CLM01' then
      v_fails := v_fails || ('CHECK2: rejected, but not with the expected CLM01 errcode (got ' || sqlstate || ')');
    end if;
  end;

  -- CHECK 3: the MATCHING actor_id against the actor-owned claim succeeds
  -- and releases it.
  insert into publication_receipts (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_id, actor_name, claim_id)
    values (v_firm, v_deliverable, v_placement, 'linkedin_post', v_version, now(), 'https://example.test/matching-actor', 'operator', v_owner_actor, 'Owner Operator', v_claim);
  if (select status from publication_placement_claims where id = v_claim) <> 'released' then
    v_fails := v_fails || 'CHECK3: matching actor_id receipt did not release the claim';
  end if;

  -- CHECK 4: an ACTORLESS claim (claimed_by_id null, e.g. a system-issued
  -- claim) still accepts a receipt with actor_id NULL -- confirms the fix
  -- did not over-tighten the documented "(where available)" policy for
  -- claims that never carried an authenticated identity.
  declare
    v_version2 uuid := '88888888-0000-0000-0000-000000000005';
    v_claim2 uuid;
  begin
    insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
      values (v_version2, v_deliverable, v_firm, 2, '<p>v2</p>', 'operator');
    update content_deliverables set approved_version_id = v_version2, current_version_id = v_version2 where id = v_deliverable;
    -- v_claim (CHECK3) already released this placement's only active claim,
    -- so no supersession is needed here -- passed null for clarity.
    v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version2, 'actor-key-2', 'system', null, null, null);
    v_claim2 := (v_result->>'claim_id')::uuid;
    if v_claim2 is null then
      v_fails := v_fails || ('CHECK4-SETUP: could not claim v2: ' || v_result::text);
    else
      insert into publication_receipts (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_id, actor_name, claim_id)
        values (v_firm, v_deliverable, v_placement, 'linkedin_post', v_version2, now(), 'https://example.test/actorless-claim', 'system', null, null, v_claim2);
      if (select status from publication_placement_claims where id = v_claim2) <> 'released' then
        v_fails := v_fails || 'CHECK4: actorless claim + NULL-actor receipt was rejected (over-tightened)';
      end if;
    end if;
  end;

  if array_length(v_fails, 1) > 0 then
    raise exception 'FAILURES: %', array_to_string(v_fails, ' || ');
  end if;
  raise notice 'ALL ACTOR-BINDING CHECKS PASSED';
end $$;

-- Finding 2: caller-controlled hash removal on every path. A root receipt
-- with artifact_id NULL must never retain a caller-supplied artifact_sha256,
-- regardless of what the insert statement puts on that column directly.
do $$
declare
  v_firm uuid := '88888888-0000-0000-0000-000000000010';
  v_deliverable uuid := '88888888-0000-0000-0000-000000000011';
  v_placement uuid := '88888888-0000-0000-0000-000000000012';
  v_version uuid := '88888888-0000-0000-0000-000000000013';
  -- Distinct approved version for CHECK 6: publication_receipts enforces at
  -- most one root receipt per (placement_id, approved_version_id), and
  -- CHECK 5 already consumed that slot for v_version.
  v_version2 uuid := '88888888-0000-0000-0000-000000000016';
  v_artifact_non_pdf uuid := '88888888-0000-0000-0000-000000000014';
  v_result jsonb;
  v_claim uuid;
  v_claim2 uuid;
  v_receipt_id uuid;
  v_stored_hash text;
  v_fails text[] := '{}';
begin
  insert into intake_firms (id, name, custom_domain, subdomain) values (v_firm, 'Hash Clear Verify', null, 'hash-clear-verify');
  insert into content_deliverables (id, firm_id, title, content_kind, status, created_by_role)
    values (v_deliverable, v_firm, 'hash clear fixture', 'text', 'draft', 'operator');
  insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
    values (v_version, v_deliverable, v_firm, 1, '<p>a</p>', 'operator');
  insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
    values (v_version2, v_deliverable, v_firm, 2, '<p>b</p>', 'operator');
  update content_deliverables set status = 'approved', approved_version_id = v_version, current_version_id = v_version where id = v_deliverable;
  insert into content_placements (id, firm_id, deliverable_id, destination, created_by_role)
    values (v_placement, v_firm, v_deliverable, 'linkedin_post', 'operator');

  v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version, 'hash-key-1', 'operator', null, 'Verify');
  v_claim := (v_result->>'claim_id')::uuid;

  -- CHECK 5 (the actual vulnerability, pre-fix would have RETAINED the
  -- caller-supplied hash): artifact_id NULL, but the insert statement puts
  -- an arbitrary sha256 on the row directly. Must be stored as NULL, not
  -- the caller-supplied value.
  insert into publication_receipts (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name, claim_id, artifact_id, artifact_sha256)
    values (v_firm, v_deliverable, v_placement, 'linkedin_post', v_version, now(), 'https://example.test/no-artifact-fake-hash', 'operator', 'Verify', v_claim, null,
            'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
    returning id, artifact_sha256 into v_receipt_id, v_stored_hash;
  if v_stored_hash is not null then
    v_fails := v_fails || ('CHECK5: caller-supplied hash with artifact_id NULL was retained: ' || v_stored_hash);
  end if;

  -- CHECK 6: a non-PDF artifact WITH a registered hash still gets its real
  -- hash applied (the fix does not accidentally null out legitimate,
  -- server-derived hashes for non-PDF artifact types). Bound to v_version2
  -- (a distinct approved version, re-approved below) since CHECK 5 already
  -- consumed the one-root-receipt-per-(placement,version) slot for v_version.
  insert into publication_artifacts (id, firm_id, deliverable_id, version_id, artifact_type, storage_bucket, storage_path, sha256, created_by_role)
    values (v_artifact_non_pdf, v_firm, v_deliverable, v_version2, 'webpage', 'firm-files', 'x/page.html',
            'cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe', 'operator');
  update content_deliverables set approved_version_id = v_version2, current_version_id = v_version2 where id = v_deliverable;
  -- CHECK 5's receipt already released v_claim, so no active claim remains
  -- on this placement -- no supersession needed.
  v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version2, 'hash-key-2', 'operator', null, 'Verify');
  v_claim2 := (v_result->>'claim_id')::uuid;
  if v_claim2 is null then
    v_fails := v_fails || ('CHECK6-SETUP: could not claim v_version2: ' || v_result::text);
  else
    insert into publication_receipts (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name, claim_id, artifact_id, artifact_sha256)
      values (v_firm, v_deliverable, v_placement, 'linkedin_post', v_version2, now(), 'https://example.test/with-artifact', 'operator', 'Verify', v_claim2, v_artifact_non_pdf, null)
      returning id, artifact_sha256 into v_receipt_id, v_stored_hash;
    if v_stored_hash is distinct from 'cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe' then
      v_fails := v_fails || ('CHECK6: bound-artifact hash not applied, got ' || coalesce(v_stored_hash, 'null'));
    end if;
  end if;

  if array_length(v_fails, 1) > 0 then
    raise exception 'FAILURES: %', array_to_string(v_fails, ' || ');
  end if;
  raise notice 'ALL HASH-CLEAR CHECKS PASSED';
end $$;

rollback;
