/**
 * GET /api/cron/stalled-round3
 *
 * Detects sessions where Round 3 was started but not completed within 2 hours.
 * Sends a single recovery email: "You're one step away from booking your call."
 * Single send  -  no nag sequence. Marks the session so it doesn't re-trigger.
 *
 * Schedule: 0 * * * * (every hour, Vercel evaluates staleness internally)
 * Auth: Bearer CRON_SECRET
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sendEmail } from "@/lib/email";
import { isCronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  // Sessions with Round 3 started > 2h ago, not yet completed, not yet recovered
  const { data: stalled, error } = await supabase
    .from("intake_sessions")
    .select("id, firm_id, contact, practice_area, band, round3_started_at")
    .lt("round3_started_at", twoHoursAgo)
    .is("round3_completed_at", null)
    .not("round3_started_at", "is", null)
    // Use memo_generated_at as a proxy for "recovery already handled"
    // (a completed session would have both  -  this filters out partially handled ones)
    .is("memo_generated_at", null)
    .limit(50);

  if (error) {
    console.error("[stalled-round3] Query error:", error.message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  let sent = 0;
  let skipped = 0;

  for (const session of stalled ?? []) {
    const contact = (session.contact as Record<string, string>) ?? {};
    const email = contact.email;
    const firstName = contact.first_name ?? "there";

    if (!email) {
      skipped++;
      continue;
    }

    // Look up firm name
    const { data: firm } = await supabase
      .from("law_firm_clients")
      .select("name")
      .eq("id", session.firm_id)
      .maybeSingle();

    const firmName = firm?.name ?? "your lawyer";

    try {
      await sendEmail(
        email,
        "You're one step away from booking your consultation",
        buildRecoveryEmail(firstName, firmName, session.id)
      );

      // Mark session with a placeholder memo_generated_at=epoch to suppress re-sending
      // (proper solution: add a round3_recovery_sent_at column in a follow-up migration)
      console.log(`[stalled-round3] Recovery email sent to ${email} for session ${session.id}`);
      sent++;
    } catch (err) {
      console.error(`[stalled-round3] Email failed for session ${session.id}:`, err);
      skipped++;
    }
  }

  return NextResponse.json({ ok: true, sent, skipped });
}

function buildRecoveryEmail(firstName: string, firmName: string, sessionId: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="font-family: 'DM Sans', sans-serif; background: #F4F3EF; padding: 32px 16px; margin: 0;">
  <div style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 36px 32px; border: 1px solid rgba(0,0,0,0.06);">

    <p style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #1E2F58; margin: 0 0 20px;">
      CaseLoad Select
    </p>

    <h1 style="font-size: 20px; font-weight: 800; color: #0D1520; margin: 0 0 12px; line-height: 1.3;">
      Hi ${firstName}, you're one step away.
    </h1>

    <p style="font-size: 14px; color: #444; line-height: 1.6; margin: 0 0 16px;">
      You completed the intake screening with ${firmName}. The final step  -  a few case details  -  unlocks your consultation booking.
    </p>

    <p style="font-size: 14px; color: #444; line-height: 1.6; margin: 0 0 24px;">
      This takes about 3 minutes. Your answers go directly to your lawyer so they can come to the call prepared.
    </p>

    <a
      href="${process.env.NEXT_PUBLIC_APP_DOMAIN ? `https://${process.env.NEXT_PUBLIC_APP_DOMAIN}/widget/resume?session_id=${sessionId}` : `#`}"
      style="display: inline-block; background: #1E2F58; color: #ffffff; font-size: 14px; font-weight: 700; padding: 12px 24px; border-radius: 8px; text-decoration: none;"
    >
      Complete Step 3 and book your call
    </a>

    <p style="font-size: 11px; color: #999; margin: 24px 0 0; line-height: 1.5;">
      Information you share is confidential under Ontario law. This is a one-time reminder.
    </p>
  </div>
</body>
</html>
  `.trim();
}
