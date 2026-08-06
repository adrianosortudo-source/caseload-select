-- Firm profile fee detail fields
--
-- RECONSTRUCTED FILE, 2026-07-25.
--
-- Migration version 20260712183638 "add_firm_profile_fee_detail_fields" is
-- recorded as applied in the production migration history, but no
-- corresponding file existed in this repository. This file reconstructs it so
-- the repo and the database agree. It is written to be recognised as already
-- applied against production; nothing here re-runs.
--
-- The three columns were added while the client pricing page was being built,
-- because the page renders detail the onboarding form did not collect:
--
--   fee_exclusions          -> the "Fixed legal fees, plus HST. Government and
--                              search fees are billed at cost" line beneath
--                              each fee table
--   fee_deal_variation      -> the per-area fee philosophy ("matters that
--                              resist a fixed structure carry a fee range with
--                              weekly reporting")
--   fee_publish_preference  -> whether fee figures are published publicly
--
-- Written by the Form 2 submit route
-- (src/app/api/firm-profile/[token]/submit/route.ts, lines 137-139).
--
-- Column definitions verified against production on 2026-07-25 via
-- information_schema: all three are text, nullable, with no default. This file
-- reproduces that exactly. IF NOT EXISTS keeps it a no-op wherever the columns
-- are already present, and correct on a fresh build.

alter table public.firm_onboarding_intake
  add column if not exists fee_exclusions text,
  add column if not exists fee_deal_variation text,
  add column if not exists fee_publish_preference text;

comment on column public.firm_onboarding_intake.fee_exclusions is
  'What the quoted fees exclude — HST, disbursements, government and search fees. Renders as the exclusions line beneath each fee table on the pricing page.';

comment on column public.firm_onboarding_intake.fee_deal_variation is
  'How fees vary where a matter resists a fixed structure. Renders as the per-area fee philosophy on the pricing page.';

comment on column public.firm_onboarding_intake.fee_publish_preference is
  'Whether the firm wants fee figures published publicly: public anchors, quote-on-request, or mixed.';
