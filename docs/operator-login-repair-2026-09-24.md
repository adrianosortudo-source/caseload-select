# Operator sign-in outage and repair, 2026-09-24

## Cause

Production deployment dpl_HNppFH4v55fU21HvqxaSmeofSDrn (main 2b6952a3639e15835e62a34a48363e464224cade, PR #313) called revalidate_operator_membership_v1 for every operator session. Production had no such function; its definition was bundled into the unapplied 20260923161812_prospect_enrichment_v1.sql migration.

Vercel logs at 17:47-18:01 UTC recorded the missing RPC/schema-cache error. The operator membership was active and exact; the invalid-link redirect was caused by failed server-side membership validation.

## Scoped repair

Migration 20260924180541_restore_operator_membership_rpc.sql restores exactly the function and service-role-only privileges already reviewed in PR #313. It does not apply the prospect-enrichment migration or change membership records. The function checks member ID, firm ID, operator role, and disabled=false.

Commit 27602fa3849ffbc733d7788d8930ed4445808433 was pushed to origin/codex/operator-login-rpc-repair before any database execution. The focused migration was applied with Supabase CLI db query --linked using an atomic transaction that recorded version 20260924180541, name restore_operator_membership_rpc, and the committed SQL in supabase_migrations.schema_migrations. The wrapper and PR draft are ignored local files under supabase/.temp in the repair worktree. This route preserved the exact version and avoided applying unrelated pending migrations.

## Verification

- Rolled-back preflight transaction passed active operator acceptance; wrong firm, lawyer role, and missing member rejection; anon/authenticated execute denial; service_role execute permission.
- Production installation completed successfully.
- Chrome's existing session redirected from /operator/login to /admin and rendered Console home.
- Clicking the existing 13:57 email link also opened /admin successfully; no new sign-in email was needed.
- Migration ledger and function grants reconciled after application.

## Remaining release work

PR #315 retains the repair in shared source. Merge only after all required checks pass and Adriano explicitly approves that PR, per AGENTS.md. The larger prospect-enrichment migration remains a separate release task. No direct Vercel production deployment was performed.