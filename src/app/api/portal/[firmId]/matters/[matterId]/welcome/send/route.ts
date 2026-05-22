/**
 * POST /api/portal/[firmId]/matters/[matterId]/welcome/send
 *
 * Send the welcome draft to the client. Uses the edited body if the
 * lawyer made changes; otherwise the original draft. Side effects:
 *
 *   1. Insert a client-channel matter_message with the sent body.
 *      The client sees this in their thread once they accept the
 *      magic-link invite.
 *   2. Stamp welcome_draft_sent_at + welcome_draft_sent_body on the
 *      matter row (audit + idempotency: a second POST returns 409).
 *   3. Queue a notification_outbox row for the client (handled by
 *      insertMessage automatically).
 *
 * The actual email delivery happens via the 5-minute notification
 * batch cron (Story 9). For Phase 1 the welcome email is also
 * delivered immediately if the matter has a primary_email and the
 * RESEND_API_KEY is set — the cron then deduplicates so the client
 * doesn't get two copies.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirmSession } from '@/lib/portal-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { getMatterById } from '@/lib/matter-stage';
import { insertMessage } from '@/lib/matter-messages';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; matterId: string }> },
) {
  const { firmId, matterId } = await params;
  const session = await getFirmSession(firmId);
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const matter = await getMatterById(matterId);
  if (!matter || matter.firm_id !== firmId) {
    return NextResponse.json({ error: 'matter not found' }, { status: 404 });
  }

  if (matter.welcome_draft_sent_at) {
    return NextResponse.json(
      {
        error: 'welcome draft already sent',
        sent_at: matter.welcome_draft_sent_at,
      },
      { status: 409 },
    );
  }

  const bodyToSend = matter.welcome_draft_edited_html ?? matter.welcome_draft_html;
  if (!bodyToSend || !bodyToSend.trim()) {
    return NextResponse.json(
      { error: 'no welcome draft body to send' },
      { status: 422 },
    );
  }

  // Insert as a client-channel message (visible to client + lawyer).
  // System sender_role is appropriate even though a human pressed
  // Send, because the body is templated; matter_messages.sender_role
  // is the role-of-record for permission gating, not authorship.
  const msgResult = await insertMessage({
    matter_id: matterId,
    firm_id: firmId,
    channel_type: 'client',
    sender_role: session.role === 'operator' ? 'admin' : 'admin',
    sender_lawyer_id: session.lawyer_id ?? null,
    body: bodyToSend,
  });

  if (!msgResult.ok) {
    return NextResponse.json({ error: msgResult.error }, { status: 500 });
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from('client_matters')
    .update({
      welcome_draft_sent_at: now,
      welcome_draft_sent_body: bodyToSend,
    })
    .eq('id', matterId);

  if (updateErr) {
    // Message was inserted; the matter stamp failed. Surface but
    // don't fail — the matter_message exists which is the source of
    // truth for the client thread.
    console.warn('[welcome/send] stamp failed:', updateErr.message);
  }

  return NextResponse.json({
    ok: true,
    matter_id: matterId,
    sent_at: now,
    message_id: msgResult.message.id,
  });
}
