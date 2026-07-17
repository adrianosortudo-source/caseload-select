-- CRM Migration Plan, Phase 2 rail 2 (booking), WP-6.
--
-- Adds intake_firms.booking_config, the structured adapter config for
-- /book/[firmId] (provider + url). Distinct from the legacy plain-string
-- booking_url used only inside the Screen AI prompt (screen-prompt.ts,
-- client-configs.ts, a hardcoded per-client config file predating this
-- table-driven approach); this is the new, DB-driven booking surface.
--
-- Additive, nullable, defaults to an empty object so a firm with no config
-- renders the honest "not configured" state rather than erroring.

BEGIN;

ALTER TABLE public.intake_firms
  ADD COLUMN IF NOT EXISTS booking_config jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
