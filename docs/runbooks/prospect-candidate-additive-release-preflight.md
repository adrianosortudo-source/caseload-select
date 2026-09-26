# Prospect candidate additive release preflight

This document and its machine-readable receipt define a **review-only, read-only preflight**. They do not authorize production migration, data import, candidate linking, qualification changes, Admin cutover, or research-process cutover.

## Exact source scope

The receipt `scripts/prospect-enrichment/additive-release-review.json` binds the eleven release migrations by ordered version, path, name, byte count, and SHA-256: two qualification migrations, six prospect-enrichment migrations, two candidate-profile migrations, and the additive supplemental firm-profile-link RPC. The verifier rejects any changed, missing, reordered, duplicated, or extra migration source. The production writer accepts only the state where the first eight migrations are present as an exact verified prefix and the three remaining migrations are the exact pending suffix.

The operator-membership restoration migration `20260924180541_restore_operator_membership_rpc.sql` is a separately recorded applied prerequisite, never part of the pending apply set. The preflight requires exactly one matching ledger row and verifies all stored SQL statements against that migration's source. It also checks the production catalog invariants recorded in the receipt: `public.revalidate_operator_membership_v1(uuid,uuid,boolean)`, `plpgsql`, `SECURITY DEFINER`, empty `search_path`, the reviewed definition MD5, no `PUBLIC`/`anon`/`authenticated` execute grant, and `service_role` as the sole non-owner execute grantee.

For interrupted release recovery, the eleven release migrations may appear only as an exact ascending-version prefix in the ledger. The preflight derives the remaining suffix from that prefix and requires Supabase CLI's pending plan to equal it exactly, with no seeds or roles. It fails on an extra ledger row, missing or changed source statement, order gap, unexpected pending migration, or catalog mismatch.

## Running the read-only check

The workflow `.github/workflows/prospect-candidate-additive-preflight.yml` is manual, restricted to this repository's `main`, and uses the protected `Production prospect migrations` environment. Before any dispatch, configure the environment variable `PROSPECT_CANDIDATE_RELEASE_REVIEWED_SHA` to the exact reviewed `main` commit and provide the same full SHA as the dispatch input. The job checks out `main`, rechecks that it is still the remote tip, requires Supabase CLI 2.117.0, and uses only the explicit TLS-verified database URL. It reads the ledger and catalog, then runs only `supabase db push --dry-run`; no step can apply SQL.

The existing six-migration workflow and its allowlist remain unchanged. The additive receipt does not silently expand that gate.

## Separate candidate-profile release gate

The separate writer is `.github/workflows/prospect-candidate-additive-release.yml`. It is manually dispatchable only from this repository's `main`, uses the existing protected `Production prospect migrations` environment, and pins all third-party actions. The owner must configure both environment variables before dispatch:

- `PROSPECT_CANDIDATE_RELEASE_REVIEWED_SHA`: the exact reviewed 40-character `main` commit SHA.
- `PROSPECT_CANDIDATE_RELEASE_REVIEWED_RECEIPT_SHA256`: the SHA-256 of the complete committed bytes of `scripts/prospect-enrichment/additive-release-review.json`.

The dispatch must provide those same exact values. The writer checks that checkout, dispatch SHA, protected SHA and freshly fetched `origin/main` all agree. It also compares the supplied and protected receipt hashes to the receipt bytes in the checked-out source. It uses only the explicitly configured `CASELOAD_PRODUCTION_SUPABASE_MIGRATOR_DB_URL`, validated as the direct project endpoint with `sslmode=verify-full`; ambient database overrides and project `.env` files stop the run. Environment reviewer approval remains required for each dispatch. The `apply` operation additionally requires the exact confirmation `APPLY-PROSPECT-CANDIDATE-PROFILES-V1`.

Use this sequence after the applicable code has landed on `main` and its exact source and migration receipt have been reviewed:

1. Complete the separate qualification ledger process in `prospect-enrichment-production-migration.md`: read-only qualification catalog preflight, separately approved metadata-only repair, exact two-version ledger-delta read-back, then separately approved six-migration enrichment apply and its source-statement ledger read-back. The additive writer will refuse to proceed unless the candidate receipt's first eight versions are an exact applied prefix.
2. Run `prospect-candidate-additive-preflight.yml` from current `main` with the reviewed SHA. Confirm its artifact proves the receipt, prerequisite RPC catalog invariant, exact applied prefix and migration plan. This workflow is read-only.
3. Run `prospect-candidate-additive-release.yml` with operation `dry-run`, reviewed SHA and receipt hash. It reads the exact eleven migration ledger rows and operator-RPC catalog; only prefix length eight is accepted, and the pending CLI plan must equal exactly the two candidate-profile migrations plus the supplemental firm-profile-link RPC migration, with no seeds or roles. Review and retain the `prospect-candidate-additive-release-evidence` artifact.
4. After that artifact and the exact current source/receipt have been independently reviewed, separately dispatch the same workflow with operation `apply`, the same reviewed SHA and receipt hash, and confirmation `APPLY-PROSPECT-CANDIDATE-PROFILES-V1`. The protected environment approval is required again. Immediately before the single `supabase db push --yes`, the writer repeats the SHA/receipt, direct-URL, ledger, operator-RPC catalog and dry-run plan checks. It sets `apply_started` immediately before the write. If the write was started, post-apply verification always runs, even if the apply command reports an uncertain failure. It requires the exact eleven source-statement ledger rows, a complete eleven-migration prefix, and an empty final pending plan. The workflow never retries an apply.
5. Retain and review the post-apply artifacts. Then independently verify the deployed Admin read routes and candidate profile/search behavior with authenticated live read-back. Migration ledger success alone does not prove the Admin read path works or that research records are visible.

This writer applies schema migrations only. It does not import research, link candidates, change qualification, or switch the research process. Data intake and active cutover still require separate snapshot-scope approval, protected intake receipts, and candidate-level authenticated Admin read-back. Do not dispatch the writer before the applicable schema prerequisites are present and verified.
