-- Token-expiry monitoring on intake_firms.
--
-- Background: each firm carries up to three secret tokens used to send
-- outbound messages on Meta channels and read voice transcripts from GHL:
--   • facebook_page_access_token        — Messenger / Instagram Send API
--   • whatsapp_cloud_api_access_token   — WhatsApp Cloud API
--   • voice_api_token                   — GHL Voice AI Public API
-- Each of these can expire (Meta long-lived tokens last ~60 days unless
-- minted via System User; GHL Private Integration Tokens have no fixed
-- expiry but can be revoked).
--
-- Symptom in production (DRG, 2026-05-25): a Messenger inbound failed
-- the Send API call, the lead silently fell into unconfirmed_inquiries
-- with reason='no_contact_provided' and follow_up_attempts=0. The
-- operator had no surface to see *why* the send failed — possibly an
-- expired Page token, possibly something else. This migration adds the
-- columns the operator and the cron sweeper need to surface "token
-- expiring soon" and "token expired" states before they cause a silent
-- send failure.
--
-- Two columns per token:
--   *_token_expires_at      timestamptz, NULL = "not tracked / unknown"
--   *_token_alert_sent_at   timestamptz, NULL = "we have not yet emailed
--                           the operator about this token's status"
--
-- Idempotent. Safe to re-run.

ALTER TABLE intake_firms
  ADD COLUMN IF NOT EXISTS facebook_page_token_expires_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS facebook_page_token_alert_sent_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS whatsapp_cloud_token_expires_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS whatsapp_cloud_token_alert_sent_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voice_api_token_expires_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voice_api_token_alert_sent_at       TIMESTAMPTZ;

COMMENT ON COLUMN intake_firms.facebook_page_token_expires_at IS
  'Operator-set expiry for facebook_page_access_token. NULL = not tracked. Used by the token-expiry cron to alert the operator before a Send API call fails.';
COMMENT ON COLUMN intake_firms.facebook_page_token_alert_sent_at IS
  'Last time the token-expiry cron emailed the operator about this token. Used to suppress repeat alerts (1 per token-rotation cycle).';
COMMENT ON COLUMN intake_firms.whatsapp_cloud_token_expires_at IS
  'Operator-set expiry for whatsapp_cloud_api_access_token. NULL = not tracked.';
COMMENT ON COLUMN intake_firms.whatsapp_cloud_token_alert_sent_at IS
  'Last time the cron emailed about WhatsApp Cloud API token expiry.';
COMMENT ON COLUMN intake_firms.voice_api_token_expires_at IS
  'Operator-set expiry for voice_api_token. NULL = not tracked.';
COMMENT ON COLUMN intake_firms.voice_api_token_alert_sent_at IS
  'Last time the cron emailed about voice_api_token expiry.';

-- Partial index for the cron sweeper: only rows that have AT LEAST one
-- expires_at set are interesting to the daily scan. Keeps the index
-- small on a per-firm table that mostly never sets these columns.
CREATE INDEX IF NOT EXISTS idx_intake_firms_token_expiry_tracked
  ON intake_firms (id)
  WHERE
    facebook_page_token_expires_at IS NOT NULL
    OR whatsapp_cloud_token_expires_at IS NOT NULL
    OR voice_api_token_expires_at IS NOT NULL;
