-- 20260727220613_intake_firms_ghl_contacts_write_token.sql
--
-- RECONSTRUCTED 2026-07-31 — this file did not previously exist. Read this
-- header before changing anything below.
--
-- This version is recorded in the production migration ledger
-- (supabase_migrations.schema_migrations) and its schema is live in
-- production, but no file for it existed in any commit, on any branch, in
-- this repository. That is the signature of DDL applied out-of-band — MCP
-- apply_migration or raw SQL — rather than through `supabase db push`.
--
-- The drift was not cosmetic: it blocked `supabase db push` outright, because
-- the CLI refuses to push while the remote ledger holds versions with no
-- corresponding local file ("Remote migration versions not found in local
-- migrations directory").
--
-- The CLI suggests resolving that with
--   supabase migration repair --status reverted 20260727220613 ...
-- DO NOT DO THAT. The schema is genuinely live; marking it reverted would
-- record a falsehood in the ledger, and the next push from any branch that
-- did carry these files would try to create objects that already exist.
-- Writing the missing file is the honest fix; that is what this is.
--
-- The SQL below was reconstructed by reading the live production catalogue on
-- 2026-07-31 (information_schema.columns, col_description) — not from memory,
-- not from any design document. It is idempotent, so it is a no-op against the
-- database that already has this column, and correct against a fresh database.
-- CI's real-Postgres job builds every migration against a fresh database on
-- every push, so a reconstruction error fails there rather than silently.

ALTER TABLE public.intake_firms
  ADD COLUMN IF NOT EXISTS ghl_contacts_write_token text;

COMMENT ON COLUMN public.intake_firms.ghl_contacts_write_token IS
  'GHL Private Integration Token (pit-*) scoped to contacts.readonly + contacts.write + locations/customFields.readonly + locations/tags.readonly + locations/tags.write. Used by the lead-magnet capture path (e.g. checklist downloads) to upsert/tag GHL contacts, separate from screened_leads matter intake. SECRET. service-role read only. Deliberately a separate token from voice_api_token (least privilege).';
