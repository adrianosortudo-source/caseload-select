-- H5 CONSENT GATE: CASL consent columns on screened_leads + consent_log table.
--
-- STATUS: DRAFT. NOT APPLIED TO PROD.
-- Apply only after the comms-gate module (src/lib/comms-gate.ts) is wired
-- into the intake paths and the operator confirms the consent-capture UI
-- (widget consent checkbox) is live on at least one firm.
--
-- CASL compliance:
--   - Implied consent (s.6(6)(d)): six_month_expiry_date tracks the 6-month window
--   - Explicit consent (s.6(1)(a)): no expiry; explicit_consent_captured_at is the proof
--   - STOP / revoke: flip status to 'declined' or 'revoked', append to consent_log
--   - Right to withdraw (s.11): consent_log is append-only for audit; status is mutable
--
-- SCHEMA NOTES:
--   - All consent columns default to 'unknown' (NOT NULL) so existing rows are not
--     upgraded to 'none' accidentally; 'unknown' is gate-closed in comms-gate.ts.
--   - six_month_expiry_date is set at intake time for implied-consent rows:
--       six_month_expiry_date = submitted_at + INTERVAL '6 months'
--   - For explicit consent rows, six_month_expiry_date stays NULL (explicit does not expire).
--   - consent_log is append-only: INSERT-only policy, no UPDATE, no DELETE.
--
-- DR reference: H5 (pending operator approval).

BEGIN;

-- ============================================================
-- 1. Additive columns on screened_leads (all nullable or defaulted)
-- ============================================================

ALTER TABLE public.screened_leads
  ADD COLUMN IF NOT EXISTS email_consent_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS sms_consent_status   TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS email_consent_source TEXT,          -- 'intake_form' | 'opt_in_message' | 'double_opt_in' | null
  ADD COLUMN IF NOT EXISTS sms_consent_source   TEXT,          -- 'intake_form' | 'explicit_sms_opt_in' | null
  ADD COLUMN IF NOT EXISTS email_consent_captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sms_consent_captured_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS six_month_expiry_date     TIMESTAMPTZ, -- CASL s.6(6)(d) expiry for implied consent
  ADD COLUMN IF NOT EXISTS consent_ip               TEXT,       -- IP at time of consent capture (widget)
  ADD COLUMN IF NOT EXISTS consent_user_agent       TEXT;       -- UA at time of consent capture (widget)

ALTER TABLE public.screened_leads
  ADD CONSTRAINT IF NOT EXISTS screened_leads_email_consent_status_check
    CHECK (email_consent_status IN ('explicit', 'implied', 'declined', 'revoked', 'unknown', 'none')),
  ADD CONSTRAINT IF NOT EXISTS screened_leads_sms_consent_status_check
    CHECK (sms_consent_status   IN ('explicit', 'implied', 'declined', 'revoked', 'unknown', 'none'));

-- Index for outbound-queue sweeps: find rows where email consent is open.
CREATE INDEX IF NOT EXISTS idx_screened_leads_email_consent
  ON public.screened_leads (firm_id, email_consent_status)
  WHERE email_consent_status IN ('explicit', 'implied');

-- Index for SMS sweeps.
CREATE INDEX IF NOT EXISTS idx_screened_leads_sms_consent
  ON public.screened_leads (firm_id, sms_consent_status)
  WHERE sms_consent_status = 'explicit';

-- ============================================================
-- 2. consent_log: append-only CASL audit table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.consent_log (
  id                UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  screened_lead_id  UUID        NOT NULL REFERENCES public.screened_leads(id) ON DELETE CASCADE,
  firm_id           UUID        NOT NULL REFERENCES public.intake_firms(id) ON DELETE CASCADE,
  event_type        TEXT        NOT NULL, -- 'consent_granted' | 'consent_revoked' | 'opt_out' | 'implied_set' | 'expiry_set'
  channel           TEXT        NOT NULL, -- 'email' | 'sms'
  consent_status    TEXT        NOT NULL, -- mirrors ConsentStatus in comms-gate.ts
  source            TEXT,                 -- 'intake_form' | 'stop_message' | 'operator_revoke' | 'double_opt_in' | 'api'
  ip_address        TEXT,
  user_agent        TEXT,
  note              TEXT,                 -- operator-entered note for manual revocations
  captured_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.consent_log
  ADD CONSTRAINT IF NOT EXISTS consent_log_event_type_check
    CHECK (event_type IN ('consent_granted', 'consent_revoked', 'opt_out', 'implied_set', 'expiry_set')),
  ADD CONSTRAINT IF NOT EXISTS consent_log_channel_check
    CHECK (channel IN ('email', 'sms')),
  ADD CONSTRAINT IF NOT EXISTS consent_log_consent_status_check
    CHECK (consent_status IN ('explicit', 'implied', 'declined', 'revoked', 'unknown', 'none'));

-- Lookup by lead (timeline view), by firm (compliance export).
CREATE INDEX IF NOT EXISTS idx_consent_log_lead_id
  ON public.consent_log (screened_lead_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_consent_log_firm_id
  ON public.consent_log (firm_id, captured_at DESC);

-- ============================================================
-- 3. RLS lockdown (DB Access Invariant: service-role only)
-- ============================================================

ALTER TABLE public.consent_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_log FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.consent_log FROM anon;
REVOKE ALL ON public.consent_log FROM authenticated;
REVOKE ALL ON public.consent_log FROM PUBLIC;

GRANT ALL ON public.consent_log TO service_role;

-- Append-only invariant: the application never UPDATEs or DELETEs rows.
-- Enforced in code (no update/delete methods in consent-log.ts). A future
-- DB-level trigger can enforce this once the pattern is proven.

COMMIT;
