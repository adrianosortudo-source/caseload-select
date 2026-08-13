/**
 * Registers the website_homepage_cta_baked placement for each article,
 * uploading the homepage-feature crop and inserting a NEW publication_
 * artifacts row that carries the role directly on the row (not via
 * assignment).
 *
 * Ported from the proven, already-executed ToDelete/register-w32-homepage-
 * cta.mjs (Standing Rule 4).
 *
 * This differs structurally from assign-placement-roles.ts, and the
 * difference is required, not stylistic: the dedupe index
 * (publication_artifacts_dedupe_idx) keys on
 *   (deliverable_id, version_id, artifact_type, coalesce(asset_role, ''), coalesce(locale, ''), coalesce(destination, ''))
 * A second hero_image row for the same deliverable/version/locale/
 * destination with asset_role left null would collide with the article-hero
 * evidence row already registered for that exact slot. Setting asset_role
 * inline is what makes it a distinct row.
 *
 * Upload path mirrors the sanctioned hero route
 *   src/app/api/portal/[firmId]/deliverables/[deliverableId]/hero/route.ts
 *   deliverables/hero/{firmId}/{deliverableId}/{Date.now()}-{safeName}
 * bucket firm-files, upsert:false, contentType from sniffed bytes. Does NOT
 * touch content_deliverables.hero_image_url -- the article hero (not the
 * homepage CTA) owns that column.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HomepageCtaRowConfig, WeekConfig } from "../config";

const BUCKET = "firm-files";
const ROLE = "website_homepage_cta_baked";

export interface RegisterHomepageCtaRowResult {
  label: string;
  deliverableId: string;
  status: "inserted" | "skipped";
  artifactId?: string;
  reason?: string;
}

export interface RegisterHomepageCtaResult {
  inserted: number;
  skipped: number;
  rows: RegisterHomepageCtaRowResult[];
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

function sniffMime(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

async function registerOne(
  supabase: SupabaseClient,
  firmId: string,
  root: string,
  row: HomepageCtaRowConfig,
): Promise<RegisterHomepageCtaRowResult> {
  const { data: d, error: dErr } = await supabase
    .from("content_deliverables")
    .select("id, firm_id, deliverable_role, locale, current_version_id")
    .eq("id", row.deliverableId)
    .maybeSingle();
  if (dErr || !d) throw new Error(`${row.label}: deliverable lookup failed: ${dErr?.message ?? "not found"}`);
  if (d.firm_id !== firmId) throw new Error(`${row.label}: firm mismatch`);
  if (d.deliverable_role !== "article") throw new Error(`${row.label}: not an article (got ${d.deliverable_role})`);
  if (d.locale !== row.locale) throw new Error(`${row.label}: locale mismatch (deliverable ${d.locale}, config ${row.locale})`);
  if (!d.current_version_id) throw new Error(`${row.label}: no current_version_id`);

  const { data: existing, error: exErr } = await supabase
    .from("publication_artifacts")
    .select("id")
    .eq("deliverable_id", row.deliverableId)
    .eq("version_id", d.current_version_id)
    .eq("artifact_type", "hero_image")
    .eq("asset_role", ROLE)
    .is("superseded_at", null);
  if (exErr) throw new Error(`${row.label}: existing-row check failed: ${exErr.message}`);
  if (existing && existing.length > 0) {
    return { label: row.label, deliverableId: row.deliverableId, status: "skipped", reason: "placement slot already filled" };
  }

  const filePath = path.join(root, row.file);
  let buf: Buffer;
  try {
    buf = readFileSync(filePath);
  } catch (err) {
    throw new Error(`${row.label}: could not read ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const mime = sniffMime(buf);
  if (!mime) throw new Error(`${row.label}: ${filePath} is not a recognized image`);

  const storagePath = `deliverables/hero/${firmId}/${row.deliverableId}/${Date.now()}-${safeName(path.basename(row.file))}`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buf, { contentType: mime, upsert: false });
  if (upErr) throw new Error(`${row.label}: upload failed: ${upErr.message}`);

  const { data: inserted, error: insErr } = await supabase
    .from("publication_artifacts")
    .insert({
      firm_id: firmId,
      deliverable_id: row.deliverableId,
      version_id: d.current_version_id,
      artifact_type: "hero_image",
      asset_role: ROLE,
      locale: row.locale,
      destination: "firm_website",
      storage_bucket: BUCKET,
      storage_path: storagePath,
      public_url: null,
      mime_type: mime,
      size_bytes: buf.length,
      sha256: null, // canon: image evidence rows leave this null (Phase 0.1, tool plan)
      validation_result: null,
      created_by_role: "operator",
      created_by_id: null,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    if (insErr?.code === "23505") {
      return { label: row.label, deliverableId: row.deliverableId, status: "skipped", reason: "placement already occupied (concurrent insert)" };
    }
    throw new Error(`${row.label}: insert failed: ${insErr?.message}`);
  }

  return { label: row.label, deliverableId: row.deliverableId, status: "inserted", artifactId: inserted.id };
}

export async function registerHomepageCta(
  supabase: SupabaseClient,
  weekConfig: WeekConfig,
  root: string,
): Promise<RegisterHomepageCtaResult> {
  const rows: RegisterHomepageCtaRowResult[] = [];
  for (const row of weekConfig.homepageCta) {
    rows.push(await registerOne(supabase, weekConfig.firmId, root, row));
  }
  return {
    inserted: rows.filter((r) => r.status === "inserted").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
    rows,
  };
}
