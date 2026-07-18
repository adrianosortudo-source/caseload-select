-- Meta channel Send API access tokens on intake_firms.
--
-- Contact-capture doctrine Phase B (2026-05-15): the receiver needs to
-- send follow-up messages back to the lead asking for contact info.
-- That requires channel-specific tokens.
--
-- Token semantics:
--
--   facebook_page_access_token       — Page access token from the Meta
--                                      dev console (Messenger API
--                                      Settings page, generate per Page).
--                                      Used for BOTH Messenger Send AND
--                                      Instagram Send because IG
--                                      inherits the linked Page's token.
--                                      Long-lived (Page tokens do not
--                                      expire when generated from a
--                                      long-lived user token).
--
--   whatsapp_cloud_api_access_token  — WhatsApp Cloud API access token
--                                      from the WhatsApp API Setup page.
--                                      Permanent system-user tokens
--                                      preferred; temporary user tokens
--                                      work for testing.
--
-- SENSITIVITY: these are SECRETS. Treat the same as service-role keys:
--   - Never log the values
--   - Never expose via portal APIs (service-role read only)
--   - Rotate via direct DB UPDATE; no API endpoint
--   - Vercel env vars are NOT a substitute (multi-firm fan-out requires
--     per-firm storage)
--
-- Future rotation/refresh logic is a separate operational task. Tokens
-- stored here are assumed valid; if they expire, send_api calls will
-- 401 and we'll surface that via logs.

ALTER TABLE intake_firms
  ADD COLUMN IF NOT EXISTS facebook_page_access_token text,
  ADD COLUMN IF NOT EXISTS whatsapp_cloud_api_access_token text;

COMMENT ON COLUMN intake_firms.facebook_page_access_token IS
  'Page access token from Meta dev console. Used by Messenger Send + Instagram Send (IG inherits Page token). SECRET. service-role read only.';

COMMENT ON COLUMN intake_firms.whatsapp_cloud_api_access_token IS
  'WhatsApp Cloud API access token. SECRET. service-role read only.';

NOTIFY pgrst, 'reload schema';
