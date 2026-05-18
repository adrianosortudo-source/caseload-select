# Supabase project migration runbook

How to move CaseLoad Select from one Supabase project (region, account, or both) to another, with minimal downtime and a clean post-cutover state.

This runbook was first executed on 2026-05-18 to move from `qpzopweonveumvuqkqgw` (us-east-2 / Ohio) to `ssxryjxifwiivghglqer` (ca-central-1 / Montreal). The data-residency move unblocks the "client lead data is stored in Canadian data centers" line used in client-facing copy.

## When to run this runbook

- Region change (the original case)
- Moving infrastructure from a personal email to a `manager@caseloadselect.ca` org-owned account
- Tier upgrade where the upgrade path requires a new project
- Disaster recovery: hot-spare project failover

## Prerequisites

| Tool | Version tested | Install |
|---|---|---|
| PostgreSQL client | 17.x | `winget install PostgreSQL.PostgreSQL.17` (Windows), `apt install postgresql-client-17` (Linux) |
| Supabase CLI | 2.x | `npm install -g supabase` |
| Vercel CLI | 54.x | `npm install -g vercel` |
| Node.js | 20+ | for the `pg` client and ad-hoc scripts |
| `curl` | any | for Storage REST API migration |

Note: `supabase db dump --linked` requires Docker Desktop. The runbook below uses raw `pg_dump` and `psql` instead, which works without Docker.

Generate two strong DB passwords up front (32 chars, no `/` `+` `=`):

```bash
openssl rand -base64 32 | tr -d '/+=' | head -c 32
```

Use one for the new project at creation time, hold the other for the password-reset step on the old project.

## Phase 0 — Pre-flight audit

Run on the OLD project to inventory everything that needs to come over:

```sql
-- Tables and row counts
SELECT schemaname, tablename, n_live_tup
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC;

-- Extensions installed
SELECT name, installed_version
FROM pg_available_extensions
WHERE installed_version IS NOT NULL;

-- pg_cron jobs
SELECT jobid, jobname, schedule, active, command FROM cron.job;

-- Vault secrets (names only; do not log decrypted_secret values)
SELECT name, description FROM vault.secrets;

-- Custom functions in public + custom schemas
SELECT n.nspname, p.proname
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname NOT IN ('pg_catalog','information_schema','auth','storage','extensions','vault','realtime')
ORDER BY n.nspname, p.proname;

-- Storage buckets and object counts
SELECT id, name, public FROM storage.buckets;
SELECT bucket_id, count(*), pg_size_pretty(sum((metadata->>'size')::bigint)) FROM storage.objects GROUP BY bucket_id;

-- Auth users (often 0 if app uses HMAC magic links)
SELECT count(*) FROM auth.users;

-- Edge Functions
-- (use `supabase functions list` or the MCP `list_edge_functions`)
```

Write the results to a checklist. Use the same checklist after restore to confirm every count matches.

## Phase 1 — Create the new project

In the Supabase dashboard:

1. **Org → New project**
2. Name: pick something descriptive (e.g. `caseload-select-ca`)
3. **Region: select the target region.** This cannot be changed after creation.
4. Database password: paste the password you generated.
5. Plan: Free tier is fine for ≤2 active projects; upgrade later if needed.
6. Click **Create new project** and wait for status `ACTIVE_HEALTHY`.

Note the project ref (the slug before `.supabase.co` in the new URL). Capture both the legacy anon key and service_role key from **Settings → API Keys → Legacy anon, service_role API keys** — production code uses the JWT format.

Enable any extensions the old project had that aren't installed by default. Common ones the app uses:

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
-- pgcrypto, supabase_vault, uuid-ossp, pg_stat_statements, plpgsql are pre-installed
```

## Phase 2 — Reset the OLD project DB password

The DB password is needed for `pg_dump`. If the original password is lost (very common — Supabase doesn't display it after creation), reset it:

1. Old project → **Settings → Database → Reset database password**
2. Enter the second strong password you generated
3. Save

**Safe operation:** the live app uses API keys, not the DB password. Resetting only breaks direct Postgres connections (psql, pg_dump, DBeaver). The app keeps serving uninterrupted.

## Phase 3 — Get session pooler URLs

Free-tier Supabase makes direct DB connections IPv6-only. From most Windows / Mac / IPv4 networks, `db.{ref}.supabase.co:5432` will fail with ENOTFOUND. Use the session pooler instead.

For each project:

1. Dashboard → **Connect** (top-right) → **Direct** tab → **Session pooler**
2. Copy the connection string template
3. Substitute the DB password

Format:

```
postgresql://postgres.{project_ref}:{password}@aws-{N}-{region}.pooler.supabase.com:5432/postgres
```

Verify both before proceeding:

```bash
psql "$OLD_URL" -c "SELECT current_database(), current_user, version()"
psql "$NEW_URL" -c "SELECT current_database(), current_user, version()"
```

Both should return clean. If not, double-check the password and `aws-N-region` prefix from the dashboard.

## Phase 4 — Dump and restore

Dump the OLD project's `public` schema and any custom schemas (the app uses `cron_internal`):

```bash
mkdir -p /tmp/supabase-migration && cd /tmp/supabase-migration

pg_dump "$OLD_URL" \
  --schema=public \
  --schema=cron_internal \
  --no-owner --no-privileges \
  --no-publications --no-subscriptions \
  -f dump_full.sql
```

Restore to the NEW project:

```bash
psql "$NEW_URL" -f dump_full.sql 2>&1 | tee restore.log
grep -iE "^error|^psql:" restore.log
```

One expected benign error: `schema "public" already exists`. Anything else is real and needs investigation.

Verify row counts match the audit:

```sql
-- On NEW project, repeat the audit queries from Phase 0
```

## Phase 5 — Recreate Vault + pg_cron

Neither vault.secrets nor cron.job rows migrate via pg_dump (they live in extension-managed schemas). Recreate manually.

### Vault

```sql
-- Get the value from the OLD project first:
SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'pg_cron_token';

-- On NEW project:
SELECT vault.create_secret('<value>', 'pg_cron_token', '<description>');
```

### pg_cron jobs

On NEW project, schedule the same jobs as on OLD:

```sql
SELECT cron.schedule('triage-backstop-hourly',  '7 * * * *',  $$select cron_internal.call_cron_route('/api/cron/triage-backstop')$$);
SELECT cron.schedule('webhook-retry-5m',        '*/5 * * * *', $$select cron_internal.call_cron_route('/api/cron/webhook-retry')$$);
SELECT cron.schedule('expire-channel-intake-sessions-hourly', '23 * * * *', $$select cron_internal.call_cron_route('/api/cron/expire-channel-intake-sessions')$$);

SELECT jobid, jobname, schedule, active FROM cron.job;
```

The `cron_internal.call_cron_route()` function came over via pg_dump in Phase 4. Verify it exists on NEW.

## Phase 6 — Storage objects

Buckets do not auto-migrate. Recreate them on NEW:

```sql
INSERT INTO storage.buckets (id, name, public, created_at, updated_at) VALUES
  ('intake-attachments',  'intake-attachments',  true,  '<created_at>', NOW()),
  ('firm-files',          'firm-files',          false, '<created_at>', NOW()),
  ('firm-onboarding-docs','firm-onboarding-docs',false, '<created_at>', NOW())
ON CONFLICT (id) DO NOTHING;
```

Object content lives in S3-backed storage, accessed via the Supabase Storage REST API. Download from old, upload to new:

```bash
# Get service_role keys for both projects from
# Dashboard → Settings → API Keys → Legacy anon, service_role API keys
OLD_SVC="<old legacy service_role JWT>"
NEW_SVC="<new legacy service_role JWT>"

for path in "<bucket>/<full/object/path>" ...; do
  bucket=${path%%/*}
  curl -sf -H "Authorization: Bearer $OLD_SVC" -H "apikey: $OLD_SVC" \
    "https://{old_ref}.supabase.co/storage/v1/object/$path" \
    -o "files/$(basename "$path")"

  curl -sf -X POST \
    -H "Authorization: Bearer $NEW_SVC" -H "apikey: $NEW_SVC" \
    -H "Content-Type: <mimetype>" \
    --data-binary "@files/$(basename "$path")" \
    "https://{new_ref}.supabase.co/storage/v1/object/$path"
done
```

Verify upload success in the response body (JSON with `Key` and `Id` fields).

## Phase 7 — Vercel env var swap (the cutover moment)

This is the moment production traffic shifts to the new project.

```bash
cd <repo>
vercel link --yes --project caseload-select --scope <scope>
vercel whoami  # verify

NEW_URL="https://<new_ref>.supabase.co"
NEW_ANON="<new legacy anon JWT>"
NEW_SVC="<new legacy service_role JWT>"

for env in production preview development; do
  vercel env rm NEXT_PUBLIC_SUPABASE_URL      $env --yes 2>/dev/null
  vercel env rm NEXT_PUBLIC_SUPABASE_ANON_KEY $env --yes 2>/dev/null
  vercel env rm SUPABASE_SERVICE_ROLE_KEY     $env --yes 2>/dev/null
done

for env in production development; do
  vercel env add NEXT_PUBLIC_SUPABASE_URL      $env --value "$NEW_URL"  --yes
  vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY $env --value "$NEW_ANON" --yes
done
vercel env add SUPABASE_SERVICE_ROLE_KEY production --value "$NEW_SVC" --yes
```

For Preview env (per-branch): pass the git branch as the third positional argument, or set via the dashboard.

Trigger a redeploy with the new env vars:

```bash
vercel ls          # find the most recent production deployment URL
vercel redeploy <prod-url>
```

Wait for `Ready` and verify the production alias (`app.caseloadselect.ca`) is updated.

## Phase 8 — Smoke test

Liveness:

```bash
curl -sI https://app.caseloadselect.ca/privacy -o /dev/null -w "%{http_code}\n"  # expect 200
curl -sI https://app.caseloadselect.ca/terms   -o /dev/null -w "%{http_code}\n"  # expect 200
```

Direct DB verification via MCP (or psql):

```sql
SELECT id, name, whatsapp_phone_number_id FROM intake_firms ORDER BY name;
SELECT count(*) FROM screened_leads;
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;
```

If WhatsApp Cloud API integration is active: send a test message and verify the engine reply fires. The closing-message Send hit failure here typically means the test access token expired (Meta dev tokens are short-lived).

## Phase 9 — Post-cutover hygiene

- Commit the updated `supabase/config.toml` (this file) pointing at the new ref.
- Update `CLAUDE.md` references from old ref to new ref.
- Update copy in `/privacy` to reflect Canadian data residency.
- Update CRM Bible v5.1 (or write a new DR) noting the migration.
- Set up `scripts/backup-supabase.sh` to run weekly (cron, GitHub Action, or manual).

## Phase 10 — Decommission OLD

Keep the OLD project alive for **at least one week** after cutover. Watch for:

- Vercel deploys staying green
- Lawyer notifications still firing
- pg_cron jobs producing `cron.job_run_details` rows on the NEW project

After the grace window:

1. Pause / disable pg_cron jobs on OLD (`SELECT cron.unschedule(jobid) FROM cron.job;`)
2. Delete the OLD project via dashboard → **Project Settings → General → Delete project**
3. Free-tier project slot is back; the org now has one less project.

## Rollback

The cleanest rollback is to point Vercel back at the OLD project's env vars. Vercel keeps env var history in **Settings → Environment Variables → History**. Redeploy after revert.

Old data continues writing to NEW project for the brief window before rollback. If rollback is needed, manually replay any new-project writes to old before re-cutting over. Worst-case downtime: 10-15 min.

## What does NOT migrate via this runbook

| Thing | Why | Action |
|---|---|---|
| Supabase Edge Functions | not in `pg_dump` | redeploy manually via `supabase functions deploy` |
| Realtime channels | server-side config | reconfigure via dashboard if used |
| Auth providers (Google, GitHub OAuth) | per-project secrets | re-enable via dashboard if used |
| GitHub integration | per-project | reconnect via dashboard if used |

The app at the time of writing does not use Realtime, OAuth providers, or GitHub integration; one Edge Function (`enviar-relatorio`) is unused and was skipped.

## Estimated time

For a 21 MB database with no Auth users, ~600 rows, 3 storage objects, 3 cron jobs, 1 vault secret:

- Phase 0-3 (audit + create + reset): 10 min
- Phase 4-6 (dump + restore + vault + cron + storage): 15 min
- Phase 7-8 (cutover + smoke): 5 min
- Phase 9 (docs): 30 min (one-time investment)
- Total active time: under 1 hour

Larger databases scale linearly with `pg_dump` / `psql` runtime; the rest is constant.
