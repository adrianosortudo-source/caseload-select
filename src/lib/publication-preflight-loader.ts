/**
 * Workstream 7: I/O loader for the preflight report. Assembles the same
 * period-scoped deliverable readiness evaluation loadPeriodPublicationReadiness
 * already does (publication-readiness-loader.ts), plus the placement and
 * current-receipt layer that evaluator doesn't know about, and hands it all
 * to the pure buildPreflightReport (publication-preflight.ts). Thin wrapper;
 * every branching decision lives in the pure function.
 */

import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { loadPeriodPublicationReadiness } from "@/lib/publication-readiness-loader";
import { listCurrentReceiptsByPlacementForDeliverable } from "@/lib/publication-receipts";
import { buildPreflightReport, type PreflightPeriodReport } from "@/lib/publication-preflight";
import { getStandingAuthorizationState } from "@/lib/standing-publishing-authorization";
import { isVersionReleaseAuthorized, type ReleaseAuthorizationResult } from "@/lib/release-authorization";
import type {
  ContentDeliverable,
  ContentPeriod,
  ContentPlacement,
  DeliverableComment,
  DeliverableVersion,
  PublicationReceipt,
} from "@/lib/types";

export async function loadPublicationPreflightForPeriod(
  periodId: string,
  firmId: string,
): Promise<PreflightPeriodReport | null> {
  const { data: period } = await supabase
    .from("content_periods")
    .select("*")
    .eq("id", periodId)
    .eq("firm_id", firmId)
    .maybeSingle();
  if (!period) return null;
  const periodRow = period as ContentPeriod;

  const [readiness, { data: deliverables }] = await Promise.all([
    loadPeriodPublicationReadiness(periodId, firmId),
    supabase.from("content_deliverables").select("*").eq("period_id", periodId).eq("firm_id", firmId),
  ]);
  const readyByDeliverableId: Record<string, boolean> = {};
  for (const r of readiness) readyByDeliverableId[r.deliverableId] = r.ready;

  const rows = (deliverables ?? []) as ContentDeliverable[];
  const activeIds = rows.filter((d) => d.status !== "archived").map((d) => d.id);
  const approvedVersionByDeliverableId = new Map(rows.map((d) => [d.id, d.approved_version_id ?? null]));
  const currentVersionIds = rows.map((d) => d.current_version_id).filter((id): id is string => !!id);

  const [comments, placementsByDeliverableId, receiptsByPlacementParts, { data: currentVersions }, standingAuthorization] = await Promise.all([
    activeIds.length
      ? supabase
          .from("deliverable_comments")
          .select("*")
          .in("deliverable_id", activeIds)
          .then(({ data }) => (data ?? []) as DeliverableComment[])
      : Promise.resolve([] as DeliverableComment[]),
    activeIds.length
      ? supabase
          .from("content_placements")
          .select("*")
          .in("deliverable_id", activeIds)
          .then(({ data }) => {
            const byDeliverable: Record<string, ContentPlacement[]> = {};
            for (const p of (data ?? []) as ContentPlacement[]) {
              const list = byDeliverable[p.deliverable_id] ?? [];
              list.push(p);
              byDeliverable[p.deliverable_id] = list;
            }
            return byDeliverable;
          })
      : Promise.resolve({} as Record<string, ContentPlacement[]>),
    Promise.all(
      activeIds.map((id) =>
        listCurrentReceiptsByPlacementForDeliverable(id, approvedVersionByDeliverableId.get(id) ?? null),
      ),
    ),
    currentVersionIds.length
      ? supabase.from("deliverable_versions").select("id, requires_individual_review").in("id", currentVersionIds)
      : Promise.resolve({ data: [] as Pick<DeliverableVersion, "id" | "requires_individual_review">[] }),
    getStandingAuthorizationState(firmId),
  ]);

  const commentsByDeliverableId: Record<string, DeliverableComment[]> = {};
  for (const c of comments) {
    const list = commentsByDeliverableId[c.deliverable_id] ?? [];
    list.push(c);
    commentsByDeliverableId[c.deliverable_id] = list;
  }

  const currentReceiptsByPlacementId: Record<string, PublicationReceipt | null> = {};
  for (const part of receiptsByPlacementParts) Object.assign(currentReceiptsByPlacementId, part);

  // The canonical two-path release-authorization result, computed once per
  // deliverable (never per-placement -- authorization is a deliverable ×
  // version fact, not a placement fact) and passed to buildPreflightReport
  // so this live route reads the exact same rule release-graph-audit.ts
  // does, never the narrower individual-approval-only fallback. Standing
  // authorization is fetched once per firm and reused for every
  // deliverable, matching release-graph-audit-loader.ts's own pattern.
  const requiresIndividualReviewByVersionId = new Map(
    ((currentVersions ?? []) as Pick<DeliverableVersion, "id" | "requires_individual_review">[]).map((v) => [
      v.id,
      v.requires_individual_review,
    ]),
  );
  const standingAuthorizationActive = standingAuthorization?.active ?? false;
  const releaseAuthorizationByDeliverableId: Record<string, ReleaseAuthorizationResult> = {};
  for (const deliverable of rows) {
    // Two distinct ways this deliverable's current-version metadata can be
    // unavailable: no current_version_id at all, or one that is set but
    // whose deliverable_versions row failed to load (a data-integrity
    // anomaly this loader's queries do not otherwise expect). Both
    // deliberately leave this deliverable OUT of the map entirely, rather
    // than inventing a synthetic ReleaseAuthorizationResult for either --
    // buildPreflightReport's reportOnePlacement has no fallback
    // interpretation for a missing map entry: it fails closed with the
    // explicit, machine-readable reasonCode
    // "release_authorization_context_unavailable" on its own, for exactly
    // this reason, so there is nothing for this loader to construct here.
    if (!deliverable.current_version_id) continue;
    const versionRequiresIndividualReview = requiresIndividualReviewByVersionId.get(deliverable.current_version_id);
    if (versionRequiresIndividualReview === undefined) continue;
    releaseAuthorizationByDeliverableId[deliverable.id] = isVersionReleaseAuthorized({
      deliverableStatus: deliverable.status,
      approvedVersionId: deliverable.approved_version_id,
      targetVersionId: deliverable.current_version_id,
      versionRequiresIndividualReview,
      standingAuthorizationActive,
    });
  }

  return buildPreflightReport({
    periodId,
    periodLifecycle: periodRow.readiness_lifecycle,
    deliverables: rows,
    readyByDeliverableId,
    commentsByDeliverableId,
    placementsByDeliverableId,
    currentReceiptsByPlacementId,
    releaseAuthorizationByDeliverableId,
  });
}
