/**
 * Phase 2.3: the `prove` command. Read-only audit + operator report: 16
 * deliverables x version/hero/body state, Kit asset counts by status,
 * publication_artifacts counts, period lifecycle, and (fix/weekly-publish-
 * placement-roles Phase 2) a hard assertion that every website article
 * resolves BOTH placement roles. Never writes.
 *
 * The publication_artifacts summary previously filtered to
 * `.is("asset_role", null)`, which silently hid every homepage-CTA row (role
 * set) and undercounted the true evidence set (9 reported vs. 17 actual for
 * W32) -- the same class of blind spot that let the placement gap itself go
 * unnoticed: a report that only shows unplaced rows cannot ever say
 * "placement is missing". Fixed: report ALL active artifacts grouped by
 * (artifact_type, destination, asset_role).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WeekConfig } from "../config";
import {
  missingPlacementRoles,
  type ArtifactRow,
  type RoleAssignmentRow,
  type MissingPlacementResult,
} from "./placement-resolution";

export interface ProveDeliverableRow {
  contentSlotId: string;
  title: string;
  hasCurrentVersion: boolean;
  bodyHtmlLength: number;
  evidenceArtifactCount: number;
}

export interface ProveReport {
  week: string;
  deliverables: ProveDeliverableRow[];
  kitAssetCountsByStatus: Record<string, number>;
  /** ALL active publication_artifacts rows for this week, grouped by (artifact_type, destination, asset_role) -- not filtered to unplaced rows. See module header. */
  publicationArtifactCounts: Array<{ artifactType: string; destination: string; assetRole: string | null; count: number }>;
  articlePlacementChecks: MissingPlacementResult[];
  placementOk: boolean;
  periodLifecycle: string | null;
  readinessEnforcedAt: string | null;
}

export async function runProve(supabase: SupabaseClient, weekConfig: WeekConfig): Promise<ProveReport> {
  const deliverableIds = weekConfig.pieces.map((p) => p.deliverableId);

  const { data: deliverables, error: dErr } = await supabase
    .from("content_deliverables")
    .select("id, title, current_version_id")
    .in("id", deliverableIds);
  if (dErr) throw new Error(`deliverable audit query failed: ${dErr.message}`);
  const byId = new Map((deliverables ?? []).map((d) => [d.id as string, d as { id: string; title: string; current_version_id: string | null }]));

  const versionIds = (deliverables ?? []).map((d) => d.current_version_id).filter((v): v is string => Boolean(v));
  const { data: versions } = versionIds.length
    ? await supabase.from("deliverable_versions").select("id, body_html").in("id", versionIds)
    : { data: [] as Array<{ id: string; body_html: string | null }> };
  const bodyById = new Map((versions ?? []).map((v) => [v.id as string, (v.body_html as string | null) ?? ""]));

  const { data: artifacts } = deliverableIds.length
    ? await supabase.from("publication_artifacts").select("deliverable_id").in("deliverable_id", deliverableIds).is("superseded_at", null)
    : { data: [] as Array<{ deliverable_id: string }> };
  const artifactCountByDeliverable = new Map<string, number>();
  for (const a of artifacts ?? []) {
    artifactCountByDeliverable.set(a.deliverable_id as string, (artifactCountByDeliverable.get(a.deliverable_id as string) ?? 0) + 1);
  }

  const deliverableRows: ProveDeliverableRow[] = weekConfig.pieces.map((piece) => {
    const d = byId.get(piece.deliverableId);
    return {
      contentSlotId: piece.contentSlotId,
      title: d?.title ?? "(not found)",
      hasCurrentVersion: Boolean(d?.current_version_id),
      bodyHtmlLength: d?.current_version_id ? (bodyById.get(d.current_version_id) ?? "").length : 0,
      evidenceArtifactCount: artifactCountByDeliverable.get(piece.deliverableId) ?? 0,
    };
  });

  const { data: kitAssets } = await supabase
    .from("publishing_package_assets")
    .select("status")
    .eq("package_id", weekConfig.packageId);
  const kitAssetCountsByStatus: Record<string, number> = {};
  for (const row of kitAssets ?? []) {
    const status = row.status as string;
    kitAssetCountsByStatus[status] = (kitAssetCountsByStatus[status] ?? 0) + 1;
  }

  // ALL deliverables for the period, not just weekConfig.evidence's rows --
  // the evidence config only lists the 9 image/social rows; the pdf rows
  // (register-pdf-evidence.ts) and homepage-CTA rows (register-homepage-
  // cta.ts) attach to deliverables not in that list. deliverableIds (from
  // weekConfig.pieces, all 16) is the correct scope.
  const { data: pubArtifacts } = await supabase
    .from("publication_artifacts")
    .select("artifact_type, destination, asset_role")
    .in("deliverable_id", deliverableIds)
    .is("superseded_at", null);
  const pubCounts = new Map<string, { artifactType: string; destination: string; assetRole: string | null; count: number }>();
  for (const row of pubArtifacts ?? []) {
    const assetRole = (row.asset_role as string | null) ?? null;
    const key = `${row.artifact_type}|${row.destination}|${assetRole ?? ""}`;
    const existing = pubCounts.get(key);
    if (existing) existing.count += 1;
    else pubCounts.set(key, { artifactType: row.artifact_type as string, destination: row.destination as string, assetRole, count: 1 });
  }
  const publicationArtifactCounts = [...pubCounts.values()];

  // Placement check: every website article must resolve BOTH required
  // roles (lib/placement-resolution.ts). Needs every artifact (any role,
  // any version -- the pure function does its own current-version and
  // superseded filtering) plus every active role assignment, scoped to the
  // article deliverables only.
  const articleDeliverableIds = weekConfig.pieces
    .filter((p) => p.assetShape === "articleHero")
    .map((p) => p.deliverableId);

  const { data: articleArtifactsRaw } = articleDeliverableIds.length
    ? await supabase
        .from("publication_artifacts")
        .select("id, deliverable_id, version_id, artifact_type, asset_role, superseded_at")
        .in("deliverable_id", articleDeliverableIds)
    : { data: [] as Array<{ id: string; deliverable_id: string; version_id: string; artifact_type: string; asset_role: string | null; superseded_at: string | null }> };

  const { data: activeAssignmentsRaw } = articleDeliverableIds.length
    ? await supabase
        .from("publication_artifact_role_assignments")
        .select("artifact_id, asset_role, superseded_at")
        .in("deliverable_id", articleDeliverableIds)
        .is("superseded_at", null)
    : { data: [] as Array<{ artifact_id: string; asset_role: string; superseded_at: string | null }> };

  const assignments: RoleAssignmentRow[] = (activeAssignmentsRaw ?? []).map((a) => ({
    artifactId: a.artifact_id,
    assetRole: a.asset_role,
    supersededAt: a.superseded_at,
  }));

  const articlePlacementChecks: MissingPlacementResult[] = articleDeliverableIds.map((deliverableId) => {
    const currentVersionId = byId.get(deliverableId)?.current_version_id ?? null;
    if (!currentVersionId) return { deliverableId, missingRoles: ["website_article_hero_baked", "website_homepage_cta_baked"] } as MissingPlacementResult;
    const artifacts: ArtifactRow[] = (articleArtifactsRaw ?? [])
      .filter((a) => a.deliverable_id === deliverableId)
      .map((a) => ({ id: a.id, versionId: a.version_id, artifactType: a.artifact_type, assetRole: a.asset_role, supersededAt: a.superseded_at }));
    return missingPlacementRoles(deliverableId, currentVersionId, artifacts, assignments);
  });
  const placementOk = articlePlacementChecks.every((c) => c.missingRoles.length === 0);

  const { data: period } = await supabase
    .from("content_periods")
    .select("readiness_lifecycle, readiness_enforced_at")
    .eq("id", weekConfig.periodId)
    .maybeSingle();

  return {
    week: weekConfig.week,
    deliverables: deliverableRows,
    kitAssetCountsByStatus,
    publicationArtifactCounts,
    articlePlacementChecks,
    placementOk,
    periodLifecycle: (period?.readiness_lifecycle as string) ?? null,
    readinessEnforcedAt: (period?.readiness_enforced_at as string) ?? null,
  };
}

export function renderProveReport(report: ProveReport): string {
  const lines: string[] = [];
  lines.push(`weekly-publish prove -- ${report.week}`);
  lines.push("");
  lines.push("Deliverables:");
  lines.push("slot".padEnd(30) + "title".padEnd(50) + "version".padEnd(9) + "body_len".padEnd(10) + "artifacts");
  for (const d of report.deliverables) {
    lines.push(
      d.contentSlotId.padEnd(30) +
        d.title.slice(0, 48).padEnd(50) +
        (d.hasCurrentVersion ? "yes" : "NO").padEnd(9) +
        String(d.bodyHtmlLength).padEnd(10) +
        String(d.evidenceArtifactCount),
    );
  }
  lines.push("");
  lines.push("Publishing Kit assets by status: " + JSON.stringify(report.kitAssetCountsByStatus));
  lines.push("");
  lines.push("publication_artifacts (all active rows, by type/destination/role):");
  const totalArtifacts = report.publicationArtifactCounts.reduce((sum, r) => sum + r.count, 0);
  for (const r of report.publicationArtifactCounts) {
    lines.push(`  ${String(r.count).padStart(2)}  ${r.artifactType}/${r.destination}  role=${r.assetRole ?? "null"}`);
  }
  lines.push(`  TOTAL: ${totalArtifacts}`);
  lines.push("");
  lines.push("Article placement check (website_article_hero_baked + website_homepage_cta_baked):");
  for (const c of report.articlePlacementChecks) {
    lines.push(
      c.missingRoles.length === 0
        ? `  [OK]   ${c.deliverableId}`
        : `  [FAIL] ${c.deliverableId}  missing: ${c.missingRoles.join(", ")}`,
    );
  }
  lines.push(report.placementOk ? "  placement: PASS" : "  placement: FAIL");
  lines.push("");
  lines.push(`Period readiness_lifecycle: ${report.periodLifecycle} (enforced_at: ${report.readinessEnforcedAt ?? "n/a"})`);
  return lines.join("\n");
}
