-- =============================================================================
-- Firm onboarding intake — directory submission preparation fields
-- =============================================================================
-- Adds three columns to `firm_onboarding_intake` to capture the universal data
-- points every Canadian legal directory submission needs from a law firm:
--
--   1. authorized_rep_year_of_call   — year the lead lawyer was called to the bar
--   2. authorized_rep_province_of_call — provincial bar of call (e.g. 'ON')
--   3. previous_business_names       — prior business names / d/b/a, free text
--
-- Why these three:
-- Pre-sale Marketing Diagnostic discovers each firm's existing directory
-- footprint (LSO, Canadian Law List, Yellow Pages Canada, Martindale, Avvo,
-- Justia, FindLaw, etc.). The diagnostic produces a per-firm directory cleanup
-- brief (see the DRG Law Damaris handoff brief as the model). The onboarding
-- form does NOT re-ask the firm to enumerate their directory footprint — the
-- operator already has that data. What the form DOES ask for is the universal
-- inputs every directory submission needs that the operator cannot reverse-
-- engineer from public sources: year of call, province of call, and any prior
-- business names the firm has traded under.
--
-- The per-lawyer fields for additional lawyers (beyond the authorized rep) are
-- captured by extending the existing `additional_lawyers` JSONB column shape
-- from `{name, email, role}` to `{name, email, role, year_of_call,
-- province_of_call}`. JSONB is permissive — old rows without the new keys
-- continue to load fine; new submissions include them.
--
-- A Phase 2 follow-up will add a per-firm "Directory Packet" surface where the
-- operator pre-fills the rows discovered during the diagnostic and the firm
-- confirms / corrects each one, plus answers any per-directory question that
-- requires the firm's input (e.g. LexTransact confirmation, callback windows).
-- That work is not in this migration.
--
-- Idempotent. Column-add only.

ALTER TABLE public.firm_onboarding_intake
  ADD COLUMN IF NOT EXISTS authorized_rep_year_of_call SMALLINT,
  ADD COLUMN IF NOT EXISTS authorized_rep_province_of_call TEXT,
  ADD COLUMN IF NOT EXISTS previous_business_names TEXT;

COMMENT ON COLUMN public.firm_onboarding_intake.authorized_rep_year_of_call IS
  'Year the authorized representative was called to the bar (e.g. 2015). Used by directory submissions and lawyer-profile fields. SMALLINT covers all plausible years.';

COMMENT ON COLUMN public.firm_onboarding_intake.authorized_rep_province_of_call IS
  'ISO-style two-letter Canadian province/territory code for the authorized representative''s bar of call (e.g. ON, BC, AB, QC, MB, SK, NS, NB, NL, PE, NT, NU, YT). Free TEXT to keep the schema flexible for cross-border calls.';

COMMENT ON COLUMN public.firm_onboarding_intake.previous_business_names IS
  'Free-text list of prior business names, d/b/a names, or predecessor firm names. Used by directory cleanup work (Yellow Pages dedup, Google Business Profile name history audit) and by lawyer-profile fields that ask "previously known as".';
