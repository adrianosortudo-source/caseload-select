# Agency follow-up journeys

## Current delivery boundary

**Status, 2026-10-26:** PR #426 is open, non-draft, and unmerged on branch `codex/crm-live-followup-final-gates-20261024`. Exact source heads, CI runs, evidence digests, production inventory, and approval state belong in the private release ledger and must be rechecked before any release action.

The Agency synthetic acceptance workflow runs against a fresh disposable Supabase stack with a network-free fake provider and real browser interactions. A pass proves only the exercised synthetic behavior; it does not prove production schema, provider acceptance, an inbox receipt, or live delivery.

No Agency production migration may run yet: PR #426 adds the Agency-specific protected route, but it is not available in production until that PR merges and its environment approval gate is verified. Once available, it must stage the complete migration history, exclude exactly the two preview-only QA migrations, and fail closed unless the exact approved pending set matches. Do not run a broad `supabase db push --include-all`, `supabase migration repair`, or raw production SQL from an operator shell.

Static review of the pending Agency migration chain found a data-changing idempotency fence that can backfill provider-use timestamps and move unsafe scheduled retries to UNKNOWN with audit rows. Operational rollback is forward-only: disable dispatch, retire active journey versions, pause active enrollments, and preserve message/event history. Use a forward repair if a schema correction is needed after rows exist.

Feature mode defaults to off. Test mode requires exact recipient and record/enrollment/message allowlists; live mode requires an exact approved enrollment allowlist. Resend delivery requires recorded, verified explicit opt-in. No production migration, provider configuration, email send, merge, deployment, or cohort activation has occurred for this release.

The database handoff gate checks current eligibility, consent, contactability, source mapping, message approval, schedule, and predecessor state in one transaction, then returns an authorized payload for the Resend request. That transaction ends before the external request; authorization is point-in-time and does not serialize a later stop or consent change with provider delivery.

## Recipient unsubscribe

The live Resend adapter requires AGENCY_FOLLOWUP_UNSUBSCRIBE_SECRET: a server-only signing key with at least 32 UTF-8 bytes. Keep it in the deployment secret store and do not expose it to a browser or log. A missing or weak key blocks live dispatch. Production configuration is not set by this change.

Each approved email body must contain {{agency_followup_unsubscribe_url}} exactly once. The adapter replaces it with a signed, message-specific URL and sends the corresponding List-Unsubscribe and RFC 8058 List-Unsubscribe-Post headers. Do not copy a signed recipient URL into another message or template.

A GET displays a confirmation page and does not unsubscribe; link-preview scanners therefore cannot opt a person out by fetching the URL. The RFC 8058 POST records an idempotent, append-only opt-out using only the normalized recipient hash and message/enrollment identifiers. The final database handoff gate checks that record for the address, including a worker that claimed a message earlier and any other prospect with the same normalized email. The service-role-only table and RPC are not granted to anon or authenticated.

The handoff decision is point-in-time. If the opt-out commits before the final gate authorizes an attempt, that attempt is blocked. If the gate authorizes first, its transaction ends before the separate Resend request; that already-authorized message may still be accepted or delivered while the opt-out is being recorded. Every later handoff is blocked. Do not claim that the in-flight message was cancelled; if its provider result is ambiguous, keep it `unknown` and do not retry.

The current signing format uses one active key. Rotating AGENCY_FOLLOWUP_UNSUBSCRIBE_SECRET invalidates every outstanding unsubscribe URL. Do not rotate it after messages have been sent until a versioned-key transition or another safe plan for outstanding links is in place.
## Manual reply and booking reconciliation

No automatic mailbox or calendar ingestion is verified for this workflow. Before approving or releasing a message, and again immediately before every dispatch, check the prospect's actual inbox and calendar history. Do not treat an empty CRM activity list as proof that no reply or booking exists.

In the Agency prospect's activity panel, choose **Activity type** and record only confirmed events:

- For an inbound reply, choose **Human reply**, select the recorded **Reply disposition**, then choose **Save activity**. A declined reply sets the conversation to declined; other human replies set it to replied.
- For a booked meeting that has not happened yet, choose **Meeting** and leave **Meeting outcome** blank. This sets meeting_scheduled. After the meeting, record the verified outcome; a non-empty outcome sets completed.
- For a confirmed delivery failure, choose **Bounce**. This sets unreachable.
- Use the separate **Contact controls** section for a verified future next action. Do not put a future action in **Meeting outcome**.

After saving, refresh the prospect activity history and confirm the expected conversation status is visible. The database handoff gate blocks all five statuses (replied, unreachable, declined, meeting_scheduled, and completed) immediately before provider handoff. If a status, identity, reply, booking, suppression, or inbox/calendar check is uncertain, do not approve or dispatch; resolve it through the authorized operator workflow first.

Saving an activity records CRM evidence. It does not send a message, inspect external mailboxes/calendars automatically, or prove that an operator completed those external checks.


## Authoring and versioning

- Template content is immutable. Create a new `template_key` version for changed copy, then record an operator approval on that version.
- Journey configuration is immutable. Create a new `journey_key` version for changed steps, timezone, business days, local window, or minimum spacing.
- Steps reference approved template versions and have ordered step numbers with business-day delays.
- Activating a draft retires the previous active version for that key in one database transaction. Existing enrollments retain their original journey and template references.
- Review and authoring events are append-only and include the operator identity.
- Template approval is one transactional service RPC: it rejects missing, non-operator, and disabled operator identities, updates only a draft version, and inserts the append-only 	emplate_approved event in the same transaction. The RPC is executable only by service_role; production identity still must come from the authenticated operator path.

## Consent evidence

- Record a grant only after reviewing source evidence that explicitly permits Agency follow-up email to the exact recipient shown in the prospect queue. The operator attestation in the form requires this for every grant. A business eligibility decision, previous contact, inferred interest, or synthetic fixture is not consent.
- Record the capture time from the source, its evidence type, the consent-text version and SHA-256, and a durable evidence reference and SHA-256. The time field uses the browser's displayed IANA timezone; convert evidence times from another timezone before entering them. The authenticated operator identity is taken from the server session; it is not supplied by the form.
- Grant and withdrawal actions append immutable events. Use the consent history view to check the event type, capture and record times, evidence reference and hashes, recipient hash, and recording operator. A reference and hash help locate and verify a reviewed source; they do not by themselves establish that consent was given.
- Consent is bound to the current prospect source, conversation, and normalized recipient address. A changed recipient requires fresh evidence. Record a withdrawal as soon as it is received; it appends a new event and blocks later follow-up for that address.
- The form records evidence only. It never dispatches email. The fake provider and synthetic walkthrough must not be used as evidence of consent or live delivery.

## Scheduling and worker states

Enrollment computes and persists each step's due instant in the configured IANA timezone, using the configured business days and local window start. Immediately before provider handoff, the worker checks the current local weekday and full half-open window `[start, end)`. A delayed claim outside that window is rescheduled to the next configured local opening. Step delays and minimum spacing are applied before the individual prospect is released. Message approval moves that message to the durable `scheduled` queue.

The claim function uses `FOR UPDATE SKIP LOCKED` and a bounded lease. A claimed message is reloaded against current prospect and shared Agency history before the configured provider adapter is called. A changed suppression, eligibility decision, identity, message hash, reviewer, or review timestamp prevents handoff. Definitive retryable failures use the same logical idempotency key and bounded backoff. Permanent failures stop. A provider interruption or expired lease becomes `unknown`; it is quarantined and never automatically retried.

## Migration, release, and rollback

The migration may be applied to a disposable loopback Supabase stack for the explicitly authorized synthetic walkthrough, only after verifying that the target has a distinct disposable project identity and the migration blob exactly matches a pushed branch. That local test does not authorize production changes. Production migration/release still requires the pushed migration, CI's fresh-Postgres checks, code review, and separate explicit release approval. Never use the pre-existing database or import real firms, people, or conversations.

After an approved migration, rollback should first disable the worker entrypoint and retire active journey versions. Pause active enrollments and preserve message and event history. Do not drop tables or delete audit records. If a schema correction is needed after rows exist, ship a forward repair migration that preserves foreign keys and immutable history. This branch does not merge or deploy and does not perform production database or provider actions.

## Local verification

Use synthetic prospect, reviewer, and message fixtures. The fake provider must remain network-free. The local walkthrough starts the actual Next app with process-only test credentials, seeds only synthetic rows into the verified disposable stack, signs an operator session cookie, and drives the actual operator page with Playwright. It covers normal authoring and approval plus duplicate enrollment, pause, suppression, invalidated approval, retry, and UNKNOWN quarantine. `npm run agency-followup:walkthrough` runs automated checks and writes screenshots plus a summary under ignored `test-results/agency-followup-walkthrough`; `npm run agency-followup:manual` opens the signed synthetic operator page in a headed browser and keeps the local server alive until Ctrl+C. Both modes leave their synthetic audit and fixture rows in the disposable database; discard the scratch stack to remove them. Never point these commands at any existing or production database. Never copy real credentials into files or print cookie/key values. Browser checks use the actual operator page with synthetic data at 1440, 1024, 768, 640, 375, and 320 CSS pixels.

From the repository root in PowerShell, with the isolated walkthrough stack already started and verified:

```powershell
$env:AGENCY_FOLLOWUP_DISPOSABLE_DATABASE_CONFIRMATION = 'YES-LOCAL-DISPOSABLE-ONLY'
npm run agency-followup:walkthrough
```

Use `npm run agency-followup:manual` instead to open the headed operator page. It creates the same isolated synthetic operator and prospect fixtures, then stays open until Ctrl+C. The runner independently checks the scratch project ID, loopback API/DB ports, both migration ledger versions, both migration blobs against their verified pushed branch revisions, and the service-role-only CRM table grants before seeding anything. It reads local Supabase keys into process memory only.

## 2026-10-14 synthetic walkthrough report

A full local synthetic walkthrough passed with exit code 0 earlier on 2026-10-14; that is historical evidence only. Fresh full reruns on the current PR head have not completed. One reached the actual operator page, which returned 200 after a slow compile, but no client chunks loaded before the hydration timeout. Later runs using both default Turbopack and Webpack exited after the 10-minute startup bound without binding loopback port 55435 or writing Next stdout/stderr. A lightweight `next --version` eventually returned 16.4.0 after about 100 seconds, which confirms unusually slow local module loading but does not establish its cause. The runner uses `--webpack` to match the repository `dev` script and the earlier run that reached the operator page. On PR commit `5357d1a9c8b3c57b15538ebdb7aa654b204ad361`, 89 Agency CRM tests passed across 13 files, including operator UI contracts, follow-up services, prospect routes, and import routes. This is useful code-level evidence but does not verify the rendered journeys.

On pushed PR head `c3aa3e8fd08fa4bb47b7c91d44a3581d48db9d96`, the screenshot runner now scrolls the page to the top immediately before each full-page viewport capture, keeping fixed mobile navigation evidence consistent. Local ESLint completed with zero errors and four existing unused-variable warnings. The exact-head PR CI passed ESLint, TypeScript, the full Vitest suite, operator-login and Secure Import rendered-copy gates, render parity, and both Vercel preview statuses. The real-Postgres job passed fresh-stack migration startup, publication/privacy integration, restore rehearsal, and the prospect-enrichment database contract. It then passed all 21 Prospect Enrichment rendered/intake-review Playwright tests and uploaded the prospect-enrichment-rendered-evidence artifact (107 files, about 39 MB). This is a separate CRM journey and does not verify the Agency Follow-up operator journey.

On 2026-10-14, the automated local Agency walkthrough passed on pushed branch `codex/crm-operator-walkthrough-20261013` at commit `cc173d3348a0e41fdfe882c941f5246682a6164a`. The Docker Linux engine was available to the elevated walkthrough process; ordinary sandboxed shell probes still received access denied for its named pipe. Docker reported 25 containers, 22 running, and WSL reported `docker-desktop` running. The walkthrough completed with exit code 0.

- The runner verified disposable project ID `crm-followup-walkthrough-20261013`, loopback API and database ports, migration versions `20261013154000` and `20261013230354`, the exact migration blobs on the pushed branch, six follow-up tables, and Agency CRM grants before seeding.
- Confirmed the follow-up API returns 401 without an operator session and 200 with the synthetic signed operator session.
- Passed template create/approve, journey create/activate, exact prospect search, enrollment, eligibility, per-prospect release, and per-message approval.
- Passed duplicate enrollment protection, pause behavior, suppression blocking, approval invalidation after content changes, accepted fake-provider persistence, UNKNOWN quarantine without retry, weekend-window rescheduling, concurrent claim exclusivity, and stale-lease rejection.
- Verified rendered copy and horizontal overflow at 1440, 1024, 768, 640, 375, and 320 CSS pixels. The six current queue screenshots are `screenshots/queue-{1440,1024,768,640,375,320}.png`; the machine-readable result is `summary.json` under ignored `test-results/agency-followup-walkthrough`. The screenshots also show synthetic fixtures left by earlier runs in this same disposable database, so the queue contains more than the six records seeded by this run.

This run seeded one synthetic operator and six synthetic prospects into the existing disposable local database; it did not reset the database, and the synthetic audit and fixture rows remain there. No production database, real contact, or real provider was accessed, and no message was sent. The fake provider is local-only and network-free.

### Run the walkthrough

From the repository root in PowerShell, start and verify the dedicated scratch stack, then run:

```powershell
$env:AGENCY_FOLLOWUP_DISPOSABLE_DATABASE_CONFIRMATION = 'YES-LOCAL-DISPOSABLE-ONLY'
npm run agency-followup:walkthrough
```

The runner checks the scratch identity, loopback endpoints, migration ledger and pushed migration blobs, and required grants before writing synthetic rows. Use `npm run agency-followup:manual` to open the signed synthetic operator page in a headed browser. The manual run remains open until Ctrl+C. Both commands are local-only and must never be pointed at an existing or production database.

## 2026-10-15 acceptance follow-up status

PR #402 merged on 2026-10-15 at 01:18 UTC as `c6b70214058a41040aeb5c484f4ba493f10f299d`. This follow-up is separate work on `codex/crm-followup-acceptance-20261014`; it does not change production or merge PR #402 again.

The acceptance changes in this worktree are not yet validated. They add stable transition waits, open and closed mobile navigation checks, point-hit occlusion checks for the heading and authoring control, and viewport checks at 1440, 1024, 769, 768, 767, 640, 375, and 320 CSS pixels. The worker unit fixture now models scheduled due times and covers early exclusion, acceptance at the retry instant, the five-attempt limit, and permanent failure. UNKNOWN remains terminal and is never automatically reclaimed.

A baseline walkthrough attempt on `c6b7021` stopped with `Cannot find module 'pg'`; it did not connect to the disposable database, seed rows, run a browser, or capture screenshots. The attempt record is `test-results/agency-followup-walkthrough/baseline-ed5ff68b-2a5a-4e05-9b24-5944bcb2f4c9.json`. The latest edited-source attempt then failed before the walkthrough loaded: `node --import tsx` raised `Error: spawn EFTYPE` from the partial `tsx/esbuild` install under Node 24.14.0. The focused worker-test command passed the metadata-secret scan, then exited with 1 because `vitest` was not recognized. The exact commands, outputs, UTC timestamps, source commit, dirty status, and diff fingerprint are recorded in `test-results/agency-followup-walkthrough/validation-attempt-a66f541b-37f5-4f6f-9d49-af498011f2be.json`. Neither latest attempt accessed the database or captured screenshots. Syntax-only TypeScript transpilation passed for the edited source and test files; the unit and full local browser/database validation remain outstanding.

The walkthrough is designed to reuse the dedicated disposable local stack without resetting it. Earlier synthetic walkthrough fixtures may remain in that stack; they are historical fixtures, not rows created by the new run. The Prospect Enrichment rendered Playwright artifact described above is separate evidence and does not establish that this Agency Follow-up walkthrough passed. A completed run must link each screenshot hash to its run ID and record source commit, working-tree fingerprint, UTC times, command, exit status, and migration identities.

### Execution checkpoint: dependency repair and stronger acceptance

The follow-up execution restored the missing local stack configuration from the prior D: walkthrough worktree after verifying its project ID, ports and disabled analytics setting. Starting the installed Docker Desktop brought the existing disposable containers back online without a database reset. Read-only preflight verified both required migration versions, their fetched origin/main blob identities, all six follow-up tables and the expected CRM grants.

The runner now requires exactly one visible, enabled and unoccluded Template key input and includes an isolated negative check for a removed input. Layout capture waits for finite transitions and three stable geometry frames within five seconds. Source state is captured before the temporary route is created and checked again after cleanup; the route has its own content hash. Success summaries are emitted after cleanup, and a separate local command wrapper records actual process exit and verifies screenshot hashes.

Each fake dispatch uses temporary row locks to exclude retained scheduled fixtures without rewriting them. The retry scenario now verifies persisted acceptance at the due instant, the same logical key, exactly two attempts, one acceptance event and no repeated claim after acceptance. Worker tests also assert that early retries and terminal exhaustion, permanent-failure and UNKNOWN states make no extra provider calls.

This was the pending checkpoint as of 2026-10-15 and is superseded by the 2026-10-16 evidence section below. The locked offline installation later completed successfully, and a full synthetic database/browser walkthrough produced 12 screenshots. Exact-final-head verification, commit/push, PR creation and CI are still outstanding.

## Historical PR status (superseded by PR #426)

This subsection records earlier PR #414 state and is retained only as historical context. It does not describe PR #426 or satisfy its review, checks, or approval. Consult the private execution ledger for the current release state.


PR #402 and PR #407 are merged; PR #407 merge commit is 8bf661e2aea255f26071aea326381ce14de3bda7. The additive live-follow-up work is PR #414 on codex/crm-live-followup-20261019, currently open, unmerged and mergeable at head c0a5af198eb103ac349c72f1e19ede7c89b0f8ef. Historical runs #8–19 contain earlier runner, migration and viewport failures; they are not evidence against or for the current head. Current Agency walkthrough #20 (39885658708) and CI #1968 (39885665794) passed on the exact current head. Artifact 12472583616 has digest sha256:9ad1891886099c29540158f6dedecc354a4831ff01b52e29c169c79036de3aaf; its manifest records the screenshot hashes.

The GitHub installation now lists adrianosortudo-source with all repositories selected, and repository metadata reports admin, maintain, pull and push access. The current main branch reports six required status contexts; all six passed on this PR head. The rulesets endpoint returned no rulesets. The GitHub integration still denies the branch-protection review-details endpoint, so any required-review policy has not been independently verified. The PR has no submitted formal review. Adriano has not recorded merge/release approval specifically for PR #414.

The separate headed CRM manual walkthrough remains pending because Docker Desktop is not responding in this execution session. No production migration, provider configuration, live send, production deployment, owner-inbox receipt or cohort activation has occurred. Do not treat PR #407 authorization, fake-provider acceptance, Vercel READY, or provider acceptance as those missing gates.
## 2026-10-16 acceptance evidence checkpoint

The full synthetic database/browser walkthrough passed with exit code 0 on 2026-10-16 from the existing disposable local project `crm-followup-walkthrough-20261013`, without resetting its database. Run ID `2aab4b5a-5a57-4e12-83eb-fd94bd0a4af4` tested commit `028c776d1391fadcecd6af1ec9db625d03d55f89` with dirty-source fingerprint `67993697c3b32084a5be6faff44f44077d08133f8454727938ef70e7cd02718e`, from 2026-10-16 04:32:16Z to 04:35:46Z. The provenance record is `test-results/agency-followup-walkthrough/2aab4b5a-5a57-4e12-83eb-fd94bd0a4af4/manifest.json`; the command and result summary, including per-capture SHA-256 values, are in its `command.log`.

The run verified both pushed migration blobs and ledger versions, the disposable project identity, six follow-up tables and service-role grants. It used seven newly seeded synthetic prospects alongside retained earlier synthetic fixtures. Template/journey authoring, duplicate-enrollment protection, eligibility and release, message approval, pause, suppression conflict, approval invalidation, fake acceptance, UNKNOWN quarantine, weekend-window rescheduling, retry/backoff and idempotency, concurrent claim exclusivity, and stale-lease rejection passed. The fake provider was network-free; no real contact, provider, message, production database, or deployment was used. The temporary route and local Next process were cleaned up.

Twelve screenshots were captured and reviewed for heading/control visibility, menu state, wrapping and overflow at 1440, 1024, 769, 768, 767, 640, 375 and 320 CSS pixels. Navigation-open and navigation-closed states are included at 767, 640, 375 and 320 pixels. Images are under `test-results/agency-followup-walkthrough/screenshots/` with this run ID in each filename; their hashes and viewport/state mapping are in the command log summary.

Two subsequent runner-only failures were diagnosed: the first reached the final UI phase but Playwright received a transpiler-injected `__name` helper in a browser callback; after the callback was inlined, the next run passed. A TypeScript check then found stale ignored `.next/dev/types` entries referring to the already-cleaned temporary route. Those exact generated files were preserved as `stale-dev-validator-20261016_02.ts.txt` and `stale-temp-route-type-20261016_02.ts.txt` after SHA-256 verification; TypeScript then passed. The current source also removes unused walkthrough parameters.

The exact pushed source HEAD `d569b4b1b72bbe490e673760f64595a00789d613` passed the focused worker suite (10 tests), the Agency Follow-up/CRM suite (13 files, 91 tests), TypeScript no-emit, and scoped ESLint (zero warnings). The full database/browser walkthrough also passed on that clean HEAD: run ID `6736e194-2db4-496f-8e08-0846dd9a38db`, 2026-10-16 04:47:59Z–04:52:29Z, exit code 0. Its provenance manifest and command log are `test-results/agency-followup-walkthrough/6736e194-2db4-496f-8e08-0846dd9a38db/manifest.json` and `command.log`; all twelve screenshot hashes were independently verified against the summary. This evidence precedes the documentation-only commit that records it; the final pushed head must be rechecked after that commit.
