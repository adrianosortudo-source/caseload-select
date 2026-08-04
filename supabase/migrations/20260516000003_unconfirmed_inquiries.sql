-- Contact-capture doctrine (adopted 2026-05-15).
--
-- "No contact, no lead. A lead the lawyer can't reach is information,
-- not a lead." A Family Law smoke test on 2026-05-15 produced a brief
-- with zero contact fields populated; the lawyer received it but had no
-- way to reach the person. That state must never recur.
--
-- An inbound intake that fails the contact gate (missing name, or
-- missing both email AND phone) is NOT a lead. It is an "unconfirmed
-- inquiry": persisted here for ops visibility, but NEVER surfaced to
-- the lawyer's triage portal. The gate is applied at every channel
-- (web, Messenger, Instagram DM, WhatsApp, voice). Voice auto-passes
-- via caller ID phone seeding.
--
-- Reasons (`reason` column):
--   no_contact_provided  - single-shot channel ran the engine, gate
--                          failed, no multi-turn capability wired (or
--                          this row is the result of a finalised
--                          attempt that still lacked contact)
--   abandoned            - multi-turn session expired before contact
--                          was captured (cron expire-channel-intake-sessions)
--   engine_refused       - max follow-up turns exhausted without contact
--
-- Service-role only, same posture as screened_leads. The portal has no
-- view of this table by design.

CREATE TABLE IF NOT EXISTS unconfirmed_inquiries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id            uuid REFERENCES intake_firms(id) ON DELETE CASCADE,
  channel            text NOT NULL,
  sender_id          text,
  sender_meta        jsonb,
  raw_transcript     text,
  matter_type        text,
  practice_area      text,
  intake_language    text,
  reason             text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  follow_up_attempts int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_unconfirmed_inquiries_firm_created
  ON unconfirmed_inquiries (firm_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_unconfirmed_inquiries_reason
  ON unconfirmed_inquiries (reason);

-- RLS: service-role only, same as screened_leads. No policies defined;
-- only the service role can read or write. The lawyer portal has no
-- access path to this table.
ALTER TABLE unconfirmed_inquiries ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE unconfirmed_inquiries IS
  'Inbound intakes that failed the contact-capture doctrine gate (adopted 2026-05-15). NEVER surfaced in the triage portal. Ops visibility only.';

COMMENT ON COLUMN unconfirmed_inquiries.channel IS
  'web | facebook | instagram | whatsapp | voice — matches EngineState.channel';

COMMENT ON COLUMN unconfirmed_inquiries.sender_id IS
  'Channel-specific sender identifier: PSID (Messenger), IGSID (Instagram), wa_id (WhatsApp), caller phone (voice), null (web)';

COMMENT ON COLUMN unconfirmed_inquiries.sender_meta IS
  'Channel-specific metadata: page_id, ig_business_account_id, phone_number_id, call_id, utm params for web';

COMMENT ON COLUMN unconfirmed_inquiries.reason IS
  'no_contact_provided | abandoned | engine_refused';

NOTIFY pgrst, 'reload schema';
