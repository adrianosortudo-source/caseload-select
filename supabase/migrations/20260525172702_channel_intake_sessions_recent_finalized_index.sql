-- Channel intake sessions: partial index for recent-finalized lookups
-- Codex review 2026-05-25 follow-up.
--
-- loadRecentFinalizedSession (in lib/channel-intake-session-store.ts)
-- queries finalized sessions ordered by recency. The base table has
-- partial indexes for OPEN sessions (the multi-turn resume path) and
-- for expiry sweeping, but no index covered this lookup until now —
-- so the post-finalization secretary-mode hook (channel-intake-
-- processor's "is this a returning lead asking a follow-up?" branch)
-- would degrade to a seq scan as channel_intake_sessions grows.
--
-- Recency clock is last_activity_at, not created_at. finalizeChannelSession
-- bumps last_activity_at to NOW() when flipping finalized=true, so for
-- a finalized session, last_activity_at IS effectively "finalized at"
-- (we don't yet have a dedicated finalized_at column; if we add one
-- later, the index target can move).

CREATE INDEX IF NOT EXISTS idx_channel_intake_sessions_recent_finalized
  ON channel_intake_sessions (firm_id, channel, sender_id, last_activity_at DESC)
  WHERE finalized = true;
