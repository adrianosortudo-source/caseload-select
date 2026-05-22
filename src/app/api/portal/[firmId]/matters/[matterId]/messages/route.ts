/**
 * GET  /api/portal/[firmId]/matters/[matterId]/messages
 * POST /api/portal/[firmId]/matters/[matterId]/messages
 *
 * Messages on a matter, with channel_type discriminator (client vs
 * internal). Role-gated:
 *
 *   - Lawyer / operator session: can read both channels, write both
 *     channels. Maps to actor_role 'admin' for matter-message
 *     purposes (legacy lawyer token).
 *   - Client session (Phase 1: future — magic-link invite story 01):
 *     can read and write 'client' channel only.
 *
 * POST body: { channel_type, body, attachments?, recipient_scope? }
 *
 * On send, the data-access helper queues a notification_outbox row
 * for digest delivery (Story 9).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getFirmSession,
  getClientMatterSession,
  type PortalSession,
} from '@/lib/portal-auth';
import { listMessagesForMatter, insertMessage } from '@/lib/matter-messages';
import { canWriteChannel } from '@/lib/matter-messages-pure';
import { getMatterById } from '@/lib/matter-stage';
import type { ChannelType, ActorRole } from '@/lib/types';

const VALID_CHANNELS: ChannelType[] = ['client', 'internal'];

function actorRoleFromSession(role: 'lawyer' | 'operator' | 'client'): ActorRole {
  if (role === 'operator') return 'operator';
  if (role === 'client') return 'client';
  return 'admin';
}

/**
 * Resolve the session for this matter route, accepting either a firm
 * session (lawyer / operator) or a client session scoped to this
 * exact matter. Client sessions can only see / write the 'client'
 * channel; the channel-gating happens at canWriteChannel + visible
 * channels in the data layer, this resolver only proves identity.
 */
async function resolveSession(
  firmId: string,
  matterId: string,
): Promise<PortalSession | null> {
  const firm = await getFirmSession(firmId);
  if (firm) return firm;
  const client = await getClientMatterSession(firmId, matterId);
  if (client) return client;
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; matterId: string }> },
) {
  const { firmId, matterId } = await params;
  const session = await resolveSession(firmId, matterId);
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const matter = await getMatterById(matterId);
  if (!matter || matter.firm_id !== firmId) {
    return NextResponse.json({ error: 'matter not found' }, { status: 404 });
  }

  const actor = actorRoleFromSession(session.role);
  const url = new URL(req.url);
  const channelParam = url.searchParams.get('channel') as ChannelType | null;
  const channel = channelParam && VALID_CHANNELS.includes(channelParam) ? channelParam : undefined;
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 200, 500) : undefined;

  const messages = await listMessagesForMatter(matterId, actor, { channel, limit });
  return NextResponse.json({
    ok: true,
    matter_id: matterId,
    count: messages.length,
    messages,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; matterId: string }> },
) {
  const { firmId, matterId } = await params;
  const session = await resolveSession(firmId, matterId);
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: {
    channel_type?: string;
    body?: string;
    attachments?: unknown;
    recipient_scope?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const channelType = body.channel_type as ChannelType | undefined;
  if (!channelType || !VALID_CHANNELS.includes(channelType)) {
    return NextResponse.json(
      { error: `body.channel_type must be one of ${VALID_CHANNELS.join(', ')}` },
      { status: 400 },
    );
  }
  if (typeof body.body !== 'string' || !body.body.trim()) {
    return NextResponse.json({ error: 'body.body is required' }, { status: 400 });
  }

  const matter = await getMatterById(matterId);
  if (!matter || matter.firm_id !== firmId) {
    return NextResponse.json({ error: 'matter not found' }, { status: 404 });
  }

  const actor = actorRoleFromSession(session.role);
  if (!canWriteChannel(actor, channelType)) {
    return NextResponse.json(
      { error: `role ${actor} cannot write to channel ${channelType}` },
      { status: 403 },
    );
  }

  // Best-effort attachment validation: expect an array of objects with
  // at least { url, name } shape. Anything else is dropped silently
  // (the column has a CHECK that the JSONB is an array).
  const attachments = Array.isArray(body.attachments)
    ? (body.attachments.filter(
        (a) =>
          a && typeof a === 'object' && typeof (a as { url?: unknown }).url === 'string',
      ) as Array<{ url: string; name: string; size?: number; mime?: string }>)
    : undefined;

  // Map the actor role to the matter_messages.sender_role column.
  // operator + admin both write as 'admin' (the role-of-record for
  // permission gating); staff writes as 'staff'; client writes as
  // 'client'. The system role is reserved for automated inserts
  // (welcome draft send, stage-change announcements) and is set by
  // the caller, not derived from a session.
  const senderRole: 'admin' | 'staff' | 'client' =
    actor === 'client' ? 'client'
      : actor === 'staff' ? 'staff'
      : 'admin';

  const result = await insertMessage({
    matter_id: matterId,
    firm_id: firmId,
    channel_type: channelType,
    recipient_scope:
      body.recipient_scope === 'group' || body.recipient_scope === 'company'
        ? body.recipient_scope
        : 'individual',
    sender_role: senderRole,
    sender_lawyer_id: session.lawyer_id ?? null,
    sender_client_email: actor === 'client' ? session.client_email ?? null : null,
    body: body.body,
    attachments,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    message: result.message,
  });
}
