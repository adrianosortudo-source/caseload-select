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
import { sanitizeWelcomeHtml } from '@/lib/welcome-html-sanitize';
import { sendEmail } from '@/lib/email';
import { loadFirmEmailBranding } from '@/lib/firm-email-branding';
import { renderEmailShell } from '@/lib/email-shell';

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

  // Sanitize the body we are about to send into the client thread + email.
  // edited_html is already sanitized on save, but the original draft and any
  // rows saved before Phase 2 sanitization existed pass through here too, so
  // this is the uniform last gate before client-facing rendering.
  const bodyToSend = sanitizeWelcomeHtml(
    matter.welcome_draft_edited_html ?? matter.welcome_draft_html,
  );
  if (!bodyToSend || !bodyToSend.trim()) {
    return NextResponse.json(
      { error: 'no welcome draft body to send' },
      { status: 422 },
    );
  }

  // Claim the send atomically BEFORE inserting the message. The stamp is the
  // gate: a concurrent double-click finds welcome_draft_sent_at already set and
  // matches zero rows here, so only one request sends the client message (the
  // prior read-then-write let both POSTs send).
  const now = new Date().toISOString();
  const { data: claimed, error: claimErr } = await supabase
    .from('client_matters')
    .update({
      welcome_draft_sent_at: now,
      welcome_draft_sent_body: bodyToSend,
    })
    .eq('id', matterId)
    .is('welcome_draft_sent_at', null)
    .select('id');

  if (claimErr) {
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: 'welcome draft already sent' }, { status: 409 });
  }

  // Themed firms (e.g. DRG Law) receive a standalone branded welcome email (the
  // L08 correspondence). When it sends, suppress the client's digest copy of
  // this same message so the client is not emailed twice; lawyers are still
  // notified. Non-themed firms send nothing here and the client is notified
  // through the digest exactly as before. Best-effort: a delivery failure falls
  // back to the digest path (notifyClient stays true).
  const branding = await loadFirmEmailBranding(firmId);
  let standaloneSent = false;
  if (branding && matter.primary_email) {
    try {
      const result = await sendEmail(
        matter.primary_email,
        `Welcome to ${branding.firmName}`,
        renderEmailShell({
          branding,
          preheader: `Welcome to ${branding.firmName}`,
          eyebrow: 'Welcome',
          bodyHtml: bodyToSend,
          footerHtml: escapeHtml(branding.firmName),
        }),
      );
      standaloneSent = !('skipped' in result && result.skipped) && Boolean(result.id);
    } catch {
      standaloneSent = false;
    }
  }

  // Insert as a client-channel message (visible to client + lawyer).
  // sender_role 'admin' is the role-of-record for permission gating, not
  // authorship (the body is templated even though a human pressed Send).
  const msgResult = await insertMessage({
    matter_id: matterId,
    firm_id: firmId,
    channel_type: 'client',
    sender_role: 'admin',
    sender_lawyer_id: session.lawyer_id ?? null,
    body: bodyToSend,
    notifyClient: !standaloneSent,
  });

  if (!msgResult.ok) {
    // Release the claim so a later retry can send.
    await supabase
      .from('client_matters')
      .update({ welcome_draft_sent_at: null, welcome_draft_sent_body: null })
      .eq('id', matterId);
    return NextResponse.json({ error: msgResult.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    matter_id: matterId,
    sent_at: now,
    message_id: msgResult.message.id,
  });
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
