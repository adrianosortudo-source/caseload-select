import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { triggerSequence } from "@/lib/sequence-engine";
import { createClioMatter } from "@/lib/clio-conversion";
import { isConflictClear, registerWonClient } from "@/lib/conflict-check";
import { cancelSequenceByTrigger } from "@/lib/send-sequences";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { stage } = await req.json();

  // ── Conflict gate ───────────────────────────────────────────────────────────
  // Block consultation_scheduled if conflict check has not passed.
  if (stage === "consultation_scheduled") {
    const gate = await isConflictClear(id);
    if (!gate.allowed) {
      return NextResponse.json(
        { error: "conflict_gate", message: gate.reason },
        { status: 422 }
      );
    }
  }

  const now = new Date().toISOString();
  const stageUpdate: Record<string, unknown> = {
    stage,
    updated_at: now,
    stage_changed_at: now,
  };

  // Populate first_contact_at once — only when transitioning new_lead → contacted
  if (stage === "contacted") {
    const { data: existing } = await supabase
      .from("leads")
      .select("stage, first_contact_at")
      .eq("id", id)
      .single();
    if (existing?.stage === "new_lead" && !existing?.first_contact_at) {
      stageUpdate.first_contact_at = now;
    }
  }

  const { data: lead, error } = await supabase
    .from("leads")
    .update(stageUpdate)
    .eq("id", id)
    .select()
    .single();

  if (error || !lead) {
    return NextResponse.json({ error: error?.message ?? "update failed" }, { status: 400 });
  }

  // J9 + WF-06 — on client_won: create review_request tracking row, trigger 3-touch sequence
  if (stage === "client_won") {
    // Idempotency guard — never double-trigger
    const { data: existing } = await supabase
      .from("review_requests")
      .select("id")
      .eq("lead_id", id)
      .maybeSingle();

    if (!existing) {
      const { data: reviewRow } = await supabase
        .from("review_requests")
        .insert({
          lead_id: id,
          law_firm_id: lead.law_firm_id,
          status: "pending",
        })
        .select()
        .single();

      // J7 — welcome/onboarding sequence (4 touches over 7 days)
      triggerSequence(lead.id, "client_won").catch((e) =>
        console.error("J7 trigger failed:", e)
      );

      // J9 — trigger 3-touch review request sequence (send-sequences processes it)
      triggerSequence(lead.id, "review_request").catch((e) =>
        console.error("J9 trigger failed:", e)
      );

      // J8 — trigger active matter check-ins (2wk, 4wk, 8wk)
      triggerSequence(lead.id, "matter_active").catch((e) =>
        console.error("J8 trigger failed:", e)
      );

      // J11 — relationship milestone touchpoints (6mo, 12mo)
      triggerSequence(lead.id, "relationship_milestone").catch((e) =>
        console.error("J11 trigger failed:", e)
      );

      // J12 — long-term nurture (18mo, 24mo)
      triggerSequence(lead.id, "long_term_nurture").catch((e) =>
        console.error("J12 trigger failed:", e)
      );

      // Clio matter creation — non-fatal, runs in background
      createClioMatter({
        id: lead.id,
        name: lead.name,
        email: lead.email ?? null,
        phone: lead.phone ?? null,
        case_type: lead.case_type ?? null,
        description: lead.description ?? null,
        law_firm_id: lead.law_firm_id ?? null,
      }).catch((e) => console.error("Clio matter creation failed:", e));

      // Add to conflict register so future intake submissions check against this client
      registerWonClient({
        name: lead.name,
        email: lead.email ?? null,
        phone: lead.phone ?? null,
        case_type: lead.case_type ?? null,
        law_firm_id: lead.law_firm_id ?? null,
      }).catch((e) => console.error("Conflict register update failed:", e));

      return NextResponse.json({ lead, review_request: reviewRow ?? null });
    }
  }

  // J2 — consultation_scheduled: trigger 3-touch reminder sequence
  if (stage === "consultation_scheduled") {
    triggerSequence(lead.id, "consultation_scheduled").catch((e) =>
      console.error("J2 trigger failed:", e)
    );
  }

  // J2 exit — cancel pending consultation reminders when lead leaves consultation stage
  if (
    ["no_show", "client_won", "client_lost", "consultation_held"].includes(stage)
  ) {
    cancelSequenceByTrigger(lead.id, "consultation_scheduled").catch((e) =>
      console.error("J2 cancel failed:", e)
    );
  }

  // J6 — retainer_awaiting: proposal sent, follow up until signed
  if (stage === "proposal_sent") {
    triggerSequence(lead.id, "retainer_awaiting").catch((e) =>
      console.error("J6 trigger failed:", e)
    );
  }

  // J6 exit — cancel pending retainer follow-ups when retainer is signed or lost
  if (["client_won", "client_lost"].includes(stage)) {
    cancelSequenceByTrigger(lead.id, "retainer_awaiting").catch((e) =>
      console.error("J6 cancel failed:", e)
    );
  }

  // J10 — re-engagement: lost lead, reconnect at 90d + 180d
  if (stage === "client_lost") {
    triggerSequence(lead.id, "re_engagement").catch((e) =>
      console.error("J10 trigger failed:", e)
    );
  }

  return NextResponse.json({ lead });
}
