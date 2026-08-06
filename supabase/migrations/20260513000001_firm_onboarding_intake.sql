-- Firm onboarding intake — public-facing form data collection
--
-- This is the firm-SIDE intake form (the firm's authorized rep fills it out
-- before the firm is created in intake_firms). Different from /onboarding,
-- which is the operator-side readiness checklist for firms already in
-- intake_firms.
--
-- One row per firm-intake submission. The submission_token is the opaque
-- label embedded in the form URL (e.g., DRG-LAW-2026-05-13); operator
-- generates the token when sending the link to the firm rep.
--
-- The submission triggers an email notification to the operator via Resend.
-- After receipt, the operator transcribes the data into the actual
-- intake_firms row plus the GHL sub-account configuration.

CREATE TABLE IF NOT EXISTS firm_onboarding_intake (
  id uuid primary key default gen_random_uuid(),
  submission_token text not null,

  -- Section 1: business identity (shared across SMS + WhatsApp + Voice AI)
  legal_name text,
  business_number text,
  business_address text,
  business_website text,
  business_email text,
  authorized_rep_name text,
  authorized_rep_title text,
  authorized_rep_email text,
  authorized_rep_phone text,

  -- Section 2: SMS / A2P 10DLC specifics
  sms_vertical text,
  sms_sender_phone_preference text,

  -- Section 3: WhatsApp / WABA specifics
  whatsapp_number_decision text,
  whatsapp_display_name text,
  whatsapp_business_verification_doc_note text,

  -- Section 4: Meta Business Manager prerequisites
  has_facebook_account boolean,
  has_meta_business_manager boolean,
  meta_business_manager_url text,
  will_add_operator_as_admin boolean,

  -- Submission meta
  consent_acknowledged boolean not null default false,
  notes text,
  submitted_at timestamptz not null default now(),
  ip_address text,
  user_agent text
);

CREATE INDEX IF NOT EXISTS firm_onboarding_intake_token_idx
  ON firm_onboarding_intake (submission_token);
CREATE INDEX IF NOT EXISTS firm_onboarding_intake_submitted_at_idx
  ON firm_onboarding_intake (submitted_at DESC);

COMMENT ON TABLE firm_onboarding_intake IS
  'Firm-side onboarding intake form submissions. Public form at /firm-onboarding/[token]; operator-facing review at /admin/onboarding-submissions.';
COMMENT ON COLUMN firm_onboarding_intake.submission_token IS
  'Opaque label embedded in the form URL. Operator generates per firm. Not authenticated; the link is the credential.';
COMMENT ON COLUMN firm_onboarding_intake.whatsapp_number_decision IS
  'One of: provision_new_ghl_number / port_existing / different_carrier_line. Drives the WABA registration path.';
