-- Migration: 20260512_intake_language_and_raw_transcript
--
-- Adds two columns to screened_leads to support the multilingual screen engine
-- (CRM Bible DR-036 / Multilingual Build).
--
-- intake_language: ISO 639-1 code of the language the lead used during intake
--   (e.g. 'en', 'fr', 'pt', 'zh', 'es', 'ar'). Populated for all new rows.
--   NULL on legacy rows inserted before this migration. English is stored
--   explicitly ('en') so no null-means-English ambiguity.
--
-- raw_transcript: The lead's original input text, preserved verbatim regardless
--   of intake language. For voice leads this is the call transcript. For web
--   leads writing in a non-English language this preserves the source text for
--   LSO compliance and audit reference. The triage portal never renders this
--   field; it is an operator/compliance surface only.
--
-- Both columns are nullable. Existing rows pre-multilingual build remain NULL;
-- no backfill is attempted (historical data predates language tracking and the
-- brief HTML for those rows is already rendered in English).

ALTER TABLE screened_leads
  ADD COLUMN IF NOT EXISTS intake_language TEXT,
  ADD COLUMN IF NOT EXISTS raw_transcript  TEXT;

COMMENT ON COLUMN screened_leads.intake_language IS
  'ISO 639-1 language code of the lead''s intake (e.g. en, fr, pt, zh, es, ar). '
  'NULL on legacy rows predating the multilingual build. Always stored explicitly; '
  'null is not treated as English.';

COMMENT ON COLUMN screened_leads.raw_transcript IS
  'Raw original-language input preserved for LSO compliance and audit reference. '
  'For voice channel: the full call transcript. For web/other channels: the lead''s '
  'initial description when intake_language differs from English. '
  'Never rendered in the lawyer triage portal.';
