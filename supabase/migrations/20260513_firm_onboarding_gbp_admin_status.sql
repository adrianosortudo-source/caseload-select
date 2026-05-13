-- Firm onboarding intake — Google Business Profile admin status
--
-- Every firm we onboard needs to grant CaseLoad Select Manager-level
-- access to their Google Business Profile. GBP is the foundation of the
-- "Capture" pillar of ACTS (local SEO, local visibility) and is needed
-- regardless of whether the firm chose `gbp_chat` as an intake channel.

ALTER TABLE firm_onboarding_intake
  ADD COLUMN IF NOT EXISTS gbp_admin_status text,
  ADD COLUMN IF NOT EXISTS gbp_admin_blocker_note text;

COMMENT ON COLUMN firm_onboarding_intake.gbp_admin_status IS
  'One of: not_started / in_progress / granted / blocked. Tracks whether the rep added the operator as Manager on the firm Google Business Profile.';
