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
 *
 * mayPublish=true is a NECESSARY precondition, not sufficient permission
 * to act (corrective-release finding 4). This function is read-only and
 * makes no database write, so two concurrent callers can both read
 * mayPublish=true for the same placement/version and both believe they
 * may proceed. The actual atomic authority is
 * claim_placement_for_publish() (see publication-placement-claims.ts and
 * supabase/migrations/20260716150130_publication_placement_claims.sql),
 * which locks the deliverable and placement rows, re-runs these same
 * readiness conditions under lock, and issues a stable claim only one
 * caller can hold per placement at a time. A publishing agent must obtain
 * a claim before acting; a mayPublish=true report on its own is never
 * sufficient.
 *
 * Optionally accepts a per-deliverable canonical release-authorization
 * result (release-authorization.ts's isVersionReleaseAuthorized()) so a
 * caller that already resolved the two-path authorization bar can have this
 * function defer to it instead of this function's own, narrower,
 * individual-approval-only default check. Both real, non-test callers of
 * this function -- release-graph-audit.ts and, as of the §13.2g correction,
 * publication-preflight-loader.ts (the live /publication-preflight route)
 * -- now supply it; the individual-approval-only default exists only for
 * backward compatibility with any caller that genuinely cannot resolve
 * standing-authorization state, and is not exercised by any live route
 * today. NOTE: /claim never calls this function at all -- it enforces
 * authorization solely and correctly via claim_placement_for_publish()
 * directly (see publication-placement-claims.ts) and was never affected by
 * either version of this default. See reportOnePlacement's own doc comment
 * and docs/publication-operator/publishing-agent-release-resolution-requirements-2026-07-20.md
 * §13.2f/§13.2g for the full history of this correction.
 */

import type {
  ContentDeliverable,
  ContentPlacement,
  DeliverableComment,
  PublicationReceipt,
} from "@/lib/types";
import type { PeriodLifecycle } from "@/lib/publication-readiness";
import type { ReleaseAuthorizationResult } from "@/lib/release-authorization";

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
  // Workstream 4: a non-archived deliverable with zero rows in
  // placementsByDeliverableId never enters the placements loop below, so
  // without this list it silently vanishes from the report -- a real
  // publishing-coverage gap (this deliverable has nowhere to go) that
  // reads identically to "nothing to do here" unless surfaced explicitly.
  deliverablesWithNoPlacements: Array<{ deliverableId: string; deliverableTitle: string }>;
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
  /**
   * The canonical two-path release-authorization result for this exact
   * deliverable/version, from isVersionReleaseAuthorized()
   * (release-authorization.ts) -- OPTIONAL and backward-compatible.
   *
   * When a caller supplies this, it is used AS-IS: this function never
   * re-derives status/approved_version_id/current_version_id equality
   * itself when a canonical result is present. Both live, non-test callers
   * supply it as of the §13.2g correction:
   *   - release-graph-audit.ts computes it once per audit for fact 1/fact 7
   *     and passes the same result here so all three consumers agree.
   *   - publication-preflight-loader.ts (the live /publication-preflight
   *     route) computes it once per deliverable, reusing one
   *     getStandingAuthorizationState() read per firm -- an independent
   *     adversarial audit (2026-07-21) confirmed this route was previously
   *     the one real production surface silently using the narrower
   *     individual-approval-only default below, which could falsely report
   *     a standing-authorized release as blocked; this correction closes
   *     that gap.
   * publication-placement-claims.ts (the live /claim route) does NOT call
   * this function at all -- it was never affected by either default, and
   * must never be described as such (a documentation error corrected the
   * same day this comment was updated).
   *
   * When omitted -- today, exercised only by publication-preflight.test.ts,
   * exercising this function's own degrade-gracefully contract for a
   * hypothetical future caller that cannot resolve standing-authorization
   * state -- this function falls back to its own original
   * individual-approval-only check, UNCHANGED, preserving the exact reason
   * strings that test file already locks in. That fallback still fails
   * closed (mayPublish is never true when it would not otherwise be), so
   * omitting this parameter is safe, just narrower than the canonical rule.
   */
  releaseAuthorization?: ReleaseAuthorizationResult;
}): PreflightPlacementReport {
  const { periodLifecycle, deliverable, deliverableReady, placement, unresolvedCommentCount, currentReceipt, releaseAuthorization } =
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
  if (releaseAuthorization) {
    if (!releaseAuthorization.authorized) {
      return {
        ...base,
        mayPublish: false,
        reason: `not release-authorized (${releaseAuthorization.kind}): ${releaseAuthorization.reason}`,
      };
    }
    // Authorized through either canonical path -- fall through to the
    // readiness/comments/lifecycle/receipt checks below, same as before.
  } else {
    // Backward-compatible default for every caller that has not supplied
    // the canonical two-path result: the original individual-approval-only
    // check, unchanged.
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

  // Workstream 4: placement.state and the current receipt's
  // verification_state were never consulted here, so a retired placement,
  // one already published, or one with an unresolved (or even a
  // successfully verified) receipt all reported mayPublish=true if the
  // deliverable-level gates above happened to pass -- a caller re-running
  // preflight against the same placement could republish it indefinitely.
  // These two checks make the report idempotent: once a placement has
  // moved past "ready" or already carries a receipt, mayPublish is false
  // with a reason naming exactly why, matching the fail-closed contract
  // this file's own docstring states.
  if (placement.state === "retired") {
    return { ...base, mayPublish: false, reason: "placement is retired, no longer intended for publication" };
  }
  if (placement.state === "published") {
    return { ...base, mayPublish: false, reason: "placement is already marked published" };
  }
  if (placement.state === "planned") {
    return { ...base, mayPublish: false, reason: "placement has not been marked ready for publication" };
  }
  if (currentReceipt) {
    const reasonByState: Record<PublicationReceipt["verification_state"], string> = {
      verified: "a receipt for this placement already exists and is verified",
      failed: "a previous publish attempt for this placement failed verification; investigate before retrying",
      unverified: "a receipt for this placement already exists and has not yet been verified",
      reconciling: "a receipt correction is in progress for this placement",
    };
    return { ...base, mayPublish: false, reason: reasonByState[currentReceipt.verification_state] };
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
  /** See reportOnePlacement's own doc comment: optional, backward-compatible, canonical two-path authorization result per deliverable id. Omitted by every caller except release-graph-audit.ts today. */
  releaseAuthorizationByDeliverableId?: Record<string, ReleaseAuthorizationResult>;
}): PreflightPeriodReport {
  const placements: PreflightPlacementReport[] = [];
  const deliverablesWithNoPlacements: Array<{ deliverableId: string; deliverableTitle: string }> = [];
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
          releaseAuthorization: input.releaseAuthorizationByDeliverableId?.[deliverable.id],
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
