-- P12 Phase 1: Google Ads click ID for offline conversion attribution.
-- Additive, nullable; existing rows unaffected. RLS already forced on
-- screened_leads (service-role only), no grant changes needed.
alter table public.screened_leads
  add column if not exists gclid text;

comment on column public.screened_leads.gclid is
  'Google Ads click ID captured from the widget URL at intake. Key for offline conversion import (P12 Phase 4).';
