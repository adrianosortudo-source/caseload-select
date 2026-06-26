-- Fix get_cron_health() HTTP correlation (audit 2026-06-26, Phase 2).
--
-- The previous version joined net._http_response on `r.id = last_run.runid`.
-- That key is wrong: pg_net request ids and pg_cron run ids are unrelated
-- sequences, so the join matched coincidental rows (and found none for
-- low-frequency jobs whose response had aged out, since pg_net purges
-- net._http_response after a few hours). The result: the daily
-- token-expiry-check job showed a blank Last HTTP and a red dot every
-- afternoon while its cron run had actually succeeded.
--
-- This correlates the HTTP response by TIMESTAMP WINDOW instead (the first
-- response recorded within 120s of the run start). A null result now
-- legitimately means "no response on record", which the Health page treats
-- as unknown, not unhealthy. Health is authoritative on the cron run status
-- plus the 24h success ratio; the HTTP status is supplementary.
--
-- Idempotent: CREATE OR REPLACE, safe to re-run via `supabase db push`.

CREATE OR REPLACE FUNCTION public.get_cron_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron', 'net'
AS $function$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'jobid',                j.jobid,
      'jobname',              j.jobname,
      'schedule',             j.schedule,
      'active',               j.active,
      'command',              j.command,
      'last_run_start',       last_run.start_time,
      'last_run_end',         last_run.end_time,
      'last_run_status',      last_run.status,
      'last_run_message',     last_run.return_message,
      'last_run_runid',       last_run.runid,
      'last_http_status',     last_resp.status_code,
      'last_http_error',      last_resp.error_msg,
      'last_http_timed_out',  last_resp.timed_out,
      'last_http_created',    last_resp.created,
      'runs_24h',             COALESCE(stats.total_runs, 0),
      'succeeded_24h',        COALESCE(stats.succeeded_runs, 0),
      'failed_24h',           COALESCE(stats.failed_runs, 0)
    )
    ORDER BY j.jobid
  )
  INTO result
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT runid, start_time, end_time, status, return_message
    FROM cron.job_run_details d
    WHERE d.jobid = j.jobid
    ORDER BY d.start_time DESC NULLS LAST
    LIMIT 1
  ) last_run ON TRUE
  LEFT JOIN LATERAL (
    SELECT status_code, error_msg, timed_out, created
    FROM net._http_response r
    WHERE last_run.start_time IS NOT NULL
      AND r.created >= last_run.start_time
      AND r.created <= last_run.start_time + INTERVAL '120 seconds'
    ORDER BY r.created ASC
    LIMIT 1
  ) last_resp ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)                                       AS total_runs,
      COUNT(*) FILTER (WHERE status = 'succeeded')   AS succeeded_runs,
      COUNT(*) FILTER (WHERE status = 'failed')      AS failed_runs
    FROM cron.job_run_details d
    WHERE d.jobid = j.jobid
      AND d.start_time >= NOW() - INTERVAL '24 hours'
  ) stats ON TRUE;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$function$;
