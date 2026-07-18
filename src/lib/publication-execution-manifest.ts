/**
 * Publication Operator, Workstream 1: PublicationExecutionManifest.
 *
 * One typed, immutable manifest binding an approved deliverable version to
 * ONE explicit placement. A deliverable with several placements (an article
 * on the website plus a companion LinkedIn post) gets several manifests, one
 * per placement -- never a single manifest that tries to cover more than one
 * destination, matching content_placements' own "one deliverable, several
 * independent placements" model (content-placements.ts).
 *
 * This module is pure: it never queries Supabase, never calls the claim RPC,
 * never fetches a URL. Every fact it reports is supplied by its caller (the
 * loader, publication-execution-manifest-loader.ts), which is solely
 * responsible for pulling those facts from stored, immutable records. A
 * request body must never be able to supply a field here that should come
 * from the database -- this module has no request-body-shaped input at all,
 * by construction.
 *
 * "A missing required field blocks the manifest. Never fall back to
 * generated copy" (Publication Operator brief): every field below is either
 * the exact stored value or explicitly null, and a null in a required slot
 * adds to blockReasons rather than being silently defaulted or invented.
 * This mirrors the existing codebase's own "No Invention" posture (see
 * publication-preflight.ts, channel-validation.ts) rather than introducing a
 * new one.
 *
 * releaseAuthorizationPath here is a READ-ONLY, PROSPECTIVE re-derivation of
 * claim_placement_for_publish()'s own path-A/path-B gate
 * (publication-placement-claims.ts, supabase/migrations/
 * 20260717230956_standing_publishing_authorization.sql) for display and
 * dry-run purposes only. It is never authoritative and never substitutes
 * for actually calling the RPC: two concurrent manifests can both compute
 * releaseAuthorizationPath !== null for the same placement and only one
 * claim can ever succeed. Same caveat publication-preflight.ts already
 * states for mayPublish.
 */

import { createHash } from "crypto";
import type {
  ContentDeliverable,
  DeliverableVersion,
  ContentPlacement,
  PublicationArtifact,
  PublicationArtifactType,
  PlacementDestination,
  PublicationReceipt,
} from "@/lib/types";
import type { PeriodLifecycle } from "@/lib/publication-readiness";

/**
 * Mirrors publication-placement-claims.ts's own ReleasePath type exactly.
 * Not imported from there directly: that module carries `import
 * "server-only"`, and pulling it into this pure module's dependency graph
 * (even as a type-only import) has been observed to destabilize Vite's
 * dependency pre-bundling for "server-only"'s conditional exports when a
 * test file also loads a second, unrelated "server-only" module (e.g.
 * channel-validation.ts) in the same run -- an environment fragility, not
 * a behavioral need for the real module. Keep this literal union in sync
 * with ReleasePath by hand; it is two string literals, not a type worth a
 * cross-module dependency.
 */
export type ReleasePath = "individual_approval" | "standing_authorization";

export const MANIFEST_SCHEMA_VERSION = "publication-execution-manifest-1.0";

export interface ManifestAsset {
  artifactId: string;
  artifactType: PublicationArtifactType;
  storageBucket: string | null;
  storagePath: string | null;
  publicUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
}

export interface ManifestGeneratorIdentity {
  role: "operator" | "lawyer" | "system";
  id: string | null;
  name: string | null;
}

export interface ManifestDestinationAccount {
  /** Whether a real, previously-verified destination account/location/site is on record for this firm+destination. Never inferred or guessed. */
  configured: boolean;
  /** The account/location/site identifier when configured (e.g. a resolved website origin). Null when not configured. */
  identifier: string | null;
  /** Human-readable explanation, always present, of what configured/not-configured means for this destination. */
  note: string;
}

export interface PublicationExecutionManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  generatedAt: string;
  generatedBy: ManifestGeneratorIdentity;
  /** Deterministic across regenerations for the same publish intent: sha256(firmId:deliverableId:placementId:approvedVersionId). Never randomized, never time-based. */
  idempotencyKey: string;

  firmId: string;
  contentPeriodId: string | null;
  periodLifecycle: PeriodLifecycle | null;
  deliverableId: string;
  approvedVersionId: string | null;
  /** sha256 of the approved version's exact body_html (text formats) or its own asset_sha256 (file formats). Null only when blocked. */
  versionBodyHash: string | null;
  releaseAuthorizationPath: ReleasePath | null;

  placementId: string;
  destination: PlacementDestination;
  destinationAccount: ManifestDestinationAccount;
  locale: string | null;

  /** Exact stored values, verbatim. Never rewritten, summarized, or translated by this module. */
  title: string | null;
  body: string | null;
  excerpt: string | null;
  ctaTargetPath: string | null;

  canonicalUrl: string | null;
  trackedUrl: string | null;

  assets: ManifestAsset[];

  scheduledPublishDate: string | null;
  scheduledTimezone: string | null;

  /** Raw, unjudged destination-facing facts a preflight/adapter layer evaluates against format/config limits. Never a pass/fail verdict itself. */
  destinationMetadata: Record<string, unknown>;

  blocked: boolean;
  blockReasons: string[];
}

export interface BuildManifestInput {
  now: string;
  generatedBy: ManifestGeneratorIdentity;

  firmId: string;
  period: { id: string; readinessLifecycle: PeriodLifecycle } | null;
  deliverable: ContentDeliverable;
  /** The row for deliverable.approved_version_id, if it could be loaded. */
  approvedVersion: DeliverableVersion | null;
  placement: ContentPlacement;
  /** publication_artifacts rows bound to approvedVersion.id, any artifact_type. */
  assets: PublicationArtifact[];
  /** The current receipt for this placement scoped to the approved version, if one exists (used only to surface prior publication, never consumed as new evidence). */
  currentReceipt: PublicationReceipt | null;
  /** Whether the firm's latest standing_publishing_authorizations event is 'enabled'. */
  standingAuthorizationActive: boolean;
  /** A previously-registered, real destination base URL for this firm+destination (resolved by the loader from prior publication_artifacts/publication_receipts evidence). Never guessed, never hardcoded per-firm. */
  resolvedDestinationBaseUrl: string | null;
  scheduledTimezone: string | null;
  /**
   * The most recent publication_placement_claims row for this placement,
   * regardless of status -- read directly (publication-placement-
   * claims.ts's getLatestClaimForPlacement), never via claim_placement_for_
   * publish(). Surfaces an existing ACTIVE claim (a concurrent or
   * not-yet-released attempt in progress) so a dry-run report can warn
   * "publishing now would conflict" instead of silently reporting ready.
   */
  latestClaim: { status: "active" | "released" | "superseded"; approvedVersionId: string } | null;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function computeManifestIdempotencyKey(
  firmId: string,
  deliverableId: string,
  placementId: string,
  approvedVersionId: string,
): string {
  return sha256Hex(`${firmId}:${deliverableId}:${placementId}:${approvedVersionId}`);
}

function resolveDestinationAccount(
  destination: PlacementDestination,
  resolvedDestinationBaseUrl: string | null,
): ManifestDestinationAccount {
  if (destination === "firm_website") {
    if (resolvedDestinationBaseUrl) {
      return {
        configured: true,
        identifier: resolvedDestinationBaseUrl,
        note: "resolved from a prior verified publication_artifacts/publication_receipts record for this firm; never guessed",
      };
    }
    return {
      configured: false,
      identifier: null,
      note:
        "no destination website is on record for this firm yet (no prior verified webpage/pdf artifact or receipt exists to resolve a base URL from); this system does not store a firm's public marketing-site domain as configuration",
    };
  }
  if (destination === "linkedin_article" || destination === "linkedin_post" || destination === "linkedin_company_page") {
    return {
      configured: false,
      identifier: null,
      note: "no LinkedIn account, company page, or API integration is configured anywhere in this system",
    };
  }
  if (destination === "google_business_profile") {
    return {
      configured: false,
      identifier: null,
      note: "no Google Business Profile location or API integration is configured anywhere in this system",
    };
  }
  // email_delivery
  return {
    configured: false,
    identifier: null,
    note: "no email delivery destination configuration exists for placements in this system",
  };
}

function resolveCanonicalUrl(
  destinationAccount: ManifestDestinationAccount,
  intendedPath: string | null,
): string | null {
  if (!destinationAccount.configured || !destinationAccount.identifier || !intendedPath) return null;
  try {
    const base = new URL(destinationAccount.identifier);
    // intendedPath is stored as an absolute site path (e.g. "/journal/...");
    // resolve against the origin only, never string-concatenated blindly.
    return new URL(intendedPath, base.origin).toString();
  } catch {
    return null;
  }
}

export function buildPublicationExecutionManifest(input: BuildManifestInput): PublicationExecutionManifest {
  const blockReasons: string[] = [];
  const { deliverable, placement, approvedVersion } = input;

  if (!deliverable.approved_version_id) {
    blockReasons.push("deliverable has no approved_version_id");
  } else if (deliverable.approved_version_id !== deliverable.current_version_id) {
    blockReasons.push("approved_version_id does not match current_version_id (version drift)");
  }
  if (deliverable.status !== "approved") {
    blockReasons.push(`deliverable status is "${deliverable.status}", not approved`);
  }
  if (deliverable.approved_version_id && !approvedVersion) {
    blockReasons.push("the approved version record could not be loaded");
  }
  if (approvedVersion && deliverable.content_kind === "text" && !approvedVersion.body_html) {
    blockReasons.push("approved version has no body_html");
  }
  if (!deliverable.locale) blockReasons.push("deliverable has no locale set");
  if (!deliverable.deliverable_role) blockReasons.push("deliverable has no deliverable_role set");
  if (placement.deliverable_id !== deliverable.id) {
    blockReasons.push("placement does not belong to this deliverable");
  }

  const versionBodyHash = approvedVersion
    ? approvedVersion.body_html
      ? sha256Hex(approvedVersion.body_html)
      : (approvedVersion.asset_sha256 ?? null)
    : null;
  if (approvedVersion && !versionBodyHash) {
    blockReasons.push("approved version has neither body_html nor asset_sha256 to bind an identity hash to");
  }

  // Prospective, read-only re-derivation of claim_placement_for_publish()'s
  // own path-A/path-B gate. See module docstring: never authoritative.
  let releaseAuthorizationPath: ReleasePath | null = null;
  const pathAApplies = deliverable.status === "approved" && deliverable.approved_version_id === deliverable.current_version_id;
  if (pathAApplies) {
    releaseAuthorizationPath = "individual_approval";
  } else if (approvedVersion?.requires_individual_review) {
    blockReasons.push(
      "this exact version is flagged requires_individual_review (operator-set); standing authorization can never cover it, only an individual lawyer approval",
    );
  } else if (input.standingAuthorizationActive) {
    releaseAuthorizationPath = "standing_authorization";
  } else {
    blockReasons.push(
      "no release authorization path is currently available: the deliverable is not individually approved as current, and the firm has no active standing publishing authorization",
    );
  }

  if (
    input.latestClaim &&
    input.latestClaim.status === "active" &&
    input.latestClaim.approvedVersionId === deliverable.approved_version_id
  ) {
    blockReasons.push(
      "an active publication claim already exists for this placement and approved version; publishing now would race a concurrent or in-progress attempt rather than create a new one",
    );
  }

  const destinationAccount = resolveDestinationAccount(placement.destination, input.resolvedDestinationBaseUrl);
  if (!destinationAccount.configured) {
    blockReasons.push(`destination not configured: ${destinationAccount.note}`);
  }

  const canonicalUrl = resolveCanonicalUrl(destinationAccount, placement.intended_path);
  if (destinationAccount.configured && placement.intended_path && !canonicalUrl) {
    blockReasons.push("canonical destination URL could not be resolved from the configured destination and intended path");
  }
  if (
    destinationAccount.configured &&
    !placement.intended_path &&
    (deliverable.deliverable_role === "article" ||
      deliverable.deliverable_role === "landing_page" ||
      deliverable.deliverable_role === "lead_magnet_pdf")
  ) {
    blockReasons.push("this role carries its own placement but publication_path/intended_path is not set");
  }

  const trackedUrl = canonicalUrl
    ? (() => {
        const u = new URL(canonicalUrl);
        u.searchParams.set("utm_source", "content_studio");
        u.searchParams.set(
          "utm_medium",
          placement.destination === "firm_website"
            ? "organic"
            : placement.destination === "google_business_profile"
              ? "gbp"
              : placement.destination === "email_delivery"
                ? "email"
                : "social",
        );
        u.searchParams.set("utm_content", placement.id);
        return u.toString();
      })()
    : null;

  const assets: ManifestAsset[] = [...input.assets]
    .sort((a, b) => a.artifact_type.localeCompare(b.artifact_type) || a.id.localeCompare(b.id))
    .map((a) => ({
      artifactId: a.id,
      artifactType: a.artifact_type,
      storageBucket: a.storage_bucket,
      storagePath: a.storage_path,
      publicUrl: a.public_url,
      mimeType: a.mime_type,
      sizeBytes: a.size_bytes,
      sha256: a.sha256,
    }));
  if (placement.required_artifact_type && !assets.some((a) => a.artifactType === placement.required_artifact_type)) {
    blockReasons.push(`no registered asset of required type "${placement.required_artifact_type}" bound to the approved version`);
  }

  const bodyLength = approvedVersion?.body_html?.length ?? null;
  const destinationMetadata: Record<string, unknown> = {
    bodyLength,
    requiredArtifactType: placement.required_artifact_type,
    assetCount: assets.length,
    hasCtaTargetPath: Boolean(deliverable.cta_target_path),
    hasPriorReceipt: Boolean(input.currentReceipt),
    priorReceiptVerificationState: input.currentReceipt?.verification_state ?? null,
    latestClaimStatus: input.latestClaim?.status ?? null,
  };

  const idempotencyKey = computeManifestIdempotencyKey(
    input.firmId,
    deliverable.id,
    placement.id,
    deliverable.approved_version_id ?? "unapproved",
  );

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedAt: input.now,
    generatedBy: input.generatedBy,
    idempotencyKey,

    firmId: input.firmId,
    contentPeriodId: input.period?.id ?? placement.period_id ?? null,
    periodLifecycle: input.period?.readinessLifecycle ?? null,
    deliverableId: deliverable.id,
    approvedVersionId: deliverable.approved_version_id,
    versionBodyHash,
    releaseAuthorizationPath,

    placementId: placement.id,
    destination: placement.destination,
    destinationAccount,
    locale: placement.locale ?? deliverable.locale,

    title: deliverable.title ?? null,
    body: approvedVersion?.body_html ?? null,
    excerpt: deliverable.excerpt ?? null,
    ctaTargetPath: deliverable.cta_target_path ?? null,

    canonicalUrl,
    trackedUrl,

    assets,

    scheduledPublishDate: placement.scheduled_publish_date,
    scheduledTimezone: placement.scheduled_publish_date ? input.scheduledTimezone : null,

    destinationMetadata,

    blocked: blockReasons.length > 0,
    blockReasons,
  };
}
