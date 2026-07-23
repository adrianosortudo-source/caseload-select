/**
 * The canonical two-path release-authorization bar: the ONE interpretation
 * of "is this version release-authorized" for the entire Content Studio
 * publishing surface, ported faithfully from claim_placement_for_publish()
 * (supabase/migrations/20260717230956_standing_publishing_authorization.sql,
 * the Path A / Path B branch at lines 407-439) -- the actual, authoritative
 * enforcement of this rule in this codebase. No other pure, importable
 * TypeScript implementation of it exists: the RPC itself is the only real
 * enforcement, and calling it performs a database write (it creates a
 * publication_placement_claims row), which read-only callers (a preflight
 * report, a dry-run audit) must never do. This module is a faithful,
 * read-only port of that same decision -- one shared helper every other
 * authorization-aware module in this codebase composes with, never a
 * second, competing rule reinvented locally.
 *
 * A version is release-authorized only through EITHER:
 *   A. individual lawyer approval of that exact version
 *      (deliverableStatus === "approved" AND approvedVersionId === targetVersionId); or
 *   B. an active standing publishing authorization for the firm, PROVIDED
 *      the version is not flagged requires_individual_review -- that flag
 *      always overrides path B unconditionally and is checked BEFORE the
 *      firm's authorization state is ever consulted, exactly as the RPC
 *      rejects on that flag first.
 * There is no third path. Every caller in this codebase must call
 * isVersionReleaseAuthorized() and use its result as-is; no function may
 * reconstruct any part of this decision independently (re-comparing
 * approved_version_id, re-checking requires_individual_review, or
 * re-reading standing-authorization state to arrive at its own yes/no).
 *
 * The RPC's own third precondition -- the target version must be the
 * deliverable's current_version_id -- is not re-checked here because every
 * caller in this codebase only ever evaluates a deliverable's actual
 * current version; callers passing a different version are responsible for
 * that invariant themselves.
 *
 * No I/O. No Supabase.
 */

export type ReleaseAuthorizationPath = "individual_approval" | "standing_authorization";

/**
 * Six named outcomes, matching this bar's actual decision tree:
 *   individually_approved            - Path A: deliverableStatus="approved"
 *                                       and approvedVersionId===targetVersionId.
 *   blocked_requires_individual_review - the version is flagged
 *                                       requires_individual_review=true,
 *                                       which overrides Path B unconditionally
 *                                       (checked before standing-authorization
 *                                       state is ever consulted, and Path A
 *                                       already failed to match by this point).
 *   standing_authorization            - Path B: not flagged
 *                                       requires_individual_review, and the
 *                                       firm's standing publishing
 *                                       authorization is currently active.
 *   approved_version_mismatch         - neither path matched, AND there IS a
 *                                       recorded individual approval
 *                                       (approvedVersionId is non-null) --
 *                                       just for a DIFFERENT version than the
 *                                       one being evaluated. Named separately
 *                                       from standing_authorization_inactive
 *                                       because it carries more specific,
 *                                       actionable evidence (a stale approval
 *                                       exists on record).
 *   standing_authorization_inactive   - neither path matched, no individual
 *                                       approval is on record at all
 *                                       (approvedVersionId is null), and the
 *                                       firm's standing publishing
 *                                       authorization is not active.
 *   no_release_authorization          - reserved for a more granular signal
 *                                       this codebase's current data does not
 *                                       yet distinguish (e.g. a firm that has
 *                                       NEVER configured standing
 *                                       authorization at all, vs. one that
 *                                       configured then explicitly revoked
 *                                       it -- getStandingAuthorizationState()
 *                                       only exposes a current active
 *                                       boolean, not that history). Not
 *                                       currently reachable by any input this
 *                                       function accepts; named now, exactly
 *                                       like this codebase's own precedent
 *                                       for a defined-but-dormant outcome
 *                                       (release-graph-audit.ts's
 *                                       compliance_wrapper_missing "bound"
 *                                       state), so a future caller that gains
 *                                       that finer signal has a name to use
 *                                       without inventing one ad hoc.
 */
export type ReleaseAuthorizationResultKind =
  | "individually_approved"
  | "standing_authorization"
  | "blocked_requires_individual_review"
  | "standing_authorization_inactive"
  | "approved_version_mismatch"
  | "no_release_authorization";

export interface ReleaseAuthorizationInput {
  deliverableStatus: string;
  approvedVersionId: string | null;
  targetVersionId: string;
  versionRequiresIndividualReview: boolean;
  /** This firm's CURRENT standing-authorization state (standing-publishing-authorization.ts's getStandingAuthorizationState().active) -- never historical presence; see this function's own doc comment on why "ever configured" is not a distinction this input can make. */
  standingAuthorizationActive: boolean;
}

export interface ReleaseAuthorizationResult {
  kind: ReleaseAuthorizationResultKind;
  authorized: boolean;
  authorizationPath: ReleaseAuthorizationPath | null;
  /** Human-readable explanation, always naming the actual path or the actual reason it was denied -- never "approved" for a standing-authorized version, never "standing authorization" described as approval of legal content. */
  reason: string;
  /** Evidence identifiers/state this decision was made from, carried through verbatim so no caller needs to re-derive or re-fetch them to explain the result. */
  approvedVersionId: string | null;
  targetVersionId: string;
  versionRequiresIndividualReview: boolean;
  standingAuthorizationActive: boolean;
}

export function isVersionReleaseAuthorized(input: ReleaseAuthorizationInput): ReleaseAuthorizationResult {
  const evidence = {
    approvedVersionId: input.approvedVersionId,
    targetVersionId: input.targetVersionId,
    versionRequiresIndividualReview: input.versionRequiresIndividualReview,
    standingAuthorizationActive: input.standingAuthorizationActive,
  };

  // Individual approval requires BOTH conditions -- status="approved" AND
  // an ID match -- exactly as claim_placement_for_publish() does. This is
  // deliberately computed once and reused below: every branch past this
  // point that describes why individual approval did NOT apply must
  // describe the ACTUAL reason (status wrong, ID wrong, or both), never
  // assume it was the ID specifically. An independent adversarial audit
  // (2026-07-21) found the ID-mismatch wording was asserted unconditionally
  // in a state where the IDs can, in fact, match (status="draft" or similar
  // with approved_version_id already equal to the evaluated version) --
  // every reason string below now names only what is actually true.
  const approvedVersionIdMatches = input.approvedVersionId === input.targetVersionId;

  if (input.deliverableStatus === "approved" && approvedVersionIdMatches) {
    return {
      kind: "individually_approved",
      authorized: true,
      authorizationPath: "individual_approval",
      reason: `Release-authorized through individual version approval: deliverable status is "approved" and approved_version_id matches the evaluated version (${input.targetVersionId}).`,
      ...evidence,
    };
  }

  // Individual approval did not apply here -- describe precisely why, since
  // this codebase's data can reach this point either because the ID didn't
  // match, or because it matched but the deliverable's status was not
  // "approved" (e.g. a later edit reverted status without clearing
  // approved_version_id). Both are real, distinct, reachable states.
  const individualApprovalGapReason = approvedVersionIdMatches
    ? `approved_version_id matches the evaluated version (${input.targetVersionId}), but deliverableStatus="${input.deliverableStatus}" is not "approved" -- both conditions are required for individual approval`
    : input.approvedVersionId !== null
      ? `approved_version_id=${input.approvedVersionId} does not match the evaluated version (${input.targetVersionId})`
      : `approved_version_id is null -- this version has never been individually approved`;

  if (input.versionRequiresIndividualReview) {
    return {
      kind: "blocked_requires_individual_review",
      authorized: false,
      authorizationPath: null,
      reason: `Not release-authorized: version ${input.targetVersionId} is flagged requires_individual_review=true, which overrides any standing publishing authorization unconditionally. ${individualApprovalGapReason}, so individual approval does not apply either.`,
      ...evidence,
    };
  }

  if (input.standingAuthorizationActive) {
    return {
      kind: "standing_authorization",
      authorized: true,
      authorizationPath: "standing_authorization",
      reason: `Release-authorized through active standing publishing authorization for this firm (version ${input.targetVersionId} is not flagged requires_individual_review).`,
      ...evidence,
    };
  }

  if (input.approvedVersionId !== null) {
    return {
      kind: "approved_version_mismatch",
      authorized: false,
      authorizationPath: null,
      reason: `Not release-authorized: ${individualApprovalGapReason}, and this firm has no active standing publishing authorization to cover the current one.`,
      ...evidence,
    };
  }

  return {
    kind: "standing_authorization_inactive",
    authorized: false,
    authorizationPath: null,
    reason: `Not release-authorized: version ${input.targetVersionId} has never been individually approved, and this firm's standing publishing authorization is not currently active.`,
    ...evidence,
  };
}
