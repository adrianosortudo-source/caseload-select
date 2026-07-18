-- H6 launch-audit fix: brute-force cap on the intake OTP.
--
-- /api/otp/verify previously allowed unlimited tries against a 6-digit code
-- inside its 15-minute window (1e6 keyspace, sweepable well within the TTL).
-- The route now counts failed verify attempts per code; at 5 the code is
-- invalidated (otp_code cleared) and verify returns 410 "locked" until
-- /api/otp/send issues a fresh code, which resets the counter to 0.
--
-- Additive + default + IF NOT EXISTS: safe to run repeatedly.

ALTER TABLE public.intake_sessions
  ADD COLUMN IF NOT EXISTS otp_attempts integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.intake_sessions.otp_attempts IS
  'Failed OTP verify attempts against the current otp_code. Reset to 0 when /api/otp/send issues a new code and on successful verify. At 5 the code is invalidated and /api/otp/verify returns 410 locked.';
