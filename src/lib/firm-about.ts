import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sanitizeExplainerHtml } from "@/lib/explainer-html-sanitize";

/**
 * Per-firm standing "About this content" explainer for the deliverables portal.
 * One row per firm in firm_about. body_html is sanitised on write with the
 * deliverable/explainer allowlist; rendered as a panel above the deliverables
 * list (read by the firm's lawyer, authored by the operator).
 */
export interface FirmAbout {
  body_html: string;
  updated_at: string;
  updated_by: string | null;
}

/**
 * Guarded read. Returns null if the firm_about table does not exist yet (the
 * migration is operator-applied, so the table may be absent on a deploy that
 * ships ahead of it) or the firm has no row / empty body. The deliverables
 * page renders safely either way: no row, no panel.
 */
export async function getFirmAbout(firmId: string): Promise<FirmAbout | null> {
  const { data, error } = await supabase
    .from("firm_about")
    .select("body_html, updated_at, updated_by")
    .eq("firm_id", firmId)
    .maybeSingle();
  if (error) return null;
  if (!data || typeof data.body_html !== "string" || !data.body_html.trim()) return null;
  return data as FirmAbout;
}

/**
 * Operator-authored upsert. Sanitises to the explainer allowlist before
 * storage (never trusts the caller's HTML), so a direct API call cannot store
 * unsafe markup.
 */
export async function setFirmAbout(input: {
  firmId: string;
  bodyHtml: string;
  updatedBy: string | null;
}): Promise<{ ok: true; about: FirmAbout } | { ok: false; error: string }> {
  const safe = sanitizeExplainerHtml(input.bodyHtml);
  const { data, error } = await supabase
    .from("firm_about")
    .upsert(
      {
        firm_id: input.firmId,
        body_html: safe,
        updated_at: new Date().toISOString(),
        updated_by: input.updatedBy,
      },
      { onConflict: "firm_id" },
    )
    .select("body_html, updated_at, updated_by")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, about: data as FirmAbout };
}
