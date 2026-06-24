---
doc-type: product-spec
pillar: S
scope: app
status: draft
version: 0.1
superseded-by: null
use-when: Building or extending the CaseLoad-to-lawyer internal messaging tool (CaseLoad Connect).
do-not: Use this for lawyer-to-client matter messaging (that is matter_messages, privileged, firm-private). Do not let operators read lawyer-client threads.
related: [matter_messages, content_deliverables, notification_outbox]
last-reviewed: 2026-06-24
last-edited: 2026-06-24
---

# CaseLoad Connect: operator-to-firm messaging spec (v0.1, draft)

## Purpose

A dedicated messaging channel between **CaseLoad (the operator, Adriano)** and **each firm's lawyers** (Damaris for DRG). This is the working line for the done-for-you relationship: setup questions, deliverable hand-offs, reporting notes, approvals, "can you send me X," day-to-day account back-and-forth.

It is explicitly NOT the lawyer-to-client matter thread. Those (`matter_messages`, channel_type `client`) are privileged communications between the firm and its own clients. The operator never reads them. CaseLoad Connect is a separate, parallel channel that only CaseLoad and the firm's own lawyers can see.

## The right mental model: Slack Connect, not team chat

The operator framed this as "our internal Slack tool." The precise analogue is **Slack Connect** (Slack's shared-channel-between-two-organizations product), not a single-workspace team chat. The two participants are two distinct parties: the CaseLoad operator org and the client firm. One shared channel per firm. CaseLoad is in every channel; each firm sees only its own.

Reference: [Slack Connect](https://slack.com/connect), [channels between orgs](https://api.slack.com/apis/channels-between-orgs).

This matters for the data model (every channel is firm-scoped, two participant classes), the auth model (operator sees all, lawyer sees one), and the surfaces (operator gets a cross-firm inbox, each firm gets one channel).

## Full Slack feature inventory, mapped to our context

From the research, Slack's surface area in 2025, with a verdict for CaseLoad Connect.

| Slack feature | What it is | Verdict for us |
|---|---|---|
| **Channels** | Topic/project spaces | MVP: one channel per firm. Phase 3: multiple topic channels per firm. |
| **Direct messages** | 1:1 / small group | Folded into the per-firm channel for MVP (the channel IS the DM between CaseLoad and the firm). |
| **Threads** | Reply under a parent message | MVP. One level deep, matching the matter-messages threading already built. |
| **@mentions** | Notify a specific person | MVP: mention firm members / the operator; drives notification + Activity. |
| **Reactions (emoji)** | Lightweight ack without a reply | Phase 2. Cheap signal ("got it"). |
| **File sharing** | Attach docs/images | MVP. Reuse the `firm-files` bucket + signed-URL pattern from matter messages. |
| **Read / unread state** | Per-person read tracking, mark-unread | MVP: per-participant last-read per channel; unread counts. Mark-unread is Phase 2. |
| **Unread badges / Activity** | Counts + a single feed of what needs you | MVP: unread badge on console home (attention bar + firm cards) and the firm page tab. |
| **Notifications** | Email / push when mentioned or messaged | MVP: reuse `notification_outbox` digest. Phase 2: per-message email, quiet hours. |
| **Message editing / deleting** | Fix or remove own messages | MVP: edit/delete own, soft-delete, time-window optional. |
| **Markdown formatting** | Bold, italic, code, lists, links | MVP: the same sanitized rich text used by welcome/explainer/deliverables. |
| **Search** | Find past messages | Phase 2: full-text over a firm's channel (operator: cross-firm). |
| **Pins** | Surface key messages at the top | Phase 2. |
| **Bookmarks / saved for later** | Personal follow-up list | Phase 3. |
| **Scheduled send / drafts** | Compose now, send later; autosave | Phase 3 (drafts), Phase 3 (scheduled). |
| **Typing indicators / presence** | Who is online / typing | Phase 3 (needs realtime; we poll today). |
| **Huddles (audio/video)** | Live call in-channel | Out of scope. The operator and firm use phone / existing tools. |
| **Canvas** | Persistent shared doc per channel | Out of scope for messaging. The deliverables surface already covers shared documents. |
| **Bots / apps / slash commands** | Automation in-channel | Phase 3: a system sender can post account events (deliverable shipped, report ready) into the channel. |
| **Retention / export** | Compliance archive | MVP posture: append-only, service-role, PIPEDA retention aligned with `data-retention.ts`. Export Phase 2. |

## Data model (proposed)

Three tables, service-role only, RLS forced, anon/authenticated revoked (per the Database Access Invariant and the born-exposed rule).

```
operator_firm_channels
  id              uuid pk
  firm_id         uuid fk intake_firms on delete cascade
  name            text            -- MVP: 'CaseLoad' default channel, one per firm
  created_at      timestamptz
  archived        boolean default false
  unique (firm_id, name)

operator_firm_messages
  id                uuid pk
  channel_id        uuid fk operator_firm_channels on delete cascade
  firm_id           uuid             -- denormalized for fast firm-scoped reads + RLS
  parent_message_id uuid fk self on delete set null   -- one-level threads
  sender_role       text  check in ('operator','lawyer','system')
  sender_id         text             -- firm_lawyers.id or operator id
  sender_name       text
  body              text             -- sanitized rich text
  attachments       jsonb            -- [{storage_path, name, size, mime, signed_url?}]
  edited_at         timestamptz
  deleted_at        timestamptz      -- soft delete
  created_at        timestamptz

operator_firm_channel_reads
  id            uuid pk
  channel_id    uuid fk
  firm_id       uuid
  participant   text             -- 'operator' or a firm_lawyers.id
  last_read_at  timestamptz
  unique (channel_id, participant)
```

Phase 2 adds `operator_firm_message_reactions (message_id, participant, emoji)`.

## Auth model

- **Operator side**: `getOperatorSession()`. Sees every firm's channel. Sender_role `operator`.
- **Lawyer side**: `getFirmSession(firmId)`. Sees only that firm's channel. Sender_role `lawyer`. Clients are rejected (this is not a client surface).
- All reads/writes go through server routes with `supabaseAdmin`. No anon, no `authenticated`.

## Surfaces

**Operator (console):**
- `/admin/firms/[firmId]/messages`: the firm page channel view (new "Messages" row in the FIRM sidebar section).
- Console home (`/admin`): unread total in the attention bar ("Unread firm messages") and a per-firm unread badge on each firm card.

**Lawyer (portal):**
- `/portal/[firmId]/messages`: a new portal tab labeled "CaseLoad" (or the operator's brand), showing the firm side of the same channel. Unread badge in `PortalTabNav`.

Both surfaces poll on a short interval (matching the 30s matter-thread poll) until realtime lands.

## Notifications

Reuse `notification_outbox` with new event types (`firm_message_new`, `firm_message_mention`). Operator-bound events go to `adriano@caseloadselect.ca` (DR-047); firm-bound events fan out to enabled `firm_lawyers`. The 5-minute digest cron already groups and sends.

## Compliance

- Append-only history (soft delete keeps the row, stamps `deleted_at`).
- Service-role only; firm isolation enforced at the route.
- PIPEDA retention via `data-retention.ts` (operator-firm comms are business records, not client PII; longer retention is defensible).
- No privilege concern: this channel is CaseLoad-to-firm, never client-facing. The privileged lawyer-client threads stay in `matter_messages`, untouched.

## MVP definition (one shippable unit)

1. Migration: the three tables above, RLS forced, grants revoked.
2. A default `CaseLoad` channel auto-created per firm on first message (lazy create).
3. Operator surface `/admin/firms/[firmId]/messages`: message list (firm-local timestamps), composer (sanitized rich text), threaded replies, file attach, edit/delete own, read-state write.
4. Lawyer surface `/portal/[firmId]/messages` (new "CaseLoad" tab): same channel, lawyer side.
5. Unread badges: console home attention bar + firm cards; portal tab.
6. Notifications via `notification_outbox` (new event types) + digest.
7. Tests: route auth (operator sees all, lawyer sees own, client rejected), send/read, firm isolation, soft delete.

## Phased roadmap after MVP

- **Phase 2**: reactions, search, pins, mark-unread, per-message email, export.
- **Phase 3**: multiple topic channels per firm, drafts, scheduled send, presence/typing (realtime), system-event posts (deliverable shipped, report ready), saved-for-later.

## Open questions for the operator

1. Channel name on the firm side: "CaseLoad," the operator's name, or a neutral "Account" label?
2. Should firm-shipped account events (a new deliverable, a weekly report) auto-post into the channel as system messages from day one, or stay Phase 3?
3. Realtime now (Supabase Realtime) or poll-first like the matter threads?
