/**
 * POST /api/portal/[firmId]/matters/[matterId]/invite
 *
 * Lawyer-initiated client invite: generates a magic link scoped to
 * the matter, emails it to the primary_email, returns the link in
 * the response (for the lawyer to copy if email delivery fails).
 *
 * The token carries:
 *   - firm_id
 *   - role='client'
 *   - matter_id (scopes the client session to ONE matter)
 *   - client_email (the matter's primary_email at invite time)
 *   - exp (48h)
 *
 * The client clicks the link, which lands on a verify route that
 * exchanges the token for a 30-day session cookie scoped the same
 * way. Phase 1 doesn't support multiple matters per client — each
 * matter gets its own invite link.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirmSession, generatePortalToken } from '@/lib/portal-auth';
import { getMatterById } from '@/lib/matter-stage';
import { sendEmail } from '@/lib/email';
import { loadFirmEmailBranding } from '@/lib/firm-email-branding';
import { renderEmailShell } from '@/lib/email-shell';
import type { EmailBranding } from '@/lib/email-branding';

const INVITE_TTL_HOURS = 48;

export async function POST(
  req: NextRequest,
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
  if (!matter.primary_email) {
    return NextResponse.json(
      { error: 'matter has no primary_email; cannot send invite' },
      { status: 422 },
    );
  }

  const token = generatePortalToken(firmId, {
    role: 'client',
    matter_id: matterId,
    client_email: matter.primary_email,
    ttlHours: INVITE_TTL_HOURS,
  });

  // Build the accept URL. Use the origin from the request so this
  // works on prod (app.caseloadselect.ca), on preview deploys, and
  // on localhost without env var plumbing.
  const origin = req.headers.get('origin') || new URL(req.url).origin;
  const acceptUrl = `${origin}/portal/${firmId}/m/${matterId}/accept?token=${encodeURIComponent(token)}`;

  // Best-effort email send. The lawyer also gets the URL in the
  // response so they can copy-paste if the inbox bounces.
  // Themed firms (e.g. DRG Law) get the branded correspondence shell; every
  // other firm keeps the default invite layout, unchanged.
  const branding = await loadFirmEmailBranding(firmId);

  let emailDelivery: { sent: boolean; error?: string } = { sent: false };
  try {
    const result = await sendEmail(
      matter.primary_email,
      `${matter.primary_name}, your secure link to your matter`,
      buildInviteEmailHtml({
        primary_name: matter.primary_name,
        accept_url: acceptUrl,
        branding,
      }),
    );
    emailDelivery = 'skipped' in result && result.skipped
      ? { sent: false, error: 'RESEND_API_KEY not set; email skipped' }
      : result.id
        ? { sent: true }
        : { sent: false, error: 'Resend returned no id' };
  } catch (err) {
    emailDelivery = {
      sent: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return NextResponse.json({
    ok: true,
    matter_id: matterId,
    accept_url: acceptUrl,
    sent_to: matter.primary_email,
    email_delivery: emailDelivery,
    expires_in_hours: INVITE_TTL_HOURS,
  });
}

function buildInviteEmailHtml(input: {
  primary_name: string;
  accept_url: string;
  branding?: EmailBranding | null;
}): string {
  const firstName = (input.primary_name ?? '').split(/\s+/)[0] || 'there';

  if (input.branding) {
    const b = input.branding;
    return renderEmailShell({
      branding: b,
      preheader: 'Your secure link to your matter',
      eyebrow: 'Secure access',
      bodyHtml:
        `<p>Hi ${escapeHtml(firstName)},</p>` +
        `<p>Here's the secure link to your matter. It takes you to a private page where you can read updates, send messages, and view what's coming next.</p>`,
      cta: { label: 'Open your secure page', url: input.accept_url },
      footerHtml:
        `This link expires in 48 hours. If it expires before you open it, reply to this email and we'll send a fresh one.<br><br>${escapeHtml(b.firmName)}`,
    });
  }

  return `
    <div style="font-family: 'Manrope', Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px;">
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>Here's the secure link to your matter. It takes you to a private page where you can read updates, send messages, and view what's coming next.</p>
      <p style="margin: 28px 0;">
        <a href="${input.accept_url}" style="display: inline-block; padding: 14px 22px; background: #1E2F58; color: #fff; text-decoration: none; border-radius: 4px; font-weight: 700;">
          Open your secure page
        </a>
      </p>
      <p style="font-size: 13px; color: #666;">This link expires in 48 hours. If it expires before you click, just reply to this email and we'll send a fresh one.</p>
    </div>
  `.trim();
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
