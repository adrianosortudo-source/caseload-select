-- Canonical weekly-package metadata shared by the portal and content-generation flow.
-- Existing records remain valid: both fields are nullable and are not backfilled.

ALTER TABLE content_periods
  ADD COLUMN IF NOT EXISTS week_number integer;

ALTER TABLE content_periods
  ADD COLUMN IF NOT EXISTS strategy_brief jsonb;

ALTER TABLE content_periods
  DROP CONSTRAINT IF EXISTS content_periods_strategy_brief_shape;

ALTER TABLE content_periods
  ADD CONSTRAINT content_periods_strategy_brief_shape CHECK (
    strategy_brief IS NULL
    OR (
      jsonb_typeof(strategy_brief) = 'object'
      AND jsonb_object_length(strategy_brief) = 6
      AND strategy_brief ?& ARRAY[
        'readerAndSituation',
        'workSupported',
        'whyThisWeek',
        'practicalAngle',
        'authorityAndEvidence',
        'websiteAndConversionRole'
      ]
      AND jsonb_typeof(strategy_brief->'readerAndSituation') = 'string'
      AND jsonb_typeof(strategy_brief->'workSupported') = 'string'
      AND jsonb_typeof(strategy_brief->'whyThisWeek') = 'string'
      AND jsonb_typeof(strategy_brief->'practicalAngle') = 'string'
      AND jsonb_typeof(strategy_brief->'authorityAndEvidence') = 'string'
      AND jsonb_typeof(strategy_brief->'websiteAndConversionRole') = 'string'
    )
  );

CREATE INDEX IF NOT EXISTS idx_content_periods_firm_week_number
  ON content_periods (firm_id, week_number);

NOTIFY pgrst, 'reload schema';
