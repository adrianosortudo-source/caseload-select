-- GHL Voice AI Public API token per firm.
--
-- Voice channel architecture amendment (2026-05-21, supersedes the
-- `{{transcript_generated.call_transcript}}` template variable approach
-- which GHL's own AI confirmed does not expose the verbatim transcript
-- to workflows). The post-call workflow now sends call_id to
-- /api/voice-intake; the endpoint fetches the verbatim transcript from
-- GHL's Voice AI Public API using this per-firm token:
--
--   GET https://services.leadconnectorhq.com/voice-ai/dashboard/call-logs/{callId}
--   Authorization: Bearer <voice_api_token>
--
-- Per-firm storage because each client firm has its own GHL sub-account
-- with its own Private Integration scoped to that location. A Vercel env
-- var doesn't scale beyond DRG.
--
-- Token semantics:
--
--   voice_api_token  — Private Integration Token (PIT) minted in the
--                      firm's GHL sub-account at Settings > Private
--                      Integrations. Scopes required:
--                        - voice-ai-dashboard.readonly
--                        - conversations.readonly
--                        - conversations/message.readonly
--                      Format: `pit-<uuid>`. Long-lived; rotated via
--                      direct DB UPDATE if revoked or regenerated.
--
-- SENSITIVITY: this is a SECRET. Treat the same as service-role keys:
--   - Never log the value
--   - Never expose via portal APIs (service-role read only)
--   - Rotate via direct DB UPDATE; no API endpoint to expose it
--   - Vercel env vars are NOT a substitute (multi-firm fan-out requires
--     per-firm storage)
--
-- Mirrors the pattern from 20260516_intake_firms_meta_access_tokens.sql
-- (facebook_page_access_token, whatsapp_cloud_api_access_token).

ALTER TABLE intake_firms
  ADD COLUMN IF NOT EXISTS voice_api_token text;

COMMENT ON COLUMN intake_firms.voice_api_token IS
  'GHL Voice AI Public API Private Integration Token (pit-*) scoped to voice-ai-dashboard.readonly + conversations.readonly + conversations/message.readonly. Used by /api/voice-intake to fetch verbatim call transcripts. SECRET. service-role read only.';

NOTIFY pgrst, 'reload schema';
