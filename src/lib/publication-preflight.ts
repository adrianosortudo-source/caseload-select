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
 * Requires a per-deliverable canonical release-authorization result
 * (release-authorization.ts's isVersionReleaseAuthorized()) to ever report
 * mayPublish=true. There is no individual-approval-only fallback: when a
 * caller has no canonical result for a deliverable (an omitted
 * `releaseAuthorizationByDeliverableId` map, or a map with no entry for
 * that deliverable id -- e.g. because its current-version metadata could
 * not be resolved), this function returns mayPublish=false with the
 * explicit, machine-readable `reasonCode: "release_authorization_context_unavailable"`
 * rather than silently re-deriving authorization from
 * status/approved_version_id/current_version_id itself. A prior version of
 * this function DID have such a fallback; a re-audit (2026-07-21) rejected
 * it -- two callers of one function that can each mean something different
 * by "authorized," distinguished only by whether an optional argument was
 * remembered, is not a safe design, even though that fallback always failed
 * closed. See reportOnePlacement's own doc comment and
 * docs/publication-operator/publishing-agent-release-resolution-requirements-2026-07-20.md
 * §13.2f/§13.2g/§13.9 for the full history of this correction. Both real,
 * non-test callers -- release-graph-audit.ts and
 * publication-preflight-loader.ts (the live /publication-preflight route)
 * -- always supply a canonical result today. NOTE: /claim never calls this
 * function at all -- it enforces authorization solely and correctly via
 * claim_placement_for_publish() directly (see publication-placement-claims.ts).
 */

import type {
  ContentDeliverable,
  ContentPlacement,
  DeliverableComment,
  PublicationReceipt,
} from "@/lib/types";
import type { PeriodLifecycle } from "@/lib/publication-readiness";
import type { ReleaseAuthorizationResult } from "@/lib/release-authorization";

/**
 * Machine-readable codes for a subset of mayPublish=false reasons that
 * callers may need to branch on programmatically, not just display. Not
 * exhaustive -- most reasons remain prose-only in `reason` (version drift,
 * unresolved comments, placement lifecycle state, etc., none of which any
 * caller currently needs to distinguish programmatically). Extend this
 * union, narrowly, only when a real caller needs to branch on a specific
 * reason rather than merely display it.
 */
export type PreflightMayNotPublishReasonCode = "release_authorization_context_unavailable";

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
  /** Non-null ONLY for the specific, currently-narrow set of reasons a caller may need to branch on programmatically -- see PreflightMayNotPublishReasonCode. Null for every other reason (including mayPublish=true), which remain prose-only in `reason`. */
  reasonCode: PreflightMayNotPublishReasonCode | null;
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
   * (release-authorization.ts) -- OPTIONAL, but there is no fallback
   * interpretation when it is absent (see below).
   *
   * When a caller supplies this, it is used AS-IS: this function never
   * re-derives status/approved_version_id/current_version_id equality
   * itself. Both live, non-test callers supply it today:
   *   - release-graph-audit.ts computes it once per audit for fact 1/fact 7
   *     and passes the same result here so all three consumers agree.
   *   - publication-preflight-loader.ts (the live /publication-preflight
   *     route) computes it once per deliverable, reusing one
   *     getStandingAuthorizationState() read per firm.
   * publication-placement-claims.ts (the live /claim route) does NOT call
   * this function at all -- it enforces authorization solely via
   * claim_placement_for_publish() and was never affected by anything below.
   *
   * When omitted -- an omitted releaseAuthorizationByDeliverableId map on
   * buildPreflightReport's own input, or a map with no entry for this
   * deliverable id (e.g. because its current-version metadata could not be
   * resolved) -- this function does NOT fall back to re-deriving
   * authorization from status/approved_version_id/current_version_id
   * itself. It returns mayPublish=false with the explicit, machine-readable
   * reasonCode "release_authorization_context_unavailable". A prior version
   * of this function had exactly such a fallback; a re-audit (2026-07-21)
   * rejected it as unsafe DESIGN (never as an authorization bypass -- the
   * fallback always failed closed) precisely because one function silently
   * meant two different things by "authorized" depending on whether a
   * caller remembered an optional argument. See
   * docs/publication-operator/publishing-agent-release-resolution-requirements-2026-07-20.md
   * §13.9 for the full correction.
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
    // Every branch below returns mayPublish=true or a prose-only reason
    // EXCEPT the one explicit release_authorization_context_unavailable
    // branch, which overrides this default -- see that branch for why.
    reasonCode: null as PreflightMayNotPublishReasonCode | null,
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
  // No fallback interpretation of "authorized" when the canonical result is
  // absent -- fail closed EXPLICITLY, with a machine-readable code, rather
  // than silently re-deriving a narrower authorization rule from
  // status/approved_version_id/current_version_id. Covers every cause of
  // absence identically: an omitted releaseAuthorizationByDeliverableId map
  // on buildPreflightReport's own input, or a map that simply has no entry
  // for this deliverable id (including because the caller could not
  // resolve this deliverable's current-version metadata at all).
  if (!releaseAuthorization) {
    return {
      ...base,
      mayPublish: false,
      reason: `release_authorization_context_unavailable: no canonical release-authorization result was supplied for this deliverable's current version (missing releaseAuthorizationByDeliverableId map, or no entry for deliverable id ${deliverable.id}). This is an explicit, fail-closed stop -- never a silent fallback to a narrower authorization interpretation.`,
      reasonCode: "release_authorization_context_unavailable",
    };
  }
  if (!releaseAuthorization.authorized) {
    return {
      ...base,
      mayPublish: false,
      reason: `not release-authorized (${releaseAuthorization.kind}): ${releaseAuthorization.reason}`,
    };
  }
  // Authorized through either canonical path -- fall through to the
  // readiness/comments/lifecycle/receipt checks below.
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
