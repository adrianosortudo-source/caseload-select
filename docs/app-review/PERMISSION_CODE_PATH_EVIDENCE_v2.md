# Meta App Review permission-to-code-path evidence, v2

Source basis: production merge `6f6c59330d94d84b1fc3bc63fb76d8830d3c8644`, deployed on 2026-09-04.

The runtime messaging paths remain unchanged from the reviewed v2 evidence. Production migrations through `20260903183915_privacy_deletion_registry_operational_completeness` are applied; the remaining privacy closeout gates are tracked separately in `META_READINESS_CLOSEOUT_2026-09-04.md`.

A permission is retained only when the application contains a concrete runtime operation that exercises it. A configured asset ID, webhook field, manually configured Meta asset, or Business Manager screenshot is not an application code path.

## Resubmission decision

| Permission | Decision | Current runtime evidence | Reason |
|---|---|---|---|
| `pages_messaging` | Retain and re-request | `src/lib/messenger-send.ts:50-66`; portal entry `src/app/api/portal/[firmId]/triage/[leadId]/reply/route.ts:277-289` | The server posts plain text to `/{page_id}/messages` with the configured Page token. The portal route derives channel, recipient, firm, actor, and reply-window evidence server-side. |
| Exact live Meta label for Instagram messaging, documented in source as `instagram_manage_messages` | Retain and re-request | `src/lib/instagram-send.ts:57-71`; portal entry `src/app/api/portal/[firmId]/triage/[leadId]/reply/route.ts:277-289` | The server posts a plain-text Instagram reply to the Page-scoped `/me/messages` endpoint with the linked Page token. Use the exact permission label displayed for this app. |
| `pages_manage_metadata` | Drop | No `subscribed_apps` or Page webhook-subscription Graph call exists under `src/`. | Manual Page webhook configuration is external state, not an exercised runtime operation. |
| `business_management` | Drop | No Business Portfolio or Business Manager Graph operation exists under `src/`. | The app consumes configured asset IDs and server-side tokens. It does not enumerate or manage portfolio assets. |
| `instagram_basic` | Drop | No Instagram identity-read operation exists under `src/`. | `src/app/api/instagram-intake/route.ts:146-155` receives an account identifier in a signed webhook. Receiving an identifier is not an identity read. |
| `pages_show_list` | Drop | No `/me/accounts` or Page-enumeration operation exists under `src/`. | The product has no Facebook Login or Page picker. |
| `pages_read_engagement` | Drop | No Page content or engagement read exists under `src/`. | The source supports Meta's conclusion that this scope is not required for the core use case. |

## Approved permissions

Do not add these approved scopes to the resubmission draft:

- `whatsapp_business_messaging`;
- `whatsapp_business_management`;
- `public_profile`.

## Security and delivery evidence

| Control | Current source evidence |
|---|---|
| Signed Messenger webhook and outbound-echo exclusion | `src/app/api/messenger-intake/route.ts:100-143` |
| Signed Instagram webhook and outbound-echo exclusion | `src/app/api/instagram-intake/route.ts:109-149` |
| Client exclusion and matching-firm lawyer or operator rule | `src/app/api/portal/[firmId]/triage/[leadId]/reply/route.ts:139-149` |
| Stable UUID actor required; otherwise `403 reauth_required` | `src/app/api/portal/[firmId]/triage/[leadId]/reply/route.ts:151-160` |
| Support-preview write guard | `src/app/api/portal/[firmId]/triage/[leadId]/reply/route.ts:163-164` |
| Firm-scoped lead lookup and server-derived destination | `src/app/api/portal/[firmId]/triage/[leadId]/reply/route.ts:194-215` |
| Strict 24-hour gate | `src/lib/channel-send.ts:123-151` |
| Window recheck immediately before the Graph side effect | `src/lib/channel-send.ts:258-273` |
| Missing, malformed, or unreasonable future inbound timestamp fails closed | `src/lib/channel-conversation.ts:72-108` |
| Newest 500 timeline events and separate latest authoritative inbound query | `src/lib/channel-conversation.ts:232-275` |
| Same request ID retained for an unchanged draft | `src/components/portal/ChannelConversationPanel.tsx:117-139` |
| Unknown or pending delivery retains draft and warns against a new message | `src/components/portal/ChannelConversationPanel.tsx:145-186`; `src/app/api/portal/[firmId]/triage/[leadId]/reply/route.ts:291-340` |
| Duplicate pending claim does not call Graph again | `src/lib/channel-send.ts:153-180` |
| Only a verified terminal sent event produces success | `src/components/portal/ChannelConversationPanel.tsx:169-182`; `src/app/api/portal/[firmId]/triage/[leadId]/reply/route.ts:320-340` |
| Append-only conversation ledger, forced RLS, pending and terminal uniqueness | `supabase/migrations/20260901231830_channel_conversation_ledger.sql:15-152` |
| Ledger service role limited to SELECT and INSERT; API roles and PUBLIC denied | `supabase/migrations/20260902111504_harden_channel_conversation_acl.sql:1-18` |
| Expiry sweep suppresses the former after-window closing send | `src/app/api/cron/expire-channel-intake-sessions/route.ts:231-248` |

## Evidence boundary

This file supports only the two messaging operations above. It does not claim that CaseLoad Select reads a Page display name or Instagram handle from Meta. The numeric ID displayed in the portal is configured context, not identity proof. The recording must show the authoritative Page name or Instagram handle in Meta UI.
