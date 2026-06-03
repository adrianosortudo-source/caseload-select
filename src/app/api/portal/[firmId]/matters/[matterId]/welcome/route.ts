/**
 * GET  /api/portal/[firmId]/matters/[matterId]/welcome
 *   → returns the welcome draft (html, plain text, edited version,
 *     sent timestamp).
 *
 * PATCH /api/portal/[firmId]/matters/[matterId]/welcome
 *   body { edited_html: string }
 *   → saves lawyer edits to welcome_draft_edited_html.
 *
 * POST  /api/portal/[firmId]/matters/[matterId]/welcome/send
 *   → marks the draft as sent. Inserts the body as a client-channel
 *     matter_message (so it appears in the client thread) and stamps
 *     welcome_draft_sent_at + welcome_draft_sent_body.
 *
 * The send POST lives in a sibling route file so the URL stays clean
 * (`/welcome/send`). This file handles GET + PATCH on the draft
 * itself.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirmSession } from '@/lib/portal-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { getMatterById } from '@/lib/matter-stage';
import { sanitizeWelcomeHtml } from '@/lib/welcome-html-sanitize';

export async function GET(
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

  return NextResponse.json({
    ok: true,
    matter_id: matterId,
    draft_html: matter.welcome_draft_html,
    draft_plain_text: matter.welcome_draft_plain_text,
    edited_html: matter.welcome_draft_edited_html,
    sent_at: matter.welcome_draft_sent_at,
    sent_body: matter.welcome_draft_sent_body,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; matterId: string }> },
) {
  const { firmId, matterId } = await params;
  const session = await getFirmSession(firmId);
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: { edited_html?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (typeof body.edited_html !== 'string') {
    return NextResponse.json({ error: 'body.edited_html is required' }, { status: 400 });
  }

  const matter = await getMatterById(matterId);
  if (!matter || matter.firm_id !== firmId) {
    return NextResponse.json({ error: 'matter not found' }, { status: 404 });
  }
  if (matter.welcome_draft_sent_at) {
    return NextResponse.json(
      { error: 'welcome draft already sent; cannot edit' },
      { status: 409 },
    );
  }

  // Authoritative sanitization: the editor produces HTML, but the stored value
  // is rendered into the CLIENT's portal + email, so it never lands unsanitized
  // regardless of what the editor (or a direct API call) submits. The client
  // adopts the returned `edited_html` as canonical so the lawyer sees exactly
  // what will be stored/sent.
  const sanitized = sanitizeWelcomeHtml(body.edited_html);

  const { error: updateErr } = await supabase
    .from('client_matters')
    .update({ welcome_draft_edited_html: sanitized })
    .eq('id', matterId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    matter_id: matterId,
    edited_html: sanitized,
  });
}
