import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { computeCpi } from "@/lib/cpi";
import { intentToState } from "@/lib/state";
import { sendEmail } from "@/lib/email";

export async function POST(req: Request) {
  const body = await req.json();

  const cpi = computeCpi({
    city: body.city ?? null,
    email: body.email ?? null,
    phone: body.phone ?? null,
    description: body.description ?? null,
    timeline: body.timeline ?? null,
    referral_source: body.referral_source ?? null,
    case_type: body.case_type ?? null,
    estimated_value: Number(body.estimated_value) || 0,
    urgency: body.urgency ?? null,
  });

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      name: body.name,
      email: body.email || null,
      phone: body.phone || null,
      case_type: body.case_type,
      estimated_value: body.estimated_value || 0,
      language: body.language || "EN",
      description: body.description || null,
      law_firm_id: body.law_firm_id || null,
      stage: "new_lead",
      score: cpi.cpi_score,
      fit_score: cpi.fit_score,
      value_score: cpi.value_score,
      cpi_score: cpi.cpi_score,
      band: cpi.band,
      referral_source: body.referral_source || null,
      urgency: body.urgency || null,
      timeline: body.timeline || null,
      city: body.city || null,
      lead_state: intentToState(body.intent),
    })
    .select()
    .single();

  if (error || !lead) {
    return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 400 });
  }

  // Log initial state
  await supabase.from("state_history").insert({
    lead_id: lead.id,
    old_state: null,
    new_state: lead.lead_state,
  });

  const now = Date.now();
  const steps = [
    { step_number: 1, scheduled_at: new Date(now).toISOString() },
    { step_number: 2, scheduled_at: new Date(now + 24 * 3600 * 1000).toISOString() },
    { step_number: 3, scheduled_at: new Date(now + 72 * 3600 * 1000).toISOString() },
  ];
  await supabase
    .from("email_sequences")
    .insert(steps.map((s) => ({ lead_id: lead.id, status: "scheduled", ...s })));

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

  return NextResponse.json({ lead, cpi });
}
