/**
 * J5B  -  Recovery B: Consulted, No Sign
 *
 * Fires when a lead has been in "consultation_held" for 3+ days without
 * moving to proposal_sent or client_won. Represents a lead who had the
 * consultation but hasn't retained.
 *
 * Sequence template trigger_event: "consulted_no_sign"
 * Recommended sequence: 5 touches over 21 days
 *   Step 1 (0h)    -  "Following up on your consultation"  -  recap key points
 *   Step 2 (48h)   -  "One thing I forgot to mention"  -  add value
 *   Step 3 (120h)  -  "Your situation + timeline"  -  limitations urgency
 *   Step 4 (216h)  -  "Decision point"  -  direct ask
 *   Step 5 (360h)  -  "Whenever you're ready"  -  low-pressure final touch
 *
 * Exits: stage moves away from consultation_held.
 * Idempotency: skips leads that already have consulted_no_sign steps scheduled.
 */

import { supabaseAdmin as supabase } from "./supabase-admin";
import { triggerSequence } from "./sequence-engine";

interface RecoveryBLead {
  id: string;
  stage: string;
  updated_at: string;
}

export interface RecoveryBResult {
  triggered: number;
  skipped: number;
  errors: string[];
}

const TRIGGER_AFTER_HOURS = 72; // 3 days in consultation_held stage

export async function runRecoveryB(): Promise<RecoveryBResult> {
  const result: RecoveryBResult = { triggered: 0, skipped: 0, errors: [] };

  const cutoff = new Date(Date.now() - TRIGGER_AFTER_HOURS * 3_600_000).toISOString();

  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, stage, updated_at")
    .eq("stage", "consultation_held")
    .lt("updated_at", cutoff);

  if (error || !leads?.length) {
    if (error) result.errors.push(error.message);
    return result;
  }

  // Fetch template for idempotency check
  const { data: template } = await supabase
    .from("sequence_templates")
    .select("id")
    .eq("trigger_event", "consulted_no_sign")
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

  for (const lead of leads as RecoveryBLead[]) {
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

      const r = await triggerSequence(lead.id, "consulted_no_sign");
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
