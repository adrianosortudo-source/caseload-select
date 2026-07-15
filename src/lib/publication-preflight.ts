/**
 * Content Studio publishing evidence system, Workstream 7: the preflight
 * report. Per PLACEMENT (not per deliverable, since one deliverable can
 * have several placements -- Workstream 4), reports exactly what an
 * operator or a publishing agent needs before acting: approved/current
 * version identity, destination, locale, path, required artifact,
 * readiness, unresolved comments, the current receipt if one exists, and
 * mayPublish with the exact reason when it is false.
 *
 * "A publishing agent may act only on may_publish=true" (mega-assignment
 * doctrine): this function is the single place that decides that boolean,
 * so no caller re-derives it independently. Fails closed by construction:
 * every branch that is not an explicit pass returns mayPublish=false with
 * a stated reason; there is no default-true path.
 */

import type {
  ContentDeliverable,
  ContentPlacement,
  DeliverableComment,
  PublicationReceipt,
} from "@/lib/types";
import type { PeriodLifecycle } from "@/lib/publication-readiness";

export interface PreflightPlacementReport {
  placementId: string;
  deliverableId: string;
  deliverableTitle: string;
  destination: ContentPlacement["destination"];
  locale: string | null;
  intendedPath: string | null;
  requiredArtifactType: ContentPlacement["required_artifact_type"];
  approvedVersionId: string | null;
  currentVersionId: string | null;
  deliverableReady: boolean;
  unresolvedCommentCount: number;
  currentReceipt: {
    id: string;
    verificationState: PublicationReceipt["verification_state"];
    publishedAt: string;
    publicUrl: string | null;
    externalPostId: string | null;
  } | null;
  mayPublish: boolean;
  reason: string | null;
}

export interface PreflightPeriodReport {
  periodId: string;
  periodLifecycle: PeriodLifecycle;
  placements: PreflightPlacementReport[];
}

function countUnresolvedComments(comments: DeliverableComment[]): number {
  // A reply threaded under a change-request record (approval_record_id set)
  // is not itself an open review comment; only unresolved, non-reply
  // comments count (matching the deliverables review UI's own count).
  return comments.filter((c) => !c.resolved && !c.approval_record_id).length;
}

function reportOnePlacement(input: {
  periodLifecycle: PeriodLifecycle;
  deliverable: ContentDeliverable;
  deliverableReady: boolean;
  placement: ContentPlacement;
  unresolvedCommentCount: number;
  currentReceipt: PublicationReceipt | null;
}): PreflightPlacementReport {
  const { periodLifecycle, deliverable, deliverableReady, placement, unresolvedCommentCount, currentReceipt } =
    input;

  const base = {
    placementId: placement.id,
    deliverableId: deliverable.id,
    deliverableTitle: deliverable.title,
    destination: placement.destination,
    locale: placement.locale,
    intendedPath: placement.intended_path,
    requiredArtifactType: placement.required_artifact_type,
    approvedVersionId: deliverable.approved_version_id,
    currentVersionId: deliverable.current_version_id,
    deliverableReady,
    unresolvedCommentCount,
    currentReceipt: currentReceipt
      ? {
          id: currentReceipt.id,
          verificationState: currentReceipt.verification_state,
          publishedAt: currentReceipt.published_at,
          publicUrl: currentReceipt.public_url,
          externalPostId: currentReceipt.external_post_id,
        }
      : null,
  };

  if (periodLifecycle !== "enforced") {
    return {
      ...base,
      mayPublish: false,
      reason:
        periodLifecycle === "legacy_unreconciled"
          ? "this period is historical and has not been reconciled against the readiness ledger"
          : "this period has not yet been activated for enforcement (setup required)",
    };
  }
  if (deliverable.status !== "approved") {
    return { ...base, mayPublish: false, reason: `deliverable status is "${deliverable.status}", not approved` };
  }
  if (deliverable.approved_version_id !== deliverable.current_version_id) {
    return {
      ...base,
      mayPublish: false,
      reason: "approved_version_id does not match current_version_id (version drift)",
    };
  }
  if (!deliverableReady) {
    return { ...base, mayPublish: false, reason: "deliverable fails one or more publication readiness checks" };
  }
  if (unresolvedCommentCount > 0) {
    return {
      ...base,
      mayPublish: false,
      reason: `${unresolvedCommentCount} unresolved comment${unresolvedCommentCount === 1 ? "" : "s"} on this deliverable`,
    };
  }
  return { ...base, mayPublish: true, reason: null };
}

export function buildPreflightReport(input: {
  periodId: string;
  periodLifecycle: PeriodLifecycle;
  deliverables: ContentDeliverable[];
  readyByDeliverableId: Record<string, boolean>;
  commentsByDeliverableId: Record<string, DeliverableComment[]>;
  placementsByDeliverableId: Record<string, ContentPlacement[]>;
  currentReceiptsByPlacementId: Record<string, PublicationReceipt | null>;
}): PreflightPeriodReport {
  const placements: PreflightPlacementReport[] = [];
  for (const deliverable of input.deliverables) {
    if (deliverable.status === "archived") continue; // excluded, matches the readiness evaluator's own rule
    const deliverableReady = input.readyByDeliverableId[deliverable.id] ?? false;
    const comments = input.commentsByDeliverableId[deliverable.id] ?? [];
    const unresolvedCommentCount = countUnresolvedComments(comments);
    const deliverablePlacements = input.placementsByDeliverableId[deliverable.id] ?? [];
    for (const placement of deliverablePlacements) {
      placements.push(
        reportOnePlacement({
          periodLifecycle: input.periodLifecycle,
          deliverable,
          deliverableReady,
          placement,
          unresolvedCommentCount,
          currentReceipt: input.currentReceiptsByPlacementId[placement.id] ?? null,
        }),
      );
    }
  }
  return { periodId: input.periodId, periodLifecycle: input.periodLifecycle, placements };
}
