/**
 * Pure helpers for matter_messages (S8 Phase 1 Story 6).
 *
 * Each matter has two parallel threads sharing one table, discriminated
 * by `channel_type`:
 *
 *   'client'    - lawyer ↔ client. Both parties read and write.
 *   'internal'  - lawyer ↔ paralegal (or lawyer ↔ lawyer). Privileged
 *                 work product. Client sessions CANNOT read or write.
 *
 * Visibility and write permission are enforced at the route handler.
 * Database has RLS in FORCE mode with no client policies — the
 * service-role key is the only path in. These pure helpers tell the
 * route handler what each role can do.
 *
 * No DB / IO in this file. Imported by route handlers and components.
 */

import type { ChannelType, ActorRole } from './types';

/**
 * Returns true if the given role is permitted to write a message on
 * the given channel.
 *
 *   admin       : both channels (client and internal)
 *   staff       : both channels (paralegals talk to clients AND
 *                 participate in internal threads)
 *   operator    : both channels (cross-firm; for support)
 *   client      : ONLY 'client' channel. Hardcoded rule. Database
 *                 also enforces this via a CHECK constraint as
 *                 defense-in-depth.
 *   system      : both (automated welcome drafts, stage-change
 *                 announcements, etc.)
 */
export function canWriteChannel(
  role: ActorRole,
  channel: ChannelType,
): boolean {
  if (role === 'client') return channel === 'client';
  return role === 'admin' || role === 'staff' || role === 'operator' || role === 'system';
}

/**
 * Returns the list of channel_types the given role is allowed to
 * read. Used by the GET handler to filter the SELECT.
 *
 *   client   : ['client'] only
 *   everyone else : ['client', 'internal']
 */
export function visibleChannelsForRole(role: ActorRole): ChannelType[] {
  if (role === 'client') return ['client'];
  return ['client', 'internal'];
}

/**
 * Returns true if the role is permitted to mark messages as read on
 * behalf of the matter. Used by the read-receipt endpoint.
 *
 *   client : yes (marking their own thread as read)
 *   admin / staff / operator : yes
 *   system : no (system doesn't read)
 */
export function canMarkRead(role: ActorRole): boolean {
  return role !== 'system';
}

/**
 * Returns the notification_outbox event_type that should be queued
 * when a message is sent. Drives the digest email content.
 */
export function notificationEventType(channel: ChannelType): 'message_new' | 'message_internal_new' {
  return channel === 'internal' ? 'message_internal_new' : 'message_new';
}

/**
 * Sanitises a message body for storage. Trims, collapses excessive
 * whitespace, and enforces a hard length cap. Returns null if the
 * resulting body is empty.
 *
 * The cap is intentionally generous (10,000 chars) — the lawyer often
 * pastes longer briefings into the internal channel. The route
 * handler still applies its own validation before calling.
 */
export function sanitiseBody(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Collapse runs of 3+ blank lines to 2 (preserve paragraph structure).
  const normalised = trimmed.replace(/\n{3,}/g, '\n\n');
  return normalised.length > 10000 ? normalised.slice(0, 10000) : normalised;
}
