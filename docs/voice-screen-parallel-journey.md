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
