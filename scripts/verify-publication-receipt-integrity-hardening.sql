-- Runnable verification for
-- supabase/migrations/20260715220000_publication_receipt_integrity_hardening.sql.
--
-- NOT run automatically by anything. Wrapped in BEGIN/ROLLBACK end to end
-- so it leaves no trace regardless of outcome. Uses DRG's real firm_id
-- (guaranteed to exist) so there is no ambiguity about whether a fake
-- firm_id happens to satisfy the intake_firms foreign key.
--
-- Usage: psql "$SUPABASE_DB_URL" -f scripts/verify-publication-receipt-integrity-hardening.sql

begin;

do $$
declare
  v_firm_id          uuid := 'eec1d25e-a047-4827-8e4a-6eb96becca2b';
  v_deliverable_id   uuid;
  v_deliverable_id_2 uuid; -- not approved, for check 12
  v_v1               uuid; -- approved version
  v_v2               uuid; -- a later, NOT approved, version (same deliverable)
  v_placement_a      uuid;
  v_placement_b      uuid; -- distinct placement, for cross-placement checks
  v_period_a         uuid;
  v_period_b         uuid;
  v_artifact_v1       uuid; -- bound to v1, matching sha
  v_artifact_v2       uuid; -- bound to v2 (wrong version relative to a v1 receipt)
  v_receipt_ok        uuid;
  v_receipt_id_preset uuid;
  v_raised            boolean;
begin
  raise notice '=== setup: one approved deliverable (2 versions), one placement, one artifact ===';

  insert into public.content_periods (id, firm_id, starts_on, ends_on, theme, readiness_lifecycle)
  values (gen_random_uuid(), v_firm_id, current_date, current_date + 4, 'VERIFY receipt integrity A', 'setup_required')
  returning id into v_period_a;

  insert into public.content_periods (id, firm_id, starts_on, ends_on, theme, readiness_lifecycle)
  values (gen_random_uuid(), v_firm_id, current_date + 7, current_date + 11, 'VERIFY receipt integrity B', 'setup_required')
  returning id into v_period_b;

  insert into public.content_deliverables (id, firm_id, title, status, content_kind, period_id)
  values (gen_random_uuid(), v_firm_id, 'VERIFY receipt-integrity deliverable', 'approved', 'text', v_period_a)
  returning id into v_deliverable_id;

  insert into public.deliverable_versions (id, deliverable_id, firm_id, version_number, body_html)
  values (gen_random_uuid(), v_deliverable_id, v_firm_id, 1, '<p>v1</p>')
  returning id into v_v1;

  insert into public.deliverable_versions (id, deliverable_id, firm_id, version_number, body_html)
  values (gen_random_uuid(), v_deliverable_id, v_firm_id, 2, '<p>v2</p>')
  returning id into v_v2;

  update public.content_deliverables
     set current_version_id = v_v1, approved_version_id = v_v1
   where id = v_deliverable_id;

  insert into public.content_placements (id, firm_id, period_id, deliverable_id, destination, state)
  values (gen_random_uuid(), v_firm_id, v_period_a, v_deliverable_id, 'firm_website', 'ready')
  returning id into v_placement_a;

  insert into public.content_placements (id, firm_id, period_id, deliverable_id, destination, state)
  values (gen_random_uuid(), v_firm_id, v_period_a, v_deliverable_id, 'linkedin_post', 'ready')
  returning id into v_placement_b;

  insert into public.publication_artifacts (id, firm_id, deliverable_id, version_id, artifact_type, sha256)
  values (gen_random_uuid(), v_firm_id, v_deliverable_id, v_v1, 'webpage', repeat('a', 64))
  returning id into v_artifact_v1;

  insert into public.publication_artifacts (id, firm_id, deliverable_id, version_id, artifact_type, sha256)
  values (gen_random_uuid(), v_firm_id, v_deliverable_id, v_v2, 'webpage', repeat('b', 64))
  returning id into v_artifact_v2;

  insert into public.content_deliverables (id, firm_id, title, status, content_kind)
  values (gen_random_uuid(), v_firm_id, 'VERIFY not-approved deliverable', 'in_review', 'text')
  returning id into v_deliverable_id_2;

  -- Check 1: happy path -- current approved version, matching artifact, matching sha256.
  insert into public.publication_receipts (
    id, firm_id, period_id, deliverable_id, placement_id, destination,
    approved_version_id, artifact_id, artifact_sha256, published_at, actor_role
  ) values (
    gen_random_uuid(), v_firm_id, v_period_a, v_deliverable_id, v_placement_a, 'firm_website',
    v_v1, v_artifact_v1, repeat('a', 64), now(), 'operator'
  ) returning id into v_receipt_ok;
  raise notice 'CHECK 1 PASS: happy-path receipt inserted: %', v_receipt_ok;

  -- Check 2: approved_version_id set to a DIFFERENT version of the same
  -- deliverable (v2, not the deliverable's actual approved_version_id v1).
  v_raised := false;
  begin
    insert into public.publication_receipts (
      id, firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, actor_role
    ) values (
      gen_random_uuid(), v_firm_id, v_deliverable_id, v_placement_a, 'firm_website', v_v2, now(), 'operator'
    );
  exception when others then
    v_raised := true;
    raise notice 'CHECK 2 PASS: wrong-version receipt raised: %', sqlerrm;
  end;
  if not v_raised then raise exception 'CHECK 2 FAIL: receipt bound to a non-approved version was NOT refused'; end if;

  -- Check 3: artifact bound to a DIFFERENT version than approved_version_id.
  v_raised := false;
  begin
    insert into public.publication_receipts (
      id, firm_id, deliverable_id, placement_id, destination, approved_version_id, artifact_id, published_at, actor_role
    ) values (
      gen_random_uuid(), v_firm_id, v_deliverable_id, v_placement_a, 'firm_website', v_v1, v_artifact_v2, now(), 'operator'
    );
  exception when others then
    v_raised := true;
    raise notice 'CHECK 3 PASS: version-mismatched artifact raised: %', sqlerrm;
  end;
  if not v_raised then raise exception 'CHECK 3 FAIL: an artifact bound to a different version was NOT refused'; end if;

  -- Check 4: artifact_sha256 disagrees with the registered artifact's own sha256.
  v_raised := false;
  begin
    insert into public.publication_receipts (
      id, firm_id, deliverable_id, placement_id, destination, approved_version_id, artifact_id, artifact_sha256, published_at, actor_role
    ) values (
      gen_random_uuid(), v_firm_id, v_deliverable_id, v_placement_a, 'firm_website', v_v1, v_artifact_v1, repeat('f', 64), now(), 'operator'
    );
  exception when others then
    v_raised := true;
    raise notice 'CHECK 4 PASS: sha256 mismatch raised: %', sqlerrm;
  end;
  if not v_raised then raise exception 'CHECK 4 FAIL: a disagreeing artifact_sha256 was NOT refused'; end if;

  -- Check 5: period_id disagrees with the placement's own period_id.
  v_raised := false;
  begin
    insert into public.publication_receipts (
      id, firm_id, period_id, deliverable_id, placement_id, destination, approved_version_id, published_at, actor_role
    ) values (
      gen_random_uuid(), v_firm_id, v_period_b, v_deliverable_id, v_placement_a, 'firm_website', v_v1, now(), 'operator'
    );
  exception when others then
    v_raised := true;
    raise notice 'CHECK 5 PASS: cross-period receipt raised: %', sqlerrm;
  end;
  if not v_raised then raise exception 'CHECK 5 FAIL: a receipt period_id disagreeing with its placement''s period was NOT refused'; end if;

  -- Check 6: verification_state = 'verified' with no verified_at/verification_method.
  v_raised := false;
  begin
    insert into public.publication_receipts (
      id, firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, actor_role, verification_state
    ) values (
      gen_random_uuid(), v_firm_id, v_deliverable_id, v_placement_a, 'firm_website', v_v1, now(), 'operator', 'verified'
    );
  exception when others then
    v_raised := true;
    raise notice 'CHECK 6 PASS: verified-without-metadata raised: %', sqlerrm;
  end;
  if not v_raised then raise exception 'CHECK 6 FAIL: verification_state=verified with no verified_at/method was NOT refused'; end if;

  -- Check 7: verification_state = 'failed' with an empty failure_reason.
  v_raised := false;
  begin
    insert into public.publication_receipts (
      id, firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, actor_role,
      verification_state, verified_at, verification_method, failure_reason
    ) values (
      gen_random_uuid(), v_firm_id, v_deliverable_id, v_placement_a, 'firm_website', v_v1, now(), 'operator',
      'failed', now(), 'url_fetch', ''
    );
  exception when others then
    v_raised := true;
    raise notice 'CHECK 7 PASS: failed-with-empty-reason raised: %', sqlerrm;
  end;
  if not v_raised then raise exception 'CHECK 7 FAIL: verification_state=failed with an empty failure_reason was NOT refused'; end if;

  -- Check 8: reconciles_receipt_id pointing at a receipt from a DIFFERENT placement.
  v_raised := false;
  begin
    insert into public.publication_receipts (
      id, firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, actor_role, reconciles_receipt_id
    ) values (
      gen_random_uuid(), v_firm_id, v_deliverable_id, v_placement_b, 'linkedin_post', v_v1, now(), 'operator', v_receipt_ok
    );
  exception when others then
    v_raised := true;
    raise notice 'CHECK 8 PASS: cross-placement reconciliation raised: %', sqlerrm;
  end;
  if not v_raised then raise exception 'CHECK 8 FAIL: reconciling a receipt from a different placement was NOT refused'; end if;

  -- Check 9: self-reference (reconciles_receipt_id = the row's own id).
  v_receipt_id_preset := gen_random_uuid();
  v_raised := false;
  begin
    insert into public.publication_receipts (
      id, firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, actor_role, reconciles_receipt_id
    ) values (
      v_receipt_id_preset, v_firm_id, v_deliverable_id, v_placement_a, 'firm_website', v_v1, now(), 'operator', v_receipt_id_preset
    );
  exception when others then
    v_raised := true;
    raise notice 'CHECK 9 PASS: self-reference raised: %', sqlerrm;
  end;
  if not v_raised then raise exception 'CHECK 9 FAIL: reconciles_receipt_id = own id was NOT refused'; end if;

  -- Check 10: a SECOND receipt also reconciling the same original --
  -- forking the chain -- must be refused by the unique partial index.
  insert into public.publication_receipts (
    id, firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, actor_role,
    reconciles_receipt_id, verification_state, verified_at, verification_method
  ) values (
    gen_random_uuid(), v_firm_id, v_deliverable_id, v_placement_a, 'firm_website', v_v1, now(), 'operator',
    v_receipt_ok, 'verified', now(), 'url_fetch'
  );
  raise notice 'CHECK 10 setup: first reconciliation of v_receipt_ok inserted';

  v_raised := false;
  begin
    insert into public.publication_receipts (
      id, firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, actor_role,
      reconciles_receipt_id, verification_state, verified_at, verification_method
    ) values (
      gen_random_uuid(), v_firm_id, v_deliverable_id, v_placement_a, 'firm_website', v_v1, now(), 'operator',
      v_receipt_ok, 'failed', now(), 'url_fetch'
    );
  exception when others then
    v_raised := true;
    raise notice 'CHECK 10 PASS: duplicate reconciliation fork raised: %', sqlerrm;
  end;
  if not v_raised then raise exception 'CHECK 10 FAIL: a second receipt reconciling the same original was NOT refused (chain forked)'; end if;

  -- Check 11: verification_state = 'reconciling' with no reconciles_receipt_id.
  v_raised := false;
  begin
    insert into public.publication_receipts (
      id, firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, actor_role, verification_state
    ) values (
      gen_random_uuid(), v_firm_id, v_deliverable_id, v_placement_a, 'firm_website', v_v1, now(), 'operator', 'reconciling'
    );
  exception when others then
    v_raised := true;
    raise notice 'CHECK 11 PASS: bare reconciling-state raised: %', sqlerrm;
  end;
  if not v_raised then raise exception 'CHECK 11 FAIL: verification_state=reconciling with no reconciles_receipt_id was NOT refused'; end if;

  -- Check 12: deliverable not approved.
  v_raised := false;
  begin
    insert into public.publication_receipts (
      id, firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, actor_role
    )
    select gen_random_uuid(), v_firm_id, v_deliverable_id_2, v_placement_a, 'firm_website', dv.id, now(), 'operator'
    from public.deliverable_versions dv where dv.deliverable_id = v_deliverable_id_2
    limit 1;
    -- deliverable_id_2 has no versions at all, so this insert should fail
    -- on the approved_version_id/deliverable ownership check regardless;
    -- exercised distinctly for clarity of which failure fires first.
  exception when others then
    v_raised := true;
    raise notice 'CHECK 12 PASS: not-approved deliverable path raised: %', sqlerrm;
  end;
  if not v_raised then raise exception 'CHECK 12 FAIL: a receipt against a non-approved deliverable was NOT refused'; end if;

  -- Check 13 (bonus): explicitly force version drift and confirm it is
  -- refused even when approved_version_id on the RECEIPT matches
  -- approved_version_id on the deliverable, if that no longer equals
  -- current_version_id.
  update public.content_deliverables set current_version_id = v_v2 where id = v_deliverable_id;
  v_raised := false;
  begin
    insert into public.publication_receipts (
      id, firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, actor_role
    ) values (
      gen_random_uuid(), v_firm_id, v_deliverable_id, v_placement_a, 'firm_website', v_v1, now(), 'operator'
    );
  exception when others then
    v_raised := true;
    raise notice 'CHECK 13 PASS: version-drift receipt raised: %', sqlerrm;
  end;
  if not v_raised then raise exception 'CHECK 13 FAIL: a receipt on a deliverable with approved<>current version drift was NOT refused'; end if;

  raise notice '=== ALL 13 CHECKS PASSED ===';
end $$;

rollback;
