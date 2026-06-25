import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sanitizeExplainerHtml } from "@/lib/explainer-html-sanitize";

/**
 * Per-firm standing "About this content" explainer for the deliverables portal.
 * One row per firm in firm_about. body_html is sanitised on write with the
 * deliverable/explainer allowlist; links is a small set of labelled reference
 * links (e.g. the firm's content strategy doc) rendered always-visible under
 * the panel body. Read by the firm's lawyer, authored by the operator.
 */
export interface FirmAboutLink {
  label: string;
  url: string;
}

export interface FirmAbout {
  body_html: string;
  links: FirmAboutLink[];
  updated_at: string;
  updated_by: string | null;
}

/**
 * Validate operator-supplied reference links: a non-empty label (trimmed,
 * capped) and an absolute http/https URL. Drops anything malformed; caps the
 * count at six. Pure.
 */
export function sanitizeAboutLinks(input: unknown): FirmAboutLink[] {
  if (!Array.isArray(input)) return [];
  const out: FirmAboutLink[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const rawLabel = (item as { label?: unknown }).label;
    const rawUrl = (item as { url?: unknown }).url;
    const label = typeof rawLabel === "string" ? rawLabel.trim().slice(0, 80) : "";
    const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
    if (!label || !/^https?:\/\//i.test(url)) continue;
    out.push({ label, url });
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * Guarded read. Returns null if the firm_about table does not exist yet or the
 * firm has no row / empty body, so the deliverables page renders safely either
 * way: no row, no panel.
 */
export async function getFirmAbout(firmId: string): Promise<FirmAbout | null> {
  const { data, error } = await supabase
    .from("firm_about")
    .select("body_html, links, updated_at, updated_by")
    .eq("firm_id", firmId)
    .maybeSingle();
  if (error) return null;
  if (!data || typeof data.body_html !== "string" || !data.body_html.trim()) return null;
  return {
    body_html: data.body_html,
    links: sanitizeAboutLinks(data.links),
    updated_at: data.updated_at as string,
    updated_by: (data.updated_by as string | null) ?? null,
  };
}

/**
 * Operator-authored upsert. Sanitises body to the explainer allowlist and links
 * to absolute http/https before storage (never trusts the caller). links is
 * only written when provided, so a body-only update leaves existing links
 * untouched.
 */
export async function setFirmAbout(input: {
  firmId: string;
  bodyHtml: string;
  links?: unknown;
  updatedBy: string | null;
}): Promise<{ ok: true; about: FirmAbout } | { ok: false; error: string }> {
  const row: Record<string, unknown> = {
    firm_id: input.firmId,
    body_html: sanitizeExplainerHtml(input.bodyHtml),
    updated_at: new Date().toISOString(),
    updated_by: input.updatedBy,
  };
  if (input.links !== undefined) row.links = sanitizeAboutLinks(input.links);

  const { data, error } = await supabase
    .from("firm_about")
    .upsert(row, { onConflict: "firm_id" })
    .select("body_html, links, updated_at, updated_by")
    .single();
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    about: {
      body_html: data.body_html as string,
      links: sanitizeAboutLinks(data.links),
      updated_at: data.updated_at as string,
      updated_by: (data.updated_by as string | null) ?? null,
    },
  };
}
