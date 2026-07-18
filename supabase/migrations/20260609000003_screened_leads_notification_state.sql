-- =============================================================================
-- screened_leads: new-lead notification delivery state (DR-046 application)
-- =============================================================================
-- Adds four columns to `screened_leads` so the new-lead lawyer notification
-- email is no longer fire-and-forget. Each row now carries its delivery state:
--
--   notification_sent_at         : when the lawyer email actually delivered
--                                  (at least one recipient accepted by Resend).
--                                  NULL until the first successful send.
--   notification_error           : error string from the most recent failed
--                                  attempt (Resend / runtime / config). On a
--                                  partially successful fan-out the per-
--                                  recipient failures are kept here alongside
--                                  notification_sent_at.
--   notification_attempts        : count of send attempts made on this row.
--   notification_last_attempt_at : when we last tried, success or fail.
--
-- Why (launch audit fix H4, 2026-06-09):
-- notifyLawyersOfNewLead returned a NotifyResult whose errors every caller
-- discarded with .catch(console.error). Nothing recorded whether the email
-- went out, sendEmail silently no-opped when RESEND_API_KEY was unset, and
-- there was no retry and no operator visibility. DR-046 (CRM Bible) defines
-- the four reliability invariants (persistent delivery state, no silent
-- error swallowing, manual retry endpoint, admin UI visibility) and says
-- they apply to web, voice, and channel intake. Firm onboarding already
-- implements them (migration 20260520_firm_onboarding_notification_tracking
-- plus firm-onboarding-notification.ts); this migration brings the new-lead
-- notification path to the same standard.
--
-- After this migration:
--   * lead-notify.ts persists every attempt to these columns. Success stamps
--     notification_sent_at; failure (including the RESEND_API_KEY-missing
--     skip) records an explicit notification_error.
--   * The operator cross-firm queue at /admin/triage surfaces a
--     Sent / Failed / Pending chip per row from these columns.
--   * A new operator-only endpoint at
--     POST /api/admin/screened-leads/[id]/retry-notification
--     replays the email with a [REPLAY] subject prefix and updates the
--     same columns.
--
-- Idempotent. Column-add only. Existing rows get NULL on the timestamp
-- columns and 0 on attempts, which the queue renders as Pending (those
-- historical emails mostly delivered; the state was simply never recorded).

ALTER TABLE public.screened_leads
  ADD COLUMN IF NOT EXISTS notification_sent_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notification_error           TEXT,
  ADD COLUMN IF NOT EXISTS notification_attempts        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notification_last_attempt_at TIMESTAMPTZ;

COMMENT ON COLUMN public.screened_leads.notification_sent_at IS
  'Timestamp of the most recent successful new-lead lawyer notification send (at least one recipient delivered). NULL means no successful send yet.';
COMMENT ON COLUMN public.screened_leads.notification_error IS
  'Error message from the most recent failed send attempt (or per-recipient failures on a partial fan-out). Cleared to NULL on the next fully successful send.';
COMMENT ON COLUMN public.screened_leads.notification_attempts IS
  'Total number of new-lead notification email attempts for this row (success + fail).';
COMMENT ON COLUMN public.screened_leads.notification_last_attempt_at IS
  'Timestamp of the most recent attempt, success or fail. Used by the admin queue to age Pending rows.';

-- Partial index so the operator queue can cheaply query "leads still waiting
-- for a successful notification". Most rows will be sent, so the failed and
-- pending set stays small even at scale.
CREATE INDEX IF NOT EXISTS screened_leads_notification_pending_idx
  ON public.screened_leads (submitted_at DESC)
  WHERE notification_sent_at IS NULL;
