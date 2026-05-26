/**
 * GET /api/cron/token-expiry-check
 *
 * Daily sweep across `intake_firms` for tokens within EXPIRING_SOON_DAYS
 * of expiry (or already expired). Emails the operator inbox once per
 * affected token; the ALERT_SUPPRESSION_DAYS window prevents repeat
 * spam until the operator rotates the token (which resets
 * `*_token_expires_at` and clears `*_token_alert_sent_at`).
 *
 * Auth: Bearer CRON_SECRET / PG_CRON_TOKEN (same shape as the other
 * crons under /api/cron/*).
 *
 * Scheduling: NOT yet wired into Supabase pg_cron — see the migration
 * doctrine. The route is callable manually for now; a follow-up
 * migration adds the daily schedule. Operator can also hit it ad-hoc
 * from `/admin/...` to force a re-check.
 *
 * Logic mirrors triage-backstop's shape:
 *   1. Fetch every firm with at least one tracked expiry (uses the
 *      partial index from 20260526_intake_firms_token_expiry.sql).
 *   2. Compute status via `computeFirmTokenStatus` (pure helper).
 *   3. For each firm with ≥1 actionable token, build + send alert email.
 *   4. Stamp `*_token_alert_sent_at` on the firm row so the suppression
 *      window engages.
 *
 * The pure logic lives in `lib/token-expiry`; this route is the I/O
 * wrapper.
 */

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { isCronAuthorized } from "@/lib/cron-auth";
import {
  computeFirmTokenStatus,
  tokensNeedingAlert,
  buildTokenAlertBody,
  buildAlertSentAtPatch,
  type FirmTokenRow,
} from "@/lib/token-expiry";

const FALLBACK_OPERATOR_EMAIL = "adriano@caseloadselect.ca";

interface FirmOutcome {
  firm_id: string;
  firm_name: string | null;
  alerted_tokens: string[];
  email_sent: boolean;
  email_error?: string;
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recipient =
    process.env.OPERATOR_NOTIFICATION_EMAIL || FALLBACK_OPERATOR_EMAIL;
  const resendKey = process.env.RESEND_API_KEY;
  const fromAddress =
    process.env.OPERATOR_NOTIFICATION_FROM || "ops@caseloadselect.ca";

  const { data: firms, error } = await supabase
    .from("intake_firms")
    .select(`
      id, name,
      facebook_page_token_expires_at, facebook_page_token_alert_sent_at,
      whatsapp_cloud_token_expires_at, whatsapp_cloud_token_alert_sent_at,
      voice_api_token_expires_at, voice_api_token_alert_sent_at
    `)
    .or(
      "facebook_page_token_expires_at.not.is.null,whatsapp_cloud_token_expires_at.not.is.null,voice_api_token_expires_at.not.is.null",
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const outcomes: FirmOutcome[] = [];
  const now = new Date();
  const resend = resendKey ? new Resend(resendKey) : null;

  for (const row of (firms ?? []) as FirmTokenRow[]) {
    const status = computeFirmTokenStatus(row, now);
    const alerted = tokensNeedingAlert(status);
    if (alerted.length === 0) continue;

    const body = buildTokenAlertBody(status);
    const subject = `[token-health] ${row.name ?? `Firm ${row.id}`} — ${alerted.length} token${alerted.length === 1 ? "" : "s"} need attention`;

    let emailSent = false;
    let emailError: string | undefined;

    if (!resend) {
      emailError = "RESEND_API_KEY not configured";
    } else {
      try {
        const { error: sendErr } = await resend.emails.send({
          from: fromAddress,
          to: recipient,
          subject,
          text: body,
        });
        if (sendErr) {
          emailError = sendErr.message ?? "send returned error";
        } else {
          emailSent = true;
        }
      } catch (err) {
        emailError = err instanceof Error ? err.message : String(err);
      }
    }

    if (emailSent) {
      const patch = buildAlertSentAtPatch(alerted, now);
      const { error: updateErr } = await supabase
        .from("intake_firms")
        .update(patch)
        .eq("id", row.id);
      if (updateErr) {
        // Stamping failed — log it. The next cron run may re-alert
        // (false positive), which is much better than missing a real alert.
        console.warn(
          `[token-expiry-cron] alert sent but stamp failed firm=${row.id}: ${updateErr.message}`,
        );
      }
    }

    outcomes.push({
      firm_id: row.id,
      firm_name: row.name,
      alerted_tokens: alerted.map((t) => t.key),
      email_sent: emailSent,
      email_error: emailError,
    });
  }

  return NextResponse.json({
    ok: true,
    scanned: firms?.length ?? 0,
    alerted: outcomes.length,
    outcomes,
  });
}
