-- Canonical weekly-package metadata shared by the portal and content-generation flow.
-- Existing records remain valid: both fields are nullable and are not backfilled.

ALTER TABLE content_periods
  ADD COLUMN IF NOT EXISTS week_number integer;

ALTER TABLE content_periods
  ADD COLUMN IF NOT EXISTS strategy_brief jsonb;

ALTER TABLE content_periods
  DROP CONSTRAINT IF EXISTS content_periods_strategy_brief_shape;

-- Exactly the six keys, no extras.
--
-- The original draft expressed the count as jsonb_object_length(strategy_brief) = 6,
-- which is not a PostgreSQL function -- there is jsonb_array_length for arrays,
-- but nothing for counting object keys. A CHECK constraint cannot contain a
-- subquery either, so (SELECT count(*) FROM jsonb_object_keys(...)) is out.
--
-- Two plain operators express the same rule: ?& asserts all six keys are
-- present, and subtracting that key set must leave an empty object, which is
-- true only when no seventh key exists. Both are immutable, so both are legal
-- in a CHECK.
ALTER TABLE content_periods
  ADD CONSTRAINT content_periods_strategy_brief_shape CHECK (
    strategy_brief IS NULL
    OR (
      jsonb_typeof(strategy_brief) = 'object'
      AND (strategy_brief - ARRAY[
        'readerAndSituation',
        'workSupported',
        'whyThisWeek',
        'practicalAngle',
        'authorityAndEvidence',
        'websiteAndConversionRole'
      ]::text[]) = '{}'::jsonb
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
