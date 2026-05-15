/**
 * POST /api/portal/[firmId]/triage/[leadId]/refer
 *
 * Lawyer-initiated Refer action (Band D primary affordance). Flips the
 * lead's status from 'triaging' to 'referred', stores the optional
 * referredTo + note on the row, then fires the `referred` GHL webhook.
 *
 * Body: { referredTo?: string, note?: string }
 *   - Both optional. The lawyer may want to mark a lead as referred
 *     without naming the recipient (e.g. when they have not decided yet
 *     who they'll pass it to). Note is an optional internal annotation.
 *
 * Auth: same model as the take / pass routes — portal session must match
 * the firmId path param, or operator session.
 *
 * Idempotency: already-referred returns 200 with the existing state;
 * other non-triaging states return 409. Matches the take / pass shape.
 *
 * No decline copy resolution. Refer doesn't fire decline-with-grace —
 * the firm's GHL workflow decides what cadence (if any) to run for a
 * referred lead. Common downstream patterns: a "we've referred you to
 * X" note to the contact, or nothing (relationship-only).
 */

import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { buildReferredPayload, fireGhlWebhook, type LeadFacts } from "@/lib/ghl-webhook";

interface LeadRow {
  lead_id: string;
  firm_id: string;
  status: "triaging" | "taken" | "passed" | "declined" | "referred";
  band: "A" | "B" | "C" | "D" | null;
  matter_type: string;
  practice_area: string;
  submitted_at: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  intake_language: string | null;
}

const MAX_FIELD_LEN = 4000;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; leadId: string }> }
) {
  const { firmId, leadId } = await params;
  const session = await getPortalSession();
  // Operators can act on any firm; lawyers only on their own.
  const isAuthorized = !!session && (session.role === "operator" || session.firm_id === firmId);
  if (!session || !isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const actor = session.role === "operator" ? "operator" : "lawyer";

  let body: { referredTo?: string; note?: string };
  try {
    body = (await req.json()) as { referredTo?: string; note?: string };
  } catch {
    body = {};
  }
  const rawReferredTo = (body.referredTo ?? "").slice(0, MAX_FIELD_LEN).trim();
  const rawNote = (body.note ?? "").slice(0, MAX_FIELD_LEN).trim();
  const referredTo = rawReferredTo.length > 0 ? rawReferredTo : null;
  const note = rawNote.length > 0 ? rawNote : null;

  // Load the lead.
  const { data: existing, error: fetchErr } = await supabase
    .from("screened_leads")
    .select(`
      lead_id, firm_id, status,
      band, matter_type, practice_area, submitted_at,
      contact_name, contact_email, contact_phone,
      intake_language
    `)
    .eq("lead_id", leadId)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing || existing.firm_id !== firmId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const lead = existing as LeadRow;

  // Idempotent: already-referred returns 200 with current state.
  if (lead.status === "referred") {
    return NextResponse.json({
      ok: true,
      already: true,
      lead_id: lead.lead_id,
      status: lead.status,
    });
  }
  if (lead.status === "taken" || lead.status === "passed" || lead.status === "declined") {
    return NextResponse.json(
      {
        error: `Lead is already ${lead.status}; cannot Refer.`,
        current_status: lead.status,
      },
      { status: 409 },
    );
  }

  // Update first, fire webhook second. The conditional WHERE status='triaging'
  // guard makes the update a no-op if a concurrent Take/Pass landed first.
  const now = new Date();
  const actorId: string =
    session.role === "operator"
      ? "operator"
      : (session.lawyer_id ?? "lawyer");
  const { error: updateErr } = await supabase
    .from("screened_leads")
    .update({
      status: "referred",
      status_changed_at: now.toISOString(),
      status_changed_by: actorId,
      status_changed_by_role: actor,
      // Persist the lawyer's note (not the referredTo). The note is the
      // free-text rationale; referredTo lives in the webhook payload only.
      status_note: note,
    })
    .eq("lead_id", leadId)
    .eq("firm_id", firmId)
    .eq("status", "triaging");

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Build and fire the webhook.
  const facts: LeadFacts = {
    lead_id: lead.lead_id,
    firm_id: lead.firm_id,
    band: lead.band,
    matter_type: lead.matter_type,
    practice_area: lead.practice_area,
    submitted_at: lead.submitted_at,
    contact_name: lead.contact_name,
    contact_email: lead.contact_email,
    contact_phone: lead.contact_phone,
    intake_language: lead.intake_language,
  };
  const payload = buildReferredPayload({
    facts,
    statusChangedAt: now,
    statusChangedBy: actor,
    referredTo,
    note,
  });
  const delivery = await fireGhlWebhook(firmId, payload);

  return NextResponse.json({
    ok: true,
    lead_id: leadId,
    status: "referred",
    referred_to: referredTo,
    webhook: delivery,
  });
}
