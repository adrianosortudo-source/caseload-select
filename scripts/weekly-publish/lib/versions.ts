/**
 * Phase 2.2 (Appendix B): generic new-version write primitive. Ported from
 * ToDelete/apply-entity-repair.mjs and apply-landing-cta-fix.mjs (Standing
 * Rule 4): both scripts share one INSERT shape -- mirrors addVersion() in
 * src/lib/deliverables.ts (not importable: server-only, Phase 0.3) -- next
 * version_number, insert, let deliverable_track_current_version() (AFTER
 * INSERT trigger) auto-promote current_version_id exactly as a real operator
 * edit through the app does. Never UPDATE.
 *
 * Deliberately NOT wired into `write`/`run`: per Standing Rule 5, "the gate
 * never edits content." The two source scripts' actual REPAIR TRANSFORMS
 * (mojibake decode, a byte-exact CTA string replacement) do not carry
 * forward as auto-fix logic -- they inform gate's REJECT checks instead
 * (F11: entity-mojibake signature, locked-string checks). This function is
 * the sanctioned primitive for the human-reviewed, one-off repair that
 * follows a gate rejection -- exposed for that manual workflow, not for
 * automatic invocation.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AddVersionInput {
  deliverableId: string;
  firmId: string;
  bodyHtml: string;
  note: string;
}

export interface AddVersionResult {
  id: string;
  versionNumber: number;
}

export async function addVersion(
  supabase: SupabaseClient,
  input: AddVersionInput,
): Promise<AddVersionResult> {
  const { data: last, error: lastErr } = await supabase
    .from("deliverable_versions")
    .select("version_number")
    .eq("deliverable_id", input.deliverableId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastErr) throw new Error(`version-sequence lookup failed: ${lastErr.message}`);
  const versionNumber = (last?.version_number ?? 0) + 1;

  const { data, error } = await supabase
    .from("deliverable_versions")
    .insert({
      deliverable_id: input.deliverableId,
      firm_id: input.firmId,
      version_number: versionNumber,
      body_html: input.bodyHtml,
      note: input.note,
      created_by_role: "operator",
    })
    .select("id, version_number")
    .single();
  if (error || !data) throw new Error(`version insert failed: ${error?.message}`);

  return { id: data.id as string, versionNumber: data.version_number as number };
}
