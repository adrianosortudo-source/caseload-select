-- =============================================================================
-- screened_leads — CaseLoad Screen 2.0 persistence target
-- =============================================================================
-- Screen 2.0 (the Vite SPA at https://caseload-screen-v2.vercel.app) writes its
-- output here on submit. The lawyer portal reads from this table to produce the
-- triage queue and the brief view.
--
-- This is a NEW table by design, not an extension of the existing `leads`
-- table. Rationale (per CRM Bible v5 DR-001 and the lawyer-portal build prompt):
--
--   * The legacy `leads` schema is shaped for the v2.1 form scoring engine and
--     the GPT-based CpiBreakdown (5 bands A-E, 100-point CPI). Conflict check,
--     sequence engine, and PIPEDA retention are wired against that shape.
--   * Screen 2.0 produces a different artifact: 3 bands (A/B/C, no gating),
--     four-axis 0-10 scores, brief JSON + pre-rendered HTML, slot answers.
--   * Mixing two scoring systems in one table would force every existing query
--     to filter by `screen_version` and every analytic to disambiguate. Worse,
--     it would silently break the legacy journeys when their expected columns
--     are unpopulated.
--   * A new table keeps the legacy machinery intact while the v5 architecture
--     matures. Foreign-key linkage between `leads` and `screened_leads` can be
--     added later if a single canonical lead identity becomes useful.
--
-- Naming: deliberately `screened_leads`, not `screen_v2_leads`. The
-- `screen_version` column inside the row carries the version semantic so the
-- structural object name does not need to.
--
-- Lifecycle states (the contract across Supabase, the lawyer portal, and the
-- GHL custom field — do not drift):
--   triaging  - default after submit, awaiting lawyer Take or Pass or 48h backstop
--   taken     - lawyer pressed Take, band cadence engaged
--   passed    - lawyer pressed Pass, decline-with-grace fired
--   declined  - auto-fired via OOS detection at intake or 48h backstop expiry
--
-- Decision deadline (CRM Bible v5 DR-003):
--   * default 48h from submit
--   * 24h when urgency_score >= 6
--   * 12h when urgency_score >= 8
--
-- Whale nurture flag (CRM Bible v5 DR-004):
--   * value_score >= 7 AND readiness_score <= 4
-- =============================================================================

CREATE TABLE IF NOT EXISTS screened_leads (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identification
  lead_id             text UNIQUE NOT NULL,            -- L-YYYY-MM-DD-XXX from engine
  firm_id             uuid REFERENCES intake_firms(id) ON DELETE CASCADE,

  -- Versioning. Future Screen 3.0 increments without renaming the table.
  screen_version      integer NOT NULL DEFAULT 2,

  -- Lifecycle
  status              text NOT NULL DEFAULT 'triaging',
  status_changed_at   timestamptz NOT NULL DEFAULT now(),
  status_changed_by   text,                            -- lawyer email, 'system', or 'system:backstop'
  status_note         text,                            -- optional lawyer-supplied note on Pass

  -- Brief artifacts. The triple-write contract:
  --   brief_json     - the structured LawyerReport object (audit, future re-render)
  --   brief_html     - pre-rendered moment-in-time snapshot the portal dumps verbatim
  --   slot_answers   - raw EngineState slots / slot_meta / slot_evidence (re-derive ground)
  brief_json          jsonb NOT NULL,
  brief_html          text NOT NULL,
  slot_answers        jsonb NOT NULL,

  -- Indexed quick-access columns for the queue page (avoid jsonb scans)
  band                text,
  matter_type         text NOT NULL,
  practice_area       text NOT NULL,

  -- Four-axis scores (engine-internal: complexity is drag, displayed as Simplicity per D012)
  value_score         integer,
  complexity_score    integer,
  urgency_score       integer,
  readiness_score     integer,
  readiness_answered  boolean NOT NULL DEFAULT false,

  -- Derived flags computed at insert time from the axes
  whale_nurture       boolean NOT NULL DEFAULT false,
  band_c_subtrack     text,                            -- fast_transaction | window_shopper | wrong_fit | NULL

  -- Decision timer (CRM Bible v5 DR-003)
  decision_deadline   timestamptz NOT NULL,

  -- Contact details captured at the end of the screen
  contact_name        text,
  contact_email       text,
  contact_phone       text,

  -- Audit
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Domain guards
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'screened_leads_status_check'
      AND conrelid = 'public.screened_leads'::regclass
  ) THEN
    ALTER TABLE screened_leads
      ADD CONSTRAINT screened_leads_status_check
      CHECK (status IN ('triaging', 'taken', 'passed', 'declined'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'screened_leads_band_check'
      AND conrelid = 'public.screened_leads'::regclass
  ) THEN
    ALTER TABLE screened_leads
      ADD CONSTRAINT screened_leads_band_check
      CHECK (band IS NULL OR band IN ('A', 'B', 'C'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'screened_leads_subtrack_check'
      AND conrelid = 'public.screened_leads'::regclass
  ) THEN
    ALTER TABLE screened_leads
      ADD CONSTRAINT screened_leads_subtrack_check
      CHECK (band_c_subtrack IS NULL OR band_c_subtrack IN ('fast_transaction', 'window_shopper', 'wrong_fit'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'screened_leads_axis_range_check'
      AND conrelid = 'public.screened_leads'::regclass
  ) THEN
    ALTER TABLE screened_leads
      ADD CONSTRAINT screened_leads_axis_range_check
      CHECK (
        (value_score      IS NULL OR value_score      BETWEEN 0 AND 10) AND
        (complexity_score IS NULL OR complexity_score BETWEEN 0 AND 10) AND
        (urgency_score    IS NULL OR urgency_score    BETWEEN 0 AND 10) AND
        (readiness_score  IS NULL OR readiness_score  BETWEEN 0 AND 10)
      );
  END IF;
END $$;

-- Queue queries: filter by firm + status, sort by band then deadline.
-- The portal's "active triage" queue hits this index every page load.
CREATE INDEX IF NOT EXISTS idx_screened_leads_queue
  ON screened_leads (firm_id, status, band, decision_deadline);

-- Lookup by lead_id (audit, deep-link from email/SMS, brief view route)
CREATE INDEX IF NOT EXISTS idx_screened_leads_lead_id
  ON screened_leads (lead_id);

-- Lifecycle event timeline per firm (analytics, recently-acted-on widgets)
CREATE INDEX IF NOT EXISTS idx_screened_leads_status_changed
  ON screened_leads (firm_id, status_changed_at DESC);

-- Backstop sweeper: find triaging rows whose deadline has passed
CREATE INDEX IF NOT EXISTS idx_screened_leads_deadline_active
  ON screened_leads (decision_deadline)
  WHERE status = 'triaging';

-- updated_at maintenance
DROP TRIGGER IF EXISTS trg_touch_screened_leads_updated_at ON screened_leads;
CREATE TRIGGER trg_touch_screened_leads_updated_at
  BEFORE UPDATE ON screened_leads
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- RLS: service-role-only access. The lawyer portal reaches Supabase through
-- supabaseAdmin (server-side), and the screen widget POSTs through the
-- Next.js /api/intake-v2 endpoint. There is no direct anon path to this table.
ALTER TABLE screened_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE screened_leads FORCE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
