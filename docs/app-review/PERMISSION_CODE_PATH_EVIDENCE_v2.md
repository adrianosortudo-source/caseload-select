# Meta App Review permission-to-code-path evidence, v2

Source basis: production merge `fbb6aac6712b28191de5aee79d0d4511aaaf4b59`, deployed on 2026-09-04.

The runtime messaging paths remain unchanged from the reviewed v2 evidence. Production migrations through `20260904125000_privacy_recovery_open_from_locked` are applied; the completed technical privacy closeout and remaining counsel/public-copy gates are tracked separately in `META_READINESS_CLOSEOUT_2026-09-04.md`.

The two business capabilities are retained because the application contains concrete runtime operations that exercise them. Meta-declared technical dependencies are included only when the current [Permissions Reference](https://developers.facebook.com/docs/permissions) requires them for one of those capabilities. A configured asset ID, webhook field, manually configured Meta asset, or Business Manager screenshot is not an application code path and must not be presented as standalone use of a dependency.

## Resubmission decision

| Permission | Decision | Current runtime evidence | Reason |
|---|---|---|---|
| `pages_messaging` | Retain and re-request | `src/lib/messenger-send.ts:50-66`; portal entry `src/app/api/portal/[firmId]/triage/[leadId]/reply/route.ts:277-289` | The server posts plain text to `/{page_id}/messages` with the configured Page token. The portal route derives channel, recipient, firm, actor, and reply-window evidence server-side. |
| Exact live Meta label for Instagram messaging, documented in source as `instagram_manage_messages` | Retain and re-request | `src/lib/instagram-send.ts:57-71`; portal entry `src/app/api/portal/[firmId]/triage/[leadId]/reply/route.ts:277-289` | The server posts a plain-text Instagram reply to the Page-scoped `/me/messages` endpoint with the linked Page token. Use the exact permission label displayed for this app. |
| `pages_manage_metadata` | Include as a Meta-required technical dependency | No standalone `subscribed_apps` or Page-management product flow exists under `src/`. | Meta's current Permissions Reference lists this as a dependency of `pages_messaging`. It is requested only to support that messaging capability, not a separate Page-management feature. |
| `business_management` | Drop | No Business Portfolio or Business Manager Graph operation exists under `src/`. | The app consumes configured asset IDs and server-side tokens. It does not enumerate or manage portfolio assets. |
| `instagram_basic` | Include as a Meta-required technical dependency | No standalone Instagram identity-read operation exists under `src/`. | Meta's current Permissions Reference lists this as a dependency of legacy `instagram_manage_messages`. It is requested only to support that messaging capability, not a separate identity product feature. |
| `pages_show_list` | Include as a Meta-required technical dependency | No `/me/accounts` or Page-enumeration product flow exists under `src/`. | Meta's current Permissions Reference lists this as a dependency of legacy `instagram_manage_messages`. It is requested only to support that messaging capability, not broad Page enumeration. |
| `pages_read_engagement` | Include as a Meta-required technical dependency | No standalone Page-content or engagement-reading product flow exists under `src/`. | Meta's current Permissions Reference lists this as a dependency of legacy `instagram_manage_messages`. It is requested only to support that messaging capability, not analytics or content access. |

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

This file supports only the two messaging operations above plus the four unique Meta-declared technical dependencies required across those capabilities. It does not claim standalone use of those dependencies or that CaseLoad Select reads a Page display name or Instagram handle from Meta. The numeric ID displayed in the portal is configured context, not identity proof. The recording must show the authoritative Page name or Instagram handle in Meta UI.
