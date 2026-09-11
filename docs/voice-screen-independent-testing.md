# Independent Voice-to-Screen testing

Each segment has an entry point. Running the entire phone-to-SMS journey is not required to inspect the caller UI or test qualification.

## Interactive entry points

- `/test/voice-screen/widget`: the exact `ContinuationWidget` component used by `/widget/voice-continuation`, with fictional call facts and a browser-memory transport. Answer, skip, finish, inspect the brief, and reset.
- `/test/voice-screen/brief`: the production report builder, immediately populated from the same sample call. Switching between widget and brief preserves the current test session.
- `/test/voice-screen/connections`: independently exercise the production handoff policy by changing caller type, urgency, consent, safe-to-text, and human request. The SMS section renders the exact message function used by the production sender.
- `/test/voice-screen`: links to all available tests and states which integration checks remain separate.

Test controls are outside the shared caller component. Test data exists only in the tab; resetting or reloading starts again. There is no API request, customer inquiry, contact update, message dispatch, storage, or production-token shortcut.

## Shared implementation contracts

Both the test session and authenticated continuation API use `voice-screen-continuation.ts` for seeding, scoring, question projection, answer validation, revisions, skip and finish. Production retains its existing token checks, service gates, rate limit, database lookup and optimistic database save. Only the transport and test fixtures differ.

Reports use the normal `buildReport` function. The API parity test compares all report assessment fields while preserving each independently created inquiry's own ID and timestamp.

## What these tests prove

The interactive routes prove caller presentation, qualification transitions, call-fact continuity, combined report content, handoff decisions and outgoing SMS wording. They are not a substitute for carrier delivery, cryptographic provider authentication, database persistence, expiry/revocation, or a complete call-to-SMS test.

Those integration boundaries already have automated route/provider/sender/database tests. Their operator-facing individual test launchers remain future work. A message-content test must never be described as a delivered SMS, and an input-policy test must never be described as a signed event.

## Repeatable verification

`npx vitest run src/lib/__tests__/voice-screen-test-session.test.ts src/lib/__tests__/voice-screen-message.test.ts src/app/api/voice-screen/continue/__tests__/route.test.ts`

`npx playwright test --config=playwright.voice-screen-independent.config.ts`

The dedicated CI workflow runs Chromium without service credentials. It exercises the widget and brief directly at 1440, 1024, 768, 640, 375 and 320 CSS pixels, checks rendered text and natural-height fields, and stores screenshots and failure traces as artifacts. A production release still uses the repository's specific-PR approval and merge process.
