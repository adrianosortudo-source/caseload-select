-- Reconstructed 2026-07-27 from the production ledger's own statements column
-- (supabase_migrations.schema_migrations, version 20260518193933) by the
-- migration-lineage remediation. This row was classified "source on main,
-- lineage-mismatched" by the 2026-07-18 investigation (content-equivalent of
-- 20260506000003_pg_cron_pg_net_setup.sql); reconstructing it at its own
-- ledger version gives the row a 1:1 file so `db push` can reconcile.
-- Idempotent: both statements are CREATE EXTENSION IF NOT EXISTS.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
