# Prospect candidate additive release preflight

This document and its machine-readable receipt define a **review-only, read-only preflight**. They do not authorize production migration, data import, candidate linking, qualification changes, Admin cutover, or research-process cutover.

## Exact source scope

The receipt `scripts/prospect-enrichment/additive-release-review.json` binds the ten currently absent migrations by ordered version, path, name, byte count, and SHA-256: two qualification migrations, six prospect-enrichment migrations, and the two candidate-profile migrations. The verifier rejects any changed, missing, reordered, duplicated, or extra migration source.

The operator-membership restoration migration `20260924180541_restore_operator_membership_rpc.sql` is a separately recorded applied prerequisite, never part of the pending apply set. The preflight requires exactly one matching ledger row and verifies all stored SQL statements against that migration's source. It also checks the production catalog invariants recorded in the receipt: `public.revalidate_operator_membership_v1(uuid,uuid,boolean)`, `plpgsql`, `SECURITY DEFINER`, empty `search_path`, the reviewed definition MD5, no `PUBLIC`/`anon`/`authenticated` execute grant, and `service_role` as the sole non-owner execute grantee.

For interrupted release recovery, the ten release migrations may appear only as an exact ascending-version prefix in the ledger. The preflight derives the remaining suffix from that prefix and requires Supabase CLI's pending plan to equal it exactly, with no seeds or roles. It fails on an extra ledger row, missing or changed source statement, order gap, unexpected pending migration, or catalog mismatch.

## Running the read-only check

The workflow `.github/workflows/prospect-candidate-additive-preflight.yml` is manual, restricted to this repository's `main`, and uses the protected `Production prospect migrations` environment. Before any dispatch, configure the environment variable `PROSPECT_CANDIDATE_RELEASE_REVIEWED_SHA` to the exact reviewed `main` commit and provide the same full SHA as the dispatch input. The job checks out `main`, rechecks that it is still the remote tip, requires Supabase CLI 2.117.0, and uses only the explicit TLS-verified database URL. It reads the ledger and catalog, then runs only `supabase db push --dry-run`; no step can apply SQL.

The existing six-migration workflow and its allowlist remain unchanged. The additive receipt does not silently expand that gate.

## Separate future release authorization

This preflight is not a production release workflow. Production application requires a separately authorized and independently reviewed exact release contract and workflow on `main`, binding the complete receipt hash and exact reviewed source SHA, a typed confirmation, protected environment approval, exact direct TLS database URL, fresh ledger/catalog/plan checks immediately before writes, exact post-apply source-statement ledger read-back, and an empty pending plan. Do not add or dispatch a production write path under this preflight authorization. Such authorization would still not approve research-data import or cutover; those require separate snapshot-scope approval, protected intake receipts, and candidate-level authenticated Admin read-back.
