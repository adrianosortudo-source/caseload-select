-- Auto-clear `*_token_alert_sent_at` when the matching
-- `*_token_expires_at` changes. The operator email body (from
-- `lib/token-expiry.ts:buildTokenAlertBody`) tells the operator that
-- updating expires_at clears the suppression window so the next cron
-- run alerts on the new lifecycle. The original migration shipped
-- columns but no trigger to honour that contract.
--
-- Codex pushback 2026-05-26: either add the trigger or change the
-- instruction. We add the trigger because it matches the operational
-- model — when the operator rotates a token, they update expires_at,
-- and the alert-sent state should reset so the next-cycle warnings
-- fire independently.
--
-- One trigger function handles all three tokens, fires BEFORE UPDATE,
-- and only clears the matching alert column when its own expires_at
-- actually changes (IS DISTINCT FROM handles NULL transitions safely).
--
-- Idempotent. Safe to re-run.

CREATE OR REPLACE FUNCTION clear_token_alert_on_expiry_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.facebook_page_token_expires_at IS DISTINCT FROM NEW.facebook_page_token_expires_at THEN
    NEW.facebook_page_token_alert_sent_at := NULL;
  END IF;
  IF OLD.whatsapp_cloud_token_expires_at IS DISTINCT FROM NEW.whatsapp_cloud_token_expires_at THEN
    NEW.whatsapp_cloud_token_alert_sent_at := NULL;
  END IF;
  IF OLD.voice_api_token_expires_at IS DISTINCT FROM NEW.voice_api_token_expires_at THEN
    NEW.voice_api_token_alert_sent_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION clear_token_alert_on_expiry_change() IS
  'When intake_firms.*_token_expires_at changes (operator rotated the token), clears the matching *_token_alert_sent_at column so the next /api/cron/token-expiry-check run alerts on the new lifecycle without the suppression window blocking it. Codex pushback 2026-05-26.';

DROP TRIGGER IF EXISTS trg_clear_token_alert ON intake_firms;
CREATE TRIGGER trg_clear_token_alert
  BEFORE UPDATE ON intake_firms
  FOR EACH ROW
  EXECUTE FUNCTION clear_token_alert_on_expiry_change();
