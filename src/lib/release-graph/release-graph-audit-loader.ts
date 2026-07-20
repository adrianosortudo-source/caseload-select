/**
 * I/O loader for resolve_and_audit_release_graph. Mirrors
 * publication-preflight-loader.ts's shape exactly: assembles already-loaded
 * data and hands it to the pure resolver (release-graph-audit.ts); every
 * branching decision lives there, not here.
 *
 * Read-only throughout. Every Supabase call below is a SELECT; nothing in
 * this file inserts, updates, deletes, or calls any external API.
 */

import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { resolveEmailBranding } from "@/lib/email-branding";
import type { FirmBranding } from "@/lib/widget-theme";
import { listCurrentReceiptsByPlacementForDeliverable } from "@/lib/publication-receipts";
import type { PeriodLifecycle } from "@/lib/publication-readiness";
import {
  resolveAndAuditReleaseGraph,
  auditDeliverableWithNoPlacements,
  type CtaTargetResolution,
} from "./release-graph-audit";
import type { ReleaseGraphAudit, ReleaseGraphNoPlacementAudit } from "./release-graph-types";
import type {
  ContentDeliverable,
  DeliverableVersion,
  ContentPlacement,
  DeliverableComment,
  PublicationArtifact,
  PublicationArtifactValidation,
  PublicationReceipt,
} from "@/lib/types";

/**
 * Best-effort content-graph resolution for a teaser/GBP post's CTA target.
 * Looks up a sibling, non-archived deliverable in the same firm whose
 * publication_path matches cta_target_path, then checks whether THAT
 * deliverable itself carries a linkedin_article placement -- the one real
 * signal this repository has for "the strategy requires a native Article."
 * Never invents a target when no match is found.
 */
async function resolveCtaTarget(firmId: string, ctaTargetPath: string | null): Promise<CtaTargetResolution | null> {
  if (!ctaTargetPath) return null;

  const { data: target } = await supabase
    .from("content_deliverables")
    .select("id, publication_path, status, current_version_id")
    .eq("firm_id", firmId)
    .eq("publication_path", ctaTargetPath)
    .neq("status", "archived")
    .maybeSingle();

  if (!target) {
    return { requiresNativeArticle: false, nativeArticleReady: false, targetLabel: null, targetVerifiedLive: false };
  }

  const { data: targetPlacements } = await supabase
    .from("content_placements")
    .select("*")
    .eq("deliverable_id", target.id);
  const nativeArticlePlacement = ((targetPlacements ?? []) as ContentPlacement[]).find(
    (p) => p.destination === "linkedin_article",
  );

  if (nativeArticlePlacement) {
    return {
      requiresNativeArticle: true,
      nativeArticleReady: nativeArticlePlacement.state === "ready" || nativeArticlePlacement.state === "published",
      targetLabel: null,
      targetVerifiedLive: false,
    };
  }

  const { data: artifacts } = await supabase
    .from("publication_artifacts")
    .select("*")
    .eq("deliverable_id", target.id)
    .eq("artifact_type", "webpage");
  const currentWebpage = ((artifacts ?? []) as PublicationArtifact[]).find(
    (a) => a.version_id === target.current_version_id,
  );
  let verified = false;
  if (currentWebpage) {
    const { data: validations } = await supabase
      .from("publication_artifact_validations")
      .select("result")
      .eq("artifact_id", currentWebpage.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    verified = validations?.result === "pass";
  }

  return {
    requiresNativeArticle: false,
    nativeArticleReady: false,
    targetLabel: verified ? ctaTargetPath : null,
    targetVerifiedLive: verified,
  };
}

export interface ReleaseGraphPeriodAudit {
  periodId: string;
  periodLifecycle: PeriodLifecycle;
  audits: ReleaseGraphAudit[];
  noPlacementAudits: ReleaseGraphNoPlacementAudit[];
}

/**
 * Audits every non-archived deliverable × placement in one content period.
 * Read-only. Returns null only when the period itself cannot be found for
 * this firm.
 */
export async function loadReleaseGraphAuditForPeriod(
  periodId: string,
  firmId: string,
): Promise<ReleaseGraphPeriodAudit | null> {
  const { data: period } = await supabase
    .from("content_periods")
    .select("id, readiness_lifecycle")
    .eq("id", periodId)
    .eq("firm_id", firmId)
    .maybeSingle();
  if (!period) return null;
  const periodLifecycle = period.readiness_lifecycle as PeriodLifecycle;

  const { data: deliverables } = await supabase
    .from("content_deliverables")
    .select("*")
    .eq("period_id", periodId)
    .eq("firm_id", firmId);
  const rows = ((deliverables ?? []) as ContentDeliverable[]).filter((d) => d.status !== "archived");
  if (rows.length === 0) return { periodId, periodLifecycle, audits: [], noPlacementAudits: [] };

  const deliverableIds = rows.map((d) => d.id);
  const versionIds = rows.map((d) => d.current_version_id).filter((id): id is string => !!id);

  const [{ data: versions }, { data: artifacts }, { data: comments }, { data: placements }, { data: firm }] = await Promise.all([
    versionIds.length
      ? supabase.from("deliverable_versions").select("*").in("id", versionIds)
      : Promise.resolve({ data: [] as DeliverableVersion[] }),
    supabase.from("publication_artifacts").select("*").in("deliverable_id", deliverableIds),
    supabase.from("deliverable_comments").select("*").in("deliverable_id", deliverableIds),
    supabase.from("content_placements").select("*").in("deliverable_id", deliverableIds),
    supabase.from("intake_firms").select("branding, ghl_location_id").eq("id", firmId).maybeSingle(),
  ]);

  const versionById = new Map(((versions ?? []) as DeliverableVersion[]).map((v) => [v.id, v]));
  const allArtifacts = (artifacts ?? []) as PublicationArtifact[];
  const artifactIds = allArtifacts.map((a) => a.id);
  const { data: validationsRaw } = artifactIds.length
    ? await supabase.from("publication_artifact_validations").select("*").in("artifact_id", artifactIds).order("created_at", { ascending: false })
    : { data: [] as PublicationArtifactValidation[] };
  const latestValidationByArtifactId: Record<string, PublicationArtifactValidation | undefined> = {};
  for (const v of (validationsRaw ?? []) as PublicationArtifactValidation[]) {
    if (!latestValidationByArtifactId[v.artifact_id]) latestValidationByArtifactId[v.artifact_id] = v;
  }

  const commentsByDeliverableId: Record<string, DeliverableComment[]> = {};
  for (const c of (comments ?? []) as DeliverableComment[]) {
    (commentsByDeliverableId[c.deliverable_id] ??= []).push(c);
  }
  const placementsByDeliverableId: Record<string, ContentPlacement[]> = {};
  for (const p of (placements ?? []) as ContentPlacement[]) {
    (placementsByDeliverableId[p.deliverable_id] ??= []).push(p);
  }

  const emailBranding = resolveEmailBranding((firm?.branding as FirmBranding | null) ?? null);
  const firmGhlLocationId = (firm?.ghl_location_id as string | null) ?? null;
  const resolvedAt = new Date().toISOString();

  const audits: ReleaseGraphAudit[] = [];
  const noPlacementAudits: ReleaseGraphNoPlacementAudit[] = [];

  for (const deliverable of rows) {
    const deliverablePlacements = placementsByDeliverableId[deliverable.id] ?? [];
    if (deliverablePlacements.length === 0) {
      noPlacementAudits.push(auditDeliverableWithNoPlacements(deliverable, resolvedAt));
      continue;
    }
    const currentVersion = deliverable.current_version_id ? (versionById.get(deliverable.current_version_id) ?? null) : null;
    const deliverableArtifacts = allArtifacts.filter((a) => a.deliverable_id === deliverable.id);
    const deliverableComments = commentsByDeliverableId[deliverable.id] ?? [];
    const ctaResolution = await resolveCtaTarget(firmId, deliverable.cta_target_path);
    const currentReceiptsByPlacementId = await listCurrentReceiptsByPlacementForDeliverable(
      deliverable.id,
      deliverable.approved_version_id ?? null,
    );

    for (const placement of deliverablePlacements) {
      const currentReceipt = currentReceiptsByPlacementId[placement.id] ?? null;

      audits.push(
        resolveAndAuditReleaseGraph({
          deliverable,
          currentVersion,
          placement,
          artifacts: deliverableArtifacts,
          latestValidationByArtifactId,
          comments: deliverableComments,
          currentReceipt,
          periodLifecycle,
          emailBranding,
          ctaResolution,
          firmGhlLocationId,
          resolvedAt,
        }),
      );
    }
  }

  return { periodId, periodLifecycle, audits, noPlacementAudits };
}
