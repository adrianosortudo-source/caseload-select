-- firm_onboarding_intake: customer-base list upload (Firm Profile, Form 2).
--
-- The Firm Profile form asks the firm to upload a client list (names, contact
-- details, practice area) so we can build relevant messages. No case details.
-- Stored in the firm-onboarding-docs bucket; these columns hold the pointer.
alter table public.firm_onboarding_intake
  add column if not exists customer_base_storage_path text,
  add column if not exists customer_base_original_name text,
  add column if not exists customer_base_size_bytes bigint,
  add column if not exists customer_base_mime_type text;
