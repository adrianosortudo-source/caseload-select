---
doc-type: migration-lineage rehearsal
scope: gta-prospect-operator-import
date: 2026-09-11
status: rehearsal-only
production-change: none
---

# GTA prospect importer migration-lineage rehearsal

## Purpose

Restore a deterministic, narrow `supabase db push --dry-run` plan before any
production importer schema change. This PR itself does not apply a migration,
alter a database, import a prospect, create a contact, or initiate outreach.

## Reconciliation performed in source control

1. The production ledger records the already-applied archive-sync SQL under
   version `20260911215333`. Its source file previously used
   `20260910161644`, so the file is renamed to match the production ledger.
   The SQL content is unchanged.
2. The never-applied owner-contact experiment
   `20260908134358_gta_prospect_owner_contact_research.sql` remains in
   `supabase/migrations-deferred/`. Its SQL is retained verbatim with an
   explicit deferral record: no executable importer or supplemental-evidence
   migration depends on its table or RPC.
3. `20260908140907_gta_prospect_downtown_geography_observations.sql` remains
   an active migration. The supplemental-evidence migration added after this
   rehearsal extends and writes to that geography ledger, so deferring it
   would make a fresh migration replay fail.

## Required pre-apply rehearsal

From clean `origin/main` after this PR has merged, run the approved migration
tool in dry-run mode against project `ssxryjxifwiivghglqer`.

The only pending versions may be:
`supabase db push --dry-run --include-all --linked`

`--include-all` is required only because the intended importer versions precede an already-applied archive migration.

- `20260911195806_gta_prospect_operator_import_apply.sql`
- `20260911205207_gta_prospect_operator_import_history.sql`

Stop if the plan contains any other version, reports a version mismatch, or
cannot be generated. Do not substitute raw SQL, MCP apply-migration calls, or
ledger repair commands.

## Post-apply checks

After a future, separately authorized normal migration push, run only
read-only checks:

1. Confirm both versions appear in the production migration ledger.
2. Confirm the two operator RPCs exist and remain service-role-only.
3. Confirm the audit-action constraint includes `updated`.
4. Confirm existing aggregate counts have not changed.

