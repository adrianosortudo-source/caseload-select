/**
 * J5A — Recovery A: Spoke, No Book
 *
 * Fires when a lead has been in the "contacted" stage for 2+ days without
 * moving to qualified or consultation_scheduled. Represents a lead the firm
 * spoke with but who didn't book a consultation.
 *
 * Sequence template trigger_event: "spoke_no_book"
 * Recommended sequence: 4 touches over 14 days
 *   Step 1 (0h)   — "Still thinking it over?" — recap value, low pressure
 *   Step 2 (48h)  — "Quick question" — address common objection
 *   Step 3 (120h) — "One more thought" — urgency/limitations flag
 *   Step 4 (240h) — "Leaving the door open" — final touch, no hard sell
 *
 * Exits: stage moves away from contacted (any direction).
 * Idempotency: skips leads that already have spoke_no_book steps scheduled.
 */

import { supabase } from "./supabase";
import { triggerSequence } from "./sequence-engine";

interface RecoveryALead {
  id: string;
  stage: string;
  updated_at: string;
}

export interface RecoveryAResult {
  triggered: number;
  skipped: number;
  errors: string[];
}

const TRIGGER_AFTER_HOURS = 48; // 2 days in contacted stage

export async function runRecoveryA(): Promise<RecoveryAResult> {
  const result: RecoveryAResult = { triggered: 0, skipped: 0, errors: [] };

  const cutoff = new Date(Date.now() - TRIGGER_AFTER_HOURS * 3_600_000).toISOString();

  // Leads stuck in "contacted" for 2+ days
  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, stage, updated_at")
    .eq("stage", "contacted")
    .lt("updated_at", cutoff);

  if (error || !leads?.length) {
    if (error) result.errors.push(error.message);
    return result;
  }

  // Fetch the spoke_no_book template ID for idempotency check
  const { data: template } = await supabase
    .from("sequence_templates")
    .select("id")
    .eq("trigger_event", "spoke_no_book")
    .eq("is_active", true)
    .maybeSingle();

  // Get step IDs for this template (needed for idempotency lookup)
  const stepIds: string[] = [];
  if (template) {
    const { data: steps } = await supabase
      .from("sequence_steps")
      .select("id")
      .eq("sequence_id", template.id);
    steps?.forEach((s) => stepIds.push(s.id));
  }

  for (const lead of leads as RecoveryALead[]) {
    try {
      // Idempotency: skip if J5A already scheduled
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

      const r = await triggerSequence(lead.id, "spoke_no_book");
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
