-- intake_sessions.practice_sub_type
--
-- Adds the missing practice_sub_type column. The column is referenced
-- throughout the codebase (classifier, screen-prompt, slot-registry,
-- sub-type-detect, /api/screen route) and is documented in schema.sql
-- at line 229, but was never created by a migration.
--
-- Impact of the missing column: every write to intake_sessions that
-- includes practice_sub_type fails atomically with PGRST204, silently
-- dropping conversation, scoring, practice_area, and every other field
-- in the same UPDATE. This causes total session-state loss across turns
-- in widget / multi-turn flows: isFirstTurn is always true, situationText
-- collapses to the current-turn message, and every redundancy-trap filter
-- stops working after round 1.
--
-- Idempotent: uses IF NOT EXISTS so safe to re-run.

ALTER TABLE intake_sessions
  ADD COLUMN IF NOT EXISTS practice_sub_type text;

COMMENT ON COLUMN intake_sessions.practice_sub_type IS
  'Matched sub-type key (e.g. "pi_mva", "emp_dismissal"). Used by slot-registry, question-set routing, and final matter routing.';

-- Index for analytics / per-sub-type session queries.
CREATE INDEX IF NOT EXISTS idx_intake_sessions_sub_type
  ON intake_sessions (firm_id, practice_sub_type)
  WHERE practice_sub_type IS NOT NULL;
