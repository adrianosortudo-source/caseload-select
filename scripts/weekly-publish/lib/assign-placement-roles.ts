/**
 * Assigns the website_article_hero_baked role to each article's baked hero
 * artifact via an append-only publication_artifact_role_assignments row.
 *
 * Ported from the proven, already-executed ToDelete/assign-w32-hero-roles.mjs
 * (Standing Rule 4), which itself mirrors every guard of the sanctioned route
 * src/app/api/portal/[firmId]/deliverables/[deliverableId]/artifacts/
 * [artifactId]/assign-role/route.ts, in the same order. Never mutates the
 * immutable publication_artifacts row.
 *
 * This is the missing half of registration named in FOLLOWUPS 2026-08-07
 * ("W32 placement -- THE ROOT CAUSE of images never show in the Publish
 * Kit"): a publication_artifacts row with asset_role null resolves to no
 * placement at all (see placement-resolution.ts / content-period-export.ts).
 * write-all.ts MUST run this AFTER registerEvidence -- it looks up the
 * article-hero artifact registerEvidence already created; if evidence has
 * not been registered yet, this STOPs rather than silently doing nothing.
 *
 * Target deliverables are derived from weekConfig.evidence itself (every row
 * with artifactType "hero_image" and destination "firm_website"), not a
 * separate hardcoded list -- Appendix A's evidence table already names
 * exactly the 4 article-hero pieces, and duplicating that list would be a
 * second, driftable copy of the same fact.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WeekConfig } from "../config";

const ROLE = "website_article_hero_baked";

export interface AssignPlacementRoleRowResult {
  label: string;
  deliverableId: string;
  status: "assigned" | "skipped";
  assignmentId?: string;
  reason?: string;
}

export interface AssignPlacementRolesResult {
  assigned: number;
  skipped: number;
  rows: AssignPlacementRoleRowResult[];
}

async function assignOne(
  supabase: SupabaseClient,
  firmId: string,
  deliverableId: string,
  label: string,
): Promise<AssignPlacementRoleRowResult> {
  // Route guard: deliverable exists, belongs to the firm, is a website
  // article, has a current version.
  const { data: d, error: dErr } = await supabase
    .from("content_deliverables")
    .select("id, firm_id, deliverable_role, current_version_id")
    .eq("id", deliverableId)
    .maybeSingle();
  if (dErr || !d) throw new Error(`${label}: deliverable lookup failed: ${dErr?.message ?? "not found"}`);
  if (d.firm_id !== firmId) throw new Error(`${label}: firm mismatch`);
  if (d.deliverable_role !== "article") throw new Error(`${label}: not an article (got ${d.deliverable_role})`);
  if (!d.current_version_id) throw new Error(`${label}: no current_version_id`);

  // Find the article-hero artifact registerEvidence already created for this
  // deliverable's current version. Must be exactly one; zero means evidence
  // registration has not run yet (an ordering error in write-all.ts, not a
  // data problem), more than one is an unexpected duplicate -- both STOP.
  const { data: candidates, error: aErr } = await supabase
    .from("publication_artifacts")
    .select("id, version_id, artifact_type, asset_role, superseded_at")
    .eq("deliverable_id", deliverableId)
    .eq("version_id", d.current_version_id)
    .eq("artifact_type", "hero_image")
    .is("superseded_at", null);
  if (aErr) throw new Error(`${label}: artifact lookup failed: ${aErr.message}`);
  const unroled = (candidates ?? []).filter((a) => !a.asset_role);
  if (unroled.length === 0) {
    // Could mean: evidence not registered yet (STOP), or already roled on a
    // prior run -- distinguish before deciding.
    const alreadyRoled = (candidates ?? []).some((a) => a.asset_role === ROLE);
    if (alreadyRoled) {
      return { label, deliverableId, status: "skipped", reason: "artifact already carries the role" };
    }
    throw new Error(`${label}: no unroled hero_image artifact found on the current version -- has registerEvidence run yet?`);
  }
  if (unroled.length > 1) {
    throw new Error(`${label}: ${unroled.length} unroled hero_image artifacts found on the current version, expected exactly 1`);
  }
  const artifact = unroled[0];

  // Route guard: artifact must have neither an existing asset_role
  // (re-checked above) nor be superseded (already filtered), and must not
  // already have an active assignment.
  const { data: priorAssignment, error: priorErr } = await supabase
    .from("publication_artifact_role_assignments")
    .select("id")
    .eq("artifact_id", artifact.id)
    .is("superseded_at", null)
    .maybeSingle();
  if (priorErr) throw new Error(`${label}: prior-assignment check failed: ${priorErr.message}`);
  if (priorAssignment) {
    return { label, deliverableId, status: "skipped", reason: "artifact already has an active placement assignment" };
  }

  // Route guard: the slot itself (deliverable, version, role) must be free.
  const { data: occupiedSlot, error: slotErr } = await supabase
    .from("publication_artifact_role_assignments")
    .select("id")
    .eq("deliverable_id", deliverableId)
    .eq("version_id", d.current_version_id)
    .eq("asset_role", ROLE)
    .is("superseded_at", null)
    .maybeSingle();
  if (slotErr) throw new Error(`${label}: slot check failed: ${slotErr.message}`);
  if (occupiedSlot) {
    return { label, deliverableId, status: "skipped", reason: "placement slot already filled by another artifact" };
  }

  const { data: inserted, error: insErr } = await supabase
    .from("publication_artifact_role_assignments")
    .insert({
      firm_id: firmId,
      artifact_id: artifact.id,
      deliverable_id: deliverableId,
      version_id: d.current_version_id,
      asset_role: ROLE,
      assigned_by_role: "operator",
      assigned_by_id: null,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    if (insErr?.code === "23505") {
      return { label, deliverableId, status: "skipped", reason: "placement already occupied (concurrent insert)" };
    }
    throw new Error(`${label}: insert failed: ${insErr?.message}`);
  }

  return { label, deliverableId, status: "assigned", assignmentId: inserted.id };
}

export async function assignPlacementRoles(
  supabase: SupabaseClient,
  weekConfig: WeekConfig,
): Promise<AssignPlacementRolesResult> {
  const targets = weekConfig.evidence.filter(
    (row) => row.artifactType === "hero_image" && row.destination === "firm_website",
  );
  const rows: AssignPlacementRoleRowResult[] = [];
  for (const target of targets) {
    rows.push(await assignOne(supabase, weekConfig.firmId, target.deliverableId, target.label));
  }
  return {
    assigned: rows.filter((r) => r.status === "assigned").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
    rows,
  };
}
