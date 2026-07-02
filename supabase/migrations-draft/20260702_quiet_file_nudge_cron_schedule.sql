-- J8 Milestone Assistant: quiet-file-nudge daily pg_cron schedule
--
-- Deferred piece of the J8 migration. The schema half (client_matters
-- columns + notification_outbox event_type extension) was applied to prod
-- 2026-07-02; see supabase/migrations/20260702180000_j8_client_matters_milestone_fields_schema.sql.
--
-- This piece is intentionally held back: the operator wants to run
-- /api/cron/quiet-file-nudge manually at least once and confirm the output
-- looks right before it starts firing daily and emailing lawyers.
--
-- Pattern mirrors 20260522014741_s8p1_notification_batch_cron.sql. Daily
-- at 13:00 UTC (09:00 America/Toronto EDT / 08:00 EST; no DST adjustment,
-- matching the existing token-expiry-check job's fixed-UTC convention).
--
-- DO NOT apply to prod without operator approval, after a manual test run
-- of GET /api/cron/quiet-file-nudge (Bearer CRON_SECRET or PG_CRON_TOKEN)
-- has confirmed the right matters get nudged.

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
