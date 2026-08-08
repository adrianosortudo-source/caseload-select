-- J8 Milestone Assistant: quiet-file-nudge daily pg_cron schedule
--
-- Deferred piece of the J8 migration. The schema half (client_matters
-- columns + notification_outbox event_type extension) was applied to prod
-- 2026-07-02; see supabase/migrations/20260702180000_j8_client_matters_milestone_fields_schema.sql.
--
-- This piece is intentionally held back: the operator wants to confirm the
-- right matters get nudged before it starts firing daily and emailing
-- lawyers.
--
-- Pattern mirrors 20260522014741_s8p1_notification_batch_cron.sql. Daily
-- at 13:00 UTC (09:00 America/Toronto EDT / 08:00 EST; no DST adjustment,
-- matching the existing token-expiry-check job's fixed-UTC convention).
--
-- DO NOT apply to prod without operator approval.
--
-- Verify with the read-only preview query in the route docblock
-- (src/app/api/cron/quiet-file-nudge/route.ts), NOT by calling the route.
-- An earlier version of this header prescribed a manual GET of
-- /api/cron/quiet-file-nudge as the test; that is not a dry run. The route
-- inserts notification_outbox rows and stamps quiet_nudge_sent_at, and the
-- notification-batch-5m job drains that outbox into real Resend email
-- within 5 minutes, so the "test" would itself notify lawyers and consume
-- the suppression window.
--
-- Also note (2026-08-07): client_matters is empty, so this schedule would
-- currently be a daily no-op and there is no live matter to verify
-- against. Revisit when the portal carries its first active matter.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'quiet-file-nudge-daily') THEN
    PERFORM cron.unschedule('quiet-file-nudge-daily');
  END IF;

  PERFORM cron.schedule(
    'quiet-file-nudge-daily',
    '0 13 * * *',
    $cmd$ SELECT cron_internal.call_cron_route('/api/cron/quiet-file-nudge'); $cmd$
  );
END $$;
