# CRM task access: disabled implementation for review

This adds a separate agent identity for exact approved tasks. It does not expand a human account, the existing CRM read session, preview QA, repository credentials, or permissions in another project. Both new application flags and the workflow variable default off. No identity, grant, session, production configuration or production migration is created by this change.

## Implemented capability

| Resource | Production task operations | Synthetic local operations |
| --- | --- | --- |
| Prospect | Update `notes`, `fit_score`, `practice_area` | Create/read/update/delete task-owned fixtures |
| Deal | Update `title`, `notes`, `expected_close`, `monthly_value` | Create/read/update/delete task-owned fixtures |
| Reminder | Update `note`, `due_at`, `done` | Create/read/update/delete task-owned fixtures |
| Follow-up template | Create a new **draft** version with an agent author | Same draft creation |

Monthly value is a CRM field; this does not change a subscription or charge anyone. Prospect name, contacts, city, source and stage are excluded in production because existing identity-sync triggers watch those columns. Production updates name only the permitted columns. Existing follow-up identity/catalog locking triggers still apply.

Everything else is denied, even if accidentally included in a task manifest: production create/delete of CRM records, consent changes, imports, qualification/review decisions, approvals, enrollment, activation, sending, inbox access, provider configuration, clients/matters, billing, credentials, grants and identities. Draft creation does not create a journey, enrollment or send. Existing operator endpoints retain human operator authorization; a task cookie never satisfies it.

Synthetic HTTP operations require `CRM_AGENT_SYNTHETIC_WRITE_ENABLED=true`, development/test mode, a loopback request origin **and** loopback database URL. This is deliberately local only; it is not a claim that a preview database is isolated. There is no unauthenticated HTTP synthetic session bootstrap. The isolated test harness provisions its own in-memory fixtures/sessions. Any future dev-server fixture issuer must stay within an explicitly isolated local environment. Do not expose that local environment on a network.

## Task/session contract

The trusted control plane provisions an identity and an immutable task after reviewing the requested scope. No agent-facing API provisions, enables or expands either. The task contains project, mode, exact origin, approved main/workflow SHA, a real approval reference, a 32-hex version, expiry and an ordered operation manifest. At most 10 operations are permitted in a production task (100 synthetic), with a maximum one-hour grant lifetime and one-megabyte manifest. Each operation has a UUID and exact JSON request. Payloads and record IDs stay in the private database, not public workflow inputs or repository files. The schema does not certify that an approval reference is valid: the trusted provisioning process must verify the actual action-time authorization.

The production issuer accepts signed GitHub OIDC only for:

- Repository `adrianosortudo-source/caseload-select`, ID `1206232496`; owner `adrianosortudo-source`, ID `274647202`.
- `refs/heads/main`, `workflow_dispatch`, GitHub-hosted runner.
- `.github/workflows/crm-task-write.yml@refs/heads/main`, protected environment `CRM task writes`, audience `caseload-crm-task-write/v1`.
- `workflow_sha=sha` and the task's approved SHA. Paired job workflow claims, when present, must match too. Signature, issuer, lifetime and single-use JTI are checked.

The write verifier coalesces concurrent JWKS fetches and imposes 30-second forced-refresh/failure cooldowns per server instance. Unknown key IDs cannot force a new outbound request on every warm request. This is not a global traffic or billing quota across serverless instances.

An opaque 256-bit cookie is HttpOnly, Secure, SameSite Strict, host-only and scoped to `/`. Only its SHA-256 hash is stored. It grants only `GET /api/agent/crm/tasks/{taskId}` and `POST /api/agent/crm/tasks/{taskId}/operations/{operationId}`; renewal uses `POST /api/operator/crm-task-session`. Mixed human/preview/read/task principals are rejected. No rendered operator UI is granted by this capability.

The first exchange binds a task to one run/attempt. A session lasts at most 15 minutes, rotates after 10 minutes with fresh OIDC and the previous live cookie, and cannot exceed the task's original expiry or 60-minute job cap. No fresh bootstrap/reset is available after binding. A failed run with lost session state needs a separately approved replacement task for any remaining operations; completed operations must be reconciled first. The driver stops initiating work at 55 minutes and the job timeout is 60 minutes.

Every request checks live task/identity/session state. Execution checks again in the same database transaction as the write. Updating fields requires exact previous values for those same fields, so concurrent edits to those fields cause a conflict. This is field-level optimistic concurrency, not a comparison of the whole row. Synthetic delete requires all business fields and refuses any dependent deal/reminder, preventing cascade deletion. Operations are ordered and idempotent: a repeated identical operation returns its saved receipt; altered payloads are denied. A revoke also blocks receipt replay. The existing privacy recovery circuit remains in front of the new API.

Setting a task or identity `enabled=false` invalidates its sessions in the same transaction. Re-enabling it does not revive those cookies. Authorization and revocation serialize: a write already authorized may finish before the revocation transaction completes; once revocation completes, subsequent operations are denied. Use database revocation for an immediate stop. Cancelling a workflow or changing a deployment environment flag alone is not immediate session revocation.

## Schema and audit

`docs/schema/crm-agent-task-writes.sql` is executable **review material**, deliberately outside `supabase/migrations`. It has not been applied. It adds:

- `crm_agent_identities`: separate project-bound agent principals, disabled by default.
- `crm_agent_tasks`: immutable exact plans, approval reference, SHA, expiry and run binding, disabled by default.
- `crm_agent_task_sessions`: only opaque token/JTI hashes, expiry, grant version and revocation.
- `crm_agent_task_receipts`: one idempotency receipt per operation. Only synthetic read receipts contain fixture records.
- `crm_agent_synthetic_records`: ownership boundary for local CRUD.
- `crm_agent_task_audit`: agent/task/operation/record IDs, fixed event/resource/action names, run/attempt and timestamp. No payloads, contact values, message content, token hashes or credentials in audit rows.

It also adds nullable `created_by_agent_id` to template versions and an exactly-one-author constraint, allowing a real agent author without inventing a lawyer ID. Existing human inserts still supply `created_by_operator_id`. Existing approval checks still require an actual human operator. Content hashes match the existing JavaScript canonicalization, including Unicode whitespace.

Tables force RLS and revoke direct access from public, anon, authenticated and service_role, including inherited provider defaults. The audit sequence is also restricted. Only four fixed RPCs (issue, verify, plan, execute) are granted to the existing server service role. Internal helpers are not callable by that role. SECURITY DEFINER routines use a pinned empty search path and explicit table names. Audit is atomic for successful writes, issue/rotation and enabled-state changes; rejected transactions roll back and return sanitized fixed errors. Execution replaces underlying constraint/type/trigger errors so record DETAIL/HINT cannot escape that routine. Rejection payloads are not recorded. Control-plane approval validation, provider request/SQL parameter log redaction, audit retention and expired session/task cleanup remain operational decisions before activation; cleanup must never erase live replay markers or approval/audit evidence.

## Local verification

Standard unit/HTTP tests use mocks and generated RSA keys. `scripts/crm-task-sql.test.mjs` executes the actual schema/functions in an embedded PostgreSQL 17 engine with synthetic fixtures. Install its pinned optional runtime in a temporary directory, not the application or shared dependency tree:

```powershell
npm install --prefix "$env:TEMP/crm-agent-pg-test" --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.3.14
$env:CRM_AGENT_TEST_PGLITE_MODULE="$env:TEMP/crm-agent-pg-test/node_modules/@electric-sql/pglite"
node --test scripts/crm-task-sql.test.mjs
node node_modules/vitest/vitest.mjs run src/lib/__tests__/crm-task-boundary.test.ts src/lib/__tests__/crm-task-github-oidc.test.ts src/lib/__tests__/crm-agent-boundary.test.ts src/lib/__tests__/portal-auth-operator-session.test.ts
```

The SQL suite loads the real base CRM migration, real template table definition and five existing prospect lock helpers/two triggers from migration `20261024171116`. The draft requires those existing locks: prospect reads/updates/deletes acquire catalog and identity locks before the tuple lock, matching human writers/provider handoff. Applied-function order and held advisory locks are checked in the embedded engine's single transaction. This does **not** prove parallel transaction safety or run the entire production migration/trigger chain, PostgREST, deployed Edge middleware, a real Supabase database, Redis, live GitHub OIDC or a production workflow. Before activation, use a separately approved isolated integration environment to verify the full schema, trigger interactions, concurrent transactions, service-role permissions/default privileges and deployment recovery gate. Do not point these tests at production.

## Remaining approvals and decisions

1. Review this local diff. Publication, PR, merge and normal deployment are not authorized by the current local implementation instruction.
2. Approve a concrete reviewed migration and isolated integration setup before applying the schema anywhere persistent. A real migration file must be deliberately created from this draft after that review.
3. Approve new persistent identity/trust configuration for the specific project, production target `https://admin.caseloadselect.ca`, Supabase project `ssxryjxifwiivghglqer`, exact final main SHA and protected GitHub environment. Create no shared credential or operator account. This implementation uses existing server database access; it introduces no new permanent agent secret and needs no Redis change. GitHub dispatch access already worked for the prior repository work, but this new workflow/environment/variable has not been configured or invoked.
4. Specify the trusted task-provisioning/revocation operator, actual approval evidence source and retention/cleanup policy. There is no self-service provisioning endpoint. Enabling identity/trust is a separate access-grant approval; each production write task also needs its exact records, values, preconditions and expiry reviewed under the applicable action-time authorization. A general request to develop the product does not waive confirmation for high-risk actions or new persistent access. Protected operations above remain unimplemented regardless of a manifest.
5. Verify current Actions plan/runner billing, account limits and a cost bound before any paid run. No new runner/service has been launched here. The fixed standard runner job has a 60-minute maximum, one concurrent run and at most 10 approved production operations, with no browser download or stored artifacts. DB/provider usage and retries still have a cost; the source code alone cannot establish a zero-dollar limit. Existing Vercel/Supabase costs and quotas were not inspected in this local-only task.
6. Only after the preceding approval and integration evidence, configure `CRM_AGENT_TASK_WRITES_ENABLED`, `CRM_AGENT_TASK_WRITES_WORKFLOW_ENABLED` and protected environment `CRM task writes` through the normal reviewed deployment process. Provision the approved identity/task in the private control plane, then separately authorize the first production run with a concrete duration and operation/cost bound. Keep the old read-only activation proposal superseded. Do not enable any grant simply to test whether it works.

For future projects, reuse this pattern with a new project identity, repository/owner/workflow/audience/target binding and reviewed domain operations. Never copy an active identity, grant, token or database permission across projects.
