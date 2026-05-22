/**
 * POST /api/portal/[firmId]/broadcast
 *
 * Mass-message fan-out (S8 Phase 1 Story 11). Sends one message body
 * to many matters in a single operation. Each matter receives its
 * own row in `matter_messages` with a shared `broadcast_id` so all
 * copies can be traced to the same send.
 *
 * Body:
 *   {
 *     recipient_matter_ids: string[],   // explicit list of matters
 *     body: string,                     // the message content
 *     channel_type?: 'client' | 'internal'  // defaults to 'client'
 *   }
 *
 * Auth: firm session. Lawyer / operator. Phase 1 doesn't expose this
 * to staff.
 *
 * Idempotency: each call generates a fresh broadcast_id. Re-sending
 * the same body produces a new broadcast — there is no de-duplication
 * window (mass messaging is an explicit operator action, not an
 * automated trigger).
 *
 * Limits: 200 recipient matters per broadcast (hard cap). Larger
 * broadcasts should be sent in batches; the cap exists to keep the
 * request-response cycle under Vercel's serverless time budget.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirmSession } from '@/lib/portal-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { insertMessage } from '@/lib/matter-messages';
import type { ChannelType } from '@/lib/types';

const MAX_RECIPIENTS = 200;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const session = await getFirmSession(firmId);
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: {
    recipient_matter_ids?: unknown;
    body?: unknown;
    channel_type?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!Array.isArray(body.recipient_matter_ids) || body.recipient_matter_ids.length === 0) {
    return NextResponse.json(
      { error: 'body.recipient_matter_ids must be a non-empty array' },
      { status: 400 },
    );
  }
  if (body.recipient_matter_ids.length > MAX_RECIPIENTS) {
    return NextResponse.json(
      {
        error: `too many recipients (${body.recipient_matter_ids.length}); max ${MAX_RECIPIENTS} per broadcast`,
      },
      { status: 400 },
    );
  }
  const matterIds = body.recipient_matter_ids.filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  if (typeof body.body !== 'string' || !body.body.trim()) {
    return NextResponse.json({ error: 'body.body is required' }, { status: 400 });
  }
  const channelType: ChannelType =
    body.channel_type === 'internal' ? 'internal' : 'client';

  // Verify all matters belong to the firm in a single query.
  const { data: validMatters } = await supabase
    .from('client_matters')
    .select('id, firm_id')
    .in('id', matterIds)
    .eq('firm_id', firmId);

  const validIdSet = new Set((validMatters ?? []).map((m) => m.id));
  const targetIds = matterIds.filter((id) => validIdSet.has(id));
  const rejectedIds = matterIds.filter((id) => !validIdSet.has(id));

  if (targetIds.length === 0) {
    return NextResponse.json(
      {
        error: 'no valid matter ids in this firm',
        rejected: rejectedIds,
      },
      { status: 422 },
    );
  }

  const broadcastId = crypto.randomUUID();
  const senderRole: 'admin' = 'admin'; // operator + lawyer both treated as admin for messages
  const results: Array<
    | { matter_id: string; ok: true; message_id: string }
    | { matter_id: string; ok: false; error: string }
  > = [];

  for (const matterId of targetIds) {
    const result = await insertMessage({
      matter_id: matterId,
      firm_id: firmId,
      channel_type: channelType,
      sender_role: senderRole,
      sender_lawyer_id: session.lawyer_id ?? null,
      body: body.body as string,
      broadcast_id: broadcastId,
    });
    if (result.ok) {
      results.push({ matter_id: matterId, ok: true, message_id: result.message.id });
    } else {
      results.push({ matter_id: matterId, ok: false, error: result.error });
    }
  }

  // Per-recipient state rows (matter_message_recipients) for later
  // read-receipt tracking. Phase 1 inserts the rows so the data
  // exists; Phase 2 ships the UI that reads them.
  const successfulMessageIds = results
    .filter((r): r is { matter_id: string; ok: true; message_id: string } => r.ok)
    .map((r) => ({ matter_id: r.matter_id, message_id: r.message_id }));

  if (successfulMessageIds.length > 0) {
    await supabase.from('matter_message_recipients').insert(
      successfulMessageIds.map((p) => ({
        message_id: p.message_id,
        matter_id: p.matter_id,
      })),
    );
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;

  return NextResponse.json({
    ok: true,
    broadcast_id: broadcastId,
    delivered: okCount,
    failed: failCount,
    rejected_ids: rejectedIds,
    results,
  });
}
