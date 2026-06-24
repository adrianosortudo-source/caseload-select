/**
 * POST /api/otp/send
 *
 * Generates a 6-digit OTP, stores it in the session, and sends it to the
 * provided email via Resend.
 *
 * Body: { session_id: string; email: string; firm_name?: string }
 * Returns: { sent: true } | { error: string }
 *
 * OTP expires in 15 minutes. Calling this endpoint again regenerates the code.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sendEmail } from "@/lib/email";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";

const OTP_TTL_MINUTES = 15;

function generateOtp(): string {
  // OTP_TEST_CODE lets you fix the OTP to a known value in dev/staging.
  // Set it in .env.local: OTP_TEST_CODE=123456
  if (process.env.OTP_TEST_CODE) return process.env.OTP_TEST_CODE;
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(req: Request) {
  try {
    // Public route that emails a code to an arbitrary address on demand;
    // the per-IP bucket is the mail-bombing gate (H6).
    const ip = ipFromRequest(req);
    const rl = await checkRateLimit("otpSend", ip);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "rate limited", retry_after_seconds: Math.ceil((rl.reset - Date.now()) / 1000) },
        { status: 429, headers: rateLimitHeaders(rl) }
      );
    }

    const body = await req.json() as { session_id?: string; email?: string; firm_name?: string };
    const { session_id, email: requestedEmail, firm_name = "the firm" } = body;

    if (!session_id) {
      return NextResponse.json({ error: "session_id required" }, { status: 400 });
    }
    if (!requestedEmail || !requestedEmail.includes("@")) {
      return NextResponse.json({ error: "valid email required" }, { status: 400 });
    }

    // Verify session exists and load the contact captured during intake.
    const { data: session, error: sessionErr } = await supabase
      .from("intake_sessions")
      .select("id, status, contact")
      .eq("id", session_id)
      .single();

    if (sessionErr || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Codex re-audit CP-02: bind the OTP recipient to the email captured
    // during intake, not the email supplied in the request body. The previous
    // shape let an attacker who learned a valid session_id receive the OTP at
    // an address of their choice and verify the session. Either the request
    // matches the captured email (legit reissue) or we refuse.
    const sessionContact = (session.contact ?? {}) as { email?: string };
    const capturedEmail = (sessionContact.email ?? "").trim().toLowerCase();
    if (!capturedEmail) {
      return NextResponse.json(
        { error: "Session has no captured contact email; complete intake first." },
        { status: 422 },
      );
    }
    if (capturedEmail !== requestedEmail.trim().toLowerCase()) {
      return NextResponse.json(
        { error: "email does not match the contact captured for this session" },
        { status: 403 },
      );
    }
    // From this point on, send to the captured email (server-trusted value),
    // never to anything caller-controlled.
    const email = capturedEmail;

    // Generate OTP and expiry
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

    // Store OTP in session (plaintext  -  6-digit, time-limited, session-scoped).
    // A fresh code starts with a clean attempt counter; the brute-force cap
    // in /api/otp/verify is per code, not per session lifetime.
    const { error: updateErr } = await supabase
      .from("intake_sessions")
      .update({ otp_code: otp, otp_expires_at: expiresAt, otp_attempts: 0 })
      .eq("id", session_id);

    if (updateErr) {
      console.error("[otp/send] Failed to store OTP:", updateErr);
      return NextResponse.json({ error: "Failed to generate OTP" }, { status: 500 });
    }

    // Send email
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <p style="color: #6b7280; font-size: 14px; margin-bottom: 8px;">Your verification code</p>
        <div style="font-size: 40px; font-weight: 700; letter-spacing: 8px; color: #111827; margin: 16px 0 24px;">
          ${otp}
        </div>
        <p style="color: #374151; font-size: 14px; line-height: 1.6;">
          Enter this code to confirm your identity and view your case review from ${firm_name}.
          This code expires in ${OTP_TTL_MINUTES} minutes.
        </p>
        <p style="color: #9ca3af; font-size: 12px; margin-top: 32px;">
          If you did not request this, you can ignore this email.
        </p>
      </div>
    `;

    try {
      const result = await sendEmail(email, `Your ${firm_name} verification code: ${otp}`, html);
      if (result.skipped) {
        // Resend not configured. Log the code ONLY in non-production (local dev
        // without an API key). Codex re-audit CP-03: OTP values must never
        // reach production application logs.
        if (process.env.NODE_ENV !== 'production') {
          console.info(`[otp/send] DEV: OTP for ${email}: ${otp}`);
        } else {
          console.warn(`[otp/send] RESEND_API_KEY missing in production; OTP stored but not delivered, session=${session_id}`);
        }
      }
    } catch (emailErr) {
      // Email delivery failed. NEVER log the OTP value; surface only the
      // session id + delivery error so an operator can investigate without the
      // code itself appearing in logs (CP-03).
      console.warn(
        `[otp/send] Email delivery failed for session=${session_id}; OTP stored in DB and unchanged.`,
        emailErr,
      );
    }

    return NextResponse.json({ sent: true });
  } catch (err) {
    console.error("[otp/send] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
