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
 * ONE shared release version, not two competing ones (corrective pass,
 * post-review). Earlier drafts of this module checked `approved_version_id`
 * unconditionally, which meant a standing-authorization-eligible manifest
 * was always reported blocked on content grounds even when
 * releaseAuthorizationPath correctly resolved to "standing_authorization" --
 * the two computations disagreed with each other. resolveReleaseVersion
 * below is the single source of truth both the release-path decision and
 * every content/hash/asset check are computed against:
 *   - Path A (individual_approval): releaseVersionId = approved_version_id,
 *     only when deliverable.status === "approved" AND approved_version_id
 *     === current_version_id (no drift).
 *   - Path B (standing_authorization): releaseVersionId = current_version_id,
 *     only when that version is not flagged requires_individual_review AND
 *     the firm's standing authorization is active. deliverable.status is
 *     NOT consulted on this path -- mirrors claim_placement_for_publish()'s
 *     own path-B gate exactly (publication-placement-claims.ts), which also
 *     never checks status for this path.
 *   - Neither applies: releaseVersionId stays null, manifest blocks.
 *
 * releaseAuthorizationPath is a READ-ONLY, PROSPECTIVE re-derivation of
 * claim_placement_for_publish()'s own path-A/path-B gate for display and
 * dry-run purposes only. It is never authoritative and never substitutes
 * for actually calling the RPC: two concurrent manifests can both compute a
 * non-null releaseAuthorizationPath for the same placement and only one
 * claim can ever succeed. Same caveat publication-preflight.ts already
 * states for mayPublish.
 *
 * Destination account resolution, corrected (corrective pass, post-review).
 * A destination's publishing account is now resolved in a strict priority
 * order: (1) explicit, operator-set configuration
 * (publication_destination_configs, authored not yet applied -- see
 * BuildManifestInput.explicitDestinationConfig), (2) for firm_website only,
 * inference from prior VALIDATED evidence as a lower-trust fallback, (3)
 * unconfigured. Explicit configuration is the only path by which a
 * non-website destination (LinkedIn, GBP, email) can ever report
 * configured:true; no inference tier exists for those, so they stay
 * honestly blocked_missing_configuration until an operator configures them.
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

export const MANIFEST_SCHEMA_VERSION = "publication-execution-manifest-1.1";

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

export interface ManifestAsset {
  artifactId: string;
  artifactType: PublicationArtifactType;
  storageBucket: string | null;
  storagePath: string | null;
  publicUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  /** True only when the most recent publication_artifact_validations row for this artifact recorded result='pass'. An unvalidated (merely registered) artifact never satisfies a placement's required_artifact_type -- registration is a claim, validation is evidence the claim was checked. */
  validated: boolean;
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
  /** Deterministic across regenerations for the same publish intent: sha256(firmId:deliverableId:placementId:releaseVersionId). Bound to the exact version that would actually release under whichever path applies -- never a fixed placeholder when unapproved, so two different current-version revisions relying on standing authorization never collide on the same key. */
  idempotencyKey: string;

  firmId: string;
  contentPeriodId: string | null;
  periodLifecycle: PeriodLifecycle | null;
  deliverableId: string;
  /** The deliverable's own approved_version_id, exactly as stored. May be null or may not equal releaseVersionId (e.g. under standing authorization, or under version drift). Informational only -- never use this for hashing/assets/idempotency; use releaseVersionId. */
  approvedVersionId: string | null;
  /** The exact version this manifest is bound to: approved_version_id under individual_approval, current_version_id under standing_authorization, null when neither release path applies. Every hash, asset lookup, and the idempotency key are computed against this id, never against approvedVersionId directly. */
  releaseVersionId: string | null;
  /** sha256 of the release version's exact body_html (text formats) or its own asset_sha256 (file formats). Null only when blocked. */
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
  /**
   * The CTA destination URL and its tracked variant, resolved independently
   * of this placement's own destination -- a GBP or LinkedIn post's CTA
   * points at the firm's WEBSITE article it promotes (cta_target_path),
   * never at "wherever this placement itself publishes". Null when the
   * deliverable carries no cta_target_path, or when the firm's website
   * base cannot be resolved from prior verified evidence.
   */
  ctaTargetUrl: string | null;
  ctaTrackedUrl: string | null;

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
  /** The row for deliverable.approved_version_id, if it could be loaded (null when approved_version_id is itself null). */
  approvedVersion: DeliverableVersion | null;
  /** The row for deliverable.current_version_id. Always attempted -- required for evaluating path B, since standing authorization releases the CURRENT version, not the approved one. */
  currentVersion: DeliverableVersion | null;
  placement: ContentPlacement;
  /** publication_artifacts rows bound to EITHER approvedVersion.id or currentVersion.id (a small union, not filtered to one version) -- the pure builder filters to whichever version resolveReleaseVersion actually selects. */
  assets: PublicationArtifact[];
  /** artifact_id -> whether its most recent publication_artifact_validations row recorded result='pass'. Artifacts with no entry here are treated as unvalidated. */
  validatedArtifactIds: ReadonlySet<string>;
  /** The current receipt for this placement scoped to whichever version ends up being the release version (used only to surface prior publication, never consumed as new evidence). */
  currentReceipt: PublicationReceipt | null;
  /** Whether the firm's latest standing_publishing_authorizations event is 'enabled'. */
  standingAuthorizationActive: boolean;
  /** A previously-registered, real, VALIDATED destination base URL for this firm+destination (resolved by the loader). Never guessed, never hardcoded per-firm, never trusted from a merely-registered-but-unvalidated artifact. Consulted only as a fallback when explicitDestinationConfig is absent (see below). */
  resolvedDestinationBaseUrl: string | null;
  /** The operator's explicit, current publishing-account configuration for this firm and destination (publication_destination_configs -- corrective-pass addition; the loader guards against the table not existing yet and reports null in that case, never throwing). When present, this is authoritative over resolvedDestinationBaseUrl: an explicit configuration always wins over inference from historical evidence, and is the only way a non-website destination (LinkedIn, GBP, email) can ever report configured:true. */
  explicitDestinationConfig: { identifier: string; label: string | null } | null;
  /** The firm's website base URL, resolved independently of this placement's own destination -- used only for CTA target resolution (a GBP/LinkedIn post's CTA points at the website regardless of where the post itself publishes). Same validation discipline as resolvedDestinationBaseUrl. */
  resolvedWebsiteBaseUrl: string | null;
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
  releaseVersionId: string,
): string {
  return sha256Hex(`${firmId}:${deliverableId}:${placementId}:${releaseVersionId}`);
}

/**
 * The single source of truth for which version would actually release, and
 * via which path. Mirrors claim_placement_for_publish()'s own path-A/path-B
 * gate exactly (supabase/migrations/20260717230956_standing_publishing_
 * authorization.sql): path A requires deliverable.status === "approved"
 * AND no version drift; path B requires the CURRENT version to not be
 * flagged requires_individual_review AND an active standing authorization,
 * and never consults deliverable.status at all. Exported so the loader can
 * call it before deciding which version to scope a receipt lookup against,
 * without duplicating this decision.
 */
export function resolveReleaseVersion(input: {
  deliverable: Pick<ContentDeliverable, "status" | "approved_version_id" | "current_version_id">;
  approvedVersion: DeliverableVersion | null;
  currentVersion: DeliverableVersion | null;
  standingAuthorizationActive: boolean;
}): {
  releaseAuthorizationPath: ReleasePath | null;
  releaseVersionId: string | null;
  releaseVersion: DeliverableVersion | null;
  blockReason: string | null;
} {
  const { deliverable, approvedVersion, currentVersion, standingAuthorizationActive } = input;

  const pathAApplies =
    deliverable.status === "approved" &&
    deliverable.approved_version_id !== null &&
    deliverable.approved_version_id === deliverable.current_version_id;

  if (pathAApplies) {
    return {
      releaseAuthorizationPath: "individual_approval",
      releaseVersionId: deliverable.approved_version_id,
      releaseVersion: approvedVersion,
      blockReason: null,
    };
  }

  if (currentVersion?.requires_individual_review) {
    return {
      releaseAuthorizationPath: null,
      releaseVersionId: null,
      releaseVersion: null,
      blockReason:
        "this exact version is flagged requires_individual_review (operator-set); standing authorization can never cover it, only an individual lawyer approval",
    };
  }

  if (standingAuthorizationActive) {
    return {
      releaseAuthorizationPath: "standing_authorization",
      releaseVersionId: deliverable.current_version_id,
      releaseVersion: currentVersion,
      blockReason: null,
    };
  }

  return {
    releaseAuthorizationPath: null,
    releaseVersionId: null,
    releaseVersion: null,
    blockReason:
      "no release authorization path is currently available: the deliverable is not individually approved as current, and the firm has no active standing publishing authorization",
  };
}

function resolveDestinationAccount(
  destination: PlacementDestination,
  resolvedDestinationBaseUrl: string | null,
  explicitConfig: { identifier: string; label: string | null } | null,
): ManifestDestinationAccount {
  // Explicit, operator-set configuration (publication_destination_configs)
  // always wins over any inference tier, for every destination -- this is
  // the corrective-pass fix for "destination identity inferred from
  // historical evidence instead of explicit approved configuration".
  if (explicitConfig) {
    return {
      configured: true,
      identifier: explicitConfig.identifier,
      note: explicitConfig.label
        ? `explicitly configured by the operator for this firm and destination: "${explicitConfig.label}" (publication_destination_configs)`
        : "explicitly configured by the operator for this firm and destination (publication_destination_configs)",
    };
  }
  if (destination === "firm_website") {
    if (resolvedDestinationBaseUrl) {
      return {
        configured: true,
        identifier: resolvedDestinationBaseUrl,
        note: "no explicit publication_destination_configs entry exists yet for this firm and destination; falling back to inference from a prior VALIDATED publication_artifacts/publication_receipts record. This inferred tier is lower-trust than explicit configuration and should be replaced by one.",
      };
    }
    return {
      configured: false,
      identifier: null,
      note:
        "no destination website is on record for this firm yet: no explicit publication_destination_configs entry, and no prior validated webpage/pdf artifact or verified receipt exists to infer a base URL from",
    };
  }
  if (destination === "linkedin_article" || destination === "linkedin_post" || destination === "linkedin_company_page") {
    return {
      configured: false,
      identifier: null,
      note: "no LinkedIn account or company page is configured for this firm (publication_destination_configs has no active entry, and no other configuration source exists)",
    };
  }
  if (destination === "google_business_profile") {
    return {
      configured: false,
      identifier: null,
      note: "no Google Business Profile location is configured for this firm (publication_destination_configs has no active entry, and no other configuration source exists)",
    };
  }
  // email_delivery
  return {
    configured: false,
    identifier: null,
    note: "no email delivery destination is configured for this firm (publication_destination_configs has no active entry, and no other configuration source exists)",
  };
}

function resolveUrlAgainstBase(base: string | null, path: string | null): string | null {
  if (!base || !path) return null;
  try {
    const origin = new URL(base).origin;
    // path is stored as an absolute site path (e.g. "/journal/..."); resolve
    // against the origin only, never string-concatenated blindly.
    return new URL(path, origin).toString();
  } catch {
    return null;
  }
}

function withTracking(url: string | null, destination: PlacementDestination, placementId: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.searchParams.set("utm_source", "content_studio");
    u.searchParams.set(
      "utm_medium",
      destination === "firm_website"
        ? "organic"
        : destination === "google_business_profile"
          ? "gbp"
          : destination === "email_delivery"
            ? "email"
            : "social",
    );
    u.searchParams.set("utm_content", placementId);
    return u.toString();
  } catch {
    return null;
  }
}

export function buildPublicationExecutionManifest(input: BuildManifestInput): PublicationExecutionManifest {
  const blockReasons: string[] = [];
  const { deliverable, placement } = input;

  if (placement.deliverable_id !== deliverable.id) {
    blockReasons.push("placement does not belong to this deliverable");
  }
  if (!deliverable.locale) blockReasons.push("deliverable has no locale set");
  if (!deliverable.deliverable_role) blockReasons.push("deliverable has no deliverable_role set");

  const release = resolveReleaseVersion({
    deliverable,
    approvedVersion: input.approvedVersion,
    currentVersion: input.currentVersion,
    standingAuthorizationActive: input.standingAuthorizationActive,
  });
  if (release.blockReason) blockReasons.push(release.blockReason);

  const { releaseAuthorizationPath, releaseVersionId, releaseVersion } = release;

  if (releaseVersionId && !releaseVersion) {
    blockReasons.push("the release version record could not be loaded");
  }
  if (releaseVersion && deliverable.content_kind === "text" && !releaseVersion.body_html) {
    blockReasons.push("release version has no body_html");
  }

  const versionBodyHash = releaseVersion
    ? releaseVersion.body_html
      ? sha256Hex(releaseVersion.body_html)
      : (releaseVersion.asset_sha256 ?? null)
    : null;
  if (releaseVersion && !versionBodyHash) {
    blockReasons.push("release version has neither body_html nor asset_sha256 to bind an identity hash to");
  }

  if (
    input.latestClaim &&
    input.latestClaim.status === "active" &&
    releaseVersionId !== null &&
    input.latestClaim.approvedVersionId === releaseVersionId
  ) {
    blockReasons.push(
      "an active publication claim already exists for this placement and this release version; publishing now would race a concurrent or in-progress attempt rather than create a new one",
    );
  }

  const destinationAccount = resolveDestinationAccount(
    placement.destination,
    input.resolvedDestinationBaseUrl,
    input.explicitDestinationConfig,
  );
  if (!destinationAccount.configured) {
    blockReasons.push(`destination not configured: ${destinationAccount.note}`);
  }

  const canonicalUrl = resolveUrlAgainstBase(destinationAccount.identifier, placement.intended_path);
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
  const trackedUrl = withTracking(canonicalUrl, placement.destination, placement.id);

  // CTA target: independent of this placement's OWN destination. A GBP or
  // LinkedIn post's cta_target_path points at the firm's website article it
  // promotes, resolved against the firm's website base regardless of
  // whether THIS placement is itself the website placement.
  const ctaTargetUrl = resolveUrlAgainstBase(input.resolvedWebsiteBaseUrl, deliverable.cta_target_path ?? null);
  const ctaTrackedUrl = withTracking(ctaTargetUrl, "firm_website", placement.id);
  if (
    deliverable.cta_target_path &&
    !ctaTargetUrl &&
    (deliverable.deliverable_role === "gbp_post" || deliverable.deliverable_role === "social_post")
  ) {
    blockReasons.push(
      "cta_target_path is set but could not be resolved into a URL (no validated firm website base is on record)",
    );
  }

  const assetsForReleaseVersion = releaseVersionId
    ? input.assets.filter((a) => a.version_id === releaseVersionId)
    : [];
  const assets: ManifestAsset[] = [...assetsForReleaseVersion]
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
      validated: input.validatedArtifactIds.has(a.id),
    }));
  if (
    placement.required_artifact_type &&
    !assets.some((a) => a.artifactType === placement.required_artifact_type && a.validated)
  ) {
    const hasUnvalidated = assets.some((a) => a.artifactType === placement.required_artifact_type);
    blockReasons.push(
      hasUnvalidated
        ? `an asset of required type "${placement.required_artifact_type}" is registered but has never been validated (no passing publication_artifact_validations record)`
        : `no registered asset of required type "${placement.required_artifact_type}" bound to the release version`,
    );
  }

  const bodyLength = releaseVersion?.body_html?.length ?? null;
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
    releaseVersionId ?? "no-release-version",
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
    releaseVersionId,
    versionBodyHash,
    releaseAuthorizationPath,

    placementId: placement.id,
    destination: placement.destination,
    destinationAccount,
    locale: placement.locale ?? deliverable.locale,

    title: deliverable.title ?? null,
    body: releaseVersion?.body_html ?? null,
    excerpt: deliverable.excerpt ?? null,
    ctaTargetPath: deliverable.cta_target_path ?? null,

    canonicalUrl,
    trackedUrl,
    ctaTargetUrl,
    ctaTrackedUrl,

    assets,

    scheduledPublishDate: placement.scheduled_publish_date,
    scheduledTimezone: placement.scheduled_publish_date ? input.scheduledTimezone : null,

    destinationMetadata,

    blocked: blockReasons.length > 0,
    blockReasons,
  };
}
