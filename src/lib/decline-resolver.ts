/**
 * Decline copy resolver — I/O wrapper around decline-resolver-pure.
 *
 * Re-exports the pure types and the resolveDecline function for callers that
 * already have candidates loaded, plus adds the Supabase fetcher
 * (loadDeclineCandidates) for the action endpoints.
 */

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import type { DeclineCandidates, DeclineTemplateRow } from "@/lib/decline-resolver-pure";

export {
  resolveDecline,
  type DeclineCandidates,
  type DeclineSource,
  type DeclineFlavour,
  type DeclineTemplateRow,
  type DeclineVerdict,
} from "@/lib/decline-resolver-pure";

/**
 * Load both candidate templates (per-PA and firm default) in one round trip.
 * The per-lead override comes from screened_leads.status_note, which the
 * caller already has in hand at decline time, so this fetcher does not
 * touch screened_leads.
 */
export async function loadDeclineCandidates(args: {
  firmId: string;
  practiceArea: string | null;
  perLeadOverride: string | null;
}): Promise<DeclineCandidates> {
  const { firmId, practiceArea, perLeadOverride } = args;

  const { data } = await supabase
    .from("firm_decline_templates")
    .select("practice_area, subject, body")
    .eq("firm_id", firmId);

  const rows = (data ?? []) as DeclineTemplateRow[];
  const perPa = practiceArea
    ? rows.find((r) => r.practice_area === practiceArea) ?? null
    : null;
  const firmDefault = rows.find((r) => r.practice_area === null) ?? null;

  return {
    perLeadOverride,
    perPaTemplate: perPa,
    firmDefaultTemplate: firmDefault,
  };
}
