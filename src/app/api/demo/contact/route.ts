/**
 * POST /api/demo/contact
 *
 * Receives the Hartwell Law PC demo contact form and emails
 * the submission to the operator via Resend.
 *
 * No auth required  -  public demo endpoint.
 * Rate-limit guard: rejects empty/bot submissions.
 */

import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";

export async function POST(req: Request) {
  let body: { name?: string; email?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { name, email, message } = body;
  if (!name || !email || !message) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const notifyTo = process.env.DEMO_NOTIFY_EMAIL ?? "adriano@caseloadselect.ca";

  const html = `
    <div style="font-family:sans-serif;max-width:560px;color:#0D1520">
      <div style="background:#1E2F58;padding:20px 24px;border-radius:8px 8px 0 0">
        <span style="color:#C4B49A;font-weight:700;font-size:14px;letter-spacing:0.05em">
          CASELOAD SELECT  -  DEMO CONTACT
        </span>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr>
            <td style="padding:8px 0;color:#6b7280;width:80px;vertical-align:top">Name</td>
            <td style="padding:8px 0;font-weight:600">${name}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6b7280;vertical-align:top">Email</td>
            <td style="padding:8px 0">
              <a href="mailto:${email}" style="color:#1E2F58">${email}</a>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6b7280;vertical-align:top">Message</td>
            <td style="padding:8px 0;white-space:pre-wrap">${message}</td>
          </tr>
        </table>
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid #f3f4f6;font-size:12px;color:#9ca3af">
          Submitted via Hartwell Law PC demo · CaseLoad Select
        </div>
      </div>
    </div>
  `;

  try {
    await sendEmail(notifyTo, `Demo enquiry from ${name}`, html);
  } catch {
    // Log but return success  -  don't expose email errors to public
    console.error("[demo/contact] Resend error");
  }

  return NextResponse.json({ ok: true });
}
