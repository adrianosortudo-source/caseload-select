/**
 * Publication Operator, Workstream 2: the preflight status taxonomy.
 *
 * Existing publication-preflight.ts already computes a binary mayPublish +
 * a single reason string per placement. This module sits ON TOP of a
 * PublicationExecutionManifest (never re-derives readiness itself) and
 * classifies the outcome into the seven distinct states the Publication
 * Operator brief requires, so an operator or a dry-run report can tell "the
 * lawyer hasn't approved this yet" apart from "the destination isn't
 * configured" apart from "this was already published" -- all of which
 * mayPublish=false collapses into one boolean today.
 *
 * Precedence, evaluated in this fixed order (matches the existing
 * fail-closed posture: the most specific, most-actionable state wins):
 *   1. already_published        -- a verified receipt already exists for
 *                                   this exact placement + approved version.
 *   2. ambiguous_external_state -- a receipt exists but is unverified,
 *                                   failed, or mid-reconciliation: the
 *                                   external state is not settled, and a
 *                                   fresh publish attempt would be unsafe
 *                                   to reason about without reconciling
 *                                   first.
 *   3. blocked_content          -- the manifest itself is blocked on a
 *                                   content/approval/metadata reason
 *                                   (never individually correctable by
 *                                   fixing destination config or auth).
 *   4. blocked_authorization    -- no release authorization path is
 *                                   currently available (neither
 *                                   individually approved nor covered by
 *                                   an active standing authorization).
 *   5. blocked_missing_configuration -- content and authorization are both
 *                                   fine, but the destination itself (an
 *                                   account/location/site, a resolvable
 *                                   canonical URL, a required asset) is not
 *                                   configured.
 *   6. blocked_destination_validation -- content, authorization, and
 *                                   configuration are all fine, but the
 *                                   destination-specific format/config
 *                                   check (publication-destination-
 *                                   validators.ts) found a blocking issue
 *                                   (e.g. over the platform's character
 *                                   limit).
 *   7. ready                    -- every gate above passed.
 */

import type { PublicationExecutionManifest } from "@/lib/publication-execution-manifest";
import {
  validateDestinationFormat,
  type DestinationValidationIssue,
} from "@/lib/publication-destination-validators";

export type PreflightStatusCategory =
  | "ready"
  | "blocked_content"
  | "blocked_missing_configuration"
  | "blocked_authorization"
  | "blocked_destination_validation"
  | "already_published"
  | "ambiguous_external_state";

export interface PublicationPreflightStatus {
  category: PreflightStatusCategory;
  reasons: string[];
  destinationIssues: DestinationValidationIssue[];
}

const CONTENT_REASON_MARKERS = [
  'status is "',
  "version drift",
  "approved version record could not be loaded",
  "no body_html",
  "no locale set",
  "no deliverable_role set",
  "does not belong to this deliverable",
  "neither body_html nor asset_sha256",
  "publication_path/intended_path is not set",
  "no registered asset of required type",
];

const CONFIGURATION_REASON_MARKERS = [
  "destination not configured",
  "canonical destination URL could not be resolved",
];

const AUTHORIZATION_REASON_MARKERS = [
  "requires_individual_review",
  "no release authorization path",
];

function classifyReason(reason: string): "content" | "configuration" | "authorization" | "other" {
  if (CONTENT_REASON_MARKERS.some((m) => reason.includes(m))) return "content";
  if (CONFIGURATION_REASON_MARKERS.some((m) => reason.includes(m))) return "configuration";
  if (AUTHORIZATION_REASON_MARKERS.some((m) => reason.includes(m))) return "authorization";
  return "other";
}

export function evaluatePublicationPreflightStatus(
  manifest: PublicationExecutionManifest,
): PublicationPreflightStatus {
  const priorState = manifest.destinationMetadata.priorReceiptVerificationState as
    | "verified"
    | "unverified"
    | "failed"
    | "reconciling"
    | null;

  if (priorState === "verified") {
    return {
      category: "already_published",
      reasons: ["a verified publication receipt already exists for this placement and approved version"],
      destinationIssues: [],
    };
  }
  if (priorState === "unverified" || priorState === "failed" || priorState === "reconciling") {
    return {
      category: "ambiguous_external_state",
      reasons: [
        priorState === "unverified"
          ? "a receipt exists for this placement but has not yet been verified"
          : priorState === "failed"
            ? "a previous publish attempt for this placement failed verification and has not been reconciled"
            : "a receipt correction is in progress for this placement (reconciling)",
      ],
      destinationIssues: [],
    };
  }

  const claimReason = manifest.blockReasons.find((r) => r.includes("active publication claim already exists"));
  if (claimReason) {
    return { category: "ambiguous_external_state", reasons: [claimReason], destinationIssues: [] };
  }

  const contentReasons = manifest.blockReasons.filter((r) => classifyReason(r) === "content");
  if (contentReasons.length > 0) {
    return { category: "blocked_content", reasons: contentReasons, destinationIssues: [] };
  }

  const authorizationReasons = manifest.blockReasons.filter((r) => classifyReason(r) === "authorization");
  if (authorizationReasons.length > 0) {
    return { category: "blocked_authorization", reasons: authorizationReasons, destinationIssues: [] };
  }

  const configurationReasons = manifest.blockReasons.filter((r) => classifyReason(r) === "configuration");
  if (configurationReasons.length > 0) {
    return { category: "blocked_missing_configuration", reasons: configurationReasons, destinationIssues: [] };
  }

  // Any remaining, unclassified blockReasons (defense in depth for a future
  // reason string this module hasn't been taught to categorize) are treated
  // as content-blocking rather than silently defaulting to ready -- fails
  // closed, matching every other evaluator in this codebase.
  const otherReasons = manifest.blockReasons.filter((r) => classifyReason(r) === "other");
  if (otherReasons.length > 0) {
    return { category: "blocked_content", reasons: otherReasons, destinationIssues: [] };
  }

  const destinationIssues = validateDestinationFormat(manifest);
  const blockingIssues = destinationIssues.filter((i) => i.severity === "block");
  if (blockingIssues.length > 0) {
    return {
      category: "blocked_destination_validation",
      reasons: blockingIssues.map((i) => i.message),
      destinationIssues,
    };
  }

  return { category: "ready", reasons: [], destinationIssues };
}
