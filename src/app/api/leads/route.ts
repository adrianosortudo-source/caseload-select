import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { computeScore } from "@/lib/scoring";
import { intentToState } from "@/lib/state";
import { sendEmail } from "@/lib/email";

export async function POST(req: Request) {
  const body = await req.json();

  const s = computeScore({
    email:           body.email ?? null,
    phone:           body.phone ?? null,
    location:        body.location ?? body.city ?? null,
    description:     body.description ?? null,
    timeline:        body.timeline ?? null,
    case_type:       body.case_type ?? null,
    estimated_value: Number(body.estimated_value) || 0,
    urgency:         body.urgency ?? null,
    source:          body.source ?? null,
    referral:        body.referral === true || body.referral === "true",
    multi_practice:  body.multi_practice === true || body.multi_practice === "true",
  });

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      // Core fields
      name:            body.name,
      email:           body.email || null,
      phone:           body.phone || null,
      case_type:       body.case_type || null,
      estimated_value: Number(body.estimated_value) || 0,
      language:        body.language || "EN",
      description:     body.description || null,
      law_firm_id:     body.law_firm_id || null,
      stage:           "new_lead",
      lead_state:      intentToState(body.intent),

      // Intake fields
      referral_source: body.referral_source || null,
      urgency:         body.urgency || null,
      timeline:        body.timeline || null,
      city:            body.location ?? body.city ?? null,
      location:        body.location ?? body.city ?? null,
      source:          body.source || null,
      referral:        body.referral === true || body.referral === "true",
      multi_practice:  body.multi_practice === true || body.multi_practice === "true",

      // Priority scoring
      fit_score:            s.fit_score,
      value_score:          s.value_score,
      geo_score:            s.geo_score,
      contactability_score: s.contactability_score,
      legitimacy_score:     s.legitimacy_score,
      complexity_score:     s.complexity_score,
      urgency_score:        s.urgency_score,
      strategic_score:      s.strategic_score,
      fee_score:            s.fee_score,
      priority_index:       s.priority_index,
      priority_band:        s.priority_band,

      // Legacy CPI (backward compat — store same composite for now)
      score:     s.priority_index,
      cpi_score: s.priority_index,
      band:      s.priority_band,
    })
    .select()
    .single();

  if (error || !lead) {
    return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 400 });
  }

  // Log initial state
  await supabase.from("state_history").insert({
    lead_id:   lead.id,
    old_state: null,
    new_state: lead.lead_state,
  });

  // WF-05 — 3-step email sequence
  const now = Date.now();
  await supabase.from("email_sequences").insert([
    { lead_id: lead.id, status: "scheduled", step_number: 1, scheduled_at: new Date(now).toISOString() },
    { lead_id: lead.id, status: "scheduled", step_number: 2, scheduled_at: new Date(now + 24 * 3600 * 1000).toISOString() },
    { lead_id: lead.id, status: "scheduled", step_number: 3, scheduled_at: new Date(now + 72 * 3600 * 1000).toISOString() },
  ]);

  if (lead.email) {
    try {
      const result = await sendEmail(
        lead.email,
        "Thanks for reaching out to CaseLoad Select",
        `<p>Hi ${lead.name},</p><p>Thanks for submitting your case. Our team will review it shortly.</p>`
      );
      if (!result.skipped) {
        await supabase
          .from("email_sequences")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("lead_id", lead.id)
          .eq("step_number", 1);
      }
    } catch (e) {
      console.error("sendEmail step 1", e);
    }
  }

  return NextResponse.json({ lead, score: s });
}
