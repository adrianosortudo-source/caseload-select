# Weekly Package Control Room — Handoff

Read this before touching production. It points at the full design doc (`weekly-package-control-room.md`) for detail; this document is the decision/checklist layer on top of it.

## 1. What this is

A spec-complete, never-deployed, never-database-applied feature build living in worktree `C:\tmp\caseload-weekly-package-control-room-20260723` on branch `feat/weekly-package-control-room`, based on `origin/main` at commit `7a06a35`. It centralizes one firm's weekly content package -- pieces, required visual assets, candidates, destination renditions, release-preflight gates -- as one view of a validated manifest. It was built entirely in an isolated worktree, across several audited passes, with no commit, push, PR, migration apply, or production data touch at any point.

## 2. What is proven

- Run `npx vitest run` to confirm. As of the last pass: **149 control-room-specific tests** (12 lib files + 8 route files) plus the full repo suite at **6178 tests passing**, 2 pre-existing failures unrelated to this feature (syntax errors in `publishing-bind-heroes-cli.test.ts` / `publishing-export-packets-cli.test.ts`, confirmed via `git status` to be untouched by this build).
- `tsc --noEmit` clean across the entire repo.
- Every hand-written manifest/guard/gate/receipt rule has dedicated unit coverage, including the full pure chain end to end (raw fixture manifest → validation → gates → persisted check rows, arithmetic-predicted at 304 rows and confirmed by the runner) and a schema-consistency lock (every event type, asset role, and status the app code emits is independently checked against the migration's own CHECK constraints and unique key text).
- Every mocked-route test proves `requireOperator` gates first and that an `Authorization: Bearer` header (including a gateway-shaped one) grants nothing on these general package APIs.
- All logic that can be tested without a real database or a real browser IS tested.

## 3. What is NOT proven, and why

- **No database round-trip has ever executed.** The migration has never been applied to any database, local or production -- no Docker/local Postgres exists in the build environment. Every mutation function's actual SQL behavior (inserts, updates, the append-only trigger, RLS) is reviewed but unexecuted.
- **The `ON CONFLICT` dedup fix is unverified against a real table.** An audit found and fixed a real bug (a nullable `asset_id` inside a `UNIQUE`/`ON CONFLICT` target never matches, so every "Run preflight" click would have duplicated check rows instead of updating them). The fix (a new `asset_scope` discriminator column) is correct at the pure row-builder level and covered by a regression-lock test on the migration text, but the actual Postgres `ON CONFLICT` behavior can only be proven by running preflight twice against a real table and confirming row count stays constant.
- **Live route auth ordering is proven only by mocks.** A real click against the real API routes in this build environment returns HTTP 500 before `requireOperator` even runs, because `supabaseAdmin` throws at module import without real Supabase env vars -- the same constraint that keeps the whole authenticated portal tree from booting in this environment. The 401-first ordering is real code, but has only been exercised through mocks, never live.
- **10 named screenshots (Section 23 of the original spec) were never captured as image files**, across four separate sessions -- the Browser pane was not displayed client-side in any of them. Every tab, both roles, desktop and mobile, was instead verified structurally: `get_page_text`, accessibility-tree reads, live click-simulated interactions against the real routes, and computed-style/overflow checks.
- Mutation actions Register/Select/Reject/Supersede/Create-manifest/Run-preflight/Export/Dry-run are wired to real code but untested end to end for the same DB reason. Upload via Gateway, Bind via Gateway, and Record rendered verification remain deliberately disabled (no deployed gateway credential, no evidence pipeline). Hash verification was deliberately never built as a portal action at all -- the portal has no file bytes to recompute a hash from, so a button here would be an evidence-free rubber stamp.
- `destinationIdentityConfirmed` and `channelAuthenticated` in the Release tab's Publication gate are hardcoded `false` -- no per-piece or firm-wide source for either exists anywhere in this codebase yet, so those two checks fail closed rather than guess.

## 4. Required review before any deploy

1. **Independent code audit** of the full diff (this handoff assumes one has NOT yet happened beyond the in-session audits already recorded in project memory).
2. **Migration review by a data-engineer** -- specifically the `asset_scope` discriminator column and unique-key choice, and the reuse of the existing `block_append_only_mutation()` trigger function for `publishing_package_events`.
3. **Apply the migration to a NON-production database first**, then run a real end-to-end pass: create a manifest, register a candidate, select it, run preflight, then **run preflight a second time and confirm the check-row count for that package stays constant instead of doubling** -- this is the one behavior the unit tests cannot prove and the entire reason the `asset_scope` fix exists.
4. **Authenticated visual review** of all 5 tabs, both operator and lawyer roles, desktop and mobile -- the screenshots that could not be captured in this environment.
5. **Production credential/configuration review.** The Publishing Package Gateway's credential is separate from this feature and must never be reused or widened in scope for it.

## 5. Explicit non-goals shipped as-is

No external publishing in this feature. No second approval system. No generic file upload. No browser-cookie automation. No direct database workflow. No image generation provider. No CSB screenshot storage. No hardcoded DRG-only shared logic. Plus: hash verification is deliberately not a portal action (gateway/CLI only); Upload/Bind/Record-rendered-verification render visibly but disabled; `destinationIdentityConfirmed`/`channelAuthenticated` are hardcoded false pending a real source.

## 6. Deploy sequence (once separately authorized)

Migration first, then the application code. The feature is inert until a `publishing_packages` row exists for a period -- created only through the operator-only `package-manifest` route -- so deploying the code before any manifest is created is safe on its own and shows only the Overview tab's empty state to every viewer.
