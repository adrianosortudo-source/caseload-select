-- Runnable verification for
-- supabase/migrations/20260716120000_publication_receipt_verification_after_revision_fix.sql
--
-- NOT run automatically by anything. Wrapped in BEGIN/ROLLBACK end to end
-- so it leaves no trace regardless of outcome. Uses DRG's real firm_id
-- (guaranteed to exist), same convention as
-- scripts/verify-publication-receipt-integrity-hardening.sql.
--
-- Usage: psql "$SUPABASE_DB_URL" -f scripts/verify-publication-receipt-verification-after-revision-fix.sql

begin;

do $$
declare
  v_firm_id         uuid := 'eec1d25e-a047-4827-8e4a-6eb96becca2b';
  v_deliverable_id  uuid;
  v_period_a        uuid;
  v_v1              uuid; -- the version published and later revised away from
  v_v2              uuid; -- the revision that resets approved_version_id to null
  v_placement_a     uuid;
  v_receipt_v1      uuid; -- the original, unverified, v1 publish receipt
  v_raised          boolean;
begin
  raise notice '=== setup: deliverable approved at v1, one placement, one unverified receipt ===';

  insert into public.content_periods (id, firm_id, starts_on, ends_on, theme, readiness_lifecycle)
  values (gen_random_uuid(), v_firm_id, current_date, current_date + 4, 'VERIFY receipt post-revision fix', 'setup_required')
  returning id into v_period_a;

  insert into public.content_deliverables (id, firm_id, title, status, content_kind, period_id)
  values (gen_random_uuid(), v_firm_id, 'VERIFY receipt post-revision deliverable', 'approved', 'text', v_period_a)
  returning id into v_deliverable_id;

  insert into public.deliverable_versions (id, deliverable_id, firm_id, version_number, body_html)
  values (gen_random_uuid(), v_deliverable_id, v_firm_id, 1, '<p>v1</p>')
  returning id into v_v1;

  update public.content_deliverables
     set current_version_id = v_v1, approved_version_id = v_v1
   where id = v_deliverable_id;

  insert into public.content_placements (id, firm_id, period_id, deliverable_id, destination, state, created_by_role)
  values (gen_random_uuid(), v_firm_id, v_period_a, v_deliverable_id, 'firm_website', 'ready', 'operator')
  returning id into v_placement_a;

  -- The original publish: an unverified receipt bound to v1, exactly as
  -- POST .../receipts (createReceipt) would create it while v1 is current
  -- and approved.
  insert into public.publication_receipts (
    id, firm_id, period_id, deliverable_id, placement_id, destination,
    approved_version_id, published_at, actor_role
  ) values (
    gen_random_uuid(), v_firm_id, v_period_a, v_deliverable_id, v_placement_a, 'firm_website',
    v_v1, now(), 'operator'
  ) returning id into v_receipt_v1;
  raise notice 'setup: v1 publish receipt inserted: %', v_receipt_v1;

  -- The revision: a new version posts. This mirrors exactly what
  -- src/lib/deliverables.ts addVersion() does on the live path --
  -- current_version_id advances, approved_version_id is reset to null,
  -- status returns to in_review -- the state that made verification of
  -- the v1 receipt permanently impossible before this fix.
  insert into public.deliverable_versions (id, deliverable_id, firm_id, version_number, body_html)
  values (gen_random_uuid(), v_deliverable_id, v_firm_id, 2, '<p>v2</p>')
  returning id into v_v2;

  update public.content_deliverables
     set current_version_id = v_v2, approved_version_id = null, status = 'in_review'
   where id = v_deliverable_id;
  raise notice 'setup: v2 posted, deliverable reset to in_review with approved_version_id null';

  -- Check 20 (the fix): verifying the v1 receipt now succeeds even though
  -- the deliverable is currently in_review with a null approved_version_id.
  -- This is exactly what verifyReceipt() constructs: reconciles_receipt_id
  -- set to the original, approved_version_id copied UNCHANGED from the
  -- original (v1), verification_state = 'verified'.
  insert into public.publication_receipts (
    id, firm_id, period_id, deliverable_id, placement_id, destination,
    approved_version_id, published_at, actor_role,
    reconciles_receipt_id, verification_state, verified_at, verification_method
  ) values (
    gen_random_uuid(), v_firm_id, v_period_a, v_deliverable_id, v_placement_a, 'firm_website',
    v_v1, now(), 'operator',
    v_receipt_v1, 'verified', now(), 'url_fetch'
  );
  raise notice 'CHECK 20 PASS: verification of a historical receipt succeeded after the deliverable was revised (the fix)';

  -- Check 21: a verification row that reconciles the v1 receipt but
  -- supplies a DIFFERENT approved_version_id (v2) must still be refused --
  -- proves the exemption cannot smuggle a different version.
  v_raised := false;
  begin
    insert into public.publication_receipts (
      id, firm_id, period_id, deliverable_id, placement_id, destination,
      approved_version_id, published_at, actor_role,
      reconciles_receipt_id, verification_state, verified_at, verification_method
    ) values (
      gen_random_uuid(), v_firm_id, v_period_a, v_deliverable_id, v_placement_a, 'firm_website',
      v_v2, now(), 'operator',
      v_receipt_v1, 'verified', now(), 'url_fetch'
    );
  exception when others then
    v_raised := true;
    raise notice 'CHECK 21 PASS: verification row asserting a different version than the one it reconciles was refused: %', sqlerrm;
  end;
  if not v_raised then raise exception 'CHECK 21 FAIL: a verification receipt asserting a DIFFERENT version than the receipt it reconciles was NOT refused'; end if;

  -- Check 22: an 'unverified' correction (the general createReceipt
  -- reconciles_receipt_id path, unused by any caller today but part of its
  -- public input type) against the still-in_review deliverable must stay
  -- on the strict path and be refused -- proves the exemption is scoped to
  -- verified/failed/reconciling only, never a forward-looking claim.
  v_raised := false;
  begin
    insert into public.publication_receipts (
      id, firm_id, period_id, deliverable_id, placement_id, destination,
      approved_version_id, published_at, actor_role, reconciles_receipt_id
    ) values (
      gen_random_uuid(), v_firm_id, v_period_a, v_deliverable_id, v_placement_a, 'firm_website',
      v_v1, now(), 'operator', v_receipt_v1
    );
  exception when others then
    v_raised := true;
    raise notice 'CHECK 22 PASS: unverified correction against a non-approved deliverable was refused: %', sqlerrm;
  end;
  if not v_raised then raise exception 'CHECK 22 FAIL: an unverified receipt with reconciles_receipt_id set was wrongly exempted from the current-approval gate'; end if;

  -- Check 23: a first-ever receipt (no reconciles_receipt_id) inserted
  -- directly as 'verified', against the still-in_review deliverable, must
  -- also stay on the strict path -- proves a row with no prior claim to be
  -- an opinion about is itself a fresh publish claim.
  v_raised := false;
  begin
    insert into public.publication_receipts (
      id, firm_id, period_id, deliverable_id, placement_id, destination,
      approved_version_id, published_at, actor_role,
      verification_state, verified_at, verification_method
    ) values (
      gen_random_uuid(), v_firm_id, v_period_a, v_deliverable_id, v_placement_a, 'firm_website',
      v_v1, now(), 'operator',
      'verified', now(), 'url_fetch'
    );
  exception when others then
    v_raised := true;
    raise notice 'CHECK 23 PASS: a pre-verified first-ever receipt with no reconciles_receipt_id was refused against a non-approved deliverable: %', sqlerrm;
  end;
  if not v_raised then raise exception 'CHECK 23 FAIL: a first-ever verified receipt with no reconciles_receipt_id was wrongly exempted'; end if;

  raise notice '=== ALL 4 POST-REVISION-FIX CHECKS PASSED (20-23; 19 is the pre-fix repro, not runnable against the fixed function) ===';
end;
$$;

rollback;
