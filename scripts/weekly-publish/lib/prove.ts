/**
 * Phase 2.3: the `prove` command. Read-only audit + operator report: 16
 * deliverables x version/hero/body state, Kit asset counts by status,
 * publication_artifacts counts, period lifecycle. Never writes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WeekConfig } from "../config";

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
  publicationArtifactCounts: Array<{ artifactType: string; destination: string; count: number }>;
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

  const { data: pubArtifacts } = await supabase
    .from("publication_artifacts")
    .select("artifact_type, destination")
    .in("deliverable_id", weekConfig.evidence.map((e) => e.deliverableId))
    .is("superseded_at", null)
    .is("asset_role", null);
  const pubCounts = new Map<string, number>();
  for (const row of pubArtifacts ?? []) {
    const key = `${row.artifact_type}|${row.destination}`;
    pubCounts.set(key, (pubCounts.get(key) ?? 0) + 1);
  }
  const publicationArtifactCounts = [...pubCounts.entries()].map(([key, count]) => {
    const [artifactType, destination] = key.split("|");
    return { artifactType, destination, count };
  });

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
  lines.push("publication_artifacts (evidence, asset_role null): " + JSON.stringify(report.publicationArtifactCounts));
  lines.push(`Period readiness_lifecycle: ${report.periodLifecycle} (enforced_at: ${report.readinessEnforcedAt ?? "n/a"})`);
  return lines.join("\n");
}
