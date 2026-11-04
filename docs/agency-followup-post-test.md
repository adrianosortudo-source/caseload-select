# Agency follow-up: post-test verification and return to off

Use this runbook after a specifically authorized, one-message Agency follow-up test. It describes checks; it is not evidence that a message was sent or permission to send another one.

## Restore sending to off

1. Preserve the result of the single approved dispatch, including its logical message identity, invocation reference, and any provider outcome. Do not run a second dispatch to resolve an ambiguous response.
2. Set the stored production Agency follow-up send mode to `off` through the approved configuration path. Keep the exact recipient and record restrictions in place.
3. Apply that stored change through a separately approved PR to main after all required checks pass. The previously deployed test-mode instance does not change merely because the stored variable changed. Direct workstation deployments, promotions, and rollbacks remain prohibited for this application.
4. Verify the production admin domain resolves to the intended new deployment and the authenticated follow-up page says sending is off. Record the actual result; if the release or readback fails, report that sending-off is unverified and investigate without dispatching again.

## Reconcile without resending

- Distinguish the provider's accepted or delivered event from receipt in the intended owner's inbox. Verify both separately and record only the minimum nonsecret identifiers and timestamps needed to associate them with the approved message.
- Confirm the saved message and event history show the actual outcome. A missing provider response or expired lease can be an unknown outcome; preserve it for investigation rather than creating another message or retrying.
- Do not click an unsubscribe link merely to prove rendering: doing so changes consent. Check rendering and signed-link presence separately; an actual unsubscribe test requires its own approved procedure and must be recorded if performed.
- Confirm no other message was claimed or sent. Keep the old owner-test draft unreleased. Continue supervising replies and calendar bookings; delivery webhooks are not evidence that a person replied or a meeting was booked.
- If the authorized window passes before prerequisites are met, leave the test unsent and obtain a new exact authorization. Never infer authorization for a later dispatch or a live prospect.
