-- Deadline-reminder delivery state (Screen qualification audit F1, 2026-07-02).
-- The T-12h reminder email tells the firm's lawyers a triaging lead's
-- decision window is closing before the backstop fires decline-with-grace.
-- One reminder per lead, stamped here; NULL means not yet sent.
-- Additive and guarded: readers treat a missing column as "no reminder".

ALTER TABLE screened_leads
  ADD COLUMN IF NOT EXISTS deadline_reminder_sent_at timestamptz;

-- Sweep support: the cron selects triaging rows with no reminder whose
-- deadline is inside the reminder window. Partial index keeps it cheap.
CREATE INDEX IF NOT EXISTS idx_screened_leads_deadline_reminder
  ON screened_leads (decision_deadline)
  WHERE status = 'triaging' AND deadline_reminder_sent_at IS NULL;
