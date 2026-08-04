-- N2: Add axis_reasoning JSONB column to screened_leads.
--
-- CANONICAL-DATA-MODEL-v1.md s3.4 specifies axis_reasoning as a top-level
-- queryable column, not buried inside brief_json. Without it, per-axis
-- breakdowns (score + human-readable reasons for each of value/complexity/
-- urgency/readiness) cannot be indexed or filtered from screened_leads directly.
--
-- Shape: { value: {score, reasons[]}, complexity: ..., urgency: ...,
--          readiness: ..., readinessAnswered: boolean }
-- Mirrors AxisReasoning in src/lib/screen-engine/types.ts.
--
-- No backfill required: enrichment-only. Historical rows keep axis_reasoning=NULL;
-- a future admin endpoint can recompute from brief_json if needed.
--
-- Write path: api/intake-v2/route.ts and lib/channel-intake-processor.ts
-- both extract report.axis_reasoning at insert time after this migration lands.
--
-- DR reference: N2 (Codex audit v2, axis_reasoning queryable column).

ALTER TABLE public.screened_leads
  ADD COLUMN IF NOT EXISTS axis_reasoning JSONB;
