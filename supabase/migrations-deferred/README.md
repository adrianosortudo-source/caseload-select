# Deferred migration sources

These SQL files are preserved source artifacts, but are deliberately outside
`supabase/migrations/` and therefore are not executable by `supabase db push`.

## Why they are deferred

- `20260908134358_gta_prospect_owner_contact_research.sql`
- `20260908140907_gta_prospect_downtown_geography_observations.sql`

Neither version exists in the production Supabase migration ledger. They are
not prerequisites of the current GTA prospect operator-import migrations, and
the currently shipped operator-import surface does not depend on either schema.
Leaving them in the executable directory would cause a standard migration push
to widen an otherwise narrow importer release.

Do not move either file back into `supabase/migrations/` without a separate
reviewed migration plan, fresh-database replay, and explicit production
authorization. This directory is an evidence archive, not a migration queue.
