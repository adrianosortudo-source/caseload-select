/**
 * POST /api/admin/onboarding-submissions/[id]/retry-notification
 *
 * Operator-only. Re-sends the firm-onboarding operator-notification email
 * for an existing firm_onboarding_intake row. Used when the original
 * notification failed (Resend errored, recipient inbox was down, sender
 * domain wasn't verified at the time, etc.) and the operator needs the
 * email to land so they can move forward with the firm's setup.
 *
 * The retry uses the same builder as the submit route, so the operator
 * gets a byte-equivalent email to what would have arrived on submission.
 * A "[REPLAY]" prefix on the subject and a callout banner inside the body
 * make the re-send obvious at a glance.
 *
 * The helper persists the delivery outcome on the row
 * (notification_sent_at / notification_error / notification_attempts /
 * notification_last_attempt_at) so the admin list page reflects the new
 * state immediately.
 *
 * Auth: getOperatorSession() (same gate as /admin/*).
 *
 * Returns:
 *   200 { ok: true,  messageId, sentTo, attempts }
 *   200 { ok: false, error, sentTo, attempts }   // delivery failed but row was updated
 *   401 { ok: false, error: "unauthorized" }
 *   404 { ok: false, error: "submission not found" }
 */

import { NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendOperatorNotification } from "@/lib/firm-onboarding-notification";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
  }

  // Confirm row exists before sending so we can return 404 with a clear
  // error rather than a confusing "row not found" from the helper.
  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from("firm_onboarding_intake")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (lookupErr) {
    return NextResponse.json(
      { ok: false, error: `lookup failed: ${lookupErr.message}` },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json({ ok: false, error: "submission not found" }, { status: 404 });
  }

  const result = await sendOperatorNotification(id, { replay: true });

  // Fetch the updated attempts count so the UI can render it without a
  // follow-up GET.
  const { data: refreshed } = await supabaseAdmin
    .from("firm_onboarding_intake")
    .select("notification_attempts, notification_sent_at, notification_error, notification_last_attempt_at")
    .eq("id", id)
    .maybeSingle();

  if (result.ok) {
    return NextResponse.json({
      ok: true,
      messageId: result.messageId ?? null,
      sentTo: result.sentTo,
      attempts: refreshed?.notification_attempts ?? null,
      notification_sent_at: refreshed?.notification_sent_at ?? null,
      notification_last_attempt_at: refreshed?.notification_last_attempt_at ?? null,
    });
  }

  // Always 200 even on send failure: the operator's action (retry) was
  // accepted, the failure is in the underlying email transport. The body
  // carries the error string so the UI surfaces it.
  return NextResponse.json({
    ok: false,
    error: result.error,
    sentTo: result.sentTo,
    attempts: refreshed?.notification_attempts ?? null,
    notification_error: refreshed?.notification_error ?? result.error,
    notification_last_attempt_at: refreshed?.notification_last_attempt_at ?? null,
  });
}
