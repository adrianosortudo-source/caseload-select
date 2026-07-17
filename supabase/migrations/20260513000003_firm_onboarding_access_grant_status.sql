-- Firm onboarding intake — access-grant status tracking
--
-- Adds status fields for the three access grants the firm rep is asked
-- to complete during onboarding: Meta Business Manager admin, LinkedIn
-- Super admin on the firm Company Page, and Microsoft 365 Exchange Admin
-- (guest user) for email DNS authentication.
--
-- Each status is one of: not_started / in_progress / granted / blocked.
-- Plus an optional blocker_note text field describing what tripped them
-- up if they selected "blocked".
--
-- These power the consolidated onboarding form at /firm-onboarding/[token]
-- and the operator detail view at /admin/onboarding-submissions/[id].

ALTER TABLE firm_onboarding_intake
  ADD COLUMN IF NOT EXISTS linkedin_admin_status text,
  ADD COLUMN IF NOT EXISTS linkedin_admin_blocker_note text,
  ADD COLUMN IF NOT EXISTS m365_admin_status text,
  ADD COLUMN IF NOT EXISTS m365_admin_blocker_note text,
  ADD COLUMN IF NOT EXISTS meta_admin_status text,
  ADD COLUMN IF NOT EXISTS meta_admin_blocker_note text;

COMMENT ON COLUMN firm_onboarding_intake.linkedin_admin_status IS
  'One of: not_started / in_progress / granted / blocked. Tracks whether the rep added the operator as a Super admin on the firm LinkedIn Company Page.';
COMMENT ON COLUMN firm_onboarding_intake.m365_admin_status IS
  'One of: not_started / in_progress / granted / blocked. Tracks whether the rep granted Exchange Administrator (guest user) on the firm Microsoft 365 tenant.';
COMMENT ON COLUMN firm_onboarding_intake.meta_admin_status IS
  'One of: not_started / in_progress / granted / blocked. Tracks whether the rep added the operator as admin on the firm Meta Business Manager.';
