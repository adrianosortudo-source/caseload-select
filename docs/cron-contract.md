# Cron contract guard

`scripts/check-cron-contract.mjs` runs in `npm run build` (so Vercel deploy
builds enforce it) and in the CI `typecheck` job. It fails the build when:

- a route under `src/app/api/cron/` lacks an `isCronAuthorized` /
  `isAuthorizationHeaderValid` gate;
- a `vercel.json` cron path has no `route.ts` on disk;
- a `scripts/cron-manifest.json` `pgCron` path has no `route.ts` on disk
  (the manifest mirrors the live pg_cron jobs on the production Supabase
  project — if a migration adds/moves/removes a job, update the manifest in
  the same PR);
- a cron route exists with no registration anywhere (schedule it, or
  allowlist it in the manifest's `unscheduled` with a reason).

Why: the schedulers live outside the type system. Before this guard, renaming
a cron route turned its schedule into silent 404s, and a new unauthenticated
cron route would merge with nothing complaining. Same pattern as the
drg-law-website static-output guard (2026-08-07), which caught a live
production defect on its first run.
