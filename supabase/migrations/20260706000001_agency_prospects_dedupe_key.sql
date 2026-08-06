-- Codex audit 2026-07-06, finding 4 (Medium, confirmed live): the bulk
-- import route (src/lib/agency-prospect-import.ts) deduped against existing
-- rows via one unpaginated SELECT(firm_name, city), which only sees the first
-- page under PostgREST's default max-rows. Verified live before this
-- migration: agency_prospects has 5648 rows (well past the ~1000-row cap) and
-- zero duplicates by the (lower(firm_name), lower(city)) key, so a real
-- re-import today could already produce duplicates for any key outside the
-- first page, and no pre-clean delete is required here.
--
-- A generated column plus a real UNIQUE constraint (not a partial or
-- expression index) lets the import switch to a plain onConflict upsert,
-- which is the 42P10-safe shape supabase-js/PostgREST can actually infer.
--
-- APPLIED to prod 2026-07-06 via Supabase MCP (version 20260706040407).
-- Verified with a live INSERT / duplicate-INSERT-with-ON-CONFLICT / DELETE
-- probe (probe row removed) before the consuming code shipped.

BEGIN;

ALTER TABLE public.agency_prospects
  ADD COLUMN IF NOT EXISTS dedupe_key text
  GENERATED ALWAYS AS (lower(btrim(firm_name)) || '|' || lower(btrim(coalesce(city, '')))) STORED;

ALTER TABLE public.agency_prospects
  ADD CONSTRAINT uq_agency_prospects_dedupe_key UNIQUE (dedupe_key);

COMMIT;
