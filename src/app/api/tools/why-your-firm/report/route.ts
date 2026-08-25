/**
 * POST /api/tools/why-your-firm/report
 *
 * Assembles the Firm Positioning Brief from a submitted wizard state,
 * renders it as a PDF, and emails it via Resend. Mirrors the contract of
 * /api/screen-demo/report: same response shape, same fail-open behaviour
 * when RESEND_API_KEY is unconfigured, same "PDF still generated and
 * returned even if the email send fails" posture.
 *
 * TRUST BOUNDARY (see engine.ts's own header comment)
 * The request body is raw selections: card ids, typed proof text, chosen
 * alternatives, the statement pattern and its slot values. It is never a
 * pre-rendered brief. assembleBrief() re-runs the exact same compliance and
 * survival logic the browser ran, so a scripted client cannot smuggle a
 * blocked claim into the PDF by skipping the UI's own checks: the server
 * recomputes from scratch and drops anything that fails here regardless of
 * what the client believed had already passed.
 *
 * No database writes. No new tables. Lead capture is the Resend send
 * itself, per the build plan's data posture (§3.3).
 */

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { Resend } from "resend";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";
import { assembleBrief, type AlternativeSelection, type CardWork } from "@/lib/why-your-firm/engine";
import { BriefPdf } from "@/lib/why-your-firm/brief-pdf";
import { copy } from "@/lib/why-your-firm/compliance";

export const runtime = "nodejs";

const RESEND_FROM = process.env.RESEND_FROM ?? "CaseLoad Select <noreply@caseloadselect.ca>";

interface RequestBody {
  firstName: string;
  firmName: string;
  email: string;
  alternatives: AlternativeSelection[];
  work: CardWork[];
  patternId: string | null;
  statementValues: string[];
}

function isString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function isCardWork(v: unknown): v is CardWork {
  if (!v || typeof v !== "object") return false;
  const w = v as Record<string, unknown>;
  return (
    isString(w.cardId) &&
    typeof w.proof === "string" &&
    !!w.tests &&
    typeof w.tests === "object" &&
    typeof (w.tests as Record<string, unknown>).provable === "boolean" &&
    typeof (w.tests as Record<string, unknown>).inDemand === "boolean" &&
    typeof (w.tests as Record<string, unknown>).unique === "boolean"
  );
}

function isAlternativeSelection(v: unknown): v is AlternativeSelection {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  return isString(a.id);
}

export async function POST(req: Request) {
  const rl = await checkRateLimit("whyYourFirmReport", ipFromRequest(req));
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "rate limited" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  // ── Validate input ────────────────────────────────────────────────
  if (!isString(body.firstName) || body.firstName.length > 120) {
    return NextResponse.json({ ok: false, error: "Missing or invalid firstName" }, { status: 400 });
  }
  if (!isString(body.firmName) || body.firmName.length > 200) {
    return NextResponse.json({ ok: false, error: "Missing or invalid firmName" }, { status: 400 });
  }
  if (!isString(body.email) || !isValidEmail(body.email) || body.email.length > 240) {
    return NextResponse.json({ ok: false, error: "Invalid email" }, { status: 400 });
  }
  if (!Array.isArray(body.alternatives) || !body.alternatives.every(isAlternativeSelection)) {
    return NextResponse.json({ ok: false, error: "Invalid alternatives" }, { status: 400 });
  }
  if (!Array.isArray(body.work) || !body.work.every(isCardWork) || body.work.length > 6) {
    return NextResponse.json({ ok: false, error: "Invalid work" }, { status: 400 });
  }
  if (body.patternId !== null && !isString(body.patternId)) {
    return NextResponse.json({ ok: false, error: "Invalid patternId" }, { status: 400 });
  }
  if (!Array.isArray(body.statementValues) || !body.statementValues.every((v) => typeof v === "string")) {
    return NextResponse.json({ ok: false, error: "Invalid statementValues" }, { status: 400 });
  }

  // ── Re-derive the brief server-side. See file header. ─────────────
  const brief = assembleBrief({
    alternatives: body.alternatives,
    work: body.work,
    patternId: body.patternId,
    statementValues: body.statementValues,
    firmName: body.firmName,
  });

  // ── Render the PDF (server-side, Node runtime) ───────────────────
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderToBuffer(BriefPdf({ brief }));
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
        subject: copy.email.subject,
        html: buildEmailHtml({
          firstName: body.firstName,
          firmName: brief.firmName || body.firmName,
          profileName: brief.profile?.name ?? null,
        }),
        attachments: [
          {
            filename: "Firm-Positioning-Brief.pdf",
            content: pdfBuffer,
          },
        ],
      });
      if (error) emailError = error.message;
      else {
        emailed = true;
        emailId = data?.id;
      }
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
    profileId: brief.profile?.id ?? null,
    profileName: brief.profile?.name ?? null,
    survivorCount: brief.survivors.length,
  });
}

/* ──────────────────────────────────────────────────────────────────
 *  Cover email: brand register, no em dashes, no banned vocabulary
 * ────────────────────────────────────────────────────────────────── */

interface EmailHtmlInput {
  firstName: string;
  firmName: string;
  profileName: string | null;
}

function buildEmailHtml({ firstName, firmName, profileName }: EmailHtmlInput): string {
  const safeFirst = escapeHtml(firstName);
  const safeFirm = escapeHtml(firmName);
  const bodyParagraphs = copy.email.body
    .split("\n\n")
    .map((p) => `<p style="font-size:14px;color:#6B7A8D;line-height:1.65;margin:0 0 16px;">${escapeHtml(p)}</p>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(copy.email.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#F4F3EF;font-family:'Manrope',-apple-system,sans-serif;color:#1C2B3A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F3EF;padding:40px 20px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
             style="background:#FFFFFF;border-radius:6px;overflow:hidden;box-shadow:0 4px 24px rgba(30,47,88,0.08);">

        <tr><td style="background:#1E2F58;padding:28px 32px;color:#FFFFFF;">
          <div style="font-family:'Oxanium',monospace;font-size:10px;font-weight:700;letter-spacing:2px;color:#C4B49A;text-transform:uppercase;margin-bottom:8px;">
            CaseLoad Select · Why Your Firm
          </div>
          <div style="font-family:'Oxanium',monospace;font-size:22px;font-weight:800;line-height:1.25;">
            ${escapeHtml(copy.email.subject)}
          </div>
          ${profileName ? `<div style="font-family:'Oxanium',monospace;font-size:11px;font-weight:700;letter-spacing:1px;color:#C4B49A;margin-top:10px;">${escapeHtml(profileName)}</div>` : ""}
        </td></tr>

        <tr><td style="padding:28px 32px;">
          <p style="font-size:15px;color:#1E2F58;line-height:1.6;margin:0 0 16px;">
            ${safeFirst}, ${safeFirm}&rsquo;s Firm Positioning Brief is attached to this email as a PDF.
          </p>
          ${bodyParagraphs}
        </td></tr>

        <tr><td style="background:#F9F8F5;padding:18px 32px;border-top:1px solid #E8E4DA;">
          <p style="font-size:11px;color:#6B7A8D;line-height:1.5;margin:0;">
            ${escapeHtml(copy.email.signoff)} &middot; Toronto, Ontario &middot; Built for Ontario law firms.
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
