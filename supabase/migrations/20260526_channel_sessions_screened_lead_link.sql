-- Distinguish finalized-successful from finalized-abandoned sessions.
--
-- Background: `channel_intake_sessions.finalized = true` was originally
-- set only when an intake completed and a screened_lead row was created.
-- The post-finalization secretary mode (DR-104, task #104) relies on
-- that semantics: "this sender is a returning lead with a real brief on
-- record, reply like a secretary acknowledging the existing matter."
--
-- Task #92's exhaustion graceful-close (2026-05-26) broke that
-- invariant. When contact-capture exhausts MAX_FOLLOW_UPS the processor
-- now ALSO calls finalizeChannelSession, but no screened_lead exists —
-- the row went to unconfirmed_inquiries. A subsequent inbound from the
-- same sender hits the secretary mode and is told "a lawyer is
-- reviewing your matter" when in fact no lead was ever screened.
--
-- Fix: add a NULL-able FK to screened_leads. Successful intakes set it
-- to the inserted screened_lead. Abandoned / send-failure / engine-
-- refused finalizations leave it NULL. The loadRecentFinalizedSession
-- query filters on `screened_lead_id IS NOT NULL` to gate the
-- secretary mode.
--
-- Codex code review pushback, 2026-05-26.

ALTER TABLE channel_intake_sessions
  ADD COLUMN IF NOT EXISTS screened_lead_id UUID
    REFERENCES screened_leads(id) ON DELETE SET NULL;

COMMENT ON COLUMN channel_intake_sessions.screened_lead_id IS
  'Set to the screened_leads.id when finalization corresponds to a successful brief insert. NULL when the session finalized because contact-capture exhausted, the Send API failed, or the cron sweep marked it abandoned. The post-finalization secretary mode treats NULL as "no real brief on file" and does NOT trigger the secretary reply.';

-- Partial index for the secretary-mode lookup: only finalized sessions
-- with a real screened_lead_id are interesting. Replaces the broader
-- idx_channel_intake_sessions_recent_finalized index for the post-
-- finalization-followup query path. The old index stays — other code
-- still uses it for the cron sweep — but the secretary-mode query now
-- has a tighter index.
CREATE INDEX IF NOT EXISTS idx_channel_intake_sessions_screened_finalized
  ON channel_intake_sessions (firm_id, channel, sender_id, last_activity_at DESC)
  WHERE finalized = true AND screened_lead_id IS NOT NULL;
