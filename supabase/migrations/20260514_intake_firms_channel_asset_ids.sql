-- =============================================================================
-- intake_firms — channel asset ID columns
-- =============================================================================
-- Adds three columns to `intake_firms` so inbound webhook handlers (Messenger,
-- Instagram, WhatsApp Cloud API) can resolve a Meta-side asset ID to one firm.
--
-- Why this exists (CRM Bible DR-022 channels-as-input doctrine):
--   Every inbound channel webhook arrives with an asset ID (Page ID for
--   Messenger, IG Business Account ID for Instagram, Phone Number ID for
--   WhatsApp Cloud API). The screen engine has to know which firm owns that
--   asset before it can run the right config (practice areas, value tiers,
--   decline templates). Without this mapping, the receivers can only ACK; they
--   cannot persist a `screened_leads` row for the correct firm. The runbook
--   receivers at `src/app/api/{messenger,instagram,whatsapp}-intake/route.ts`
--   carry a TODO referencing this mapping.
--
-- Why columns (not a join table):
--   ICP today is sole practitioners and 2-lawyer firms. Each firm has one FB
--   Page, one IG Business Account, one WhatsApp number. A 1:1 column is
--   idiomatic for that cardinality and avoids a join on every inbound webhook.
--   If a firm ever needs multiple Pages later, we add a `firm_channel_assets`
--   join table beside these columns (additive, not breaking).
--
-- Why unique indexes:
--   One Meta asset = one firm. If two `intake_firms` rows both claim
--   `facebook_page_id = X`, the receiver cannot route inbound deterministically.
--   Partial unique indexes (WHERE col IS NOT NULL) so NULLs do not collide.
--
-- Asset ID source notes (operator reference):
--   facebook_page_id              From the Page asset selector in Meta dev console
--                                 OR via Graph API: GET /me/accounts (paginated).
--                                 NOT the profile.php?id=<…> variant (that is the
--                                 user-facing profile ID; receivers see the asset ID).
--   instagram_business_account_id From Graph API:
--                                   GET /<page-id>?fields=instagram_business_account
--                                 OR the dev console Instagram-via-Page settings.
--                                 NOT the @username (string handle, not the ID).
--   whatsapp_phone_number_id      From the WhatsApp use case API Setup page in the
--                                 Meta dev console (under "From"). NOT the display
--                                 phone number — that is the human-readable +1 555…
--                                 form. Receivers see the Phone Number ID in the
--                                 webhook payload's `metadata.phone_number_id`.
-- =============================================================================

ALTER TABLE intake_firms
  ADD COLUMN IF NOT EXISTS facebook_page_id              text,
  ADD COLUMN IF NOT EXISTS instagram_business_account_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id      text;

COMMENT ON COLUMN intake_firms.facebook_page_id IS
  'Meta-side Facebook Page asset ID (NOT the user-facing profile.php id). Inbound Messenger webhooks carry this in `entry[].id`. One Page maps to one firm.';

COMMENT ON COLUMN intake_firms.instagram_business_account_id IS
  'Meta-side Instagram Business Account ID (NOT the @username). Inbound Instagram DM webhooks carry this in `entry[].id` (the IG account the message was sent TO). One IG account maps to one firm.';

COMMENT ON COLUMN intake_firms.whatsapp_phone_number_id IS
  'Meta-side WhatsApp Cloud API Phone Number ID (NOT the display phone number). Inbound WhatsApp webhooks carry this in `entry[].changes[].value.metadata.phone_number_id`. One Phone Number ID maps to one firm.';

-- One asset = one firm. Partial unique indexes so NULLs do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_intake_firms_facebook_page_id
  ON intake_firms (facebook_page_id)
  WHERE facebook_page_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_intake_firms_instagram_business_account_id
  ON intake_firms (instagram_business_account_id)
  WHERE instagram_business_account_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_intake_firms_whatsapp_phone_number_id
  ON intake_firms (whatsapp_phone_number_id)
  WHERE whatsapp_phone_number_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
