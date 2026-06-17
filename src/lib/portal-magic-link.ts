/**
 * Shared portal magic-link send path.
 *
 * Extracted from /api/portal/request-link so the operator access tool can
 * resend a sign-in link to a firm member without duplicating the token mint
 * + branded email. request-link keeps its own resolution + anti-enumeration
 * flow and renders through these helpers.
 */

import "server-only";
import { generatePortalToken } from "@/lib/portal-auth";
import { sendEmail } from "@/lib/email";

export function buildMagicLinkUrl(token: string): string {
  const appDomain = process.env.NEXT_PUBLIC_APP_DOMAIN;
  const origin =
    (appDomain ? `https://app.${appDomain}` : null) ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return `${origin}/api/portal/login?token=${encodeURIComponent(token)}`;
}

export function renderMagicLinkEmail(args: {
  firmName: string;
  magicLink: string;
  role: "lawyer" | "operator";
}): string {
  const { firmName, magicLink, role } = args;
  const heading = role === "operator"
    ? "Operator sign-in link"
    : `Sign-in link for ${escapeHtml(firmName)}`;
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
              <div style="font-family:'Manrope',Arial,sans-serif;font-weight:800;font-size:22px;line-height:1.25;color:#1E2F58;">${heading}</div>
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

/**
 * Mint a token, build the link, render and send the branded email. Returns
 * { sent } and never throws; email failures are swallowed (the caller has
 * already authorised the action). The token role collapses to lawyer for any
 * firm membership that is not the operator role.
 */
export async function sendPortalMagicLink(args: {
  email: string;
  firmId: string;
  firmName: string;
  role?: "lawyer" | "operator";
  lawyerId?: string;
}): Promise<{ sent: boolean }> {
  const role: "lawyer" | "operator" = args.role === "operator" ? "operator" : "lawyer";
  const token = generatePortalToken(args.firmId, { role, lawyer_id: args.lawyerId });
  const magicLink = buildMagicLinkUrl(token);
  const subject = role === "operator"
    ? "CaseLoad Select operator sign-in link"
    : "CaseLoad Select sign-in link";
  const html = renderMagicLinkEmail({ firmName: args.firmName, magicLink, role });
  try {
    await sendEmail(args.email, subject, html);
    return { sent: true };
  } catch {
    return { sent: false };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[c]!));
}
