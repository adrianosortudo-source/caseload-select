-- OPERATOR ACTION REQUIRED. This file is NOT auto-applied by Supabase MCP
-- because the migration role (postgres) lacks permission to alter the
-- supabase_admin role's default privileges. Codex re-audit F0 residual.
--
-- Paste this into Supabase Dashboard → Database → SQL Editor and run it once.
-- The dashboard SQL editor runs with sufficient privilege to modify
-- supabase_admin's default ACL.
--
-- After applying:
--   SELECT pg_get_userbyid(defaclrole) AS owner, defaclacl::text AS acl
--   FROM pg_default_acl
--   WHERE defaclnamespace = 'public'::regnamespace AND defaclobjtype = 'r';
--
-- Both rows should show only postgres / supabase_admin / service_role grants,
-- with NO anon or authenticated entries.
--
-- The script scripts/check-public-grants.mjs in this repo asserts the same
-- invariant from the application side as a defense-in-depth: any anon /
-- authenticated grant on any table in schema public (outside the documented
-- intake_firms column allowlist) fails the check. Run with:
--   node scripts/check-public-grants.mjs

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
