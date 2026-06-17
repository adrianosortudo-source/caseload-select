-- firm_lawyers: soft-disable for portal-access removal.
--
-- Removing a member from the operator access tool sets disabled=true rather
-- than deleting the row (keeps attribution + audit). The magic-link send
-- paths (public request-link + operator resend) skip disabled rows, so a
-- removed person can no longer obtain a NEW link. An already-issued session
-- is a stateless 30-day HMAC cookie and lives out its term (documented
-- trade; true instant revoke needs a session-version layer, not built).
alter table public.firm_lawyers
  add column if not exists disabled boolean not null default false,
  add column if not exists disabled_at timestamptz;
