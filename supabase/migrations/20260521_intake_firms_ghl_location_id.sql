-- GHL sub-account location id per firm.
--
-- The Voice AI Public API (call log list endpoint) requires
-- `locationId` as a query parameter. Each client firm has its own GHL
-- sub-account, so the location id must be stored per-firm rather than
-- as a global env var.
--
--   GET https://services.leadconnectorhq.com/voice-ai/dashboard/call-logs
--     ?locationId={ghl_location_id}
--     &contactId={ghl_contact_id}
--
-- This column is the partner of `voice_api_token` (migration
-- `20260521_intake_firms_voice_api_token.sql`). Both are needed for the
-- transcript fetch in `/api/voice-intake`.
--
-- Sensitivity: location ids are NOT secret — they appear in GHL
-- dashboard URLs and in webhook bodies — but they're still per-firm
-- configuration data, so they live on the firm row alongside the token
-- rather than in code or env. Format: 20-character base62 string
-- (e.g. `KwpSaMUehIN25dMG4WZB` for DRG Law).
--
-- Mirrors the storage pattern from
-- `20260521_intake_firms_voice_api_token.sql` and from the Meta asset id
-- columns (`facebook_page_id`, `instagram_business_account_id`,
-- `whatsapp_phone_number_id`).

ALTER TABLE intake_firms
  ADD COLUMN IF NOT EXISTS ghl_location_id text;

COMMENT ON COLUMN intake_firms.ghl_location_id IS
  'GHL sub-account location id (20-char base62). Required as a query param for the Voice AI Public API. Per-firm because each client firm has its own GHL sub-account. Not secret, but per-firm config.';

NOTIFY pgrst, 'reload schema';
