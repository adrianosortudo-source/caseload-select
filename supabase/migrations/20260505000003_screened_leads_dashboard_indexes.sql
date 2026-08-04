-- =============================================================================
-- screened_leads — additional indexes for the v5 dashboard
-- =============================================================================
-- Follow-up to 20260505_screened_leads.sql. The base migration covers per-firm
-- queue queries via idx_screened_leads_queue (firm_id, status, band,
-- decision_deadline) and a few audit/timeline indexes. These three additions
-- cover the access patterns the v5 operator dashboard will need that the
-- queue index does not serve. Defined now while the table is empty so the
-- backfill cost is zero.
--
-- Indexes added:
--
--   1. (created_at DESC)              cross-firm time-window scans
--                                     ("leads created in the last 7 days")
--   2. (firm_id, created_at DESC)     per-firm time-window queries
--                                     ("this firm's leads this month")
--   3. (status, band)                 cross-firm status + band rollups
--                                     ("active triage by band across all firms")
--
-- Postgres 17 has no btree skip-scan, so a leading-column-skipped query
-- against idx_screened_leads_queue would not benefit from it. These explicit
-- indexes are required for status-alone and band-alone access paths.
--
-- Operator-facing dashboard work itself is deferred (CRM Bible v5 keeps the
-- legacy dashboard in place during the transition); these indexes are a
-- cheap forward investment so the v5 dashboard does not need a follow-up
-- schema sprint when it lands.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_screened_leads_created
  ON screened_leads (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_screened_leads_firm_created
  ON screened_leads (firm_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_screened_leads_status_band
  ON screened_leads (status, band);

NOTIFY pgrst, 'reload schema';
