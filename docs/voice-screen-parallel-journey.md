# Parallel Voice to Screen: demo and disabled persisted pilot

## Built scope

New route `/demo/voice-to-screen` uses the unchanged pure Screen demo engine. It simulates a short fictional reception call, requires explicit inquiry SMS permission and confirmation that the callback number is correct and safe to text, previews a message, asks remaining adaptive questions, and updates a combined lawyer brief. Existing/urgent callers and callers without permission continue to a human follow-up demonstration without an invitation. Early Screen exit retains the callback request.

The `/demo/voice-to-screen` route is browser memory only. It performs no actual call, message or persistence; refresh discards its fictional state. The separate persisted pilot described below adds new routes and a migration without changing the shared Screen engine or existing phone routing. The existing retention job gains an explicitly gated parallel cleanup hook.

`src/lib/voice-screen-bridge.ts` is an inactive pure eligibility policy with current-call provenance checks. It cannot send messages. No environment flag can make this prototype live.

## Separate HighLevel assets

- Location: `TH71IN0vUaIByLOxnFQY`
- Parallel test agent: `6aa1d9d7c17e44082c31a0fc`
- Draft workflow: `6f6d9cb7-39d8-43b1-890e-be98506b622a`
- Dedicated extraction: `contact.v2s_test_call_capture` (multiline JSON), `contact.v2s_test_inquiry_sms_consent`, `contact.v2s_test_safe_to_text`.

These shared contact fields are inspection aids, not proof of the current call. The authenticated provider event must supply call ID, location, agent ID and timestamps; the model must not invent them. Final saved configuration and field action status must be verified separately in HighLevel.

## Implementation and activation status

1. Obtain a real test agent call event and verify provider authentication, immutable call ID, timing of transcript/actions, and current-call extraction provenance. Reconcile consent and safe-to-text evidence against that call, not a contact's previous values.
2. Implemented, disabled: authenticated exact-call hydration at `/api/integrations/voice-screen/calls`, scoped to the configured TEST agent/location, with enforced rate limiting and stale-event rejection.
3. Implemented, migration unapplied: durable inquiry and unique `(location_id, agent_id, call_id)` identity, immediate human queue, atomic outbox and no ambiguous-send retry.
4. Implemented, unactivated: opaque keyed continuation, stored hash, expiry, revocation and private operator brief. Actual provider delivery and live security/rendered acceptance remain unverified.
5. Implemented: bounded current-call facts and attributed incremental answers through the existing engine, with skip/finish paths. Privacy-registry integration and provider deletion events remain rollout blockers.
6. Configure a test SMS sender and send to an explicitly approved test number. Suppress opted-out, unsafe, unverified, urgent, existing-client and human-takeover cases. A late opt-out or human takeover must cancel the queued invitation before dispatch.
7. Verify actual call, provider event, one SMS, mobile continuation, combined brief and human notification. Test duplicate/out-of-order events, interrupted Screen, declined permission, token expiry, failed send and human takeover.

Database changes must be committed and pushed before application. Production release requires the specific PR's merge approval and successful CI; this prototype is not a production activation request.

## UI scope

Only the new demo route is styled. The split becomes stacked below 800px. Form controls, progress navigation, facts lists, and the simulated SMS bubble are functional layout elements; ordinary panel copy fills the panel content box. No editorial width caps are used.

## Validation record

### Persisted pipeline implementation (not activated)

The follow-up adds a separate persisted journey behind disabled server gates. The earlier prototype-only limitations below are historical. No migration has been applied, credential configured, real message sent, or production release approved.

- Ingest: `POST /api/integrations/voice-screen/calls`, header `x-v2s-secret`, JSON `{ "callId": "actual-provider-call-log-id" }`. The server retrieves that exact call from GHL; mutable contact fields and `contact.id` are not accepted as call evidence. This workflow adapter is distinct from a native marketplace webhook.
- Persistence: `20260909231831_voice_screen_parallel_journey.sql` adds service-only inquiry/outbox tables and atomic dedupe, revision-save, dispatch-claim and takeover RPCs. Each location/agent/call has an immutable inquiry and immediate human queue entry. No raw transcript is stored; bounded permission/safety/callback evidence and timestamp provenance are retained.
- Caller: `/widget/voice-continuation#opaque-token` removes the fragment immediately and uses memory-only bearer API access. The keyed token uses a 32-byte random seed; only its hash and non-bearer seed persist. Pilot expiry defaults to 7 days (`V2S_RETENTION_DAYS`, integer 1–30). Answers save incrementally with optimistic revisions; callers never receive the lawyer report or raw call facts.
- Lawyer: `/admin/voice-screen` requires existing operator authentication. Review combines captured facts and saved answers; takeover revokes continuation independently of Screen completion. No separate email/human notification is configured.
- Sending: an enabled, newly created inquiry schedules one background dispatch. `/api/admin/voice-screen/dispatch` supports authenticated pending recovery; no cron schedule was added. Current contact location, number and DND are rechecked. Only explicitly allowlisted test numbers are eligible. Ambiguous provider outcomes are never automatically retried; an already in-flight SMS may arrive after takeover, but its link is revoked.

Required server configuration: `V2S_ENABLED=true`, `V2S_FIRM_ID`, `V2S_LOCATION_ID`, `V2S_AGENT_ID`, `V2S_PUBLIC_ORIGIN` (HTTPS origin), `V2S_TOKEN_KEY` and `V2S_WEBHOOK_SECRET` (each at least 32 characters), `V2S_GHL_VOICE_TOKEN` with verified `voice-ai-dashboard.readonly` access, plus active `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Sending separately requires `V2S_SMS_ENABLED=true`, dedicated `V2S_GHL_SMS_TOKEN` with verified contact-read/message-write scopes, `V2S_SENDER_NAME`, and `V2S_TEST_RECIPIENTS` containing exact E.164 test numbers. None of these flags or credentials were activated here.

Activation gates: pushed migration and passing fresh-Postgres CI; explicit PR merge and migration approval; server-only firm/location/TEST-agent mapping; verified provider call-log shape, transcript speaker labels and timestamp semantics; scoped read/send credentials; actual call permission/safety/phone proof; approved test recipients; end-to-end controlled test. Strict speech-number proof currently suppresses invitations when the caller does not state an exact E.164-equivalent number. Live caller/operator UI responsive QA and delivery testing remain outstanding.

Retention must be enabled with `V2S_RETENTION_ENABLED=true` when the pilot is activated; `liveConfig` fails closed otherwise. The existing daily `runDataRetention` job calls service-only `v2s_purge_expired` in bounded batches and reports `voice_screen_inquiries_purged` plus errors. Expiry deletes the entire inquiry and cascading outbox, not just its token. Keep this cleanup gate enabled even after disabling new intake. No purge was executed during implementation.

Token-key rotation is a deliberate global revocation: changing `V2S_TOKEN_KEY` makes stored seeds reconstruct different tokens. Disable new sends, drain or expire existing links, and communicate the effect before rotation. Do not rotate it as routine configuration cleanup. No rotation occurred here.

Verified subject erasure is available to authenticated operators at `POST /api/admin/voice-screen` with same-origin JSON `{ "action": "erase_subject", "contactId": "verified-GHL-contact-id", "confirm": "ERASE" }`. It removes all parallel inquiries for that subject inside the configured firm/location. This is a manual pilot procedure, not a claim that the existing deletion registry or GHL contact-deletion webhook is fully integrated. Those integrations are named blockers before broader rollout; no automatic deletion occurs on a possibly transient provider 404. Erased records cannot be restored by this feature. Ingestion rejects calls older than 24 hours to limit late-event recreation; privacy deletion registry suppression remains required for complete replay protection after erasure.

The operator queue exposes unknown/dispatching invitations and a reconciliation action. Requests dispatching for over five minutes are marked unknown, never put back into the send queue. Staff must inspect provider history before any follow-up. Firm UUIDs and location/agent identifiers are validated server-side. Missing secrets, Redis enforcement, current-call proof or test-recipient permission keep the journey disabled or suppress its invitation.

- Initial commit `1499d767`: all 14 GitHub checks passed, including TypeScript, ESLint, full Vitest, real Postgres integration, existing rendered-copy suites and the Vercel preview build. Those existing rendered suites do not constitute six-viewport testing of this new route.
- Interactive authenticated preview review verified the grant path and declined, unknown, unsafe-number, urgent and existing-client paths. It found that the text-only extractor missed the explicitly stated $28,000 amount. Follow-up commit `426e51df` seeds validated fixture facts directly, and adds assertions that known amount, invoice, payment and dispute facts are not asked again. The source narrative retains the exact amount.
- Local initial focused suite: 12 tests passed. The follow-up adds one skipped-question regression (13 total). Latest CI must be checked against the final commit before merge.
- Local full TypeScript check using the canonical dependency junction failed because the dependency installation lacked Next and Playwright declarations. The junction was removed without altering canonical dependencies; a clean worktree install was started. Clean CI TypeScript passed on the initial commit. Do not present the failed local check as a pass.
- The fictional prototype never makes real calls or sends. The separate persisted pilot is implemented in source but actual GHL calls, SMS delivery, production routing and live retention remain untested/unactivated; separate human notifications are not configured.
- Follow-up `426e51df`: all 14 checks passed, including the expanded 13-test focused suite as part of full Vitest. The preview is available through PR #250 and requires Vercel authentication.
- The isolated dependency installation was stopped after prolonged registry requests (individual requests exceeded seven minutes). Only that install process was stopped; partial ignored `node_modules` remains in this worktree. No canonical dependencies were modified. Local server is stopped. The new route's full six-width rendered-copy audit is still outstanding; it is not waived or represented as passed.
- Authenticated browser review on `426e51df` verified the complete corrected grant-and-safe path: five remaining questions (delivery proof, timing, other lawyer, decision maker, desired outcome), no repeated amount or dispute question, live combined brief updates and successful Finish Screen. The demonstration was reset after review.
- Added scoped rendered regression: `npx playwright test --config=playwright.voice-screen-demo.config.ts`. It covers six widths, copy bounds/orphans, each journey stage, known-fact continuity, negative paths, URL privacy and absence of writes/storage. It has not been executed in this environment because local dependencies could not finish installing; it is not automatically included in the existing CI workflow.
