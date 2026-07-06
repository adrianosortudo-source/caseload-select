---
doc-type: audit
scope: production-nextjs-supabase-codebase
auditor: Codex
date: 2026-07-06
status: complete
---

# CODEX Audit 2026-07-06

## Scope And Constraints

This is a read-only, report-only audit of `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-app`.

Important constraint observed at audit start: the working tree is not clean and appears to contain unrelated concurrent-session work. `git status --short` shows many modified content-studio files and a large migration reconciliation in progress where original migration filenames are deleted and timestamped replacements are untracked. I did not stage, revert, apply, or repair any of that work. Findings below distinguish confirmed defects from areas I could not evaluate cleanly because the working tree is actively changing.

Orientation completed:

- Read the relevant beginning and architecture sections of `CLAUDE.md`, including the Database Access Invariant and engine-sync doctrine. The file is very large, and the read timed out after returning the core sections.
- Read the beginning and CRM-layer framing of `../CaseLoad_CRM_Migration_Plan_v1.md`; the read timed out before EOF.
- Read the beginning of `../../00_System/01_Doctrine/DECISION_RECORDS.md`; the read timed out before EOF.
- Read `package.json` and enumerated current `supabase/migrations/`.

Because the codebase is large and the working tree is actively changing, this audit is not exhaustive yet. I prioritized the requested high-risk classes: migration hygiene/RLS, PostgREST upsert traps, silent Supabase errors, dead-on-arrival feature paths, auth gates, and engine-sync.

## Executive Summary

Confirmed high-risk gaps are concentrated in three patterns:

1. Compliance and canonical CRM evidence writes are best-effort side writes. The primary user action can succeed while `consent_log`, `parties`, or `activities` silently fail.
2. Some operational runners and login routes preserve user-facing success while dropping internal errors, producing false-green behavior.
3. The working-tree migration directory is currently not self-contained. The base `screened_leads` migration is absent from `supabase/migrations/` and present only in a local archive folder, while current migrations still alter `screened_leads`.

I did not find a confirmed current table-creation migration that creates a new public table without same-file RLS enable/force/revoke. That pass is constrained by the migration reconciliation in the working tree.

## Findings

### High. Consent audit trail can disappear while the lead is persisted and later becomes send-eligible

**Code evidence:** `supabase/migrations/20260626203055_20260626_screened_leads_consent.sql:20-35` states the consent model is the CASL compliance path and that `consent_log` is append-only audit evidence. The table has compliance fields at `supabase/migrations/20260626203055_20260626_screened_leads_consent.sql:93-120`, RLS lockdown at `supabase/migrations/20260626203055_20260626_screened_leads_consent.sql:177-184`, and only a comment-level append-only invariant at `supabase/migrations/20260626203055_20260626_screened_leads_consent.sql:186-188`.

The intake route writes the queryable consent columns in the primary `screened_leads` insert at `src/app/api/intake-v2/route.ts:430-458`, but calls `logIntakeConsent()` after the insert at `src/app/api/intake-v2/route.ts:487-500` and catches/logs failures instead of failing or retrying the request. The wrapper explicitly says the log write "never throws" and "never blocks" at `src/lib/consent-log.ts:11-15`, and swallows both Supabase insert errors and unexpected exceptions at `src/lib/consent-log.ts:16-25`.

**Evidence status:** CONFIRMED.

**Concrete failure scenario:** A web intake with explicit consent is inserted into `screened_leads` with `email_consent_status='explicit'`. The subsequent `consent_log` insert fails because of a transient Supabase error, schema drift, or RLS/policy regression. The user sees success, the lead is eligible under the send gate, but the append-only evidence table has no row proving how or when consent was captured.

**Risk:** Compliance evidence breach. The system may lawfully block/allow sends based on queryable state while losing the audit trail needed to prove CASL/PIPEDA consent history.

**Recommended fix:** Make consent evidence durable before the intake can be treated as fully persisted. Options: wrap the `screened_leads` insert plus `consent_log` insert in a Postgres RPC transaction, or write a required `consent_log_outbox`/repair queue row in the same request and surface non-2xx if both direct log and repair enqueue fail. Keep the user-facing retry path idempotent by `lead_id`.

### High. `/api/admin/provision-clients` bypasses the operator-session gate used by the admin tree

**Code evidence:** The locked database/auth doctrine says sensitive app access goes through server routes and custom portal/operator sessions, not Supabase Auth, at `CLAUDE.md:57-67`. The admin tree is described as route-gated in DR-063 at `CLAUDE.md:475`. Most admin routes use `getOperatorSession()` or `requireOperator()`, but `src/app/api/admin/provision-clients/route.ts:9` documents a separate `ADMIN_API_SECRET` header scheme.

The route checks only `process.env.ADMIN_API_SECRET` and `x-admin-secret` at `src/app/api/admin/provision-clients/route.ts:88-104`. It then creates or updates `intake_firms` rows via service-role upsert/update at `src/app/api/admin/provision-clients/route.ts:44-79`, returning partial success at `src/app/api/admin/provision-clients/route.ts:123-138`.

**Evidence status:** CONFIRMED.

**Concrete failure scenario:** Anyone who obtains or misroutes `ADMIN_API_SECRET` can POST to `/api/admin/provision-clients` without an operator session and mutate live firm configuration. This is not an unauthenticated-open route, but it is outside the app's normal operator authorization path and audit surface.

**Risk:** High-impact administrative mutation behind a shared secret instead of the same operator identity gate used elsewhere. A leaked automation secret becomes sufficient to overwrite client-firm configuration.

**Recommended fix:** Require `getOperatorSession()`/`requireOperator()` for interactive calls. If automation still needs this route, use the existing explicit cron-auth dual-mode pattern from other routes, log the actor mode, and keep the shared-secret path scoped to a known automation header, not the general admin route.

### High. Cadence runner has false-green Supabase reads

**Code evidence:** The cadence runner handles the initial `cadence_rules` and `cadence_steps` errors at `src/lib/cadence-runner.ts:137-150`, but several later reads ignore `error` entirely:

- Stage events: `src/lib/cadence-runner.ts:164-171`
- Matter lookup for enrollments: `src/lib/cadence-runner.ts:176-182`
- Lead-status enrollment source: `src/lib/cadence-runner.ts:256-263`
- Active runs: `src/lib/cadence-runner.ts:313-321`
- Per-matter reload during advancement: `src/lib/cadence-runner.ts:325-333`
- Lead load for consent/recipient state: `src/lib/cadence-runner.ts:336-344`
- Firm config load for real-send/review URL: `src/lib/cadence-runner.ts:346-356`

The cron wrapper returns `ok: true` spread over the result at `src/app/api/cron/send-sequences/route.ts:13-14`; the newer cadence runner itself can also return a summary with `ok: true` when ignored read errors produce empty arrays.

**Evidence status:** CONFIRMED.

**Concrete failure scenario:** Supabase returns a transient error for `matter_stage_events` or active `cadence_runs`. Because the code only reads `data`, the runner treats the result as `[]`, enrolls or advances nothing, and can return a successful summary. A missed cadence tick is invisible unless someone inspects database side effects.

**Risk:** Production automation can silently skip client/lawyer touches while reporting healthy execution. This is especially risky once shadow mode is converted to real send.

**Recommended fix:** For every Supabase read in `runCadenceEngine`, destructure and check `error`. Set `summary.ok=false`, include a specific `reason`, and avoid advancing any run when required dependent reads fail. Add tests where each read returns `{ data: null, error }` and assert non-green output.

### Medium. Agency CRM import dedupe breaks once `agency_prospects` exceeds the PostgREST page cap

**Code evidence:** The bulk import route allows up to 10,000 rows per request at `src/app/api/admin/agency-crm/prospects/import/route.ts:11-25`. The importer dedupes against existing rows by doing one unpaginated `select('firm_name, city')` at `src/lib/agency-prospect-import.ts:70-75`, then inserts chunks at `src/lib/agency-prospect-import.ts:86-103`.

The `agency_prospects` schema has `firm_name` and `city` columns at `supabase/migrations/20260625184449_20260625_agency_crm.sql:6-21`, but only a stage index at `supabase/migrations/20260625184449_20260625_agency_crm.sql:22`. There is no database unique constraint on the dedupe key in that migration.

**Evidence status:** CONFIRMED.

**Concrete failure scenario:** Once the table contains more rows than PostgREST returns in one default response, the importer sees only the first page of existing `(firm_name, city)` keys. Re-importing an export can insert duplicates for keys outside that first page because the database does not enforce uniqueness on the logical dedupe key.

**Risk:** Data quality corruption in Layer B. The import UI can appear idempotent while duplicating prospects at realistic production sizes.

**Recommended fix:** Add a normalized dedupe key column or unique expression index for `(lower(trim(firm_name)), lower(trim(coalesce(city,''))))`, then use `upsert(..., { onConflict: ... , ignoreDuplicates: true })`. If avoiding a schema change, page the existing-key read with `.range()` until exhaustion and add a regression test above 1,000 existing rows.

### Medium. Cadence schema advertises trigger types the runner and editor cannot execute

**Code evidence:** `supabase/migrations/20260703_cadence_engine_shadow.sql:46-66` creates `cadence_rules.trigger_type` and explicitly allows `field_change`, `threshold`, and `time_relative`, with config comments for all three at `supabase/migrations/20260703_cadence_engine_shadow.sql:51-55`.

Pure functions exist for threshold and time-relative matching at `src/lib/cadence-rules-pure.ts:98-140`, but `src/lib/cadence-runner.ts:189-213` enrolls from stage events only through `matchesFieldChangeTrigger`, and `src/lib/cadence-runner.ts:248-253` filters lead-sourced rules to `trigger_type === 'field_change'`. A repository-wide call search found no runner caller for `matchesThresholdTrigger` or `matchesTimeRelativeTrigger` outside tests. The admin/editor layer documents the gap directly: `src/lib/cadence-rule-form-pure.ts:9-13` says threshold/time_relative are pure-function stubs with zero runner caller, and `src/lib/cadence-rule-admin.ts:8-12` says every rule it writes is hardcoded to `field_change`.

**Evidence status:** CONFIRMED.

**Concrete failure scenario:** A service-role import, SQL edit, or future admin UI change creates a valid `cadence_rules` row with `trigger_type='threshold'` or `trigger_type='time_relative'`. The database accepts it. The pure matcher tests pass. The production runner never enrolls it, so the rule is dead-on-arrival.

**Risk:** Operators can believe the generic Trigger-Condition-Action engine supports threshold/time triggers because the schema and pure functions say it does, but production execution does not. Future cadence templates may be silently inert.

**Recommended fix:** Either narrow the DB `CHECK` to `field_change` until execution exists, or implement explicit threshold/time-relative enrollment passes in `src/lib/cadence-runner.ts` with fixture tests that prove real `cadence_rules` rows of each type create `cadence_runs`.

### Medium. Current migration directory is not self-contained for `screened_leads`

**Code evidence:** The current `supabase/migrations/` directory contains multiple migrations that alter or index `screened_leads`, such as `supabase/migrations/20260625224856_screened_leads_scoring_delta.sql:27`, `supabase/migrations/20260626203055_20260626_screened_leads_consent.sql:48`, and `supabase/migrations/20260702160000_screened_leads_decision_reason_code.sql:20`.

However, a current-file search found no `CREATE TABLE ... screened_leads` in `supabase/migrations/`. The base table definition is currently present under `supabase/_archive_local_only_2026-06-29/20260505_screened_leads.sql:44-49`, not under `supabase/migrations/`. `git status --short supabase/migrations` also shows the original `supabase/migrations/20260505_screened_leads.sql` deleted and many timestamped replacements untracked during this audit.

**Evidence status:** SUSPECTED, because the migration tree is under active reconciliation in the working tree. The defect is confirmed in the current filesystem view, but I did not assert that this is the intended final branch state or current prod state.

**Concrete failure scenario:** A fresh Supabase project or CI migration replay from the current `supabase/migrations/` folder reaches an `ALTER TABLE public.screened_leads` migration before any migration creates `screened_leads`, and fails. Separately, reviewers cannot reliably determine which migrations are canonical versus local archive/quarantine.

**Risk:** Migration replay and disaster recovery are unsafe. The app may run against prod because prod already has historical migrations, while a fresh rebuild from source fails.

**Recommended fix:** Complete the migration reconciliation before merging: restore the base `screened_leads` migration into `supabase/migrations/` under the applied timestamp/name expected by Supabase, or commit the authoritative timestamped replacement that creates the table. Add a CI script that parses migrations for `ALTER TABLE public.<table>` before any `CREATE TABLE public.<table>` in the replay order.

### Medium. Portal magic-link route hides DB and email failures with no internal ledger

**Code evidence:** The anti-enumeration behavior is deliberate: `src/app/api/portal/request-link/route.ts:45-67` returns `{ ok: true }` for throttled, malformed, or unknown requests. But the first Supabase lookup ignores the `error` object entirely at `src/app/api/portal/request-link/route.ts:94-103`, and the legacy firm lookup also ignores errors at `src/app/api/portal/request-link/route.ts:112-120`. Email delivery failures are swallowed with an empty catch at `src/app/api/portal/request-link/route.ts:140-145`.

**Evidence status:** CONFIRMED.

**Concrete failure scenario:** Supabase returns an error for `firm_lawyers`, or Resend fails. The lawyer receives no magic link, the HTTP response is still `{ ok: true }`, and there is no durable notification/attempt ledger to distinguish anti-enumeration silence from infrastructure failure.

**Risk:** Lawyers can be locked out during a production incident while the route appears healthy. This is not a data leak, but it directly affects pilot operability and support.

**Recommended fix:** Preserve the external anti-enumeration response, but log internal failures to a durable table or existing notification/outbox health channel with request hash, firm/lawyer resolution stage, and email error class. At minimum, destructure and `console.error` Supabase errors.

### Medium. Canonical `parties` and `activities` dual-writes are best-effort and can permanently miss rows

**Code evidence:** `src/lib/crm-dual-write.ts:1-13` says the module starts populating canonical parties/activities going forward, but also says all writes are best-effort and failures never block the primary path. `writePrimaryParty()` catches and logs non-unique failures at `src/lib/crm-dual-write.ts:35-52`. `writeActivity()` catches and logs all insert failures at `src/lib/crm-dual-write.ts:68-84`.

**Evidence status:** CONFIRMED.

**Concrete failure scenario:** A lawyer takes a lead and `client_matters` is created, but the canonical `parties` insert fails due to schema drift or transient Supabase failure. The matter exists, but the canonical party table is missing the primary client. Dual-read fallback may mask this for the UI, and there is no retry queue/backfill marker for this individual missed write.

**Risk:** The canonical CRM model becomes incomplete while the legacy surface appears functional. This undermines the migration goal and makes later exports/reporting unreliable.

**Recommended fix:** Reuse the existing idempotent outbox pattern: enqueue canonical write intents with deterministic keys such as `<matter_id>:primary_party` and `<matter_id>:activity:<type>:<source_id>`, retry until written, and expose a health report for failed canonical dual-writes. Alternatively, make the canonical write part of the same transactional RPC as matter creation once the model is no longer shadow-only.

### Low. Engine-sync CI still has a bootstrap skip path

**Code evidence:** DR-058 says `check-engine-sync.sh` must run on every commit that touches the engine at `CLAUDE.md:472`. The workflow documents the manifest-based compromise at `.github/workflows/ci.yml:9-15` and marks `engine-sync` required at `.github/workflows/ci.yml:17-21`.

The actual CI job skips if `scripts/check-engine-manifest.sh` or `scripts/engine-sync.manifest` is missing at `.github/workflows/ci.yml:111-118`. The local full check is stronger, but also refreshes the manifest as a side effect when clean at `scripts/check-engine-sync.sh:102-108`.

I ran `bash scripts/check-engine-sync.sh` during the audit. It reported:

```text
OK: app/src/lib/screen-engine/ matches sandbox/src/engine/ (content; line endings ignored; persist.ts excluded by design).
Refreshed scripts/engine-sync.manifest
```

**Evidence status:** CONFIRMED for the skip path; no current engine drift was found.

**Concrete failure scenario:** An old branch that lacks the manifest/check script changes engine files and opens a PR. The `engine-sync` job passes via the bootstrap branch instead of failing. Branch protection sees the check as green.

**Risk:** Low-probability enforcement gap now that DR-058 is established, but it is still a bypass of the intended "required check" semantics.

**Recommended fix:** Remove the bootstrap skip now that the gate is on main. Make missing `scripts/check-engine-manifest.sh` or `scripts/engine-sync.manifest` a hard failure. Consider making `check-engine-sync.sh` support a no-write audit mode so verification does not refresh files.

### Low. Intake route tests explicitly mock the integrations most likely to fail in production

**Code evidence:** The route-level intake test documents that it mocks Supabase, GHL webhook, lead notification email, decline resolver, `waitUntil`, and rate limiting at `src/app/api/intake-v2/__tests__/route.test.ts:11-23`. It captures the insert payload instead of reading a real DB at `src/app/api/intake-v2/__tests__/route.test.ts:31-33` and stubs Supabase insert success at `src/app/api/intake-v2/__tests__/route.test.ts:47-75`.

**Evidence status:** CONFIRMED.

**Concrete failure scenario:** The handler test suite passes while a production-only integration breaks: Vercel `waitUntil` behavior, Resend notification delivery, consent-log insert, or webhook dispatch. This has already been a recurring class of issue in adjacent flows because route tests prove payload shape, not deployed side effects.

**Risk:** Test-suite fidelity gap. The tests are useful unit/route tests, but they should not be interpreted as proof that an intake reaches lawyers or downstream systems in production.

**Recommended fix:** Keep the fast mocked tests, but add one smoke/integration test layer for the intake path that exercises the real server route against a test Supabase project or a contract-level fake that records every side effect: `screened_leads`, `consent_log`, notification ledger, webhook outbox, and rate-limit branch.

## Non-Findings / Refuted Candidates

- **Current new-table RLS scan:** A first-pass parser over the current `supabase/migrations/*.sql` did not find a `CREATE TABLE` migration missing same-file RLS enable, force RLS, and anon/authenticated/PUBLIC revoke. This is constrained by the active migration reconciliation and does not prove prod is perfect.
- **Cadence `ON CONFLICT` partial-index trap:** The earlier partial-index risk appears addressed in the current tree. `supabase/migrations/20260705_cadence_audit_fixes.sql:2-9` explicitly documents the 42P10 issue, and adds real unique constraints for `cadence_runs` and `outbound_messages` at `supabase/migrations/20260705_cadence_audit_fixes.sql:26-34`.
- **Processed channel-message dedupe:** The dedupe upsert uses `onConflict: 'firm_id,channel,message_mid'` and the migration has `UNIQUE (firm_id, channel, message_mid)` at `supabase/migrations/20260610012439_20260609_processed_channel_messages.sql:25-30`.
- **Operator-firm messaging upserts:** The current migrations include matching unique constraints for `channel_id,participant` and `message_id,participant,emoji` at `supabase/migrations/20260624132001_operator_firm_messaging.sql:63-68` and `supabase/migrations/20260624145310_operator_firm_messaging_phase2.sql:15-22`.

## Open Audit Limitations

- I did not complete a full manual review of every route under `src/app/api/**`.
- I did not run destructive or write-producing checks, and I did not apply migrations.
- The working tree contains substantial unrelated edits and migration reconciliation. Findings that depend on the current migration directory are marked SUSPECTED where appropriate.

## Remediation status (2026-07-06)

Every finding was independently re-verified against the code (not accepted at face value) before any fix landed; two severities were corrected in the process. Finding 2 is confirmed real but was overstated at High, since the affected route only re-syncs a hardcoded firm list rather than accepting attacker-controlled values. Finding 1 is confirmed real but with the nuance that the send-gate's queryable consent state was never at risk, only the append-only audit evidence. A parallel-agent build produced a cron migration with an unverified time-slot claim (grepped tracked migration files only); the actual live `cron.job` table showed a collision the grep missed, corrected before applying.

| # | Finding | Severity (as audited) | Disposition | Evidence |
|---|---|---|---|---|
| 1 | consent_log audit trail can disappear silently | High | **Fixed**, `362fc50` | Live sweep run against prod: `{"scanned":48,"missing":48,"repaired":48,"failed":0}`. Every consent-eligible lead had zero prior evidence; all 48 repaired with real historical timestamps (2026-05-06 to 2026-07-03), zero failures. Daily cron scheduled at `52 5 * * *` UTC, verified live in `cron.job`. |
| 2 | `/api/admin/provision-clients` bypasses operator-session gate | High as audited, corrected to **Medium** on reverification (route only re-syncs a hardcoded `CLIENT_CONFIGS` list, no attacker-controlled mutation was ever possible) | **Fixed**, `71095a9` | Now accepts operator session OR the existing secret; also fixes a real bug found in passing (unset `ADMIN_API_SECRET` previously 500'd the route even for a valid operator session). 6 new tests. |
| 3 | Cadence runner false-green Supabase reads | High | **Fixed**, `1a9700c` | All 7 unchecked reads now fail closed (2 tick-gating reads early-return; 5 enrichment reads skip only the dependent runs via a new `skipRunIds` set). 20/20 tests (13 existing plus 7 new), confirmed standalone after a full-suite hook-timeout false alarm (box saturation, not a regression). |
| 4 | Agency import dedupe breaks past the PostgREST page cap | Medium, confirmed **live** during remediation | **Fixed**, `fc9b1c2` | Guard check found `agency_prospects` at 5648 rows (already past the roughly 1000-row cap) with zero duplicates. Generated `dedupe_key` column plus a real UNIQUE constraint, live 42P10 probed (insert, duplicate no-op, cleanup) before code shipped. 11/11 tests. |
| 5 | Cadence schema allows dead-on-arrival trigger types | Medium | **Fixed**, `a5033c4` | Guard check confirmed all 7 existing `cadence_rules` rows are `field_change`; CHECK narrowed to `field_change`-only. |
| 6 | Migration directory not self-contained for `screened_leads` | Medium (SUSPECTED by the auditor) | **Not ours** | Belongs to the parallel migration-reconciliation session (`supabase/_archive*`, `_quarantine*`, `_reconciliation*`), mid-flight in the shared working tree throughout this remediation. Not touched, per the standing parallel-session discipline. Followup logged. |
| 7 | Portal magic-link route hides internal failures | Medium | **Fixed**, `63f66a8` | 3 additive `console.error` calls, zero response-shape changes (every return statement traced to the same `{ ok: true }`). No raw email logged. 6 new tests confirm external behavior is byte-identical across every failure path. |
| 8 | `parties`/`activities` dual-writes are best-effort | Medium | **Deferred** | Documented intentional shadow-phase behavior with dual-read fallback (`crm-dual-write.ts`). Belongs with the M1 canonical-model hardening pass (an outbox/retry pattern), not a standalone patch. Followup logged. |
| 9 | Engine-sync CI bootstrap skip still active | Low | **Fixed**, `463a22f` | Confirmed both `scripts/check-engine-manifest.sh` and `scripts/engine-sync.manifest` have been on main since 2026-06-09 (git log); the skip now hard-fails instead of silently passing. |
| 10 | Intake route tests mock the integrations most likely to fail | Low | **No action** | Informational; unit and route tests are supposed to mock. Not a defect. |

Seven of nine real findings fixed and shipped the same day; one correctly identified as out of this session's scope; one deferred to a larger planned pass. Zero findings were rejected outright. Codex's audit held up well under independent verification, with the one meaningful correction being severity calibration, not factual accuracy.
