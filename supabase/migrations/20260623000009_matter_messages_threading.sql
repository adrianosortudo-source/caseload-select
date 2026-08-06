-- S10 Phase 1 messaging upgrade: threaded replies
--
-- Adds parent_message_id to matter_messages so a reply can reference
-- its parent. One level of threading only (replies are flat children of
-- a root message; the UI enforces this by not allowing a reply-to-reply).
--
-- ON DELETE SET NULL means a deleted root message orphans its replies
-- (they remain visible with parent_message_id = null). Acceptable for
-- Phase 1 — deleted messages are not a current use-case.

ALTER TABLE matter_messages
  ADD COLUMN IF NOT EXISTS parent_message_id uuid
    REFERENCES matter_messages(id) ON DELETE SET NULL;

-- Fast lookup of replies for a given set of root messages.
CREATE INDEX IF NOT EXISTS idx_matter_messages_parent
  ON matter_messages(matter_id, parent_message_id)
  WHERE parent_message_id IS NOT NULL;
