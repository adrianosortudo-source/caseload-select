-- Codex audit 2026-07-06, finding 5 (defense in depth): the cadence engine
-- runner (src/lib/cadence-runner.ts) only ever enrolls trigger_type='field_change'
-- rules. threshold/time_relative are pure-function stubs with zero caller in the
-- runner (src/lib/cadence-rules-pure.ts matchesThresholdTrigger /
-- matchesTimeRelativeTrigger). The journey editor (src/lib/cadence-rule-admin.ts)
-- already hardcodes field_change on every write it makes; this closes the
-- residual gap where a raw SQL statement or a future service-role script could
-- still insert a dead-on-arrival rule with one of the other two values.
--
-- Guard verified before this migration: SELECT trigger_type, count(*) FROM
-- cadence_rules GROUP BY 1 returned exactly one row, {field_change: 7}. No
-- existing row uses threshold or time_relative, so narrowing the CHECK is safe.
--
-- APPLIED to prod 2026-07-06 via Supabase MCP (version 20260706040354).

BEGIN;

ALTER TABLE public.cadence_rules DROP CONSTRAINT IF EXISTS cadence_rules_trigger_type_check;
ALTER TABLE public.cadence_rules ADD CONSTRAINT cadence_rules_trigger_type_check
  CHECK (trigger_type = 'field_change');

COMMIT;
