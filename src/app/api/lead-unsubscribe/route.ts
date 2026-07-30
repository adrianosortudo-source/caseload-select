/**
 * GET /api/lead-unsubscribe?firm={intake_firms.id}&email={address}
 *
 * The unsubscribe link a GHL workflow email's footer points at. Hit
 * directly by a human clicking a link in their email client, so there is
 * no auth header to check -- the same posture every commercial-email
 * unsubscribe link on the internet has (the "proof" is that the request
 * arrived at the address it names, not a bearer token).
 *
 * Write-ahead evidence, same invariant as marketing-lead-intake's consent
 * insert: `marketing_lead_unsubscribes` is written BEFORE the GHL call is
 * attempted, and that insert is NOT best-effort, so a durable record that
 * the opt-out request was received survives a GHL outage. The GHL contact
 * resolution and Email-DND call are best-effort after that -- the visitor
 * still sees a confirmation page either way, since re-driving a failed DND
 * call from the audit row is a recoverable follow-up, but telling someone
 * their opt-out failed when we could not even confirm receipt is not.
 *
 * Response is always HTML: a real person is looking at this page in a
 * browser, not a machine parsing JSON.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { upsertGhlContact, setGhlContactEmailDnd } from '@/lib/ghl-contacts-write-api';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page(title: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { margin:0; padding:48px 24px; background:#F4F3EF; color:#1E2F58; font-family:Georgia,'Times New Roman',serif; }
  .card { max-width:480px; margin:0 auto; background:#FFFFFF; border-top:3px solid #1E2F58; padding:32px 28px; }
  h1 { font-size:20px; margin:0 0 12px; }
  p { font-size:15px; line-height:1.6; margin:0 0 10px; }
  .muted { color:#5b6579; font-size:13px; }
</style>
</head>
<body>
  <div class="card">${body}</div>
</body>
</html>`;
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

const CONFIRMED_BODY = `
  <h1>You have been unsubscribed.</h1>
  <p>DRG Law will not send you further email communications.</p>
  <p class="muted">If you keep receiving messages, reply to any of them or contact info@drglaw.ca and we will resolve it directly.</p>
`;

const ERROR_BODY = `
  <h1>Something did not go through.</h1>
  <p>We could not process your unsubscribe request automatically.</p>
  <p class="muted">Please email info@drglaw.ca and we will remove you manually.</p>
`;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const firmId = (url.searchParams.get('firm') ?? '').trim();
  const email = (url.searchParams.get('email') ?? '').trim();

  if (!firmId || !UUID_RE.test(firmId) || !email || !email.includes('@')) {
    return page('Unsubscribe', ERROR_BODY, 400);
  }

  const { data: firm, error: firmErr } = await supabase
    .from('intake_firms')
    .select('id, ghl_location_id, ghl_contacts_write_token')
    .eq('id', firmId)
    .maybeSingle();

  if (firmErr || !firm) {
    console.error('[lead-unsubscribe] firm lookup failed:', firmErr);
    return page('Unsubscribe', ERROR_BODY, 500);
  }

  const forwardedFor = req.headers.get('x-forwarded-for');
  const ip = forwardedFor ? forwardedFor.split(',')[0]?.trim() : null;
  const userAgent = req.headers.get('user-agent');

  // Write-ahead: durable evidence the request was received, before any
  // downstream GHL call is attempted.
  const { data: row, error: insertErr } = await supabase
    .from('marketing_lead_unsubscribes')
    .insert({
      firm_id: firmId,
      email,
      ip_address: ip,
      user_agent: userAgent,
    })
    .select('id')
    .single();

  if (insertErr || !row) {
    console.error('[lead-unsubscribe] audit insert failed:', insertErr);
    return page('Unsubscribe', ERROR_BODY, 500);
  }

  if (!firm.ghl_location_id || !firm.ghl_contacts_write_token) {
    console.error(`[lead-unsubscribe] firm ${firmId} has no GHL contacts-write config`);
    return page('Unsubscribed', CONFIRMED_BODY);
  }

  // Best-effort from here: the visitor already sees confirmation either
  // way, since the audit row above is the recoverable source of truth if
  // this GHL leg fails.
  const upsertResult = await upsertGhlContact(firm.ghl_location_id, firm.ghl_contacts_write_token, { email });
  if (!upsertResult.ok) {
    console.error('[lead-unsubscribe] GHL contact resolution failed (non-fatal):', upsertResult);
    return page('Unsubscribed', CONFIRMED_BODY);
  }

  const dndResult = await setGhlContactEmailDnd(
    upsertResult.contactId,
    firm.ghl_contacts_write_token,
    'Unsubscribed via lead-magnet welcome email footer',
  );
  if (!dndResult.ok) {
    console.error('[lead-unsubscribe] GHL email DND set failed (non-fatal):', dndResult);
  }

  return page('Unsubscribed', CONFIRMED_BODY);
}
