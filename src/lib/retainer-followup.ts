/**
 * J6 — Retainer Awaiting Signature
 *
 * Fires when a lead moves to "proposal_sent" (retainer sent, awaiting signature).
 * Follows up until the lead converts to client_won or client_lost, or the
 * sequence exhausts.
 *
 * Sequence template trigger_event: "retainer_awaiting"
 * Recommended sequence: 4 touches over 10 days
 *   Step 1 (2h)   — "Your retainer agreement" — confirm they received it
 *   Step 2 (24h)  — "Any questions about the agreement?" — remove friction
 *   Step 3 (72h)  — "Following up" — gentle nudge with deadline framing
 *   Step 4 (168h) — "Last reminder" — final touch before file goes cold
 *
 * Exits: stage moves to client_won or client_lost.
 * Idempotency: skips leads that already have retainer_awaiting steps scheduled.
 *
 * Note: This engine runs daily. The stage route also triggers immediately
 * on proposal_sent → no delay before the first touch.
 */

import { supabase } from "./supabase";
import { triggerSequence } from "./sequence-engine";

interface RetainerLead {
  id: string;
  stage: string;
  updated_at: string;
}

export interface RetainerFollowupResult {
  triggered: number;
  exited: number;
  skipped: number;
  errors: string[];
}

export async function runRetainerFollowup(): Promise<RetainerFollowupResult> {
  const result: RetainerFollowupResult = { triggered: 0, exited: 0, skipped: 0, errors: [] };

  // Fetch template
  const { data: template } = await supabase
    .from("sequence_templates")
    .select("id")
    .eq("trigger_event", "retainer_awaiting")
    .eq("is_active", true)
    .maybeSingle();

  const stepIds: string[] = [];
  if (template) {
    const { data: steps } = await supabase
      .from("sequence_steps")
      .select("id")
      .eq("sequence_id", template.id);
    steps?.forEach((s) => stepIds.push(s.id));
  }

  // Cancel scheduled retainer steps for leads who have already converted/lost
  if (stepIds.length > 0) {
    const { data: converted } = await supabase
      .from("leads")
      .select("id")
      .in("stage", ["client_won", "client_lost"]);

    if (converted?.length) {
      const convertedIds = converted.map((l) => l.id);
      const { count } = await supabase
        .from("email_sequences")
        .update({ status: "skipped" })
        .in("lead_id", convertedIds)
        .in("sequence_step_id", stepIds)
        .eq("status", "scheduled");
      result.exited = count ?? 0;
    }
  }

  // Find leads newly in proposal_sent (entered within the last 2h to avoid re-triggering daily)
  const window = new Date(Date.now() - 2 * 3_600_000).toISOString();

  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, stage, updated_at")
    .eq("stage", "proposal_sent")
    .gte("updated_at", window);

  if (error) {
    result.errors.push(error.message);
    return result;
  }

  for (const lead of (leads ?? []) as RetainerLead[]) {
    try {
      if (stepIds.length > 0) {
        const { count } = await supabase
          .from("email_sequences")
          .select("id", { count: "exact", head: true })
          .eq("lead_id", lead.id)
          .in("sequence_step_id", stepIds);
        if ((count ?? 0) > 0) {
          result.skipped++;
          continue;
        }
      }

      const r = await triggerSequence(lead.id, "retainer_awaiting");
      if (r.skipped) {
        result.skipped++;
      } else {
        result.triggered++;
      }
    } catch (e) {
      result.errors.push(`Lead ${lead.id}: ${(e as Error).message}`);
    }
  }

  return result;
}
