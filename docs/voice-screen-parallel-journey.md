# Parallel Voice to Screen prototype

## Built scope

New route `/demo/voice-to-screen` uses the unchanged pure Screen demo engine. It simulates a short fictional reception call, requires explicit inquiry SMS permission and confirmation that the callback number is correct and safe to text, previews a message, asks remaining adaptive questions, and updates a combined lawyer brief. Existing/urgent callers and callers without permission continue to a human follow-up demonstration without an invitation. Early Screen exit retains the callback request.

This is browser memory only. No audio call, SMS, WhatsApp, persistence, private link or human notification is performed. Refresh discards the demonstration. This is not a production continuation endpoint. No existing journey files, shared engine code, migrations or phone routing are changed.

`src/lib/voice-screen-bridge.ts` is an inactive pure eligibility policy with current-call provenance checks. It cannot send messages. No environment flag can make this prototype live.

## Separate HighLevel assets

- Location: `TH71IN0vUaIByLOxnFQY`
- Parallel test agent: `6aa1d9d7c17e44082c31a0fc`
- Draft workflow: `6f6d9cb7-39d8-43b1-890e-be98506b622a`
- Dedicated extraction: `contact.v2s_test_call_capture` (multiline JSON), `contact.v2s_test_inquiry_sms_consent`, `contact.v2s_test_safe_to_text`.

These shared contact fields are inspection aids, not proof of the current call. The authenticated provider event must supply call ID, location, agent ID and timestamps; the model must not invent them. Final saved configuration and field action status must be verified separately in HighLevel.

## Remaining production implementation

1. Obtain a real test agent call event and verify provider authentication, immutable call ID, timing of transcript/actions, and current-call extraction provenance. Reconcile consent and safe-to-text evidence against that call, not a contact's previous values.
2. Add an authenticated bridge scoped to this test location and agent only. Suggested future endpoint `/api/integrations/voice-screen/calls` does not exist yet. Reject original-agent events and invalid payloads; do not log transcripts or secrets.
3. Add a separate durable inquiry store and unique `(location_id, call_id)` claim. Create the human callback task at intake, before qualification. Separate multiple calls by the same contact. Late events must not overwrite newer inquiries. Use an atomic outbox claim to prevent retries from resending SMS.
4. Mint at least 256 random bits for a continuation token, store only its hash, bind it to the inquiry and expiry, and expose no personal data or contact IDs in URLs. Add expiry, revocation, abuse limits and safe browser/session handling. Suppress third-party scripts and referrer leakage. Keep the lawyer brief behind operator authorization, never in the caller's bearer-link response.
5. Persist only required current-call facts and caller answers, with source attribution, corrections and unknowns. Integrate the existing Screen engine through a dedicated adapter. Avoid detailed sensitive pre-conflict questioning and provide skip/finish paths.
6. Configure a test SMS sender and send to an explicitly approved test number. Suppress opted-out, unsafe, unverified, urgent, existing-client and human-takeover cases. A late opt-out or human takeover must cancel the queued invitation before dispatch.
7. Verify actual call, provider event, one SMS, mobile continuation, combined brief and human notification. Test duplicate/out-of-order events, interrupted Screen, declined permission, token expiry, failed send and human takeover.

Database changes must be committed and pushed before application. Production release requires the specific PR's merge approval and successful CI; this prototype is not a production activation request.

## UI scope

Only the new demo route is styled. The split becomes stacked below 800px. Form controls, progress navigation, facts lists, and the simulated SMS bubble are functional layout elements; ordinary panel copy fills the panel content box. No editorial width caps are used.

## Validation record

- Initial commit `1499d767`: all 14 GitHub checks passed, including TypeScript, ESLint, full Vitest, real Postgres integration, existing rendered-copy suites and the Vercel preview build. Those existing rendered suites do not constitute six-viewport testing of this new route.
- Interactive authenticated preview review verified the grant path and declined, unknown, unsafe-number, urgent and existing-client paths. It found that the text-only extractor missed the explicitly stated $28,000 amount. Follow-up commit `426e51df` seeds validated fixture facts directly, and adds assertions that known amount, invoice, payment and dispute facts are not asked again. The source narrative retains the exact amount.
- Local initial focused suite: 12 tests passed. The follow-up adds one skipped-question regression (13 total). Latest CI must be checked against the final commit before merge.
- Local full TypeScript check using the canonical dependency junction failed because the dependency installation lacked Next and Playwright declarations. The junction was removed without altering canonical dependencies; a clean worktree install was started. Clean CI TypeScript passed on the initial commit. Do not present the failed local check as a pass.
- Real calls, actual SMS delivery, persistent links, human notifications and production routing remain untested and unimplemented by this prototype.
- Follow-up `426e51df`: all 14 checks passed, including the expanded 13-test focused suite as part of full Vitest. The preview is available through PR #250 and requires Vercel authentication.
- The isolated dependency installation was stopped after prolonged registry requests (individual requests exceeded seven minutes). Only that install process was stopped; partial ignored `node_modules` remains in this worktree. No canonical dependencies were modified. Local server is stopped. The new route's full six-width rendered-copy audit is still outstanding; it is not waived or represented as passed.
- Authenticated browser review on `426e51df` verified the complete corrected grant-and-safe path: five remaining questions (delivery proof, timing, other lawyer, decision maker, desired outcome), no repeated amount or dispute question, live combined brief updates and successful Finish Screen. The demonstration was reset after review.
- Added scoped rendered regression: `npx playwright test --config=playwright.voice-screen-demo.config.ts`. It covers six widths, copy bounds/orphans, each journey stage, known-fact continuity, negative paths, URL privacy and absence of writes/storage. It has not been executed in this environment because local dependencies could not finish installing; it is not automatically included in the existing CI workflow.
