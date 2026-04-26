/**
 * matter-routing.ts
 *
 * Looks up the per-firm sub-type routing config from the matter_routing table.
 * Called during finalize to override the default band→stage GHL pipeline mapping.
 *
 * Returns null if no row exists for (firmId, subType)  -  callers fall back to
 * the standard band-based assignment.
 */

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export interface MatterRouting {
  ghl_pipeline_id: string | null;
  ghl_stage: string | null;
  assigned_staff_id: string | null;
  assigned_staff_email: string | null;
}

/**
 * Fetch the matter routing config for a firm + sub-type pair.
 * Returns null when no row is configured (caller uses default routing).
 */
export async function getMatterRouting(
  firmId: string,
  subType: string | null,
): Promise<MatterRouting | null> {
  if (!firmId || !subType) return null;

  const { data, error } = await supabase
    .from("matter_routing")
    .select("ghl_pipeline_id, ghl_stage, assigned_staff_id, assigned_staff_email")
    .eq("firm_id", firmId)
    .eq("sub_type", subType)
    .maybeSingle();

  if (error) {
    console.error("[matter-routing] Lookup error:", error.message);
    return null;
  }

  return data ?? null;
}
