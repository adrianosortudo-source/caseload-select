-- Firm onboarding intake — channel preferences + signature block
--
-- Adds:
-- * intake_channels (JSONB array) — which channels the firm wants CaseLoad
--   Screen to handle. Values from {whatsapp, sms, voice, instagram_dm,
--   facebook_messenger, gbp_chat, discuss}. Web is always implied.
-- * signed_name + signed_email — typed signature at the bottom of the form.
--   Replaces the bare consent checkbox with a more deliberate authorization
--   gesture. The act of typing the name and clicking Submit is the consent.

ALTER TABLE firm_onboarding_intake
  ADD COLUMN IF NOT EXISTS intake_channels jsonb,
  ADD COLUMN IF NOT EXISTS signed_name text,
  ADD COLUMN IF NOT EXISTS signed_email text;

COMMENT ON COLUMN firm_onboarding_intake.intake_channels IS
  'JSON array of channel keys the firm wants CaseLoad Screen to handle. One or more of: whatsapp, sms, voice, instagram_dm, facebook_messenger, gbp_chat, discuss. Web is always implied (the widget).';
COMMENT ON COLUMN firm_onboarding_intake.signed_name IS
  'Full name typed by the rep at the bottom of the form. The act of typing the name + clicking Submit constitutes the authorization for CaseLoad Select to act on the firm behalf.';
COMMENT ON COLUMN firm_onboarding_intake.signed_email IS
  'Email associated with the typed signature. Defaults to authorized_rep_email but the rep can change it if the signing identity differs.';
