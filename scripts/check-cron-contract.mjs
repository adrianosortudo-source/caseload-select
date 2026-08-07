/**
 * Cron contract guard.
 *
 * The cron surface is invoked by two schedulers that live outside the type
 * system — vercel.json and pg_cron on the production Supabase project — so
 * three invariants are invisible to tsc, eslint, and the test suite:
 *
 *  1. AUTH — every route under src/app/api/cron/ must gate on
 *     isCronAuthorized / isAuthorizationHeaderValid (src/lib/cron-auth.ts).
 *     All 23 routes did when this guard was written (2026-08-07); this keeps
 *     a new route from merging without it.
 *  2. SCHEDULE→ROUTE — every path a scheduler fires at must exist on disk.
 *     Renaming a route otherwise turns a schedule into silent 404s.
 *  3. ROUTE→SCHEDULE — every cron route must be registered somewhere:
 *     vercel.json, scripts/cron-manifest.json pgCron (mirror of the live
 *     jobs), or the manifest's unscheduled allowlist with a reason.
 *
 * Runs in `npm run build` (so Vercel deploys enforce it — same pattern as
 * check-no-em-dash-marketing.mjs) and as a CI step. Dependency-free on
 * purpose: bare `node scripts/check-cron-contract.mjs` must always work.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CRON_DIR = join(ROOT, "src", "app", "api", "cron");
const manifest = JSON.parse(readFileSync(join(ROOT, "scripts", "cron-manifest.json"), "utf8"));
const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));

const violations = [];
const routeFileFor = (urlPath) =>
  join(ROOT, "src", "app", ...urlPath.split("/").filter(Boolean), "route.ts");

// 2a. vercel.json schedules point at real routes.
for (const c of vercel.crons ?? []) {
  if (!existsSync(routeFileFor(c.path)))
    violations.push(`vercel.json cron "${c.path}" (${c.schedule}) has no route.ts on disk`);
}

// 2b. pg_cron mirror entries point at real routes.
for (const j of manifest.pgCron) {
  if (!existsSync(routeFileFor(j.path)))
    violations.push(`pg_cron job "${j.jobname}" targets "${j.path}" which has no route.ts on disk — if the route moved, the LIVE pg_cron job must move with it (migration), then update the manifest`);
}

// Stale-allowlist check: unscheduled entries must still exist too.
for (const u of manifest.unscheduled) {
  if (!existsSync(routeFileFor(u.path)))
    violations.push(`manifest unscheduled entry "${u.path}" has no route.ts on disk — remove the stale entry`);
}

// 1 + 3. Every cron route dir: authed, and registered somewhere.
const registered = new Set([
  ...(vercel.crons ?? []).map((c) => c.path),
  ...manifest.pgCron.map((j) => j.path),
  ...manifest.unscheduled.map((u) => u.path),
]);
const dirs = readdirSync(CRON_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

for (const name of dirs) {
  const urlPath = `/api/cron/${name}`;
  const file = join(CRON_DIR, name, "route.ts");
  if (!existsSync(file)) {
    violations.push(`${urlPath}: directory exists but has no route.ts`);
    continue;
  }
  const src = readFileSync(file, "utf8");
  if (!/isCronAuthorized|isAuthorizationHeaderValid/.test(src))
    violations.push(`${urlPath}: no cron auth call found — every cron route must gate on isCronAuthorized/isAuthorizationHeaderValid from @/lib/cron-auth`);
  if (!registered.has(urlPath))
    violations.push(`${urlPath}: not in vercel.json crons, not in cron-manifest.json pgCron, not allowlisted as unscheduled — schedule it or register it with a reason`);
}

// Discovery sanity: a broken glob must fail loudly, not pass emptily.
if (dirs.length < 20)
  violations.push(`discovery: only ${dirs.length} cron route dirs found under src/app/api/cron — expected 20+; the guard's file discovery broke, fix the guard, don't skip it`);

if (violations.length) {
  console.error(`✖ cron contract: ${violations.length} violation(s)\n`);
  for (const v of violations) console.error("  - " + v);
  process.exit(1);
}
console.log(
  `✓ cron contract: ${dirs.length} routes authed; ${(vercel.crons ?? []).length} vercel + ${manifest.pgCron.length} pg_cron schedules resolve; ${manifest.unscheduled.length} allowlisted unscheduled`,
);
