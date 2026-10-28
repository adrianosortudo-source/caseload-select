# Dedicated CRM agent read QA (disabled implementation)

This implementation is local and disabled. No production grant, configuration,
session, database migration, workflow run, push, PR, or deployment is part of
this task. Existing human operator membership and session checks remain in place.

## Identity and permission boundary

The only workload is `.github/workflows/crm-console-read-qa.yml` on
`adrianosortudo-source/caseload-select`, repository ID `1206232496`, owner ID
`274647202`. These IDs were verified through GitHub repository metadata on
2026-10-28. The OIDC verifier independently checks signature, issuer, exact
audience `caseload-crm-console-read/v1`, environment `CRM console read QA`,
main ref, workflow path, direct-job metadata, GitHub-hosted runner, event,
repository and owner names and IDs, SHA, time bounds, and token identifier.
Prospect-comparison and preview-QA tokens are never accepted for CRM.

The additional live Redis grant pins the exact reviewed workflow commit SHA.
Only `CRM_AGENT_READ_ENABLED=true` on a production deployment plus a live
enabled grant permits an exchange. Preview and local deployments fail closed.
No flag or grant is supplied by this change. The workflow separately requires
repository variable `CRM_AGENT_READ_WORKFLOW_ENABLED=true`; it has no inputs.

`__Host-crm_agent_session` is a random 256-bit opaque cookie, HttpOnly, Secure,
SameSite Strict, host-only, path `/`, valid only at
`https://admin.caseloadselect.ca`. It is never a lawyer, client, or operator
principal, including when a human cookie is also present. Middleware overwrites
the route/method/origin context before server components use it.

The allowlist in `src/lib/crm-agent-policy.ts` permits GET/HEAD only:

- `/admin/agency-crm` and `/admin/agency-crm/follow-up`.
- CRM prospects, deals, reminders, follow-up, and follow-up opt-in history APIs.
- `/api/admin/prospect-operations/report`: existing aggregate counts only.
- `/api/admin/prospect-operations/conversations/agency/{uuid}`: agency-source
  activities only; no other linked-source activities.
- Next static runtime files and the favicon.

Every other route and every business mutation is denied when the agent cookie
is present. Existing API mutation handlers also reject the agent independently
through human auth. Client/matter records, other prospect source APIs, inboxes,
imports, enrollments, approvals, sending, and provider configuration are excluded.
Consent history has its own authorized agent-read service path; no operator ID
is invented or substituted. UI controls may render, but they convey no write
authority. UI GETs and API reads return no-store through the agent middleware.

## Storage, renewal, and revocation

The existing server-only Upstash connection executes one atomic Lua operation
in namespace `agent:{crm-console-read-qa}:v1:`. It never accesses business
tables. Registry unavailability or malformed state denies access. Each request
checks the current grant without a grant/session cache, including runtime assets;
route/server-component authorization checks it again where applicable.

Keys and records:

- `grant`: externally administered JSON with `enabled`, `capability`, `origin`,
  `version`, `workflowSha`, and `expiresAt` (Unix milliseconds).
- `session:{sha256(cookie)}`: nonsecret identity, grant version, issue/expiry time,
  and absolute job deadline. Redis TTL is at most 15 minutes. No raw cookie.
- `jti:{sha256(oidc-jti)}`: replay marker, 11-minute TTL.
- `run:{run-id}:{attempt}`: first-exchange deadline, retained seven days.
- `audit`: bounded stream (approximately 10,000 events), only event type,
  capability, run ID, and attempt. No URLs, record IDs, CRM content, or credentials.

Renewal requires a freshly verified OIDC token and the active previous cookie,
at least ten minutes after issuance and before expiry. Atomic rotation removes
the old hash immediately. Each run/attempt can bootstrap only once, and no
rotation extends the first exchange's 60-minute deadline. The workflow has a
separate 60-minute timeout. A grant expiry can shorten session lifetime further.
The fixed driver uses its browser context's own request cookie jar, checks the
read APIs, renders both pages, rotates once after ten minutes, then checks again.

Immediate revocation options (administrative actions requiring later approval):
set `grant.enabled=false`, delete the grant, change the grant version, or delete
one session hash. These deny the next authorization check. They cannot undo data
already read or terminate a request that has already passed authorization.
The deployment flag also disables access; a grant is the immediate live switch.
When re-enabling after a stop, use a new grant version. Re-enabling the same
version can otherwise resume a previously issued cookie until its short expiry;
deleting a session hash or changing version is the durable revocation action.

The SHA pin deliberately stops new access after main moves to an unreviewed
commit. Repinning is a trust change, not automatic renewal. This first version
does not promise permanent independence across arbitrary future code changes.

## Public repository output policy

The workflow checks out its main SHA with checkout credentials disabled, installs
locked dependencies with lifecycle scripts disabled, and has only contents read
and id-token write permissions. It never executes arbitrary supplied scripts or
PR code. Browser subresource requests are restricted to safe methods on the
approved origin; service workers and downloads are disabled.

The QA step suppresses child stdout/stderr and prints only fixed
`CRM_QA_PASS`/`CRM_QA_FAIL` diagnostics. Setup failures print a fixed label.
There is no artifact upload, screenshot, trace, HAR, browser console forwarding,
storage-state export, CRM record printout, or token printout. GitHub's normal
public workflow metadata and setup-action metadata remain visible.

## Local synthetic verification

Use the repository's locked Node dependencies, with no production environment
file or credentials loaded. The Vitest fixtures intercept registry/provider and
business data calls. Cryptographic tests use locally generated RSA keys.

```sh
node node_modules/vitest/vitest.mjs run src/lib/__tests__/crm-agent-*.test.ts --maxWorkers=1 --minWorkers=1
```

The actual Lua script can also run in Lua 5.1 against in-memory Redis command
fixtures. Install `lupa==2.6` in a temporary Python environment, then run:

```sh
python scripts/test-crm-agent-registry.py
```

This tests actual script logic, not a real Redis server or deployed Upstash.
Production cookie behavior, environment enforcement, and deployed browser QA
remain untested until specifically approved activation. The future workflow
driver itself must never be run locally against the production target.

## Dispatch and cost evidence (2026-10-28)

Read-only `gh auth status` outside the restricted network sandbox confirmed
the existing keyring account `adrianosortudo-source` has `repo` and `workflow`
scopes. GitHub repository metadata confirmed admin/push permission. This is an
existing CLI path suitable for a future authorized `gh workflow run`, without
creating credentials. No dispatch was attempted, so successful dispatch is not
claimed. The connected GitHub tool catalog itself has no dispatch operation.
The new CRM environment is absent from the current environment list. A read-only
Actions permissions query confirmed Actions is enabled (`allowed_actions=all`).

The repository is public. GitHub documents standard GitHub-hosted runners as
free for public repositories; this workflow uses standard `ubuntu-latest`, one
job, no cache and no uploaded artifacts. It imposes a 60-minute job cap and one
concurrency group. The account Actions billing endpoint returned HTTP 404 and
the CLI reported that the existing OAuth credential lacks the `user` scope.
No scope refresh or credential change was attempted; account-specific usage,
quotas, and budgets remain unverified.
Vercel invocation and Upstash command/storage usage can still incur existing
provider-plan costs: this implementation performs live registry checks on each
request and writes bounded nonsecret audit events. Those plan costs have not
been verified, so total zero cost is not promised.

Sources:

- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://docs.github.com/en/actions/reference/limits
- https://docs.github.com/actions/reference/openid-connect-reference

## Exact later activation steps requiring approval

1. Approve the final diff and security review, publish through the repository's
   PR/check/review process, and allow the normal merged-main deployment. Keep all
   agent flags absent/false throughout that release. No direct production deploy.
2. Approve a dedicated GitHub environment named `CRM console read QA`, restricted
   to main only, with protection policy explicitly chosen for this capability.
   A required human reviewer on every run would prevent fully unattended runs;
   do not bypass an existing review requirement. Review and pin the final main
   commit containing the workflow and fixed driver.
3. Verify the existing Redis connection supports the atomic script and bounded
   audit stream in a separate synthetic staging namespace; review Vercel and
   Upstash billing/limits and choose audit retention. No DB migration is needed.
4. Approve creating the project-specific live grant with the exact capability,
   origin and reviewed SHA, a new nonsecret version (at least 16 characters),
   and an explicit expiry. Start with `enabled=false`. Do not store a bearer
   token, human cookie, or universal credential in that grant.
5. Approve enabling the deployment flag, repository workflow variable and grant
   for this exact read scope, then dispatch a controlled first QA run on main.
   Confirm fixed public diagnostics, valid cookie scope, renewal, and revocation
   through private nonsecret audit. Never upload CRM artifacts as evidence.
6. Approve ongoing unattended dispatch under the chosen environment policy.
   Renew grant expiry/SHA only under approved trust-change policy. Each future
   project gets its own identity/audience/origin/grant/namespace/allowlist and
   revocation boundary; no permission transfers from this project.

## Reusing the pattern

For each future project, record the repository and owner IDs from authoritative
metadata, select a narrow initial capability, review each required route and
data source, deny unsafe methods before dispatch, and keep human auth separate.
Use a dedicated workflow/environment and short-lived workload identity, opaque
hash-only browser sessions, atomic rotation/replay protection, live revocation,
and sanitized audit. Prove negative cases with synthetic data before enabling.
Treat new capabilities, providers, data scope, trust pins, and activation as
separate explicit approvals. Establish a real dispatch path and provider cost
evidence before promising independent operation.
