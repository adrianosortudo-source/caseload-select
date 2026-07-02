-- H5 CONSENT GATE: CASL consent columns on screened_leads + consent_log table.
-- Also adds intake_firms.consent_gate_enabled (the per-firm enforcement flag).
--
-- STATUS: APPLIED TO PROD (confirmed live via Supabase MCP 2026-07-02; this
-- header previously said "DRAFT. NOT APPLIED TO PROD", which was stale by
-- the time it was found). DRG has consent_gate_enabled=true.
--
-- N6 ALIGNMENT (2026-06-26): schema aligned with CANONICAL-DATA-MODEL-v1.md §4.1.
--   Changes from original draft:
--   - consent_log: screened_lead_id -> subject_id (FK to screened_leads for now;
--     will point to parties.id once the parties table exists)
--   - consent_log: added consent_type (express|implied_ebr|implied_inquiry|conspicuous_publication|conflict_waiver)
--   - consent_log: consent_status CHECK aligned to canonical (granted|withdrawn|expired)
--   - consent_log: renamed source -> basis_source
--   - consent_log: added basis_evidence JSONB, purpose TEXT, honoured_by TIMESTAMPTZ,
--     privacy_notice_version TEXT, cem_identification_ok BOOLEAN, withdrawn_at TIMESTAMPTZ,
--     withdrawal_channel TEXT, created_by TEXT
--   - added intake_firms.consent_gate_enabled BOOLEAN NOT NULL DEFAULT false
--
-- CASL compliance:
--   - Implied consent (s.6(6)(d)): six_month_expiry_date tracks the 6-month window
--   - Explicit consent (s.6(1)(a)): no expiry; explicit_consent_captured_at is the proof
--   - STOP / revoke: flip status to 'declined' or 'revoked', append to consent_log
--   - Right to withdraw (s.11): consent_log is append-only for audit; status is mutable
--   - 10-business-day honour window: honoured_by on consent_log records when the
--     withdrawal was actioned (must be <= withdrawn_at + 10 business days)
--
-- SCHEMA NOTES:
--   - All consent columns on screened_leads default to 'unknown' (NOT NULL) so
--     existing rows are not upgraded to 'none' accidentally; 'unknown' is gate-closed
--     in comms-gate.ts. Run the implied-consent backfill after applying.
--   - six_month_expiry_date is set at intake time for implied-consent rows:
--       six_month_expiry_date = submitted_at + INTERVAL '6 months'
--   - For explicit consent rows, six_month_expiry_date stays NULL (explicit does not expire).
--   - consent_log is append-only: INSERT-only policy, no UPDATE, no DELETE.
--   - intake_firms.consent_gate_enabled defaults to false; set to true per firm only
--     after the widget checkbox is live and the implied-consent backfill has run.
--
-- DR reference: DR-075 (CASL consent gate architecture).
-- Related: src/lib/comms-gate.ts, src/lib/ghl-webhook.ts

BEGIN;

-- ============================================================
-- 1. Additive columns on screened_leads (all nullable or defaulted)
-- ============================================================

ALTER TABLE public.screened_leads
  ADD COLUMN IF NOT EXISTS email_consent_status        TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS sms_consent_status          TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS email_consent_source        TEXT,   -- 'intake_form' | 'opt_in_message' | 'double_opt_in' | null
  ADD COLUMN IF NOT EXISTS sms_consent_source          TEXT,   -- 'intake_form' | 'explicit_sms_opt_in' | null
  ADD COLUMN IF NOT EXISTS email_consent_captured_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sms_consent_captured_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS six_month_expiry_date       TIMESTAMPTZ, -- CASL s.6(6)(d) expiry for implied consent
  ADD COLUMN IF NOT EXISTS consent_ip                  TEXT,   -- IP at time of consent capture (widget)
  ADD COLUMN IF NOT EXISTS consent_user_agent          TEXT;   -- UA at time of consent capture (widget)

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'screened_leads_email_consent_status_check') THEN
    ALTER TABLE public.screened_leads
      ADD CONSTRAINT screened_leads_email_consent_status_check
        CHECK (email_consent_status IN ('explicit', 'implied', 'declined', 'revoked', 'unknown', 'none'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'screened_leads_sms_consent_status_check') THEN
    ALTER TABLE public.screened_leads
      ADD CONSTRAINT screened_leads_sms_consent_status_check
        CHECK (sms_consent_status IN ('explicit', 'implied', 'declined', 'revoked', 'unknown', 'none'));
  END IF;
END $$;

-- Outbound-queue sweep: find rows where email consent is open.
CREATE INDEX IF NOT EXISTS idx_screened_leads_email_consent
  ON public.screened_leads (firm_id, email_consent_status)
  WHERE email_consent_status IN ('explicit', 'implied');

CREATE INDEX IF NOT EXISTS idx_screened_leads_sms_consent
  ON public.screened_leads (firm_id, sms_consent_status)
  WHERE sms_consent_status = 'explicit';

-- ============================================================
-- 2. intake_firms.consent_gate_enabled (per-firm enforcement flag)
-- ============================================================

ALTER TABLE public.intake_firms
  ADD COLUMN IF NOT EXISTS consent_gate_enabled BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- 3. consent_log: append-only CASL audit table
--    Aligned with CANONICAL-DATA-MODEL-v1.md §4.1 (N6, 2026-06-26)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.consent_log (
  id                     UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id                UUID        NOT NULL REFERENCES public.intake_firms(id) ON DELETE CASCADE,

  -- subject_id: FK to screened_leads.id for now.
  -- Will be rebased to parties.id once the parties table exists (Phase 2+).
  subject_id             UUID        NOT NULL REFERENCES public.screened_leads(id) ON DELETE CASCADE,

  channel                TEXT        NOT NULL, -- 'email' | 'sms' | 'voice' | 'whatsapp' | 'instagram'
  event_type             TEXT        NOT NULL, -- what happened (see CHECK below)
  consent_type           TEXT        NOT NULL, -- basis for this consent (see CHECK below)
  consent_status         TEXT        NOT NULL, -- resulting status after this event (see CHECK below)
  purpose                TEXT,                 -- PIPEDA Principle 2: why data is collected/used
  basis_source           TEXT,                 -- 'widget_optin' | 'screen_inquiry' | 'signed_contract' | 'stop_message' | 'operator_revoke' | 'double_opt_in' | 'api'
  basis_evidence         JSONB,                -- form snapshot, IP, widget version, checkbox state, transcript ref
  ip_address             TEXT,                 -- IP at time of event
  user_agent             TEXT,                 -- UA at time of event
  note                   TEXT,                 -- operator-entered note for manual revocations
  obtained_at            TIMESTAMPTZ,          -- when consent was given / inquiry made / contract dated
  expires_at             TIMESTAMPTZ,          -- inquiry: +6mo; ebr: +2yr; express/conflict_waiver: null
  withdrawn_at           TIMESTAMPTZ,          -- when consent was withdrawn by the subject
  withdrawal_channel     TEXT,                 -- how withdrawal was received ('sms_stop' | 'email_unsubscribe' | 'operator_ui' | 'api')
  honoured_by            TIMESTAMPTZ,          -- must be <= withdrawn_at + 10 business days (CASL s.11)
  privacy_notice_version TEXT,                 -- which version of the privacy notice was in effect
  cem_identification_ok  BOOLEAN,              -- template had sender ID block + unsubscribe endpoint at send time
  created_by             TEXT,                 -- 'system' | lawyer_id | 'operator'
  captured_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  -- event_type: what happened in this event log entry
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consent_log_event_type_check') THEN
    ALTER TABLE public.consent_log
      ADD CONSTRAINT consent_log_event_type_check
        CHECK (event_type IN (
          'consent_granted',   -- explicit or implied consent recorded
          'consent_revoked',   -- operator-initiated revocation
          'opt_out',           -- subject-initiated STOP / unsubscribe
          'implied_set',       -- intake submission sets implied consent window
          'expiry_set'         -- expiry date stamped at intake or recalculated
        ));
  END IF;

  -- consent_type: the basis for this consent (CASL taxonomy)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consent_log_consent_type_check') THEN
    ALTER TABLE public.consent_log
      ADD CONSTRAINT consent_log_consent_type_check
        CHECK (consent_type IN (
          'express',                    -- subject checked a box / sent double-opt-in confirmation
          'implied_ebr',                -- existing business relationship (s.6(6)(a)-(c))
          'implied_inquiry',            -- inquiry (s.6(6)(d)): the Screen submission itself
          'conspicuous_publication',    -- business contact info publicly published (s.6(6)(e))
          'conflict_waiver'             -- consent linked to conflict-of-interest waiver (LSO)
        ));
  END IF;

  -- consent_status: canonical status values per CANONICAL-DATA-MODEL-v1.md §4.1
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consent_log_consent_status_check') THEN
    ALTER TABLE public.consent_log
      ADD CONSTRAINT consent_log_consent_status_check
        CHECK (consent_status IN ('granted', 'withdrawn', 'expired'));
  END IF;

  -- channel: must be one of the supported CEM channels
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consent_log_channel_check') THEN
    ALTER TABLE public.consent_log
      ADD CONSTRAINT consent_log_channel_check
        CHECK (channel IN ('email', 'sms', 'voice', 'whatsapp', 'instagram'));
  END IF;
END $$;

-- Timeline view per lead.
CREATE INDEX IF NOT EXISTS idx_consent_log_subject_id
  ON public.consent_log (subject_id, captured_at DESC);

-- Compliance export per firm.
CREATE INDEX IF NOT EXISTS idx_consent_log_firm_id
  ON public.consent_log (firm_id, captured_at DESC);

-- ============================================================
-- 4. RLS lockdown (DB Access Invariant: service-role only)
-- ============================================================

ALTER TABLE public.consent_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_log FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.consent_log FROM anon;
REVOKE ALL ON public.consent_log FROM authenticated;
REVOKE ALL ON public.consent_log FROM PUBLIC;

GRANT ALL ON public.consent_log TO service_role;

-- Append-only invariant: the application never UPDATEs or DELETEs consent_log rows.
-- Enforced in application code. A DB-level trigger can be added later to enforce this
-- at the schema level once the pattern is proven in production.

COMMIT;
