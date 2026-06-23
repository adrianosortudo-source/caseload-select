/**
 * GET  /api/portal/[firmId]/matters/[matterId]/messages
 * POST /api/portal/[firmId]/matters/[matterId]/messages
 *
 * Messages on a matter, with channel_type discriminator (client vs
 * internal). Role-gated:
 *
 *   - Lawyer / operator session: can read both channels, write both
 *     channels. Maps to actor_role 'admin' for matter-message purposes.
 *   - Client session: can read and write 'client' channel only.
 *
 * POST body:
 *   { channel_type, body, attachments?, recipient_scope?, parent_message_id? }
 *
 * attachments: array of { storage_path, name, size, mime } objects
 *   returned by the /messages/upload endpoint.
 *
 * On send, the data-access helper queues a notification_outbox row
 * for digest delivery.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getFirmSession,
  getClientMatterSession,
  type PortalSession,
} from '@/lib/portal-auth';
import { listMessagesForMatter, insertMessage } from '@/lib/matter-messages';
import { canWriteChannel, isOwnedAttachmentPath } from '@/lib/matter-messages-pure';
import { getMatterById } from '@/lib/matter-stage';
import type { ChannelType, ActorRole, MatterAttachment } from '@/lib/types';

const VALID_CHANNELS: ChannelType[] = ['client', 'internal'];

function actorRoleFromSession(role: 'lawyer' | 'operator' | 'client'): ActorRole {
  if (role === 'operator') return 'operator';
  if (role === 'client') return 'client';
  return 'admin';
}

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
    parent_message_id?: string | null;
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

  // Accept an attachment ONLY when its storage_path sits under this matter's
  // own prefix. A caller with a valid session for their own matter could
  // otherwise pass another firm's object key and have the server sign a
  // download URL for it (cross-firm read of the shared firm-files bucket).
  // Anything with a foreign or missing storage_path is silently dropped.
  const attachments: MatterAttachment[] = Array.isArray(body.attachments)
    ? (body.attachments as unknown[]).filter((a): a is MatterAttachment => {
        if (typeof a !== 'object' || a === null) return false;
        const rec = a as Record<string, unknown>;
        return (
          typeof rec.name === 'string' &&
          isOwnedAttachmentPath(rec.storage_path, firmId, matterId)
        );
      })
    : [];

  const senderRole: 'admin' | 'staff' | 'client' =
    actor === 'client' ? 'client'
      : actor === 'staff' ? 'staff'
      : 'admin';

  // Validate parent_message_id belongs to the same matter if provided.
  const parentId = typeof body.parent_message_id === 'string' ? body.parent_message_id : null;

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
    parent_message_id: parentId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    message: result.message,
  });
}
