-- firm_onboarding_intake: v2 field expansion (two-form onboarding).
--
-- Adds a form_type discriminator ('registration' | 'profile') plus columns for
-- the Form 1 additions (LSO and bar record, languages, domain/DNS/email) and
-- the new Form 2 "Firm Profile" intake (operations, brand, growth). All
-- additive and nullable; existing rows are unaffected and read as registration.
alter table public.firm_onboarding_intake
  add column if not exists form_type text not null default 'registration',
  -- Form 1 additions
  add column if not exists lso_member_number text,
  add column if not exists registered_legal_name text,
  add column if not exists additional_bar_admissions jsonb,
  add column if not exists real_estate_insured text,
  add column if not exists offers_limited_scope text,
  add column if not exists professional_liability_insurance text,
  add column if not exists languages jsonb,
  add column if not exists languages_other text,
  add column if not exists domain_registrar text,
  add column if not exists dns_control text,
  add column if not exists dns_access_preference text,
  add column if not exists email_platform text,
  -- Form 2: Firm Profile
  add column if not exists office_model text,
  add column if not exists firm_size text,
  add column if not exists annual_revenue_band text,
  add column if not exists second_contact text,
  add column if not exists ooo_pattern text,
  add column if not exists past_clients_active integer,
  add column if not exists past_clients_mid integer,
  add column if not exists past_clients_closed integer,
  add column if not exists baseline_inquiry_volume integer,
  add column if not exists fee_structure text,
  add column if not exists payment_methods jsonb,
  add column if not exists esignature_tool text,
  add column if not exists marketing_crm text,
  add column if not exists brand_assets_status text,
  add column if not exists brand_assets_notes text,
  add column if not exists photos_status text,
  add column if not exists social_linkedin_personal text,
  add column if not exists social_instagram text,
  add column if not exists social_x text,
  add column if not exists social_facebook text,
  add column if not exists icp_want_more text,
  add column if not exists icp_decline text,
  add column if not exists review_comfort text,
  add column if not exists profile_notes text,
  add column if not exists profile_uploads jsonb;

alter table public.firm_onboarding_intake drop constraint if exists firm_onboarding_intake_form_type_check;
alter table public.firm_onboarding_intake
  add constraint firm_onboarding_intake_form_type_check check (form_type in ('registration', 'profile'));
