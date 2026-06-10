/**
 * POST /api/admin/screened-leads/[id]/retry-notification
 *
 * Operator-only. Re-sends the new-lead lawyer notification email for an
 * existing screened_leads row (DR-046 invariant 3, launch audit fix H4).
 * Used when the original notification failed (Resend errored, recipient
 * inbox was down, RESEND_API_KEY was unset at the time, etc.) and the
 * operator needs the lawyer to see the lead inside its decision window.
 *
 * The retry rebuilds the email from the stored row through the same
 * builder the intake paths use (notifyLawyersOfNewLead), so the lawyer
 * gets an equivalent email to what would have arrived at intake. A
 * "[REPLAY]" prefix on the subject makes the re-send obvious at a glance.
 *
 * The helper persists the delivery outcome on the row
 * (notification_sent_at / notification_error / notification_attempts /
 * notification_last_attempt_at) so the /admin/triage chip reflects the
 * new state immediately.
 *
 * Auth: requireOperator() (same gate as the rest of /api/admin/*).
 *
 * Returns:
 *   200 { ok: true,  result, ...notification state }
 *   200 { ok: false, error, result, ...notification state }  delivery failed, row updated
 *   401 { error: "Unauthorized" }
 *   404 { ok: false, error: "lead not found" }
 */

import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { notifyLawyersOfNewLead } from "@/lib/lead-notify";

export const dynamic = "force-dynamic";

interface LeadRow {
  lead_id: string;
  firm_id: string;
  status: string;
  band: "A" | "B" | "C" | "D" | null;
  matter_type: string;
  practice_area: string;
  contact_name: string | null;
  decision_deadline: string;
  whale_nurture: boolean;
  intake_language: string | null;
  slot_answers: { channel?: string } | null;
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
  }

  const { data: row, error: lookupErr } = await supabaseAdmin
    .from("screened_leads")
    .select(
      "lead_id, firm_id, status, band, matter_type, practice_area, contact_name, decision_deadline, whale_nurture, intake_language, slot_answers",
    )
    .eq("lead_id", id)
    .maybeSingle()
    .returns<LeadRow>();
  if (lookupErr) {
    return NextResponse.json(
      { ok: false, error: `lookup failed: ${lookupErr.message}` },
      { status: 500 },
    );
  }
  if (!row) {
    return NextResponse.json({ ok: false, error: "lead not found" }, { status: 404 });
  }

  const result = await notifyLawyersOfNewLead({
    firmId: row.firm_id,
    leadId: row.lead_id,
    contactName: row.contact_name,
    matterType: row.matter_type,
    practiceArea: row.practice_area,
    band: row.band,
    decisionDeadlineIso: row.decision_deadline,
    whaleNurture: row.whale_nurture,
    intakeLanguage: row.intake_language,
    channel: row.slot_answers?.channel ?? null,
    // 'declined' keeps the auto-filtered treatment on replay; every other
    // lifecycle state replays with the standard triaging treatment.
    lifecycleStatus: row.status === "declined" ? "declined" : "triaging",
    replay: true,
  });

  // Fetch the updated notification state so the UI can render it without a
  // follow-up GET.
  const { data: refreshed } = await supabaseAdmin
    .from("screened_leads")
    .select(
      "notification_sent_at, notification_error, notification_attempts, notification_last_attempt_at",
    )
    .eq("lead_id", id)
    .maybeSingle();

  const ok = result.sent > 0;

  // Always 200 once past auth + lookup: the operator's action (retry) was
  // accepted; a failure is in the underlying email transport and the body
  // carries the error string so the UI surfaces it.
  return NextResponse.json({
    ok,
    ...(ok ? {} : { error: result.errors.join("; ") || "no recipients delivered" }),
    result,
    notification_sent_at: refreshed?.notification_sent_at ?? null,
    notification_error: refreshed?.notification_error ?? null,
    notification_attempts: refreshed?.notification_attempts ?? null,
    notification_last_attempt_at: refreshed?.notification_last_attempt_at ?? null,
  });
}
