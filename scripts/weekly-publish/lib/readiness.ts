/**
 * Phase 2.2 (Appendix B): activate period readiness. Ported from
 * ToDelete/kit-activate-readiness.mjs (Standing Rule 4): mirrors
 * activatePeriodReadiness()'s exact content_periods update. This is the
 * plan's ONE sanctioned UPDATE (Standing Rule 1's named exception) --
 * everything else this tool writes is INSERT-only.
 *
 * Already idempotent in the source script (already-enforced guard); ported
 * as-is.
 *
 * Preconditions this module does NOT (re-)verify -- the one-off run already
 * confirmed them against publication-requirements.ts's real per-role
 * profiles for W32 (role_and_locale_known, publication_destination_set on
 * the 4 articles, landing_page_placement on the 2 lead_magnet_pdf rows) --
 * are the DB trigger's own job (trg_validate_readiness_activation per
 * FOLLOWUPS 2026-08-07), which rejects the update outright if they don't
 * hold. A future week that fails preflight fails here with the trigger's
 * own error, not a silently-passed activation.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WeekConfig } from "../config";

export interface ActivateReadinessResult {
  status: "activated" | "skipped";
  readinessLifecycle: string;
  enforcedAt: string | null;
}

export async function activateReadiness(
  supabase: SupabaseClient,
  weekConfig: WeekConfig,
): Promise<ActivateReadinessResult> {
  const { data: period, error: readErr } = await supabase
    .from("content_periods")
    .select("readiness_lifecycle, readiness_enforced_at")
    .eq("id", weekConfig.periodId)
    .eq("firm_id", weekConfig.firmId)
    .maybeSingle();
  if (readErr || !period) throw new Error(`period read failed: ${readErr?.message ?? "not found"}`);
  if (period.readiness_lifecycle === "enforced") {
    return { status: "skipped", readinessLifecycle: "enforced", enforcedAt: period.readiness_enforced_at as string };
  }

  const { data, error } = await supabase
    .from("content_periods")
    .update({
      readiness_lifecycle: "enforced",
      readiness_enforced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", weekConfig.periodId)
    .eq("firm_id", weekConfig.firmId)
    .select("readiness_lifecycle, readiness_enforced_at")
    .maybeSingle();
  if (error || !data) throw new Error(`readiness update failed: ${error?.message ?? "not found"}`);

  return {
    status: "activated",
    readinessLifecycle: data.readiness_lifecycle as string,
    enforcedAt: data.readiness_enforced_at as string,
  };
}
