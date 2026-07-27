-- SECURITY FIX (Critical), applied to prod 2026-06-23 via Supabase MCP.
--
-- The 20260623_content_approval tables shipped RLS-off and inherited the
-- public schema's default anon/authenticated CRUD grant (verified in
-- pg_default_acl: both the postgres and supabase_admin default ACLs grant ALL
-- to anon + authenticated on every newly created table). Result: the LSO
-- Rule 4.2-1 compliance log (approval_records: signer name, email, IP) and
-- every firm's marketing drafts were readable, forgeable, and deletable with
-- the public anon key.
--
-- This locks the four tables to service-role-only (the app's access model;
-- service_role bypasses RLS, identical to the matter_messages posture) and
-- revokes the default privilege so future migration-created tables are not
-- born exposed. Per the Database Access Invariant in CLAUDE.md.

ALTER TABLE content_deliverables  ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_deliverables  FORCE  ROW LEVEL SECURITY;
ALTER TABLE deliverable_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliverable_versions  FORCE  ROW LEVEL SECURITY;
ALTER TABLE deliverable_comments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliverable_comments  FORCE  ROW LEVEL SECURITY;
ALTER TABLE approval_records      ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_records      FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON content_deliverables FROM anon, authenticated, PUBLIC;
REVOKE ALL ON deliverable_versions FROM anon, authenticated, PUBLIC;
REVOKE ALL ON deliverable_comments FROM anon, authenticated, PUBLIC;
REVOKE ALL ON approval_records     FROM anon, authenticated, PUBLIC;

-- Root-cause containment: stop the public-schema default privilege from
-- re-granting anon/authenticated on every future table created by postgres.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
