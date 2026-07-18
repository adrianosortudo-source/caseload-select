-- Cron + pg_net health RPC for the operator console.
--
-- Exposes a single SECURITY DEFINER function that joins cron.job +
-- cron.job_run_details + net._http_response and returns a per-job summary
-- the /admin/health page can render without granting PostgREST direct access
-- to the cron or net schemas. Returns plain JSONB so the caller does not need
-- to manage a custom return type.
--
-- Schema access required by this function:
--   cron.job, cron.job_run_details   - read via pg_cron
--   net._http_response                - read via pg_net
--
-- Both schemas are normally restricted; SECURITY DEFINER lets the function
-- read them while the caller (service role) only sees the result.

CREATE OR REPLACE FUNCTION public.get_cron_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, net
AS $$
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
  -- Most recent run per job
  LEFT JOIN LATERAL (
    SELECT runid, start_time, end_time, status, return_message
    FROM cron.job_run_details d
    WHERE d.jobid = j.jobid
    ORDER BY d.start_time DESC NULLS LAST
    LIMIT 1
  ) last_run ON TRUE
  -- Most recent pg_net response for that job's most recent run
  LEFT JOIN LATERAL (
    SELECT status_code, error_msg, timed_out, created
    FROM net._http_response r
    WHERE r.id = last_run.runid
    LIMIT 1
  ) last_resp ON TRUE
  -- 24h success/failure counts
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
$$;

-- Lock down: service role and authenticated roles only. Anonymous cannot call
-- it (the /admin/health page calls via supabaseAdmin which uses service_role).
REVOKE ALL ON FUNCTION public.get_cron_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cron_health() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_cron_health() TO authenticated;

COMMENT ON FUNCTION public.get_cron_health() IS
  'Operator health: per-cron-job last-run + 24h stats + paired pg_net response. Called by /admin/health.';
