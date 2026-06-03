-- #128: alert when the screen engine's LLM extraction is disabled.
--
-- llmExtractServer returns mode='disabled' when GEMINI_API_KEY is missing or
-- invalid. In that state every brief silently degrades to regex-only
-- extraction (shallower briefs, missed fields, possible contact-gate failures)
-- with no signal to the operator. /api/voice-intake now emails the operator
-- when it observes mode='disabled', throttled per firm so a sustained outage
-- does not send one email per inbound call.
--
-- This column is the suppression timestamp, mirroring the existing
-- *_token_alert_sent_at convention from 20260526_intake_firms_token_expiry.sql.
-- Additive + nullable + IF NOT EXISTS: safe to run repeatedly.

ALTER TABLE public.intake_firms
  ADD COLUMN IF NOT EXISTS gemini_disabled_alert_sent_at timestamptz;

COMMENT ON COLUMN public.intake_firms.gemini_disabled_alert_sent_at IS
  'Suppression timestamp for the LLM-extraction-disabled operator alert (#128). Stamped when an operator email fires because llmExtractServer returned mode=disabled (GEMINI_API_KEY missing/invalid). The suppression window (see lib/llm-health-alert.ts) gates repeat sends; clears implicitly once the window passes. Mirrors the *_token_alert_sent_at token-expiry convention.';
