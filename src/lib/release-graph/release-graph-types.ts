/**
 * Release-graph audit domain types (`resolve_and_audit_release_graph`).
 *
 * Formalizes a new, mandatory preflight stage layered on top of the
 * existing publication-readiness.ts / publication-preflight.ts /
 * channel-validation.ts pipeline (all pure or read-only, all reused here —
 * see release-graph-audit.ts's doc comment for exactly what is reused vs.
 * new). For every proposed release (one deliverable version × one intended
 * destination placement) this stage resolves and records ten facts and
 * classifies every gap found into one of fifteen precise categories —
 * never a single generic "blocked."
 *
 * This module is audit-only. It creates no placement, claim, receipt, or
 * artifact row; it writes nothing anywhere; it calls no external API. See
 * docs/publication-operator/publishing-agent-release-resolution-requirements-2026-07-20.md
 * §13 for the full specification this module implements.
 */

/** The ten facts resolve_and_audit_release_graph must resolve and record for every proposed release. */
export type ReleaseGraphFact =
  | "release_authorized_source_version"
  | "intended_destination_surface"
  | "canonical_public_destination_route"
  | "required_visual_rendition"
  | "required_downloadable_artifact"
  | "cta_target_live_and_correct"
  | "compliance_wrapper_and_sender"
  | "channel_authorization_availability"
  | "preview_artifact_current_and_faithful"
  | "publication_evidence_receipt";

/** The fifteen gap classifications. Exhaustive -- do not add a sixteenth without updating the addendum. */
export type GapClassification =
  | "content_absent"
  | "source_path_unverified"
  | "renderer_derived_metadata"
  | "destination_required_metadata_missing"
  | "destination_target_unresolved"
  | "required_downloadable_artifact_missing"
  | "required_visual_rendition_missing"
  | "visual_rendition_role_mismatch"
  | "visual_safe_area_violation"
  | "preview_not_publish_faithful"
  | "compliance_wrapper_missing"
  | "channel_auth_missing"
  | "unsubscribe_endpoint_pending"
  | "publication_receipt_missing"
  | "ambiguous_external_state";

/**
 * Website article/homepage media must be textless (headline rendered live
 * in HTML/CSS over a plain photo); LinkedIn/GBP/OG media may be a
 * pre-composed card with the headline baked into the image bytes. These
 * are two different objects with two different validation rules -- an
 * agent must never treat one as a substitute for the other. See
 * visual_rendition_role_mismatch.
 */
export type VisualRenditionRole = "textless_html_headline" | "baked_editorial_card";

/**
 * How a single finding affects THIS release, distinct from the release-
 * level verdict (ReleaseVerdict) it rolls up into:
 *   blocks_today                     - a genuine, current, content/config
 *                                       gap for this exact release; fixable
 *                                       by an operator/lawyer action today.
 *   can_publish_with_existing_renderer - the fact resolves, though via a
 *                                       fallback/approximation rather than
 *                                       the ideal path (e.g. a
 *                                       platform-format preview instead of
 *                                       a live embed); not itself blocking.
 *   needs_human_confirmation          - not definitively broken, but a
 *                                       human must look before this can
 *                                       proceed (an unresolved ambiguity,
 *                                       an unverified source path).
 *   system_improvement                - blocked by a missing SYSTEM
 *                                       capability (no engineering exists
 *                                       for this yet) rather than by
 *                                       anything specific to this release's
 *                                       content.
 */
export type ReleaseImpact =
  | "blocks_today"
  | "can_publish_with_existing_renderer"
  | "needs_human_confirmation"
  | "system_improvement";

/**
 * The eight required structured-output fields for every finding, plus the
 * identifying metadata (classification/fact/summary) needed to locate and
 * group findings. Every field is a plain string (or the typed enum) --
 * never left as an empty placeholder; a resolver that cannot fill a field
 * honestly must not report the finding at all.
 */
export interface ReleaseGraphFinding {
  /** Which of the fifteen classifications this finding is. */
  classification: GapClassification;
  /** Which of the ten facts this finding was found while resolving. */
  fact: ReleaseGraphFact;
  /** Short, human title for report grouping, e.g. "PDF missing". */
  summary: string;

  // The eight required structured-output fields (task specification, verbatim order):
  releaseImpact: ReleaseImpact;
  factualEvidence: string;
  canonicalSourceConsulted: string;
  immediateDisposition: string;
  rootCause: string;
  proposedDurableSolution: string;
  authorityRequired: string;
  reusablePreflightRule: string;
}

/** The release-level verdict a human-readable operator report groups releases under. */
export type ReleaseVerdict = "publish_now" | "hold" | "needs_verification" | "system_improvement";

export const RELEASE_VERDICT_LABEL: Record<ReleaseVerdict, string> = {
  publish_now: "Publish now",
  hold: "Hold",
  needs_verification: "Needs verification",
  system_improvement: "System improvement",
};

/** The full audit result for one deliverable version × one destination placement. */
export interface ReleaseGraphAudit {
  deliverableId: string;
  deliverableTitle: string;
  versionId: string;
  versionNumber: number | null;
  placementId: string;
  destination: string;
  locale: string | null;
  verdict: ReleaseVerdict;
  findings: ReleaseGraphFinding[];
  /**
   * The existing publication-preflight.ts gate (approval status, version
   * drift, unresolved comments, placement lifecycle state, current receipt
   * verification state) reused verbatim, not re-derived. Present so a
   * report reader can see the full picture without a second query, but
   * this module never re-implements what that gate already decides.
   */
  existingPreflightGate: { mayPublish: boolean; reason: string | null };
  resolvedAt: string;
}

/** Audit result for a deliverable with no placements at all -- reported, never silently dropped. */
export interface ReleaseGraphNoPlacementAudit {
  deliverableId: string;
  deliverableTitle: string;
  verdict: "needs_verification";
  findings: ReleaseGraphFinding[];
  resolvedAt: string;
}
