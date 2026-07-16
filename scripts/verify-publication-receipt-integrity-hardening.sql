-- Runnable verification for
-- supabase/migrations/20260715225139_publication_receipt_integrity_hardening.sql
-- (checks 1-13) and
-- supabase/migrations/20260715231733_publication_receipt_hardening_supplement.sql
-- (checks 14-18, added on adversarial re-review: superseded artifact,
-- hash auto-populate, locale mismatch, and the two new verification-state
-- purity constraints for 'unverified' and 'reconciling').
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
  v_artifact_superseded uuid; -- bound to v1, superseded_at set (check 14)
  v_placement_c       uuid; -- distinct placement, locale = 'en-CA' (check 16)
  v_receipt_ok        uuid;
  v_receipt_id_preset uuid;
  v_receipt_for_reconciling uuid; -- second happy-path receipt, reconciled by check 18
  v_stored_sha        text;
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

  insert into public.content_placements (id, firm_id, period_id, deliverable_id, destination, state, created_by_role)
  values (gen_random_uuid(), v_firm_id, v_period_a, v_deliverable_id, 'firm_website', 'ready', 'operator')
  returning id into v_placement_a;

  insert into public.content_placements (id, firm_id, period_id, deliverable_id, destination, state, created_by_role)
  values (gen_random_uuid(), v_firm_id, v_period_a, v_deliverable_id, 'linkedin_post', 'ready', 'operator')
  returning id into v_placement_b;

  insert into public.publication_artifacts (id, firm_id, deliverable_id, version_id, artifact_type, sha256, created_by_role)
  values (gen_random_uuid(), v_firm_id, v_deliverable_id, v_v1, 'webpage', repeat('a', 64), 'operator')
  returning id into v_artifact_v1;

  insert into public.publication_artifacts (id, firm_id, deliverable_id, version_id, artifact_type, sha256, created_by_role)
  values (gen_random_uuid(), v_firm_id, v_deliverable_id, v_v2, 'webpage', repeat('b', 64), 'operator')
  returning id into v_artifact_v2;

  -- Distinct locale ('fr-CA') vs v_artifact_v1's null so the two rows
  -- don't collide on publication_artifacts_dedupe_idx (unique on
  -- deliverable_id, version_id, artifact_type, coalesce(locale,''),
  -- coalesce(destination,'')); the artifact's own locale is never
  -- compared against anything by the trigger, so this is inert for the
  -- superseded-artifact check itself.
  insert into public.publication_artifacts (id, firm_id, deliverable_id, version_id, artifact_type, sha256, superseded_at, created_by_role, locale)
  values (gen_random_uuid(), v_firm_id, v_deliverable_id, v_v1, 'webpage', repeat('c', 64), now(), 'operator', 'fr-CA')
  returning id into v_artifact_superseded;

  insert into public.content_placements (id, firm_id, period_id, deliverable_id, destination, state, locale, created_by_role)
  values (gen_random_uuid(), v_firm_id, v_period_a, v_deliverable_id, 'firm_website', 'ready', 'en-CA', 'operator')
  returning id into v_placement_c;

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

  -- The negative row must be valid in EVERY respect except the one property
  -- under test, so the unique partial index is the only thing that can reject
  -- it. failure_reason is supplied because verification_state = 'failed'
  -- without one violates publication_receipts_failed_requires_reason_check,
  -- which Postgres evaluates before the index is ever consulted: the insert
  -- would abort on the CHECK and a bare "when others" would report a pass for
  -- an index it never reached. Catching sqlstate 23505 specifically (rather
  -- than "others") is what keeps that failure mode from returning.
  v_raised := false;
  begin
    insert into public.publication_receipts (
      id, firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, actor_role,
      reconciles_receipt_id, verification_state, verified_at, verification_method, failure_reason
    ) values (
      gen_random_uuid(), v_firm_id, v_deliverable_id, v_placement_a, 'firm_website', v_v1, now(), 'operator',
      v_receipt_ok, 'failed', now(), 'url_fetch', 'verify script: second reconciliation of the same original'
    );
  exception
    when unique_violation then
      v_raised := true;
      raise notice 'CHECK 10 PASS: duplicate reconciliation fork refused by the unique index: %', sqlerrm;
    when others then
      raise exception 'CHECK 10 FAIL: expected unique_violation (23505) from publication_receipts_reconciles_single_chain_idx, got %: %', sqlstate, sqlerrm;
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

  -- Check 12: deliverable not approved. Uses v_v1 (a real version row that
  -- belongs to the OTHER deliverable) as approved_version_id: the FK is
  -- satisfied (v_v1 exists in deliverable_versions), so the trigger fires,
  -- and the status check ('in_review' <> 'approved') runs before the
  -- version-ownership or placement-ownership checks in the function body,
  -- so this correctly isolates the not-approved rejection. An earlier
  -- version of this check selected a version FROM v_deliverable_id_2's own
  -- (deliberately empty) deliverable_versions -- since that SELECT matches
  -- zero rows, the INSERT ... SELECT silently inserted zero rows, raised no
  -- exception, and never exercised the check at all (caught on re-run: the
  -- DO block still reached "CHECK 12 FAIL" because v_raised stayed false).
  v_raised := false;
  begin
    insert into public.publication_receipts (
      id, firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, actor_role
    ) values (
      gen_random_uuid(), v_firm_id, v_deliverable_id_2, v_placement_a, 'firm_website', v_v1, now(), 'operator'
    );
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

  -- Undo the check-13 drift so checks 14+ (which need approved=current) pass.
  update public.content_deliverables set current_version_id = v_v1 where id = v_deliverable_id;

  -- Check 14: artifact_id references a SUPERSEDED artifact.
  v_raised := false;
  begin
    insert into public.publication_receipts (
      id, firm_id, deliverable_id, placement_id, destination, approved_version_id, artifact_id, published_at, actor_role
    ) values (
      gen_random_uuid(), v_firm_id, v_deliverable_id, v_placement_a, 'firm_website', v_v1, v_artifact_superseded, now(), 'operator'
    );
  exception when others then
    v_raised := true;
    raise notice 'CHECK 14 PASS: superseded-artifact receipt raised: %', sqlerrm;
  end;
  if not v_raised then raise exception 'CHECK 14 FAIL: a receipt bound to a superseded artifact was NOT refused'; end if;

  -- Check 15: artifact_id set (artifact HAS a real sha256), the receipt's
  -- own artifact_sha256 left null -- must succeed, and the STORED row
  -- must have artifact_sha256 auto-populated from the artifact.
  insert into public.publication_receipts (
    id, firm_id, deliverable_id, placement_id, destination, approved_version_id, artifact_id, published_at, actor_role
  ) values (
    gen_random_uuid(), v_firm_id, v_deliverable_id, v_placement_a, 'firm_website', v_v1, v_artifact_v1, now(), 'operator'
  ) returning artifact_sha256 into v_stored_sha;
  if v_stored_sha is distinct from repeat('a', 64) then
    raise exception 'CHECK 15 FAIL: omitted artifact_sha256 was not auto-populated from the artifact (got %)', v_stored_sha;
  end if;
  raise notice 'CHECK 15 PASS: omitted hash auto-populated from the trusted artifact row: %', v_stored_sha;

  -- Check 16: locale disagreeing with the placement's own locale
  -- (v_placement_c has locale = 'en-CA').
  v_raised := false;
  begin
    insert into public.publication_receipts (
      id, firm_id, deliverable_id, placement_id, destination, locale, approved_version_id, published_at, actor_role
    ) values (
      gen_random_uuid(), v_firm_id, v_deliverable_id, v_placement_c, 'firm_website', 'pt-BR', v_v1, now(), 'operator'
    );
  exception when others then
    v_raised := true;
    raise notice 'CHECK 16 PASS: locale-mismatched receipt raised: %', sqlerrm;
  end;
  if not v_raised then raise exception 'CHECK 16 FAIL: a receipt locale disagreeing with its placement''s locale was NOT refused'; end if;

  -- Check 17: verification_state = 'unverified' (the default) but carrying
  -- verified_at + verification_method (satisfies the pre-existing pair
  -- check, so this isolates the NEW unverified-purity constraint).
  v_raised := false;
  begin
    insert into public.publication_receipts (
      id, firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, actor_role,
      verification_state, verified_at, verification_method
    ) values (
      gen_random_uuid(), v_firm_id, v_deliverable_id, v_placement_a, 'firm_website', v_v1, now(), 'operator',
      'unverified', now(), 'url_fetch'
    );
  exception when others then
    v_raised := true;
    raise notice 'CHECK 17 PASS: unverified-with-metadata raised: %', sqlerrm;
  end;
  if not v_raised then raise exception 'CHECK 17 FAIL: verification_state=unverified carrying verified_at/method was NOT refused'; end if;

  -- Check 18: verification_state = 'reconciling' with a VALID
  -- reconciles_receipt_id (passes the pre-existing reconciling-requires-id
  -- check) but also carrying verified_at + verification_method (isolates
  -- the NEW reconciling-purity constraint).
  insert into public.publication_receipts (
    id, firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, actor_role,
    verification_state, verified_at, verification_method
  ) values (
    gen_random_uuid(), v_firm_id, v_deliverable_id, v_placement_a, 'firm_website', v_v1, now(), 'operator',
    'verified', now(), 'url_fetch'
  ) returning id into v_receipt_for_reconciling;

  v_raised := false;
  begin
    insert into public.publication_receipts (
      id, firm_id, deliverable_id, placement_id, destination, approved_version_id, published_at, actor_role,
      reconciles_receipt_id, verification_state, verified_at, verification_method
    ) values (
      gen_random_uuid(), v_firm_id, v_deliverable_id, v_placement_a, 'firm_website', v_v1, now(), 'operator',
      v_receipt_for_reconciling, 'reconciling', now(), 'url_fetch'
    );
  exception when others then
    v_raised := true;
    raise notice 'CHECK 18 PASS: reconciling-with-metadata raised: %', sqlerrm;
  end;
  if not v_raised then raise exception 'CHECK 18 FAIL: verification_state=reconciling carrying verified_at/method was NOT refused'; end if;

  raise notice '=== ALL 18 CHECKS PASSED ===';
end $$;

rollback;
