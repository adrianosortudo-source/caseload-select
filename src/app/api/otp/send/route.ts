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

const OTP_TTL_MINUTES = 15;

function generateOtp(): string {
  // OTP_TEST_CODE lets you fix the OTP to a known value in dev/staging.
  // Set it in .env.local: OTP_TEST_CODE=123456
  if (process.env.OTP_TEST_CODE) return process.env.OTP_TEST_CODE;
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { session_id?: string; email?: string; firm_name?: string };
    const { session_id, email, firm_name = "the firm" } = body;

    if (!session_id) {
      return NextResponse.json({ error: "session_id required" }, { status: 400 });
    }
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "valid email required" }, { status: 400 });
    }

    // Verify session exists
    const { data: session, error: sessionErr } = await supabase
      .from("intake_sessions")
      .select("id, status")
      .eq("id", session_id)
      .single();

    if (sessionErr || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Generate OTP and expiry
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

    // Store OTP in session (plaintext  -  6-digit, time-limited, session-scoped)
    const { error: updateErr } = await supabase
      .from("intake_sessions")
      .update({ otp_code: otp, otp_expires_at: expiresAt })
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
        // Resend not configured  -  dev mode
        console.info(`[otp/send] DEV: OTP for ${email}: ${otp}`);
      }
    } catch (emailErr) {
      // Email delivery failed (e.g. Resend sandbox restriction)  -  OTP is still valid in DB
      console.warn(`[otp/send] Email delivery failed, OTP still stored. Code for ${email}: ${otp}`, emailErr);
    }

    return NextResponse.json({ sent: true });
  } catch (err) {
    console.error("[otp/send] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
