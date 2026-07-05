/**
 * Pure aggregation for the unified staff inbox (CaseLoad_CRM_Migration_Plan_v1.md
 * §4 "Unified staff inbox" gap, §6 target architecture). One threaded view
 * across all of a firm's matter_messages, replacing GHL's per-sub-account
 * conversation list as the staff-facing surface.
 *
 * No I/O; staff-inbox.ts fetches matters + messages and calls this to build
 * the thread list.
 */

import type { ClientMatter, MatterMessage, ChannelType } from '@/lib/types';

export interface InboxThread {
  matter: ClientMatter;
  lastMessage: MatterMessage | null;
  messageCount: number;
  lastActivityAt: string; // ISO; lastMessage.created_at, or matter.updated_at when no messages yet
}

export interface InboxFilters {
  channel?: ChannelType; // filter threads whose last message is on this channel
  matterStage?: ClientMatter['matter_stage'];
  unreadOnly?: boolean; // true = only threads with at least one message
}

/**
 * Groups messages by matter_id, keeping the single most recent message and a
 * count per matter. Matters with zero messages still get a thread (an empty
 * inbox item, useful right after Take before the welcome draft is sent).
 */
export function buildInboxThreads(
  matters: ClientMatter[],
  messages: MatterMessage[],
): InboxThread[] {
  const byMatter = new Map<string, MatterMessage[]>();
  for (const m of messages) {
    const list = byMatter.get(m.matter_id) ?? [];
    list.push(m);
    byMatter.set(m.matter_id, list);
  }

  const threads: InboxThread[] = matters.map((matter) => {
    const matterMessages = byMatter.get(matter.id) ?? [];
    matterMessages.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const lastMessage = matterMessages[0] ?? null;
    return {
      matter,
      lastMessage,
      messageCount: matterMessages.length,
      lastActivityAt: lastMessage?.created_at ?? matter.updated_at,
    };
  });

  threads.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
  return threads;
}

/**
 * Applies inbox filters. Returns a NEW filtered array; does not mutate input.
 */
export function filterInboxThreads(threads: InboxThread[], filters: InboxFilters): InboxThread[] {
  return threads.filter((t) => {
    if (filters.channel && t.lastMessage?.channel_type !== filters.channel) return false;
    if (filters.matterStage && t.matter.matter_stage !== filters.matterStage) return false;
    if (filters.unreadOnly && t.messageCount === 0) return false;
    return true;
  });
}

/** A short preview of the last message body, for the thread-list row. */
export function previewBody(body: string | null | undefined, maxLength = 90): string {
  if (!body) return '';
  // Messages store HTML for the rich subset (welcome sends); strip tags for
  // a plain-text preview rather than rendering raw markup in a list row.
  const stripped = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (stripped.length <= maxLength) return stripped;
  return stripped.slice(0, maxLength - 1).trimEnd() + '…';
}
