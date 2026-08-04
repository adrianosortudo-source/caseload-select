-- Per-firm website analytics configuration.
-- ga4_property_id: numeric GA4 property ID (from analytics.google.com admin).
-- vercel_project_id: Vercel project ID for the firm's website deployment.
-- Both are optional; the metrics page degrades gracefully when unset.

ALTER TABLE public.intake_firms
  ADD COLUMN IF NOT EXISTS ga4_property_id TEXT,
  ADD COLUMN IF NOT EXISTS vercel_project_id TEXT;
