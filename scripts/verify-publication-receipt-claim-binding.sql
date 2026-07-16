-- Runnable, single-session verification for
-- supabase/migrations/20260716200000_publication_receipt_claim_binding.sql
-- and
-- supabase/migrations/20260716210000_publication_placement_claim_mutation_lockdown.sql.
--
-- Wrapped in BEGIN/ROLLBACK end to end so it leaves no trace regardless of
-- outcome. Fixture ids use the 77777777-... prefix to stay out of the way of
-- the existing 66666666-... verify scripts.
--
-- Usage: run via the Supabase MCP execute_sql tool, or
--   psql "$SUPABASE_DB_URL" -f scripts/verify-publication-receipt-claim-binding.sql
--
-- 14/14 checks passed against production (project ssxryjxifwiivghglqer) on
-- 2026-07-16 before these migrations were applied for real.

begin;

-- Claim-binding + version-scoped uniqueness + already-published fix
-- (workstreams 1+2).
do $$
declare
  v_firm uuid := '77777777-0000-0000-0000-000000000001';
  v_deliverable uuid := '77777777-0000-0000-0000-000000000002';
  v_placement uuid := '77777777-0000-0000-0000-000000000003';
  v_version1 uuid := '77777777-0000-0000-0000-000000000004';
  v_version2 uuid := '77777777-0000-0000-0000-000000000005';
  v_other_actor uuid := '77777777-0000-0000-0000-0000000000aa';
  v_result jsonb;
  v_claim1 uuid;
  v_claim2 uuid;
  v_root1 uuid;
  v_root2 uuid;
  v_fails text[] := '{}';
begin
  insert into intake_firms (id, name, custom_domain, subdomain) values (v_firm, 'Claim Binding Verify', null, 'claim-binding-verify');
  insert into content_deliverables (id, firm_id, title, content_kind, status, created_by_role)
    values (v_deliverable, v_firm, 'claim binding fixture', 'text', 'draft', 'operator');
  insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
    values (v_version1, v_deliverable, v_firm, 1, '<p>v1</p>', 'operator');
  update content_deliverables set status = 'approved', approved_version_id = v_version1, current_version_id = v_version1 where id = v_deliverable;
  insert into content_placements (id, firm_id, deliverable_id, destination, created_by_role)
    values (v_placement, v_firm, v_deliverable, 'linkedin_post', 'operator');

  -- CHECK 1: root receipt with NO claim_id must be rejected.
  begin
    insert into publication_receipts (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name)
      values (v_firm, v_deliverable, v_placement, 'linkedin_post', v_version1, now(), 'https://example.test/no-claim', 'operator', 'Verify');
    v_fails := v_fails || 'CHECK1: root receipt with no claim_id was accepted';
  exception when others then
    null;
  end;

  -- CHECK 2: claim + matching root receipt succeeds and releases the claim.
  v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version1, 'wf1-key-1', 'operator', null, 'Verify');
  if not (v_result->>'ok')::boolean then
    v_fails := v_fails || ('CHECK2: claim rejected: ' || v_result::text);
  else
    v_claim1 := (v_result->>'claim_id')::uuid;
    insert into publication_receipts (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name, claim_id)
      values (v_firm, v_deliverable, v_placement, 'linkedin_post', v_version1, now(), 'https://example.test/v1-root', 'operator', 'Verify', v_claim1)
      returning id into v_root1;
    if (select status from publication_placement_claims where id = v_claim1) <> 'released' then
      v_fails := v_fails || 'CHECK2: claim not released after matching root receipt';
    end if;
  end if;

  -- Mark v1 verified via a reconciling receipt (publication_receipts is
  -- append-only, so this is the real-world path -- not an UPDATE).
  insert into publication_receipts (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url,
       actor_role, actor_name, verification_state, verified_at, verification_method, reconciles_receipt_id)
    values (v_firm, v_deliverable, v_placement, 'linkedin_post', v_version1, now(), 'https://example.test/v1-root',
       'operator', 'Verify', 'verified', now(), 'operator_attestation', v_root1);

  -- CHECK 3: re-claiming the SAME (already-verified) version must report
  -- already_published.
  v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version1, 'wf1-key-3', 'operator', null, 'Verify');
  if (v_result->>'next_action') is distinct from 'already_published' then
    v_fails := v_fails || ('CHECK3: expected already_published, got: ' || v_result::text);
  end if;

  -- CHECK 4 (the actual doctrine fix): a NEW approved version on the SAME
  -- placement must be claimable and publishable, even though v1 is verified.
  insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
    values (v_version2, v_deliverable, v_firm, 2, '<p>v2</p>', 'operator');
  update content_deliverables set approved_version_id = v_version2, current_version_id = v_version2 where id = v_deliverable;

  v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version2, 'wf1-key-4', 'operator', null, 'Verify');
  if not (v_result->>'ok')::boolean then
    v_fails := v_fails || ('CHECK4: claiming new version rejected: ' || v_result::text);
  else
    v_claim2 := (v_result->>'claim_id')::uuid;
    insert into publication_receipts (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name, claim_id)
      values (v_firm, v_deliverable, v_placement, 'linkedin_post', v_version2, now(), 'https://example.test/v2-root', 'operator', 'Verify', v_claim2)
      returning id into v_root2;
  end if;

  -- CHECK 5: claim_id scope mismatch (claim belongs to a different
  -- approved_version_id than the receipt claims) must be rejected.
  begin
    insert into publication_receipts (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name, claim_id)
      values (v_firm, v_deliverable, v_placement, 'linkedin_post', v_version1, now(), 'https://example.test/mismatch', 'operator', 'Verify', v_claim2);
    v_fails := v_fails || 'CHECK5: version-mismatched claim_id was accepted';
  exception when others then
    null;
  end;

  -- CHECK 6: claim_id pointing at an already-released claim must be
  -- rejected (v_claim1 was released by CHECK 2's receipt already).
  begin
    insert into publication_receipts (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name, claim_id)
      values (v_firm, v_deliverable, v_placement, 'linkedin_post', v_version1, now(), 'https://example.test/reuse-released', 'operator', 'Verify', v_claim1);
    v_fails := v_fails || 'CHECK6: reuse of a released claim_id was accepted';
  exception when others then
    null;
  end;

  -- CHECK 7: operator-identity mismatch between the receipt's actor and the
  -- claim's claimed-by identity must be rejected (one actor's receipt
  -- cannot release another actor's claim).
  declare
    v_claim3 uuid;
    v_placement2 uuid := '77777777-0000-0000-0000-000000000006';
  begin
    insert into content_placements (id, firm_id, deliverable_id, destination, created_by_role)
      values (v_placement2, v_firm, v_deliverable, 'google_business_profile', 'operator');
    v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement2, v_version2, 'wf1-key-5', 'operator', v_other_actor, 'Other Operator');
    v_claim3 := (v_result->>'claim_id')::uuid;
    begin
      insert into publication_receipts (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_id, actor_name, claim_id)
        values (v_firm, v_deliverable, v_placement2, 'google_business_profile', v_version2, now(), 'https://example.test/wrong-actor', 'operator', gen_random_uuid(), 'Wrong Operator', v_claim3);
      v_fails := v_fails || 'CHECK7: mismatched-actor receipt released another operator''s claim';
    exception when others then
      null;
    end;
  end;

  if array_length(v_fails, 1) > 0 then
    raise exception 'FAILURES: %', array_to_string(v_fails, ' || ');
  end if;
  raise notice 'ALL CLAIM-BINDING CHECKS PASSED';
end $$;

-- PDF hash trust removal (workstream 4).
do $$
declare
  v_firm uuid := '77777777-0000-0000-0000-000000000010';
  v_deliverable uuid := '77777777-0000-0000-0000-000000000011';
  v_placement uuid := '77777777-0000-0000-0000-000000000012';
  v_version uuid := '77777777-0000-0000-0000-000000000013';
  v_artifact_no_hash uuid := '77777777-0000-0000-0000-000000000014';
  v_artifact_with_hash uuid := '77777777-0000-0000-0000-000000000015';
  v_result jsonb;
  v_claim uuid;
  v_claim2 uuid;
  v_receipt_id uuid;
  v_stored_hash text;
  v_fails text[] := '{}';
begin
  insert into intake_firms (id, name, custom_domain, subdomain) values (v_firm, 'PDF Hash Verify', null, 'pdf-hash-verify');
  insert into content_deliverables (id, firm_id, title, content_kind, status, created_by_role)
    values (v_deliverable, v_firm, 'pdf hash fixture', 'text', 'draft', 'operator');
  insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
    values (v_version, v_deliverable, v_firm, 1, '<p>a</p>', 'operator');
  update content_deliverables set status = 'approved', approved_version_id = v_version, current_version_id = v_version where id = v_deliverable;
  insert into content_placements (id, firm_id, deliverable_id, destination, required_artifact_type, created_by_role)
    values (v_placement, v_firm, v_deliverable, 'firm_website', 'pdf', 'operator');

  -- publication_artifacts is append-only too, so the "hash arrives later"
  -- case is modeled as a second artifact row, not an UPDATE.
  insert into publication_artifacts (id, firm_id, deliverable_id, version_id, artifact_type, storage_bucket, storage_path, sha256, created_by_role)
    values (v_artifact_no_hash, v_firm, v_deliverable, v_version, 'pdf', 'firm-files', 'x/no-hash.pdf', null, 'operator');
  insert into publication_artifacts (id, firm_id, deliverable_id, version_id, artifact_type, destination, storage_bucket, storage_path, sha256, created_by_role)
    values (v_artifact_with_hash, v_firm, v_deliverable, v_version, 'pdf', 'linkedin', 'firm-files', 'x/with-hash.pdf',
            'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'operator');

  v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version, 'wf4-key-1', 'operator', null, 'Verify');
  v_claim := (v_result->>'claim_id')::uuid;

  -- CHECK 8: a root receipt bound to a PDF artifact with NO registered hash
  -- must be rejected (fail closed), regardless of a caller-supplied hash on
  -- the request itself.
  begin
    insert into publication_receipts (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name, claim_id, artifact_id, artifact_sha256)
      values (v_firm, v_deliverable, v_placement, 'firm_website', v_version, now(), 'https://example.test/pdf-no-hash', 'operator', 'Verify', v_claim, v_artifact_no_hash,
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    v_fails := v_fails || 'CHECK8: PDF artifact with no registered hash was accepted as evidence';
  exception when others then
    null;
  end;

  -- CHECK 9: a caller-supplied artifact_sha256 that disagrees with the
  -- artifact's own registered hash must NEVER become the stored evidence --
  -- the trigger overwrites it with the trusted value.
  v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version, 'wf4-key-2', 'operator', null, 'Verify', v_claim);
  v_claim2 := (v_result->>'claim_id')::uuid;
  if v_claim2 is null then
    v_fails := v_fails || ('CHECK9-SETUP: could not supersede+reclaim: ' || v_result::text);
  else
    insert into publication_receipts (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name, claim_id, artifact_id, artifact_sha256)
      values (v_firm, v_deliverable, v_placement, 'firm_website', v_version, now(), 'https://example.test/pdf-good-hash', 'operator', 'Verify', v_claim2, v_artifact_with_hash,
              'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
      returning id, artifact_sha256 into v_receipt_id, v_stored_hash;
    if v_stored_hash is distinct from 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' then
      v_fails := v_fails || ('CHECK9: stored hash mismatch, got ' || coalesce(v_stored_hash, 'null'));
    end if;
  end if;

  if array_length(v_fails, 1) > 0 then
    raise exception 'FAILURES: %', array_to_string(v_fails, ' || ');
  end if;
  raise notice 'ALL PDF-HASH-TRUST CHECKS PASSED';
end $$;

-- Claim-mutation lockdown (workstream 3). Runs as service_role to prove
-- ordinary application writes are blocked while the RPC and the
-- receipt-release trigger (both SECURITY DEFINER, run as postgres) still
-- function.
do $$
declare
  v_fails text[] := '{}';
begin
  set local role service_role;

  -- CHECK 10: direct INSERT as service_role must be blocked.
  begin
    insert into publication_placement_claims (firm_id, deliverable_id, placement_id, approved_version_id, idempotency_key, claimed_by_role)
      values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'direct-insert-attempt', 'operator');
    v_fails := v_fails || 'CHECK10: direct INSERT as service_role was NOT blocked';
  exception when others then
    null;
  end;

  reset role;

  declare
    v_firm uuid := '77777777-0000-0000-0000-000000000020';
    v_deliverable uuid := '77777777-0000-0000-0000-000000000021';
    v_placement uuid := '77777777-0000-0000-0000-000000000022';
    v_version uuid := '77777777-0000-0000-0000-000000000023';
    v_claim uuid;
    v_result jsonb;
  begin
    insert into intake_firms (id, name, custom_domain, subdomain) values (v_firm, 'Mutation Lockdown Verify', null, 'mutation-lockdown-verify');
    insert into content_deliverables (id, firm_id, title, content_kind, status, created_by_role)
      values (v_deliverable, v_firm, 'lockdown fixture', 'text', 'draft', 'operator');
    insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
      values (v_version, v_deliverable, v_firm, 1, '<p>a</p>', 'operator');
    update content_deliverables set status = 'approved', approved_version_id = v_version, current_version_id = v_version where id = v_deliverable;
    insert into content_placements (id, firm_id, deliverable_id, destination, created_by_role)
      values (v_placement, v_firm, v_deliverable, 'linkedin_post', 'operator');

    -- CHECK 11: the RPC (SECURITY DEFINER, runs as postgres) still creates
    -- claims fine with the lockdown trigger active.
    v_result := claim_placement_for_publish(v_firm, v_deliverable, v_placement, v_version, 'wf3-key-1', 'operator', null, 'Verify');
    v_claim := (v_result->>'claim_id')::uuid;
    if v_claim is null then
      v_fails := v_fails || ('CHECK11: could not seed a claim via the RPC: ' || v_result::text);
    else
      set local role service_role;

      -- CHECK 12: direct UPDATE as service_role must be blocked.
      begin
        update publication_placement_claims set status = 'active', approved_version_id = gen_random_uuid() where id = v_claim;
        v_fails := v_fails || 'CHECK12: direct UPDATE as service_role was NOT blocked';
      exception when others then
        null;
      end;

      -- CHECK 13: direct DELETE as service_role must be blocked.
      begin
        delete from publication_placement_claims where id = v_claim;
        v_fails := v_fails || 'CHECK13: direct DELETE as service_role was NOT blocked';
      exception when others then
        null;
      end;
      reset role;

      -- CHECK 14: the legitimate release path (a root receipt naming this
      -- exact claim_id, inserted as service_role -- the app's real role)
      -- must still work, because release_placement_claim_on_receipt() is
      -- SECURITY DEFINER.
      set local role service_role;
      insert into publication_receipts (firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, public_url, actor_role, actor_name, claim_id)
        values (v_firm, v_deliverable, v_placement, 'linkedin_post', v_version, now(), 'https://example.test/lockdown-release', 'operator', 'Verify', v_claim);
      reset role;
      if (select status from publication_placement_claims where id = v_claim) is distinct from 'released' then
        v_fails := v_fails || 'CHECK14: legitimate release-by-receipt path broke under the lockdown trigger';
      end if;
    end if;
  end;

  if array_length(v_fails, 1) > 0 then
    raise exception 'FAILURES: %', array_to_string(v_fails, ' || ');
  end if;
  raise notice 'ALL CLAIM-MUTATION-LOCKDOWN CHECKS PASSED';
end $$;

rollback;
