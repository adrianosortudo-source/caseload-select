-- Follow-up hardening for the preview-only registry. Keep the already-applied
-- registry migration immutable: this migration reasserts FORCE RLS and removes
-- direct service-key table access while retaining the two narrow RPC grants.

alter table public.preview_qa_sessions force row level security;
alter table public.preview_qa_bootstrap_grants force row level security;

-- The service key must call only the security-definer issue/verify RPCs. It
-- must not read or mutate either registry table directly, even though the
-- role bypasses RLS.
revoke all on table public.preview_qa_sessions from service_role;
revoke all on table public.preview_qa_bootstrap_grants from service_role;
