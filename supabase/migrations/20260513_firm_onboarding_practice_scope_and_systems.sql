-- Firm onboarding intake — practice scope, lawyer team, and existing systems
--
-- Adds 12 columns covering the gaps surfaced in the 2026-05-13 form audit:
--
-- Section 1 extensions
--   office_hours              — firm operating hours, affects acknowledgment cadence
--   additional_lawyers        — JSONB array of {name, email, role?} for lawyers
--                               beyond the authorized rep. Used to populate the
--                               firm_lawyers table at firm setup time.
--
-- New Section 2: Practice scope
--   practice_areas            — JSONB array of practice area keys
--   practice_areas_other      — free-text additions for niche areas
--   service_area              — toronto_core / gta / ontario_wide / cross_border / other
--   service_area_other        — free text when service_area = other
--   out_of_scope_notes        — matter types the firm explicitly does not handle
--
-- New Section 3: Existing systems
--   existing_website_form_url — current contact form URL on the firm's site
--   existing_phone_lines      — main phone lines used for legal inquiries
--   practice_management_system — clio / practice_panther / mycase / cosmolex /
--                                leap / pclaw / soluno / other / none
--   practice_management_system_other — free text when system = other
--   pms_integration_preference — yes / not_now / discuss

ALTER TABLE firm_onboarding_intake
  ADD COLUMN IF NOT EXISTS office_hours text,
  ADD COLUMN IF NOT EXISTS additional_lawyers jsonb,
  ADD COLUMN IF NOT EXISTS practice_areas jsonb,
  ADD COLUMN IF NOT EXISTS practice_areas_other text,
  ADD COLUMN IF NOT EXISTS service_area text,
  ADD COLUMN IF NOT EXISTS service_area_other text,
  ADD COLUMN IF NOT EXISTS out_of_scope_notes text,
  ADD COLUMN IF NOT EXISTS existing_website_form_url text,
  ADD COLUMN IF NOT EXISTS existing_phone_lines text,
  ADD COLUMN IF NOT EXISTS practice_management_system text,
  ADD COLUMN IF NOT EXISTS practice_management_system_other text,
  ADD COLUMN IF NOT EXISTS pms_integration_preference text;

COMMENT ON COLUMN firm_onboarding_intake.additional_lawyers IS
  'JSONB array of {name, email, role?} for lawyers beyond the authorized rep.';
COMMENT ON COLUMN firm_onboarding_intake.practice_areas IS
  'JSONB array of practice area keys from the form picker. Mirrors intake_firms.practice_areas structure.';
COMMENT ON COLUMN firm_onboarding_intake.service_area IS
  'One of: toronto_core, gta, ontario_wide, cross_border, other.';
COMMENT ON COLUMN firm_onboarding_intake.practice_management_system IS
  'One of: clio, practice_panther, mycase, cosmolex, leap, pclaw, soluno, other, none. Drives downstream integration setup.';
COMMENT ON COLUMN firm_onboarding_intake.pms_integration_preference IS
  'One of: yes, not_now, discuss. Indicates whether the firm wants CaseLoad Select to integrate with their PMS at go-live.';
