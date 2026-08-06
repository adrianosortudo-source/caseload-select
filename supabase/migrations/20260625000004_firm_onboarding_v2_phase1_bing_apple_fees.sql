-- Onboarding form v2, Phase 1: Bing Places + Apple Business Connect access
-- tracking, and the Services + Fees capture section (upload + free-text +
-- structured cheatsheet). New nullable columns on firm_onboarding_intake.
-- Old submissions render these as empty. No RLS change: columns inherit the
-- table's existing service-role-only posture. Idempotent.
--
-- Per onboarding form v2 spec; Phase 1 narrow path. DRG pilot surfaced the gaps.

ALTER TABLE firm_onboarding_intake
  ADD COLUMN IF NOT EXISTS bing_places_status       text,
  ADD COLUMN IF NOT EXISTS bing_places_notes        text,
  ADD COLUMN IF NOT EXISTS apple_business_status    text,
  ADD COLUMN IF NOT EXISTS apple_business_notes     text,
  ADD COLUMN IF NOT EXISTS fees_upload_storage_path text,
  ADD COLUMN IF NOT EXISTS fees_upload_original_name text,
  ADD COLUMN IF NOT EXISTS fees_upload_size_bytes   bigint,
  ADD COLUMN IF NOT EXISTS fees_upload_mime_type    text,
  ADD COLUMN IF NOT EXISTS fees_freetext            text,
  ADD COLUMN IF NOT EXISTS fees_structured          jsonb;
