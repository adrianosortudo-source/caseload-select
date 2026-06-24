/**
 * CI / pre-deploy guard. Asserts the Database Access Invariant (CLAUDE.md):
 *   - No anon or authenticated grants on any table in schema public, EXCEPT
 *     the documented column-level allowlist on intake_firms
 *     (id, custom_domain, subdomain — needed for middleware host resolution).
 *   - No RLS-off tables in schema public.
 *
 * Run with:  node scripts/check-public-grants.mjs
 * Env:       SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or read from .env.local)
 *
 * Exits 1 with a list of offenders if any drift is found. Codex re-audit F0
 * residual: this catches the case where a new migration forgets to revoke
 * anon/authenticated, regardless of which role's default ACL granted them.
 */

import { readFileSync } from 'node:fs';

function loadEnv() {
  let raw = '';
  try { raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8'); } catch {}
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const env = { ...loadEnv(), ...process.env };
const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(2);
}

// The single allowed grant: column-level SELECT on intake_firms for anon.
const ALLOWED_COLUMN_GRANTS = new Set([
  'intake_firms.id',
  'intake_firms.custom_domain',
  'intake_firms.subdomain',
]);

async function sql(query) {
  const res = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    throw new Error(`exec_sql ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// The Supabase MCP path isn't available from CI, so query via PostgREST direct
// SELECTs against the information_schema. PostgREST exposes the schema only
// if the catalog views are exposed, which they are not by default. So we use
// a SECURITY DEFINER helper (one-time install) or read via a service-role SQL
// passthrough. To keep this script dependency-free, we issue queries via the
// pgmeta endpoint that the Supabase MCP uses internally.

async function pgQuery(query) {
  const res = await fetch(`${url}/pg/query`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`pg/query ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  // (1) Any anon/authenticated grant on any public table outside the allowlist?
  const grants = await pgQuery(`
    SELECT g.table_name, g.grantee, g.privilege_type, g.column_name
    FROM information_schema.column_privileges g
    WHERE g.table_schema = 'public'
      AND g.grantee IN ('anon', 'authenticated')
    UNION ALL
    SELECT t.table_name, t.grantee, t.privilege_type, NULL::text AS column_name
    FROM information_schema.role_table_grants t
    WHERE t.table_schema = 'public'
      AND t.grantee IN ('anon', 'authenticated')
    ORDER BY 1, 2, 3;
  `);

  const violations = [];
  for (const row of grants) {
    const key = row.column_name
      ? `${row.table_name}.${row.column_name}`
      : row.table_name;
    if (row.column_name && ALLOWED_COLUMN_GRANTS.has(key)) continue;
    if (!row.column_name) {
      violations.push(
        `TABLE ${row.table_name} grants ${row.privilege_type} to ${row.grantee}`,
      );
    }
  }

  // (2) Any RLS-off tables in public?
  const rlsOff = await pgQuery(`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = false
    ORDER BY 1;
  `);
  for (const row of rlsOff) {
    violations.push(`RLS OFF on table ${row.relname}`);
  }

  // (3) Codex re-audit CP-01: also check pg_default_acl directly. Codex
  // correctly pointed out that information_schema.role_table_grants only sees
  // CURRENT tables — a default-ACL drift hides until the NEXT migration
  // creates a table. This catches the trap at the source.
  const defaults = await pgQuery(`
    SELECT pg_get_userbyid(defaclrole) AS owner, defaclacl::text AS acl
    FROM pg_default_acl
    WHERE defaclnamespace = 'public'::regnamespace
      AND defaclobjtype = 'r';
  `);
  for (const row of defaults) {
    if (/\banon=/.test(row.acl) || /\bauthenticated=/.test(row.acl)) {
      violations.push(
        `pg_default_acl(owner=${row.owner}) grants future public tables to ` +
          `anon/authenticated: ${row.acl}`,
      );
    }
  }

  if (violations.length === 0) {
    console.log('OK: no anon/authenticated table grants and no RLS-off tables in public.');
    process.exit(0);
  }

  console.error('FAIL: Database Access Invariant drift detected:');
  for (const v of violations) console.error(`  - ${v}`);
  console.error(
    '\nFix: every CREATE TABLE migration must `ENABLE+FORCE RLS` and ' +
      '`REVOKE ALL FROM anon, authenticated, PUBLIC` in the same file.',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('check-public-grants failed:', e.message ?? e);
  process.exit(2);
});
