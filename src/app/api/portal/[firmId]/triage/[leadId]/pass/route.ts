/**
 * POST /api/portal/[firmId]/triage/[leadId]/pass
 *
 * Lawyer-initiated Pass action. Flips the lead's status from 'triaging' to
 * 'passed', stores the optional custom decline note on status_note, resolves
 * the decline copy via the three-layer model, then fires the decline-with-
 * grace webhook to GHL.
 *
 * Body: { note?: string }
 *   - note empty / absent → resolver falls through to per-PA / firm default / system
 *   - note non-empty → resolver returns the note as the decline body, marked
 *     as source: per_lead_override
 *
 * Auth: portal session must match firmId.
 *
 * Idempotency: same model as Take. Already-passed returns 200 with the
 * existing state, no re-fire. Other non-triaging states return 409.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import {
  loadDeclineCandidates,
  resolveDecline,
} from "@/lib/decline-resolver";
import { buildPassedPayload, fireGhlWebhook, type LeadFacts } from "@/lib/ghl-webhook";

interface LeadRow {
  lead_id: string;
  firm_id: string;
  status: "triaging" | "taken" | "passed" | "declined";
  band: "A" | "B" | "C" | null;
  matter_type: string;
  practice_area: string;
  submitted_at: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}

const MAX_NOTE_LEN = 4000;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; leadId: string }> }
) {
  const { firmId, leadId } = await params;
  const session = await getPortalSession();
  if (!session || session.firm_id !== firmId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { note?: string };
  try {
    body = (await req.json()) as { note?: string };
  } catch {
    body = {};
  }
  const rawNote = (body.note ?? "").slice(0, MAX_NOTE_LEN).trim();
  const note = rawNote.length > 0 ? rawNote : null;

  // Load the lead.
  const { data: existing, error: fetchErr } = await supabase
    .from("screened_leads")
    .select(`
      lead_id, firm_id, status,
      band, matter_type, practice_area, submitted_at,
      contact_name, contact_email, contact_phone
    `)
    .eq("lead_id", leadId)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing || existing.firm_id !== firmId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const lead = existing as LeadRow;

  if (lead.status === "passed") {
    return NextResponse.json({
      ok: true,
      already: true,
      lead_id: lead.lead_id,
      status: lead.status,
    });
  }
  if (lead.status === "taken" || lead.status === "declined") {
    return NextResponse.json(
      {
        error: `Lead is already ${lead.status}; cannot Pass.`,
        current_status: lead.status,
      },
      { status: 409 },
    );
  }

  // Update first.
  const now = new Date();
  const { error: updateErr } = await supabase
    .from("screened_leads")
    .update({
      status: "passed",
      status_changed_at: now.toISOString(),
      status_changed_by: "lawyer",
      status_note: note, // null when not provided; lookup honours empty as no override
    })
    .eq("lead_id", leadId)
    .eq("firm_id", firmId)
    .eq("status", "triaging");

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Resolve decline copy (per-lead override > per-PA > firm default > system fallback).
  const candidates = await loadDeclineCandidates({
    firmId,
    practiceArea: lead.practice_area,
    perLeadOverride: note,
  });
  const verdict = resolveDecline(candidates, "lawyer_pass");

  // Build and fire webhook.
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
  };
  const payload = buildPassedPayload({
    facts,
    statusChangedAt: now,
    statusChangedBy: "lawyer",
    declineSubject: verdict.subject,
    declineBody: verdict.body,
    declineSource: verdict.source,
    lawyerNotePresent: !!note,
  });
  const delivery = await fireGhlWebhook(firmId, payload);

  return NextResponse.json({
    ok: true,
    lead_id: leadId,
    status: "passed",
    decline_source: verdict.source,
    webhook: delivery,
  });
}
