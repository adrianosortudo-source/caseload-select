-- Dashboard v2: hero metrics config, engagement start, industry benchmarks
-- Idempotent — all additions use IF NOT EXISTS / ON CONFLICT DO NOTHING

-- Hero metrics config on each firm
ALTER TABLE intake_firms
  ADD COLUMN IF NOT EXISTS hero_metrics        JSONB DEFAULT '["signed_cases","cpsc","avgResponseSecs"]',
  ADD COLUMN IF NOT EXISTS metric_definitions  JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS engagement_start_date DATE DEFAULT NULL;

-- Industry benchmarks reference table (Canadian solo/2-lawyer law firm averages)
CREATE TABLE IF NOT EXISTS industry_benchmarks (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key       TEXT        NOT NULL UNIQUE,
  label            TEXT        NOT NULL,
  benchmark_value  NUMERIC     NOT NULL,
  unit             TEXT        NOT NULL DEFAULT 'number',
  direction        TEXT        NOT NULL DEFAULT 'higher_better',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO industry_benchmarks (metric_key, label, benchmark_value, unit, direction) VALUES
  ('inquiries',        'Monthly Inquiries',      40,     'number',   'higher_better'),
  ('qualified',        'Qualified Leads/Month',  14,     'number',   'higher_better'),
  ('signed',           'Signed Cases/Month',      4,     'number',   'higher_better'),
  ('cpsc',             'Cost per Signed Case',  2500,    'currency', 'lower_better'),
  ('avgResponseSecs',  'Median Response (sec)',    60,   'seconds',  'lower_better'),
  ('pipelineValue',    'Pipeline Value',         50000,  'currency', 'higher_better'),
  ('funnelConversion', 'Funnel Conversion %',      10,   'percent',  'higher_better')
ON CONFLICT (metric_key) DO NOTHING;
