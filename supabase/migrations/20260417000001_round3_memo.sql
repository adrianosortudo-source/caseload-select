-- S10: Round 3 post-capture deep qualification + Case Intake Memo
-- Adds round3 answer storage and memo generation columns to intake_sessions.

ALTER TABLE intake_sessions
  ADD COLUMN IF NOT EXISTS round3_answers       jsonb,
  ADD COLUMN IF NOT EXISTS round3_started_at    timestamptz,
  ADD COLUMN IF NOT EXISTS round3_completed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS memo_text            text,
  ADD COLUMN IF NOT EXISTS memo_generated_at    timestamptz;

-- Index for portal queries: find sessions with memos ready for a firm
CREATE INDEX IF NOT EXISTS idx_intake_sessions_memo
  ON intake_sessions (firm_id, memo_generated_at)
  WHERE memo_generated_at IS NOT NULL;

-- Index for stalled-round3 cron: find sessions started but not completed
CREATE INDEX IF NOT EXISTS idx_intake_sessions_round3_stalled
  ON intake_sessions (round3_started_at)
  WHERE round3_started_at IS NOT NULL AND round3_completed_at IS NULL;
