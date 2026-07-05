/**
 * I/O for the unified staff inbox. Fetches the firm's active matters plus
 * their messages in two queries (no N+1), then hands off to
 * staff-inbox-pure.ts to build the sorted thread list.
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { ClientMatter, MatterMessage } from '@/lib/types';
import { buildInboxThreads, type InboxThread } from '@/lib/staff-inbox-pure';

const MAX_MATTERS = 200;
const MAX_MESSAGES_PER_MATTER_SET = 2000;

/**
 * Lists inbox threads for a firm: every non-closed matter, each paired with
 * its most recent message (across both client and internal channels) and a
 * total message count. Closed matters are excluded (mirrors
 * listActiveMattersForFirm's scope; a closed matter's history stays on its
 * own detail page rather than crowding the daily inbox).
 */
export async function listInboxThreadsForFirm(firmId: string): Promise<InboxThread[]> {
  const { data: matterRows } = await supabase
    .from('client_matters')
    .select('*')
    .eq('firm_id', firmId)
    .neq('matter_stage', 'closed')
    .order('updated_at', { ascending: false })
    .limit(MAX_MATTERS);

  const matters = (matterRows ?? []) as ClientMatter[];
  if (matters.length === 0) return [];

  const matterIds = matters.map((m) => m.id);
  const { data: messageRows } = await supabase
    .from('matter_messages')
    .select('*')
    .in('matter_id', matterIds)
    .order('created_at', { ascending: false })
    .limit(MAX_MESSAGES_PER_MATTER_SET);

  const messages = (messageRows ?? []) as MatterMessage[];
  return buildInboxThreads(matters, messages);
}
