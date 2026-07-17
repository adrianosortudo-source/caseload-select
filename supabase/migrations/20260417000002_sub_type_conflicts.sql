-- Sub-Type Conflict Log
-- Fire-and-forget table: populated when regex and GPT disagree on sub-type
-- classification. Rows are inserted with ON CONFLICT DO NOTHING and the insert
-- is deliberately never awaited in the application path. If the insert fails
-- (table absent, RLS, network), the session continues unaffected.
--
-- Purpose: surface systematic misclassifications so question sets can be tuned.
-- Query: SELECT practice_area, regex_result, gpt_result, COUNT(*) FROM
--        sub_type_conflicts GROUP BY 1,2,3 ORDER BY 4 DESC;

CREATE TABLE IF NOT EXISTS sub_type_conflicts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         uuid REFERENCES intake_sessions(id) ON DELETE SET NULL,
  firm_id            uuid REFERENCES intake_firms(id)   ON DELETE SET NULL,
  practice_area      text NOT NULL,
  regex_result       text,           -- sub-type key returned by regex fast-path (null = no match)
  gpt_result         text NOT NULL,  -- sub-type key returned by GPT classification
  situation_hash     text,           -- SHA-256 hex of first 500 chars of situation text (PII-free)
  app_version        text,           -- git SHA or semver, populated by the app if available
  created_at         timestamptz DEFAULT now()
);

-- Index to support the per-firm and per-PA aggregation queries.
CREATE INDEX IF NOT EXISTS idx_sub_type_conflicts_pa
  ON sub_type_conflicts (practice_area, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sub_type_conflicts_firm
  ON sub_type_conflicts (firm_id, created_at DESC)
  WHERE firm_id IS NOT NULL;

-- RLS: service-role only. Conflict logs are internal telemetry, never client-facing.
ALTER TABLE sub_type_conflicts ENABLE ROW LEVEL SECURITY;

-- No SELECT/INSERT policies for anon or authenticated roles.
-- All writes go through the service-role key on the API route.
