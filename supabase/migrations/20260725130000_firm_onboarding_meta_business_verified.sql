-- Firm onboarding intake — Meta business verification gate
--
-- Adds meta_business_verified, which gates whether the business verification
-- document question is shown at all.
--
-- Background: the form previously asked for the verification document
-- unconditionally, in the WhatsApp section — three sections before it asked
-- whether the firm even had a Meta Business Manager. That requested Articles
-- of Incorporation, a utility bill, or a tax document from firms whose
-- Business Manager was already verified and therefore needed to provide
-- nothing.
--
-- Meta only requires business verification once per business, before a
-- WhatsApp account can go live. With this column the document question is
-- shown only when it is actually needed:
--
--   has_meta_business_manager = true  and meta_business_verified = false/null
--       -> verification still outstanding, ask for the document
--   has_meta_business_manager = false/null
--       -> no Business Manager yet; verification will be required when we
--          create one, so ask for the document without showing the gate
--   has_meta_business_manager = true  and meta_business_verified = true
--       -> nothing needed, the question never renders
--
-- Tri-state boolean, matching has_facebook_account, has_meta_business_manager
-- and will_add_operator_as_admin: true = yes, false = no, null = not sure or
-- not asked. Types verified against production 2026-07-25.

alter table public.firm_onboarding_intake
  add column if not exists meta_business_verified boolean;

comment on column public.firm_onboarding_intake.meta_business_verified is
  'Whether the firm''s Meta Business Manager has already completed Meta business verification. true = verified, false = not yet, null = not sure or not asked. Gates the business verification document question.';
