-- =============================================================================
-- Firm onboarding intake — notification tracking
-- =============================================================================
-- Adds four columns to `firm_onboarding_intake` so the operator notification
-- email is no longer fire-and-forget. Each row now carries its delivery state:
--
--   notification_sent_at         — when the operator email actually delivered
--                                  (Resend returned a message id). NULL until
--                                  the first successful send.
--   notification_error           — Resend / runtime error string from the most
--                                  recent failed attempt. Cleared on success.
--   notification_attempts        — count of send attempts made on this row.
--   notification_last_attempt_at — when we last tried, success or fail.
--
-- Why:
-- A DRG Law submission on 2026-05-15 landed in the database fine but never
-- produced an operator notification email. The submit route swallowed any
-- send error in a try/catch and returned success to the form, so the only
-- trace was a console.error line in Vercel's short-retention log stream
-- (gone by the time we noticed). Future submissions need a persistent
-- record of delivery state and a retry path the operator can drive from
-- the admin UI.
--
-- After this migration:
--   * The submit route logs every attempt to these columns. Success clears
--     notification_error and stamps notification_sent_at.
--   * The admin list and detail pages surface "Sent" / "Failed" / "Pending"
--     badges from these columns.
--   * A new operator-only endpoint at
--     POST /api/admin/onboarding-submissions/[id]/retry-notification
--     replays the email and updates the same columns.
--
-- Idempotent. Column-add only. Existing rows get NULL on the timestamp
-- columns and 0 on attempts, which the UI renders as "Pending — never
-- attempted". The DRG row will read "Pending" until the next time we run
-- a backfill or hit the retry endpoint manually.

ALTER TABLE public.firm_onboarding_intake
  ADD COLUMN IF NOT EXISTS notification_sent_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notification_error           TEXT,
  ADD COLUMN IF NOT EXISTS notification_attempts        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notification_last_attempt_at TIMESTAMPTZ;

COMMENT ON COLUMN public.firm_onboarding_intake.notification_sent_at IS
  'Timestamp of the most recent successful operator-notification email send. NULL means no successful send yet. Cleared only if we deliberately reset to retry (we do not).';
COMMENT ON COLUMN public.firm_onboarding_intake.notification_error IS
  'Error message from the most recent failed send attempt. Cleared to NULL on the next successful send.';
COMMENT ON COLUMN public.firm_onboarding_intake.notification_attempts IS
  'Total number of operator-notification email attempts for this row (success + fail).';
COMMENT ON COLUMN public.firm_onboarding_intake.notification_last_attempt_at IS
  'Timestamp of the most recent attempt, success or fail. Used by the admin list to age "Pending" rows.';

-- Partial index so the admin list can cheaply query "submissions still
-- waiting for a successful notification". Most rows will be sent, so the
-- failed/pending set stays small even at scale.
CREATE INDEX IF NOT EXISTS firm_onboarding_intake_notification_pending_idx
  ON public.firm_onboarding_intake (submitted_at DESC)
  WHERE notification_sent_at IS NULL;
