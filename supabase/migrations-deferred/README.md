# Deferred migration sources

These SQL files are preserved source artifacts, but are deliberately outside
`supabase/migrations/` and therefore are not executable by `supabase db push`.

## Why they are deferred

- `20260908134358_gta_prospect_owner_contact_research.sql`

This version is not in the production Supabase migration ledger. No executable
GTA prospect operator-import or supplemental-evidence migration references its
table or RPC, so it is not a fresh-replay prerequisite. Leaving it in the
executable directory would widen an otherwise narrow importer release.

Do not move it back into `supabase/migrations/` without a separate reviewed
migration plan, fresh-database replay, and explicit production authorization.
This directory is an evidence archive, not a migration queue.
