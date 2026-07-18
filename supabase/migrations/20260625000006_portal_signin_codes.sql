-- Short sign-in links.
--
-- The portal magic link is a self-contained HMAC token, which makes the URL
-- long. To hand a link out-of-band (WhatsApp, text) when email is quarantined,
-- the operator wants a SHORT link. This table is the opaque key behind it:
-- /l/{code} looks the row up, mints the normal token server-side, and redirects
-- into the existing /api/portal/login flow. The code, not the token, is what
-- the operator shares.
--
-- Reusable until expiry (mirrors the 48h magic link). The code is the
-- credential, so it is high-entropy and time-bound.
--
-- Service-role only. RLS forced, anon/authenticated/PUBLIC revoked.
-- Idempotent.

CREATE TABLE IF NOT EXISTS portal_signin_codes (
  code             text PRIMARY KEY,
  firm_id          uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,
  lawyer_id        uuid REFERENCES firm_lawyers(id) ON DELETE CASCADE,
  role             text NOT NULL CHECK (role IN ('lawyer', 'operator')),
  expires_at       timestamptz NOT NULL,
  created_by_role  text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_signin_codes_expires
  ON portal_signin_codes (expires_at);

ALTER TABLE portal_signin_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_signin_codes FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON portal_signin_codes FROM anon, authenticated, PUBLIC;
