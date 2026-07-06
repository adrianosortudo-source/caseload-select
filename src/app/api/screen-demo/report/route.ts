/**
 * POST /api/screen-demo/report
 *
 * Generates the Sample Screen Report PDF for a /screen-demo session and
 * emails it to the firm via Resend. Also returns the PDF as base64 so the
 * UI can offer an immediate inline preview if desired.
 *
 * Request body:
 *   {
 *     caseId:    string  // e.g. "immigration-appeal" | "criminal-impaired" | "real-estate-closing" | "your-own"
 *     answers:   Record<string, string | string[]>
 *     firmName:  string
 *     email:     string
 *   }
 *
 * Response:
 *   { ok: true, emailed: boolean, emailId?: string, pdfBase64: string }
 *   or
 *   { ok: false, error: string }
 *
 * Behaviour:
 *   - Resend RESEND_API_KEY missing → emailed=false, PDF still generated and returned
 *   - Renders the ReportPdf React tree with @react-pdf/renderer in Node
 *   - Brand discipline: subject + body copy passes brand-book rules
 *     (no em dashes, no banned vocabulary, no orphan words)
 *
 * LSO Rule 4.2-1 note: every page of the PDF carries the DEMONSTRATION
 * footer band. The cover email body also names the artifact as a sample.
 */

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { Resend } from "resend";
import { getCase } from "../../../(marketing)/screen-demo/_data/cases";
import { computeScore, type Answers } from "../../../(marketing)/screen-demo/_lib/scoring";
import { ReportPdf } from "../../../(marketing)/screen-demo/_lib/report-pdf";

export const runtime = "nodejs";

const RESEND_FROM =
  process.env.RESEND_FROM ?? "CaseLoad Select <noreply@caseloadselect.ca>";

interface RequestBody {
  caseId: string;
  answers: Answers;
  firmName: string;
  email: string;
}

function isString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export async function POST(req: Request) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  // ── Validate input ────────────────────────────────────────────────
  if (!isString(body.caseId)) {
    return NextResponse.json({ ok: false, error: "Missing caseId" }, { status: 400 });
  }
  if (!body.answers || typeof body.answers !== "object") {
    return NextResponse.json({ ok: false, error: "Missing answers" }, { status: 400 });
  }
  if (!isString(body.firmName)) {
    return NextResponse.json({ ok: false, error: "Missing firmName" }, { status: 400 });
  }
  if (!isString(body.email) || !isValidEmail(body.email)) {
    return NextResponse.json({ ok: false, error: "Invalid email" }, { status: 400 });
  }
  if (body.firmName.length > 120 || body.email.length > 240) {
    return NextResponse.json({ ok: false, error: "Field too long" }, { status: 400 });
  }

  const caseFixture = getCase(body.caseId);
  if (!caseFixture) {
    return NextResponse.json({ ok: false, error: "Unknown caseId" }, { status: 400 });
  }

  // ── Compute the score from the submitted answers ─────────────────
  const score = computeScore(body.answers);

  // ── Render the PDF (server-side, Node runtime) ───────────────────
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderToBuffer(
      ReportPdf({
        caseFixture,
        score,
        firmName: body.firmName,
        answers: body.answers,
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "PDF render failed";
    return NextResponse.json({ ok: false, error: `PDF error: ${msg}` }, { status: 500 });
  }

  // ── Email delivery via Resend (best-effort, non-fatal) ───────────
  const resendKey = process.env.RESEND_API_KEY;
  let emailed = false;
  let emailId: string | undefined;
  let emailError: string | undefined;

  if (resendKey) {
    try {
      const resend = new Resend(resendKey);
      const { data, error } = await resend.emails.send({
        from: RESEND_FROM,
        to: body.email,
        subject: `Your CaseLoad Select Screen Report (Sample) · ${caseFixture.tag}`,
        html: buildEmailHtml({
          firmName: body.firmName,
          caseTitle: caseFixture.title,
          band: score.band,
          cpi: score.cpi,
        }),
        attachments: [
          {
            filename: `CaseLoad-Select-Screen-Report-Sample-${caseFixture.id}.pdf`,
            content: pdfBuffer,
          },
        ],
      });
      if (error) emailError = error.message;
      else { emailed = true; emailId = data?.id; }
    } catch (err) {
      emailError = err instanceof Error ? err.message : "Resend send failed";
    }
  }

  return NextResponse.json({
    ok: true,
    emailed,
    emailId,
    emailError,
    pdfBase64: pdfBuffer.toString("base64"),
    cpi: score.cpi,
    band: score.band,
  });
}

/* ──────────────────────────────────────────────────────────────────
 *  Cover email — Sage register, no em dashes, no banned vocabulary
 * ────────────────────────────────────────────────────────────────── */

interface EmailHtmlInput {
  firmName: string;
  caseTitle: string;
  band: string;
  cpi: number;
}

function buildEmailHtml({ firmName, caseTitle, band, cpi }: EmailHtmlInput): string {
  const safeFirm = escapeHtml(firmName);
  const safeCase = escapeHtml(caseTitle);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Your CaseLoad Select Screen Report (Sample)</title>
</head>
<body style="margin:0;padding:0;background:#F4F3EF;font-family:'Manrope',-apple-system,sans-serif;color:#1C2B3A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F3EF;padding:40px 20px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
             style="background:#FFFFFF;border-radius:6px;overflow:hidden;box-shadow:0 4px 24px rgba(30,47,88,0.08);">

        <tr><td style="background:#1E2F58;padding:28px 32px;color:#FFFFFF;">
          <div style="font-family:'Oxanium',monospace;font-size:10px;font-weight:700;letter-spacing:2px;color:#C4B49A;text-transform:uppercase;margin-bottom:8px;">
            CaseLoad Select · Screen Report · Sample
          </div>
          <div style="font-family:'Oxanium',monospace;font-size:22px;font-weight:800;line-height:1.25;">
            Your sample Screen report is ready
          </div>
        </td></tr>

        <tr><td style="padding:28px 32px;">
          <p style="font-size:15px;color:#1E2F58;line-height:1.6;margin:0 0 16px;">
            ${safeFirm}, your Sample Screen Report is attached to this email as a PDF.
          </p>
          <p style="font-size:14px;color:#6B7A8D;line-height:1.65;margin:0 0 16px;">
            You walked through the Screen for one inquiry: <strong style="color:#1E2F58;">${safeCase}</strong>.
            The Screen scored the case at <strong style="color:#1E2F58;">${cpi}</strong> out of 100 and
            assigned it to <strong style="color:#1E2F58;">Band ${escapeHtml(band)}</strong>.
            The PDF shows the full breakdown, the recommended next steps, and the answer trail
            that produced the score.
          </p>
          <p style="font-size:14px;color:#6B7A8D;line-height:1.65;margin:0 0 24px;">
            Save the PDF for later. Share it with anyone else at the firm. The artifact is yours.
          </p>

          <div style="background:#FFF4E0;border:1px solid #C4B49A;padding:14px 18px;margin:0 0 24px;border-radius:4px;">
            <div style="font-family:'Oxanium',monospace;font-size:10px;font-weight:700;letter-spacing:1.8px;color:#9E9070;text-transform:uppercase;margin-bottom:4px;">
              Demonstration report
            </div>
            <p style="font-size:13px;color:#4A3510;line-height:1.55;margin:0;">
              The attached PDF is a sample. It uses inputs you provided to show how the
              CaseLoad Select Screen works, not to evaluate a real client matter. Every page
              is marked accordingly.
            </p>
          </div>

          <p style="font-size:14px;color:#1E2F58;line-height:1.65;margin:0 0 24px;">
            CaseLoad Select runs the Screen on every inquiry your firm receives, in seven
            channels, around the clock. A 30-minute call walks through what that looks like
            for your practice and your case mix.
          </p>

          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
            <tr><td>
              <a href="https://caseloadselect.ca/home#cta"
                 style="display:inline-block;background:#C4B49A;color:#0D1520;
                        font-family:'Manrope',sans-serif;font-size:13px;font-weight:700;
                        letter-spacing:1.2px;text-transform:uppercase;text-decoration:none;
                        padding:14px 28px;border-radius:3px;">
                Book a 30-minute call →
              </a>
            </td></tr>
          </table>

          <p style="font-size:12px;color:rgba(107,122,141,0.85);line-height:1.55;margin:0;">
            Or run another sample case at
            <a href="https://caseloadselect.ca/screen-demo" style="color:#9E9070;text-decoration:underline;">caseloadselect.ca/screen-demo</a>.
          </p>
        </td></tr>

        <tr><td style="background:#F9F8F5;padding:18px 32px;border-top:1px solid #E8E4DA;">
          <p style="font-size:11px;color:#6B7A8D;line-height:1.5;margin:0;">
            CaseLoad Select · Toronto, Ontario · Built for Ontario law firms.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
