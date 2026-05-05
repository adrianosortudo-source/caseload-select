/**
 * POST /api/portal/request-link
 *
 * Lawyer-initiated magic-link request. Lawyer enters their email at
 * /portal/login; this endpoint resolves email → firmId via the firm record's
 * branding.lawyer_email field, generates a 48h HMAC token via the existing
 * portal-auth utilities, and emails the link via Resend.
 *
 * Body: { email: string }
 *
 * Response is intentionally always 200 with `{ ok: true }` regardless of
 * whether the email matched a firm. Returning a different code on no-match
 * would let an attacker enumerate authorized lawyer emails. The email lands
 * (or doesn't) silently.
 *
 * To authorize a lawyer email for a firm, set
 *   intake_firms.branding.lawyer_email = "lawyer@firm.com"
 * during onboarding. This is a single-lawyer-per-firm MVP shape; the column
 * can be widened to an array (lawyer_emails) when 2-lawyer firms onboard.
 */

import { NextRequest, NextResponse } from "next/server";
import { generatePortalToken } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sendEmail } from "@/lib/email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FirmRow {
  id: string;
  name: string | null;
  branding: { lawyer_email?: string; firm_name?: string } | null;
}

export async function POST(req: NextRequest) {
  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json({ ok: true }); // silent
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: true }); // silent
  }

  // Look up firm by branding.lawyer_email. JSONB scan is cheap at this scale
  // (a handful of firms in the table); when this grows past ~100 firms, add
  // a btree index on (branding->>'lawyer_email').
  const { data: firms, error } = await supabase
    .from("intake_firms")
    .select("id, name, branding")
    .filter("branding->>lawyer_email", "eq", email);

  if (error || !firms || firms.length === 0) {
    return NextResponse.json({ ok: true }); // silent
  }

  const firm = firms[0] as FirmRow;
  const token = generatePortalToken(firm.id);
  const appDomain = process.env.NEXT_PUBLIC_APP_DOMAIN;
  const origin =
    (appDomain ? `https://app.${appDomain}` : null) ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const magicLink = `${origin}/api/portal/login?token=${encodeURIComponent(token)}`;

  const firmName = firm.branding?.firm_name ?? firm.name ?? "your firm";
  const subject = "CaseLoad Select sign-in link";
  const html = renderMagicLinkEmail({ firmName, magicLink });

  try {
    await sendEmail(email, subject, html);
  } catch {
    // Don't surface email failures to the caller. Operator can re-send via
    // /api/portal/generate if needed.
  }

  return NextResponse.json({ ok: true });
}

function renderMagicLinkEmail(args: { firmName: string; magicLink: string }): string {
  const { firmName, magicLink } = args;
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#F4F3EF;font-family:'DM Sans',Arial,sans-serif;color:#0D1520;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F3EF;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid #E4E2DB;">
          <tr>
            <td style="background:#0D1520;padding:18px 28px;border-bottom:2px solid #C4B49A;">
              <div style="font-family:'Oxanium',Arial,sans-serif;font-weight:700;font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:#C4B49A;">CaseLoad Select</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px 8px;">
              <div style="font-family:'Manrope',Arial,sans-serif;font-weight:800;font-size:22px;line-height:1.25;color:#1E2F58;">Sign-in link for ${escapeHtml(firmName)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 24px;">
              <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#3F3C36;">
                Click the link below to access the lawyer portal. The link is valid for 48 hours and signs you in for 30 days on this device.
              </p>
              <p style="margin:0 0 24px;">
                <a href="${magicLink}" style="display:inline-block;background:#1E2F58;color:#FFFFFF;text-decoration:none;font-family:'Oxanium',Arial,sans-serif;font-weight:700;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;padding:12px 22px;">Open the portal</a>
              </p>
              <p style="margin:0;font-size:12px;line-height:1.5;color:#5C5850;">
                If you did not request this link, you can ignore this email. The link does not grant access until clicked.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#EFEDE6;padding:14px 28px;border-top:1px solid #E4E2DB;font-size:11px;color:#9B9690;font-family:'Oxanium',Arial,sans-serif;letter-spacing:0.1em;text-transform:uppercase;">
              caseloadselect.ca
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[c]!));
}
