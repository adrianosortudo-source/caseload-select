import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { computeScore } from "@/lib/scoring";
import { intentToState } from "@/lib/state";
import { sendEmail } from "@/lib/email";
import { triggerSequence } from "@/lib/sequence-engine";

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
    value_tier:            null,
    complexity_indicators: null,
    prior_experience:      null,
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

      // Legacy CPI (backward compat  -  store same composite for now)
      score:     s.priority_index,
      cpi_score: s.priority_index,
      band:      s.priority_band,

      // Explainability (v2.2)  -  confidence, 1-3 sentence rationale, and
      // human-readable missing-field labels. Read by the admin lead detail
      // pill, the portal pre-call checklist, and the incomplete-intake cron
      // (which nudges B/C leads whose confidence came back low).
      cpi_confidence:     s.confidence,
      cpi_explanation:    s.explanation,
      cpi_missing_fields: s.missing_fields,

      // Source-aware scoring snapshot. Tells downstream consumers (the
      // rationale helper in src/lib/score-components.ts, analytics) that
      // this row was scored by the v2.1 form engine (fit max 30, value max
      // 65, 7 factors) and gives them the full native breakdown in one place.
      // GPT-screen rows carry scoring_model='gpt_cpi_v1' with a different shape.
      scoring_model: "v2.1_form",
      score_components: {
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
      },
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

  // WF-05  -  trigger Welcome Sequence from sequence builder
  const seqResult = await triggerSequence(lead.id, "new_lead");

  // Fire step 1 immediately if it was scheduled at delay 0
  if (!seqResult.skipped && lead.email && seqResult.steps_scheduled > 0) {
    try {
      // Find the step-1 row and send it
      const { data: step1 } = await supabase
        .from("email_sequences")
        .select("id, sequence_step_id")
        .eq("lead_id", lead.id)
        .eq("step_number", 1)
        .maybeSingle();

      if (step1?.sequence_step_id) {
        const { data: tmpl } = await supabase
          .from("sequence_steps")
          .select("subject, body")
          .eq("id", step1.sequence_step_id)
          .maybeSingle();

        if (tmpl) {
          const subject = tmpl.subject.replace(/\{name\}/g, lead.name).replace(/\{case_type\}/g, lead.case_type ?? "legal");
          const html = tmpl.body.replace(/\{name\}/g, lead.name).replace(/\{case_type\}/g, lead.case_type ?? "legal").replace(/\n/g, "<br>");
          const result = await sendEmail(lead.email, subject, `<p>${html}</p>`);
          if (!result.skipped) {
            await supabase
              .from("email_sequences")
              .update({ status: "sent", sent_at: new Date().toISOString() })
              .eq("id", step1.id);
          }
        }
      }
    } catch (e) {
      console.error("sendEmail step 1", e);
    }
  }

  return NextResponse.json({ lead, score: s, sequence: seqResult });
}
