# Meta App Review permission-to-code-path evidence, v2

Source basis: PR #191, merged ACL PR #195 and the default-off follow-up candidate, reviewed on 2026-09-02.

This table is deliberately narrower than the first submission. A permission is retained only when the application at this commit contains a concrete runtime operation that exercises it. A stored asset ID, a webhook payload field, a manually configured Meta asset, or a Business Manager screenshot is not treated as an application code path.

## Resubmission decision

| Permission | Decision | Runtime evidence | Why |
|---|---|---|---|
| `pages_messaging` | **Retain and re-request** | `src/lib/messenger-send.ts:50-66`; portal entry point `src/app/api/portal/[firmId]/triage/[leadId]/reply/route.ts:277-289` | The app posts a plain-text message to `/{page_id}/messages` with the firm's Page access token. The portal action resolves the Page and recipient server-side and calls the shared dispatcher. |
| `instagram_manage_messages` | **Retain and re-request** | `src/lib/instagram-send.ts:57-71`; portal entry point `src/app/api/portal/[firmId]/triage/[leadId]/reply/route.ts:277-289` | The app posts a plain-text Instagram reply to the Page-scoped `/me/messages` endpoint with the linked Page token. Use the exact legacy/current permission label displayed for App ID `1007304805285554`; do not silently rename it in the submission. |
| `pages_manage_metadata` | **Drop; do not re-request** | No `subscribed_apps` or Page webhook-subscription API call exists under `src/` at this commit. | Page webhook configuration is external/manual state, not an exercised application operation. A Business Manager screen recording cannot substitute for a missing code path. |
| `business_management` | **Drop; do not re-request** | No Business Portfolio or Business Manager Graph API call exists under `src/` at this commit. | The app consumes stored server-side Page tokens and configured asset IDs. It does not enumerate or manage Business Portfolio assets at runtime. |
| `instagram_basic` | **Drop; do not re-request** | No Instagram account-identity read endpoint exists under `src/` at this commit. | `src/app/api/instagram-intake/route.ts:185-224` receives an IG account ID in a signed webhook and maps it to a configured firm. Receiving an identifier in a webhook is not an `instagram_basic` read operation. |
| `pages_show_list` | **Drop; do not re-request** | No `/me/accounts` or equivalent Page-enumeration call exists under `src/` at this commit. | The product has no Facebook Login or Page picker. `facebook_page_id` is configured against the firm record. |
| `pages_read_engagement` | **Drop; do not re-request** | No Page content or engagement read exists under `src/` at this commit. | Meta already rejected this scope as unnecessary to the core use case, and the source confirms that conclusion. |

## Approved permissions: leave untouched

Do not add these to the new resubmission draft:

- `whatsapp_business_messaging`
- `whatsapp_business_management`
- `public_profile`

They were approved in submission `1016624077686960`. The new evidence issue concerns Facebook Messenger and Instagram only.

## Security and delivery evidence supporting the two retained permissions

| Control | Final source evidence |
|---|---|
| Verified Messenger webhook and outbound-echo suppression | `src/app/api/messenger-intake/route.ts:110-143` |
| Verified Instagram webhook and outbound-echo suppression | `src/app/api/instagram-intake/route.ts:116-149` |
| Firm-scoped lead lookup and server-derived destination | `src/app/api/portal/[firmId]/triage/[leadId]/reply/route.ts:194-215` |
| Client exclusion, matching-firm lawyer rule, operator role and attributable member ID | `src/app/api/portal/[firmId]/triage/[leadId]/reply/route.ts:139-163` |
| Support-preview write guard | `src/app/api/portal/[firmId]/triage/[leadId]/reply/route.ts:163-164` |
| Strict 24-hour server-side gate | `src/lib/channel-send.ts:123-151` |
| Recheck immediately before the Graph side effect | `src/lib/channel-send.ts:258-273` |
| Exact-true global gate plus per-firm default-false approval | `src/lib/channel-conversation-gate.ts`; `supabase/migrations/20260902123126_channel_conversation_default_off_gate.sql` |
| Database insert guard blocks message bodies while a firm's approval flag is off | `supabase/migrations/20260902123126_channel_conversation_default_off_gate.sql` |
| Missing, malformed and unreasonable future inbound timestamps fail closed | `src/lib/channel-conversation.ts:84-108` |
| Idempotent portal retries preserve one request ID for an unchanged draft | `src/components/portal/ChannelConversationPanel.tsx:117-190` |
| Applied append-only ledger with pending forward ACL and default-off hardening; runtime use remains blocked pending privacy, retention and erasure approval | `supabase/migrations/20260901231830_channel_conversation_ledger.sql:15-151`; `supabase/migrations/20260902111504_harden_channel_conversation_acl.sql`; `supabase/migrations/20260902123126_channel_conversation_default_off_gate.sql` |
| Expiry sweep suppresses the former after-window closing send | `src/app/api/cron/expire-channel-intake-sessions/route.ts:241-248` |

## Evidence boundary

Migration `20260901231830_channel_conversation_ledger.sql` was confirmed applied in production on 2026-09-02, and the ledger objects exist. Migration `20260902111504_harden_channel_conversation_acl.sql` is merged source but was not applied when this candidate was prepared. The new default-off migration, application gate, database insert guard and unavailable-state UI are follow-up candidate changes. This document does **not** claim that either later migration is applied or that the follow-up application controls are deployed.

While either gate is off, an unavailable panel is a deliberate fault state, not evidence of an empty conversation. Meta recording and resubmission must wait until the follow-up PR is approved and merged, CI passes, production auto-deploy completes, both later migrations are applied and verified, retention and erasure controls are approved, both gates are deliberately enabled for the test firm, and a production smoke test passes.
