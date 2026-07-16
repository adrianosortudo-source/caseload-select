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

/**
 * What an operator or publishing agent should do next for this placement.
 * "publish" is the only value that pairs with mayPublish=true; every other
 * value is a terminal or blocking state that mayPublish=false already
 * covers with its own reason, surfaced here as a stable machine-readable
 * label instead of forcing callers to pattern-match the reason string.
 */
export type PreflightNextAction =
  | "already_retired"
  | "already_published"
  | "needs_reverification"
  | "needs_verification"
  | "activate_period"
  | "approve_deliverable"
  | "resolve_version_drift"
  | "await_readiness"
  | "resolve_comments"
  | "publish";

export interface PreflightPlacementReport {
  placementId: string;
  deliverableId: string;
  deliverableTitle: string;
  destination: ContentPlacement["destination"];
  locale: string | null;
  intendedPath: string | null;
  requiredArtifactType: ContentPlacement["required_artifact_type"];
  placementState: ContentPlacement["state"];
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
  nextAction: PreflightNextAction;
}

export interface PreflightDeliverableGap {
  deliverableId: string;
  deliverableTitle: string;
}

export interface PreflightPeriodReport {
  periodId: string;
  periodLifecycle: PeriodLifecycle;
  placements: PreflightPlacementReport[];
  /**
   * Active, non-archived deliverables with zero placements. Silently
   * omitted from `placements` otherwise (there is nothing to push there
   * for them), which reads as "fully covered" when it is really an
   * uncovered gap -- surfaced explicitly instead.
   */
  deliverablesWithNoPlacements: PreflightDeliverableGap[];
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
    placementState: placement.state,
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

  // Idempotency checks first, ahead of the legal-gate checks below: a
  // retired placement or one that already has a receipt is a terminal or
  // in-flight state regardless of whether the deliverable would otherwise
  // pass every legal gate. Without this, a retired placement, or one with
  // an already-verified receipt, or one with a failed verification, all
  // returned mayPublish=true whenever the legal gates happened to pass --
  // "may publish" must never say yes to something already published or
  // deliberately retired.
  if (placement.state === "retired") {
    return { ...base, mayPublish: false, reason: "placement is retired", nextAction: "already_retired" };
  }
  if (currentReceipt) {
    if (currentReceipt.verification_state === "verified") {
      return {
        ...base,
        mayPublish: false,
        reason: "already published and verified",
        nextAction: "already_published",
      };
    }
    if (currentReceipt.verification_state === "failed") {
      return {
        ...base,
        mayPublish: false,
        reason: "the current receipt's verification failed; needs manual review before any republish",
        nextAction: "needs_reverification",
      };
    }
    // 'unverified' or 'reconciling': a publish attempt already happened
    // and has not been resolved yet. The next action is to verify the
    // existing receipt, not to create another one.
    return {
      ...base,
      mayPublish: false,
      reason: "a receipt exists for this placement but has not been verified yet",
      nextAction: "needs_verification",
    };
  }

  if (periodLifecycle !== "enforced") {
    return {
      ...base,
      mayPublish: false,
      reason:
        periodLifecycle === "legacy_unreconciled"
          ? "this period is historical and has not been reconciled against the readiness ledger"
          : "this period has not yet been activated for enforcement (setup required)",
      nextAction: "activate_period",
    };
  }
  if (deliverable.status !== "approved") {
    return {
      ...base,
      mayPublish: false,
      reason: `deliverable status is "${deliverable.status}", not approved`,
      nextAction: "approve_deliverable",
    };
  }
  if (deliverable.approved_version_id !== deliverable.current_version_id) {
    return {
      ...base,
      mayPublish: false,
      reason: "approved_version_id does not match current_version_id (version drift)",
      nextAction: "resolve_version_drift",
    };
  }
  if (!deliverableReady) {
    return {
      ...base,
      mayPublish: false,
      reason: "deliverable fails one or more publication readiness checks",
      nextAction: "await_readiness",
    };
  }
  if (unresolvedCommentCount > 0) {
    return {
      ...base,
      mayPublish: false,
      reason: `${unresolvedCommentCount} unresolved comment${unresolvedCommentCount === 1 ? "" : "s"} on this deliverable`,
      nextAction: "resolve_comments",
    };
  }
  return { ...base, mayPublish: true, reason: null, nextAction: "publish" };
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
  const deliverablesWithNoPlacements: PreflightDeliverableGap[] = [];
  for (const deliverable of input.deliverables) {
    if (deliverable.status === "archived") continue; // excluded, matches the readiness evaluator's own rule
    const deliverableReady = input.readyByDeliverableId[deliverable.id] ?? false;
    const comments = input.commentsByDeliverableId[deliverable.id] ?? [];
    const unresolvedCommentCount = countUnresolvedComments(comments);
    const deliverablePlacements = input.placementsByDeliverableId[deliverable.id] ?? [];
    if (deliverablePlacements.length === 0) {
      deliverablesWithNoPlacements.push({ deliverableId: deliverable.id, deliverableTitle: deliverable.title });
      continue;
    }
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
  return {
    periodId: input.periodId,
    periodLifecycle: input.periodLifecycle,
    placements,
    deliverablesWithNoPlacements,
  };
}
