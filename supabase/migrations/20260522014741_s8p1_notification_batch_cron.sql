-- =============================================================================
-- S8 Phase 1 · pg_cron schedule for /api/cron/notification-batch
-- =============================================================================
-- Schedules the 5-minute notification batch drain via the existing
-- cron_internal.call_cron_route helper (defined in 20260506_pg_cron_pg_net_setup.sql).
--
-- Pattern matches the other two crons:
--   triage-backstop-hourly  -  '7 * * * *'
--   webhook-retry-5m        -  '*/5 * * * *'
--   notification-batch-5m   -  '*/5 * * * *' (this migration)
--
-- Auth: the cron route accepts CRON_SECRET or PG_CRON_TOKEN via Bearer.
-- =============================================================================

DO $$
BEGIN
  -- Drop any existing schedule with the same name (idempotent re-runs).
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'notification-batch-5m'
  ) THEN
    PERFORM cron.unschedule('notification-batch-5m');
  END IF;

  PERFORM cron.schedule(
    'notification-batch-5m',
    '*/5 * * * *',
    $cmd$ SELECT cron_internal.call_cron_route('/api/cron/notification-batch'); $cmd$
  );
END $$;

COMMENT ON EXTENSION pg_cron IS
  'pg_cron schedules: triage-backstop-hourly, webhook-retry-5m, notification-batch-5m.';
