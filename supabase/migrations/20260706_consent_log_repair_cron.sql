-- Schedules the consent_log repair sweep (H5/DR-075 follow-up) via
-- Supabase pg_cron + pg_net, reusing the cron_internal.call_cron_route(path)
-- helper defined alongside the other pg_cron jobs in this project
-- (triage-backstop-hourly, webhook-retry-5m, notification-batch-5m,
-- token-expiry-check-daily, deadline-reminder-hourly,
-- expire-web-intake-sessions-hourly, expire-channel-intake-sessions-hourly).
--
-- Existing schedules verified LIVE against cron.job on prod (not just grepped
-- from migration files — a grep-only pass initially missed
-- expire-channel-intake-sessions-hourly, which isn't captured in any
-- migration this repo tracks, and would have collided with the first
-- proposed slot):
--   token-expiry-check-daily              41 6 * * *   (06:41 daily)
--   deadline-reminder-hourly               37 * * * *   (:37 hourly)
--   expire-channel-intake-sessions-hourly  23 * * * *   (:23 hourly)
--   expire-web-intake-sessions-hourly      17 * * * *   (:17 hourly)
--   triage-backstop-hourly                  7 * * * *   (:07 hourly)
--   webhook-retry-5m                      */5 * * * *
--   notification-batch-5m                 */5 * * * *
--
-- consent-log-repair-daily runs once a day at 05:52 UTC: minute 52 is not
-- used by any hourly job (7/17/23/37) and is not a multiple of 5, so it
-- cannot collide with any existing job regardless of hour; 05:52 also
-- differs from the one other daily job's 06:41 slot.
--
-- Idempotent: unschedule-then-reschedule by job name inside a DO block,
-- matching the pattern used by the reconstructed
-- 20260522014741_s8p1_notification_batch_cron.sql migration in this repo,
-- so re-running this file is a safe no-op.
--
-- APPLIED to prod 2026-07-06 via Supabase MCP, verified live in cron.job.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'consent-log-repair-daily') THEN
    PERFORM cron.unschedule('consent-log-repair-daily');
  END IF;

  PERFORM cron.schedule(
    'consent-log-repair-daily',
    '52 5 * * *',
    $cmd$ SELECT cron_internal.call_cron_route('/api/cron/consent-log-repair'); $cmd$
  );
END $$;
