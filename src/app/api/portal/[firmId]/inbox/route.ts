/**
 * GET /api/portal/[firmId]/inbox
 *
 * The unified staff inbox listing (CaseLoad_CRM_Migration_Plan_v1.md §4
 * "Unified staff inbox" gap): one thread per non-closed matter, sorted by
 * most recent activity across both client and internal channels.
 *
 * Auth: portal session cookie. Operators can read any firm's inbox; lawyers
 * only their own. Client sessions (matter-scoped magic links) are rejected,
 * same posture as /triage (DR-063 "the route is the gate").
 *
 * Query params:
 *   channel       'client' | 'internal', filters by the last message's channel
 *   matter_stage  filters by the matter's current stage
 *
 * Response: { items: InboxThread[] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPortalSession } from '@/lib/portal-auth';
import { listInboxThreadsForFirm } from '@/lib/staff-inbox';
import { filterInboxThreads } from '@/lib/staff-inbox-pure';
import type { ChannelType, MatterStage } from '@/lib/types';

const VALID_CHANNELS: ChannelType[] = ['client', 'internal'];
const VALID_STAGES: MatterStage[] = ['intake', 'retainer_pending', 'active', 'closing', 'closed'];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const session = await getPortalSession();
  const isAuthorized = !!session && session.role !== 'client' && (session.role === 'operator' || session.firm_id === firmId);
  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const channelParam = url.searchParams.get('channel');
  const stageParam = url.searchParams.get('matter_stage');
  const channel = channelParam && VALID_CHANNELS.includes(channelParam as ChannelType) ? (channelParam as ChannelType) : undefined;
  const matterStage = stageParam && VALID_STAGES.includes(stageParam as MatterStage) ? (stageParam as MatterStage) : undefined;

  const threads = await listInboxThreadsForFirm(firmId);
  const filtered = filterInboxThreads(threads, { channel, matterStage });

  return NextResponse.json({ items: filtered });
}
