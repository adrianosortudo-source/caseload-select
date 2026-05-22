/**
 * POST /api/portal/[firmId]/triage/[leadId]/take
 *
 * Lawyer-initiated Take action. Flips the lead's status from 'triaging' to
 * 'taken', then fires the band-driven cadence webhook to GHL.
 *
 * Auth: portal session must match firmId.
 *
 * Idempotency: if the row is already in 'taken' state, the endpoint returns
 * 200 with the existing state (no second webhook fired). For any other
 * non-triaging state ('passed' / 'declined'), returns 409 — the lawyer
 * cannot take a passed or declined lead.
 *
 * Webhook delivery: at-most-once. If the webhook fails after the DB update
 * succeeded, the row stays 'taken' and the operator surfaces the failure.
 * See docs/ghl-webhook-contract.md for the contract.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { buildTakenPayload, fireGhlWebhook, type LeadFacts } from "@/lib/ghl-webhook";
import { createMatterFromBandATake } from "@/lib/matter-stage";

interface BriefJson {
  matter_snapshot?: string;
  fee_estimate?: string;
}

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
  brief_json: BriefJson | null;
  intake_language: string | null;
}

export async function POST(
  _req: NextRequest,
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

  // Load the lead. 404 covers cross-firm; 409 covers already-non-triaging.
  const { data: existing, error: fetchErr } = await supabase
    .from("screened_leads")
    .select(`
      lead_id, firm_id, status,
      band, matter_type, practice_area, submitted_at,
      contact_name, contact_email, contact_phone,
      brief_json, intake_language
    `)
    .eq("lead_id", leadId)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing || existing.firm_id !== firmId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const lead = existing as LeadRow;

  // Idempotent: if already taken, return the current state without re-firing.
  if (lead.status === "taken") {
    return NextResponse.json({
      ok: true,
      already: true,
      lead_id: lead.lead_id,
      status: lead.status,
    });
  }
  if (lead.status === "passed" || lead.status === "declined") {
    return NextResponse.json(
      {
        error: `Lead is already ${lead.status}; cannot Take.`,
        current_status: lead.status,
      },
      { status: 409 },
    );
  }

  // Update first, fire webhook second. The order matters: if the webhook fails
  // after the DB update, the row is in the correct state and the operator can
  // re-fire. The reverse would leave the cadence engaged for a row still
  // showing as triaging.
  const now = new Date();
  // APP-006 (Jim Manico audit): persist the lawyer_id from the session
  // token (or "operator" for operator-actor calls) so the audit trail
  // is identity-bound, not just role-bound. Falls back to "lawyer"
  // string when an old token without lawyer_id is presented (no
  // session migration needed; lawyer_id was added later).
  const actorId: string =
    session.role === "operator"
      ? "operator"
      : (session.lawyer_id ?? "lawyer");
  const { error: updateErr } = await supabase
    .from("screened_leads")
    .update({
      status: "taken",
      status_changed_at: now.toISOString(),
      status_changed_by: actorId,
      status_changed_by_role: actor,
    })
    .eq("lead_id", leadId)
    .eq("firm_id", firmId)
    .eq("status", "triaging"); // guard against race with another tab

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
  const payload = buildTakenPayload({
    facts,
    statusChangedAt: now,
    statusChangedBy: actor,
    feeEstimate: lead.brief_json?.fee_estimate ?? null,
    matterSnapshot: lead.brief_json?.matter_snapshot ?? null,
  });
  const delivery = await fireGhlWebhook(firmId, payload);

  // S8 Phase 1 Story 3: on Band A take, create a client_matters row
  // at matter_stage='intake' so the matter is queryable in the
  // lawyer's active-clients home + the client surface. Best-effort:
  // the matter creation is logged on failure but does not roll back
  // the take. The screened_lead row remains in 'taken' state with the
  // webhook fired; the operator can re-trigger matter creation via
  // a backfill endpoint if needed.
  //
  // Only Band A takes create a matter. Band B/C are pipeline-managed
  // via the legacy `leads` table; Band D is OOS / refer-eligible (no
  // matter expected).
  let matterId: string | null = null;
  if (lead.band === 'A') {
    // Read the actual screened_leads row id (UUID) for the FK to
    // source_screened_lead_id. The lead_id column is the human-
    // readable string id (e.g. L-2026-05-22-SX4), not the UUID PK.
    const { data: leadRow } = await supabase
      .from('screened_leads')
      .select('id')
      .eq('lead_id', leadId)
      .eq('firm_id', firmId)
      .maybeSingle();
    if (leadRow?.id && lead.contact_name && (lead.contact_email || lead.contact_phone)) {
      const matterResult = await createMatterFromBandATake({
        firm_id: firmId,
        source_screened_lead_id: leadRow.id,
        matter_type: lead.matter_type,
        practice_area: lead.practice_area,
        primary_name: lead.contact_name,
        primary_email: lead.contact_email,
        primary_phone: lead.contact_phone,
      });
      if (matterResult.ok) {
        matterId = matterResult.matter.id;
      } else {
        console.warn('[take] Band A matter creation failed:', matterResult.error);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    lead_id: leadId,
    status: "taken",
    webhook: delivery,
    matter_id: matterId,
  });
}
