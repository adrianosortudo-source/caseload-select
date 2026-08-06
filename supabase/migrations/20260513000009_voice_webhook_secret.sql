-- Per-firm shared secret for HMAC verification of GHL Voice AI webhooks.
--
-- Closes Codex audit HIGH #7. Previously /api/voice-intake accepted any
-- POST that included a valid firm UUID (a non-secret value visible in
-- widget embeds), so anyone could forge a voice lead. With this column
-- populated and VOICE_HMAC_REQUIRED=true in Vercel, voice-intake will
-- compute HMAC-SHA256(rawBody, secret) and compare against the
-- X-Signature-256 header GHL sends, rejecting 401 on mismatch.
--
-- Rollout discipline (do this per firm, not globally):
--   1. Generate a high-entropy secret (32+ bytes base64) per firm.
--   2. Store it in intake_firms.voice_webhook_secret via the operator console.
--   3. Configure the same secret in the firm's GHL sub-account voice webhook
--      header field.
--   4. After confirming a test call lands cleanly, set
--      VOICE_HMAC_REQUIRED=true in Vercel Production to enforce platform-wide.
--   5. Until step 4, signatures are verified when the column AND header are
--      both present but never rejected — this lets ops dry-run the wiring
--      without breaking the existing voice intake path.

ALTER TABLE intake_firms
  ADD COLUMN IF NOT EXISTS voice_webhook_secret TEXT;

COMMENT ON COLUMN intake_firms.voice_webhook_secret IS
  'High-entropy shared secret for HMAC-SHA256 verification of GHL Voice AI webhooks. NULL means signature verification is bypassed for this firm (rollout phase only). Operator-only column; never expose to clients. Codex audit HIGH #7.';
