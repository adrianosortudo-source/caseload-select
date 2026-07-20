/**
 * `resolve_and_audit_release_graph` — the pure, deterministic release-graph
 * audit. No I/O, no Supabase, no network call, no write anywhere (matches
 * the "No I/O. No Supabase." convention publication-readiness.ts already
 * documents for itself). Given an already-loaded bundle for one deliverable
 * version × one destination placement, resolves and records the ten facts
 * this addendum requires and returns every gap found as a
 * ReleaseGraphFinding, classified into exactly one of the fifteen
 * categories -- never a single generic "blocked."
 *
 * Deliberately composes with, rather than re-derives, the existing
 * publication-evidence pipeline:
 *   - evaluateDeliverableReadiness (publication-readiness.ts) is the
 *     backbone for "does the required evidence already exist," including
 *     its own stale-artifact detection, reused directly for fact 9.
 *   - buildPreflightReport (publication-preflight.ts) is the existing,
 *     already-correct placement-level mayPublish/reason gate (approval
 *     status, version drift, unresolved comments, placement lifecycle
 *     state, current receipt verification state). This module calls it
 *     and carries its result forward verbatim on every audit
 *     (`existingPreflightGate`) rather than re-implementing any part of it.
 *   - channel-validation.ts's isManuallyVerifiableDestination informs fact
 *     8 (channel authorization/integration availability).
 * What this module adds on top, because nothing existing covers them yet:
 * visual-rendition-role awareness (fact 4), the downloadable-artifact/CTA-
 * target content-graph rule (facts 5-6, "never substitute the website URL
 * for a required native LinkedIn Article"), compliance-wrapper/sender
 * resolution (fact 7), and preview-faithfulness via stale-artifact
 * detection (fact 9).
 *
 * See docs/publication-operator/publishing-agent-release-resolution-requirements-2026-07-20.md
 * §13 for the full specification.
 */

import type {
  ContentDeliverable,
  DeliverableVersion,
  ContentPlacement,
  DeliverableComment,
  PublicationArtifact,
  PublicationArtifactType,
  PublicationArtifactValidation,
  PublicationReceipt,
  PlacementDestination,
} from "@/lib/types";
import type { EmailBranding } from "@/lib/email-branding";
import {
  evaluateDeliverableReadiness,
  type EvaluateReadinessInput,
  type PeriodLifecycle,
} from "@/lib/publication-readiness";
import { buildPreflightReport } from "@/lib/publication-preflight";
import { isVersionReleaseAuthorized } from "@/lib/release-authorization";
import type { ReleaseAuthorizationResult } from "@/lib/release-authorization";
import { resolveDestinationIdentity } from "@/lib/destination-identity";
import type {
  ConfiguredDestinationIdentity,
  ExternalVerifiablePlatform,
  ObservedExternalIdentity,
} from "@/lib/destination-identity";
import type {
  GapClassification,
  ReleaseGraphFact,
  ReleaseGraphFinding,
  ReleaseGraphAudit,
  ReleaseGraphNoPlacementAudit,
  ReleaseVerdict,
  VisualRenditionRole,
  ReleaseImpact,
} from "./release-graph-types";

/** The one firm this phase has a genuine, source-faithful website template for (DRGArticleFrame). */
export const DRG_FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";

// Re-exported for backward compatibility with existing importers of this
// module -- the canonical definitions now live in release-authorization.ts
// (a lower-level, dependency-free module publication-preflight.ts can also
// import from, which this file must not depend on in reverse). No logic
// lives here; this file is a consumer like any other, same as
// publication-preflight.ts.
export { isVersionReleaseAuthorized };
export type {
  ReleaseAuthorizationPath,
  ReleaseAuthorizationInput,
  ReleaseAuthorizationResult,
  ReleaseAuthorizationResultKind,
} from "@/lib/release-authorization";

// Likewise for the exact-destination-identity gate (destination-identity.ts)
// -- reported under fact 8, channel_authorization_availability, by
// resolveExternalDestinationIdentity below.
export { resolveDestinationIdentity };
export type {
  ConfiguredDestinationIdentity,
  DestinationIdentityResolution,
  DestinationIdentityResolutionKind,
  ExternalVerifiablePlatform,
  ObservedExternalIdentity,
} from "@/lib/destination-identity";

export interface CtaTargetResolution {
  /** True when the promoted content itself carries a linkedin_article placement -- the strategy requires the native Article, never the plain website URL. */
  requiresNativeArticle: boolean;
  /** True only when that linkedin_article placement's state is ready or published. */
  nativeArticleReady: boolean;
  targetLabel: string | null;
  /** True when the target (a website route) has been verified live via a validated webpage artifact. */
  targetVerifiedLive: boolean;
}

export interface ResolveReleaseGraphInput {
  deliverable: ContentDeliverable;
  currentVersion: DeliverableVersion | null;
  placement: ContentPlacement;
  /**
   * Every content_placements row for this SAME deliverable (including
   * `placement` itself), not just the one being evaluated. Required so
   * fact 7 can derive this placement's actual content-graph source edge
   * (e.g. does this deliverable also carry a firm_website placement) rather
   * than assuming one -- see resolveFact7ComplianceWrapper.
   */
  deliverablePlacements: ContentPlacement[];
  /** All publication_artifacts rows for this deliverable, any version -- same shape evaluateDeliverableReadiness expects. */
  artifacts: PublicationArtifact[];
  latestValidationByArtifactId: Record<string, PublicationArtifactValidation | undefined>;
  comments: DeliverableComment[];
  currentReceipt: PublicationReceipt | null;
  periodLifecycle: PeriodLifecycle;
  /** Resolved email branding for this firm (email-branding.ts), or null when no theme is configured. */
  emailBranding: EmailBranding | null;
  /** Cross-deliverable CTA-target resolution for a teaser/GBP post whose cta_target_path points elsewhere. Null when not applicable. */
  ctaResolution: CtaTargetResolution | null;
  /**
   * intake_firms.ghl_location_id for this firm, or null if unset. The only
   * real, existing per-firm delivery-account signal this schema has today
   * (used elsewhere for GHL Voice/SMS, not specifically for email) -- used
   * by fact 7/unsubscribe resolution to distinguish "no delivery account is
   * connected for this firm at all" from "an account is connected but this
   * system holds no record of its unsubscribe-endpoint configuration."
   * Never treated as proof that GHL email sending or its unsubscribe link
   * is actually working -- GHL itself is external to this repository and
   * this audit cannot verify its internal state.
   */
  firmGhlLocationId: string | null;
  /** This firm's current standing-authorization state (standing-publishing-authorization.ts's getStandingAuthorizationState().active) -- the second path isVersionReleaseAuthorized checks. */
  standingAuthorizationActive: boolean;
  /**
   * This firm's durably configured destination identity for THIS placement's
   * external platform (see destination-identity.ts's header comment) --
   * OPTIONAL, defaults to null. Every real caller in this codebase supplies
   * null (or omits this field) today: no durable configuration model exists
   * yet (blocked by the migration-lineage freeze). Present as an input,
   * rather than hardcoded inside the resolver, so a future loader can start
   * supplying a real value without any change to this module's own logic.
   */
  configuredDestinationIdentity?: ConfiguredDestinationIdentity | null;
  /**
   * The identity an actual evidence-source query returned for THIS
   * placement's external destination, or null when no query was attempted
   * -- the normal state today, since no live LinkedIn/GBP integration
   * exists (channel_auth_missing already reports that gap separately).
   * OPTIONAL, defaults to null.
   */
  observedExternalIdentity?: ObservedExternalIdentity | null;
  resolvedAt: string;
}

/**
 * The DR-105 registry's own source/destination-surface vocabulary
 * (surface-presentation-adaptation-registry.md's `source_surface`/
 * `destination_surface` fields), kept distinct from PlacementDestination --
 * the two are related but not spelled the same (the registry's
 * `linkedin_native_article` corresponds to a `content_placements.destination`
 * value of `linkedin_article`, not the same string).
 */
export type RegistrySourceSurface = "website_article";
export type RegistryDestinationSurface = "linkedin_native_article";

/**
 * Hand-maintained mirror of the rule(s) currently registered in
 * docs/publication-operator/surface-presentation-adaptation-registry.md,
 * keyed on the SAME four-part tuple the registry itself uses --
 * firm_id + locale + source_surface + destination_surface. This exists
 * ONLY so this audit can distinguish "no DR-105 rule has ever been
 * authored for this exact tuple" (a real content/doctrine gap) from "a
 * rule IS documented for this exact tuple, but no runtime reader applies
 * or binds it to a specific release" (a system-enforcement gap) -- it is
 * NOT the runtime registry reader preflight design §10 item 4 describes,
 * and must be updated by hand, in the same PR, whenever the registry file
 * changes. If this table and the registry file drift, this audit will
 * report a stale answer.
 *
 * A two-dimensional (firm, locale) version of this table previously shipped
 * and was corrected 2026-07-21: it could not distinguish a genuinely
 * documented rule from one that merely shared a firm and locale with an
 * unrelated source/destination pairing. Every field below is matched with
 * exact equality; there is no wildcard, fallback, or "close enough" case.
 */
export interface KnownDR105Rule {
  firmId: string;
  locale: string;
  sourceSurface: RegistrySourceSurface;
  destinationSurface: RegistryDestinationSurface;
  ruleId: string;
}

export const KNOWN_DR105_RULES: KnownDR105Rule[] = [
  {
    firmId: DRG_FIRM_ID,
    locale: "en-CA",
    sourceSurface: "website_article",
    destinationSurface: "linkedin_native_article",
    ruleId: "drg_en_website_article_to_linkedin_article_lso_notice_v1",
  },
];

/**
 * Exact four-field lookup against the mirror above. No field is optional,
 * no field is inferred, and a match requires every field to be identical --
 * this is the audit's own authorization boundary, not something it inherits
 * from another part of the system.
 */
export function findKnownDr105Rule(candidate: {
  firmId: string;
  locale: string;
  sourceSurface: string;
  destinationSurface: string;
}): KnownDR105Rule | null {
  return (
    KNOWN_DR105_RULES.find(
      (r) =>
        r.firmId === candidate.firmId &&
        r.locale === candidate.locale &&
        r.sourceSurface === candidate.sourceSurface &&
        r.destinationSurface === candidate.destinationSurface,
    ) ?? null
  );
}

/**
 * Maps a content_placements.destination value to the DR-105 registry's own
 * destination_surface vocabulary. Only linkedin_article has a defined
 * mapping today -- every other destination returns null, which callers
 * must treat as "no DR-105 destination-surface concept applies here," never
 * as a wildcard that could accidentally match a rule.
 */
export function registryDestinationSurfaceFor(destination: PlacementDestination): RegistryDestinationSurface | null {
  if (destination === "linkedin_article") return "linkedin_native_article";
  return null;
}

/**
 * Derives the candidate source surface for a linkedin_article placement
 * from this deliverable's ACTUAL content graph -- never assumed. Per the
 * content-graph rule (preflight design §5/§4.1), a linkedin_article
 * placement is only ever a valid republication of the SAME deliverable's
 * own firm_website placement; this checks that a firm_website placement
 * genuinely exists among this deliverable's OWN placements, and that the
 * deliverable's role is "article" (the only role this system's content
 * graph resolves to the registry's "website_article" surface -- a
 * firm_website placement on a "landing_page"-role deliverable is a
 * different, currently-unsupported source surface, not website_article).
 * Returns null for both "no edge at all" and "edge exists but is not an
 * article" -- both are equally unresolved/unsupported from this audit's
 * point of view, distinguished only in the finding's own evidence text.
 */
/**
 * Why a source-surface resolution came back null, so the caller can report
 * exact, distinct evidence instead of one blended "unresolved" message:
 *   no_website_placement           - no firm_website destination exists on
 *                                     this deliverable at all.
 *   wrong_role                     - a firm_website placement exists, but
 *                                     this deliverable's role is not
 *                                     "article" (e.g. landing_page).
 *   version_not_release_authorized - the CURRENT version fails
 *                                     isVersionReleaseAuthorized's
 *                                     two-path bar (neither individually
 *                                     approved nor covered by an active
 *                                     standing authorization -- or flagged
 *                                     requires_individual_review, which
 *                                     overrides standing authorization
 *                                     unconditionally).
 *   no_version_bound_artifact      - a firm_website placement and an
 *                                     authorized current version both
 *                                     exist, but no webpage
 *                                     publication_artifacts row is bound
 *                                     to THIS EXACT version -- any existing
 *                                     webpage artifact is for an older
 *                                     version and must never be read as
 *                                     this release's source edge.
 */
type SourceSurfaceUnresolvedReason = "no_website_placement" | "wrong_role" | "version_not_release_authorized" | "no_version_bound_artifact";

interface SourceSurfaceResolution {
  surface: RegistrySourceSurface | null;
  reason: SourceSurfaceUnresolvedReason | null;
  /**
   * The full canonical result from isVersionReleaseAuthorized(), carried
   * through verbatim -- never re-derived or re-summarized. Null only when
   * the check short-circuited before ever calling it: no firm_website
   * placement, wrong deliverable role, or no current version to evaluate.
   * Callers read authorization.reason/kind/authorizationPath directly for
   * evidence text rather than reconstructing their own explanation.
   */
  authorization: ReleaseAuthorizationResult | null;
}

/**
 * Derives the candidate source surface for a linkedin_article placement
 * from this deliverable's ACTUAL content graph -- never assumed, and never
 * satisfied merely by a firm_website placement's existence (placements are
 * not version-scoped in this schema; a placement object alone says nothing
 * about which version's content it currently represents).
 *
 * Per the content-graph rule (preflight design §5/§4.1), a linkedin_article
 * placement is only ever a valid republication of the SAME deliverable's
 * own firm_website content, AT THE SAME RELEASE-AUTHORIZED VERSION being
 * republished. Four facts must all hold, checked in order, each capable of
 * independently failing closed:
 *   1. A firm_website placement exists on this deliverable (intent).
 *   2. The deliverable's role is "article" (this system's content graph
 *      only ever resolves an "article"-role firm_website placement to the
 *      registry's website_article surface; "landing_page" is a different,
 *      currently-unsupported source surface).
 *   3. The CURRENT version is release-authorized through EITHER path of
 *      isVersionReleaseAuthorized (individual approval, or an active
 *      standing authorization when the version is not flagged
 *      requires_individual_review) -- the same canonical two-path bar the
 *      rest of this system already uses, never a narrower individual-
 *      approval-only check.
 *   4. A webpage publication_artifacts row is bound to THAT EXACT firm, THAT
 *      EXACT version, AND THAT EXACT LOCALE (evidence, not merely intent)
 *      -- an artifact belonging to a different firm, an older version, or a
 *      different locale than the deliverable's own is stale/wrong and must
 *      never satisfy this check, even though the placement (intent) still
 *      exists. The locale predicate matches findArtifact()'s own pattern
 *      (used by facts 3/4 in this same file); a first adversarial audit
 *      (2026-07-21) found the locale predicate had been dropped, and a
 *      second found the firm_id predicate had never been added at all --
 *      the pure audit must enforce the complete binding itself, not rely
 *      on database-level integrity (e.g. a foreign key or RLS policy) as a
 *      substitute for checking the actual row.
 */
function resolveWebsiteArticleSourceSurface(
  deliverable: ContentDeliverable,
  currentVersion: DeliverableVersion | null,
  deliverablePlacements: ContentPlacement[],
  artifacts: PublicationArtifact[],
  /** The one canonical release-authorization result, computed once by resolveAndAuditReleaseGraph and passed in verbatim -- never recomputed here. Null exactly when currentVersion is null (nothing to authorize). */
  releaseAuthorization: ReleaseAuthorizationResult | null,
  /** deliverable.locale ?? "en-CA" -- the same default resolveFact7ComplianceWrapper's caller already applies; passed in rather than re-defaulted here so there is exactly one place this default lives. */
  locale: string,
): SourceSurfaceResolution {
  const hasWebsitePlacement = deliverablePlacements.some((p) => p.destination === "firm_website");
  if (!hasWebsitePlacement) return { surface: null, reason: "no_website_placement", authorization: null };

  if (deliverable.deliverable_role !== "article") return { surface: null, reason: "wrong_role", authorization: null };

  if (!currentVersion || !releaseAuthorization) return { surface: null, reason: "version_not_release_authorized", authorization: null };

  if (!releaseAuthorization.authorized) return { surface: null, reason: "version_not_release_authorized", authorization: releaseAuthorization };

  const boundArtifact = artifacts.find(
    (a) =>
      a.artifact_type === "webpage" &&
      a.firm_id === deliverable.firm_id &&
      a.version_id === currentVersion.id &&
      a.locale === locale,
  );
  if (!boundArtifact) return { surface: null, reason: "no_version_bound_artifact", authorization: releaseAuthorization };

  return { surface: "website_article", reason: null, authorization: releaseAuthorization };
}

function finding(
  classification: GapClassification,
  fact: ReleaseGraphFact,
  summary: string,
  parts: Omit<ReleaseGraphFinding, "classification" | "fact" | "summary">,
): ReleaseGraphFinding {
  return { classification, fact, summary, ...parts };
}

function requiredRenditionRole(destination: PlacementDestination): VisualRenditionRole | null {
  switch (destination) {
    case "firm_website":
      return "textless_html_headline";
    case "linkedin_article":
    case "linkedin_post":
    case "linkedin_company_page":
    case "google_business_profile":
      return "baked_editorial_card";
    case "email_delivery":
      return null;
  }
}

function actualRenditionRole(artifactType: PublicationArtifactType): VisualRenditionRole | null {
  if (artifactType === "hero_image") return "textless_html_headline";
  if (artifactType === "social_image") return "baked_editorial_card";
  return null;
}

function findArtifact(
  artifacts: PublicationArtifact[],
  types: PublicationArtifactType[],
  versionId: string | null,
  locale?: string | null,
): PublicationArtifact | null {
  if (!versionId) return null;
  const matching = artifacts
    .filter((a) => types.includes(a.artifact_type))
    .filter((a) => (locale ? a.locale === locale : true))
    .filter((a) => a.version_id === versionId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return matching[0] ?? null;
}

// ─── Fact resolvers ─────────────────────────────────────────────────────────
// Each returns zero or more findings. Zero findings means the fact resolves
// cleanly -- never represented as its own "pass" finding, matching the
// existing readiness evaluator's own convention of only reporting failures
// explicitly (successes are the absence of a finding, not a positive one).

function resolveFact1And2SourceAndSurface(
  input: ResolveReleaseGraphInput,
  canonicalSource: string,
  releaseAuthorization: ReleaseAuthorizationResult | null,
): ReleaseGraphFinding[] {
  const { deliverable, currentVersion } = input;
  const out: ReleaseGraphFinding[] = [];

  // For a lead_magnet_pdf-role deliverable, whether the promised PDF bytes
  // exist is fact 5's own, more specific check
  // (required_downloadable_artifact_missing) -- a version row can validly
  // exist (with its own approval/metadata lifecycle already underway)
  // before the file itself is generated and bound. Fact 1 here only
  // requires the version to exist at all; it must never pre-empt fact 5
  // with a less specific content_absent finding for this role.
  const hasBody =
    deliverable.content_kind === "text"
      ? !!currentVersion?.body_html?.trim()
      : deliverable.deliverable_role === "lead_magnet_pdf"
        ? true
        : !!currentVersion?.storage_path;
  if (!currentVersion || !hasBody) {
    out.push(
      finding("content_absent", "release_authorized_source_version", "Canonical source missing", {
        releaseImpact: "blocks_today",
        factualEvidence: currentVersion
          ? `deliverable_versions.id=${currentVersion.id} has no ${deliverable.content_kind === "text" ? "body_html" : "storage_path"}`
          : `content_deliverables.current_version_id is null`,
        canonicalSourceConsulted: "content_deliverables, deliverable_versions",
        immediateDisposition: "Do not attempt this release. No canonical content exists to publish.",
        rootCause: "The current version has never been authored, or its asset was never bound.",
        proposedDurableSolution: "Author the content (or bind the asset) through the existing Content Studio / deliverable-version workflow -- this is a new-content task, not a publishing task.",
        authorityRequired: "Operator or the firm's author, not this audit.",
        reusablePreflightRule: "Never evaluate any downstream fact for a release whose current_body check fails; content_absent is a hard stop before fact 2 onward.",
      }),
    );
    return out; // every later fact is moot without content
  }

  if (!deliverable.deliverable_role || !deliverable.locale) {
    out.push(
      finding(
        "destination_required_metadata_missing",
        "intended_destination_surface",
        "Deliverable role or locale not set",
        {
          releaseImpact: "blocks_today",
          factualEvidence: `deliverable_role=${deliverable.deliverable_role ?? "null"}, locale=${deliverable.locale ?? "null"}`,
          canonicalSourceConsulted: "content_deliverables",
          immediateDisposition: "Do not attempt this release. The intended publication surface is unknown.",
          rootCause: "deliverable_role and/or locale were never set on this row (the pre-existing role_and_locale_known readiness check fails).",
          proposedDurableSolution: "Operator sets deliverable_role and locale through the existing deliverable-metadata editing surface.",
          authorityRequired: "Operator.",
          reusablePreflightRule: "Treat role_and_locale_known's existing failure as destination_required_metadata_missing, never as content_absent -- the content may be complete; only its intended surface is unrecorded.",
        },
      ),
    );
  }

  // The ONE canonical release-authorization decision for this version,
  // computed exactly once by resolveAndAuditReleaseGraph and passed in --
  // never re-derived here. fact 7 (resolveWebsiteArticleSourceSurface) and
  // existingPreflightGate (via resolveAndAuditReleaseGraph's call into
  // buildPreflightReport) both consult this exact same object, so all
  // three can never disagree about whether a given version is
  // release-authorized. currentVersion is guaranteed non-null at this
  // point (the hasBody check above already returned early otherwise), so
  // releaseAuthorization is guaranteed non-null too -- the `?? ` below is
  // a defensive fallback only, never expected to actually fire.
  const authorization =
    releaseAuthorization ??
    isVersionReleaseAuthorized({
      deliverableStatus: deliverable.status,
      approvedVersionId: deliverable.approved_version_id,
      targetVersionId: currentVersion.id,
      versionRequiresIndividualReview: currentVersion.requires_individual_review,
      standingAuthorizationActive: input.standingAuthorizationActive,
    });
  if (!authorization.authorized) {
    out.push(
      finding(
        "source_path_unverified",
        "release_authorized_source_version",
        "Release-authorization identity not confirmed",
        {
          releaseImpact: "needs_human_confirmation",
          factualEvidence: authorization.reason,
          canonicalSourceConsulted: "content_deliverables (approved_version_id vs. current_version_id) and standing_publishing_authorizations (via getStandingAuthorizationState)",
          immediateDisposition: "Hold. This version is not release-authorized through either legitimate path.",
          rootCause: `${authorization.kind} -- ${authorization.reason}`,
          proposedDurableSolution: "The firm's lawyer individually approves the current version, or -- when the version is not flagged requires_individual_review -- an active standing publishing authorization for the firm covers it, through the existing approval/authorization workflow -- never assumed from a live-looking public page.",
          authorityRequired: "Firm's lawyer (individual approval) or an active standing publishing authorization -- never the operator alone.",
          reusablePreflightRule: "Resolve fact 1 (release-authorized source version) exclusively via isVersionReleaseAuthorized's canonical two-path bar -- never re-derive authorization from approved_version_id equality alone; every release-graph consumer (this fact, fact 7, existingPreflightGate) must reach the same authorized/kind result for the same inputs.",
        },
      ),
    );
  }

  return out;
}

/**
 * Fields the real DRGArticleFrame renderer already conditionally renders
 * (`{topic && ...}`, `{byline && ...}`, `{readTime && ...}`, the lead
 * paragraph `{excerpt && ...}`) -- a blank value here is a valid, already-
 * handled state, never evidence of missing content. Informational only:
 * this finding exists to make the distinction explicit and auditable, not
 * to block anything.
 */
function resolveRendererDerivedMetadata(
  input: ResolveReleaseGraphInput,
  canonicalSource: string,
): ReleaseGraphFinding[] {
  const { deliverable, placement } = input;
  if (placement.destination !== "firm_website") return [];

  const blankOptionalFields = (["excerpt", "byline", "topic", "read_time"] as const).filter(
    (key) => !deliverable[key],
  );
  if (blankOptionalFields.length === 0) return [];

  return [
    finding(
      "renderer_derived_metadata",
      "intended_destination_surface",
      `${blankOptionalFields.join(", ")} blank, but the website renderer already handles that gracefully`,
      {
        releaseImpact: "can_publish_with_existing_renderer",
        factualEvidence: `content_deliverables columns [${blankOptionalFields.join(", ")}] are null/empty; DRGArticleFrame.tsx conditionally renders each of these chips/lead paragraph only when present ({field && ...}).`,
        canonicalSourceConsulted: "src/components/portal/DRGArticleFrame.tsx",
        immediateDisposition: "No action needed for these fields specifically. This is not a content gap.",
        rootCause: "The field was never authored, which is a valid editorial choice the renderer already accounts for -- not a missing-content bug.",
        proposedDurableSolution: "None required. If a human decides the chip/lead SHOULD show, that is an editorial addition, not a defect fix.",
        authorityRequired: "None -- informational only.",
        reusablePreflightRule: "Before reporting a blank content_deliverables column as content_absent, check whether the actual destination renderer treats that specific field as optional; if so, classify renderer_derived_metadata, never content_absent.",
      },
    ),
  ];
}

function resolveFact3And6Destination(
  input: ResolveReleaseGraphInput,
  canonicalSource: string,
): ReleaseGraphFinding[] {
  const { deliverable, currentVersion, placement, artifacts, ctaResolution } = input;
  const out: ReleaseGraphFinding[] = [];
  const locale = deliverable.locale ?? "en-CA";

  if (placement.destination === "firm_website") {
    const webpage = findArtifact(artifacts, ["webpage"], currentVersion?.id ?? null, locale);
    if (!webpage) {
      out.push(
        finding("destination_target_unresolved", "canonical_public_destination_route", "Website route not deployed", {
          releaseImpact: "blocks_today",
          factualEvidence: `No publication_artifacts row of type webpage exists for version ${currentVersion?.id} at locale ${locale}.`,
          canonicalSourceConsulted: "publication_artifacts",
          immediateDisposition: "Hold this destination. No live route exists to publish -- or to point any teaser/CTA at.",
          rootCause: "The website deployment for this exact version has not happened yet (the site is a separate, CLI-deployed repository -- deployment is a manual operator action, not something this system can trigger).",
          proposedDurableSolution: "Operator deploys the route in the site repository, then registers a publication_artifacts row and runs reconciliation to confirm it live.",
          authorityRequired: "Operator (deploy) -- no lawyer action required for a route deploy alone.",
          reusablePreflightRule: "A firm_website placement's fact-3 finding must always be destination_target_unresolved when no current-version webpage artifact exists for the placement's locale, never destination_required_metadata_missing (the metadata may be fully set; only the live route is missing).",
        }),
      );
    }
  }

  if (deliverable.cta_target_path) {
    if (!ctaResolution) {
      out.push(
        finding("destination_target_unresolved", "cta_target_live_and_correct", "CTA target not identified", {
          releaseImpact: "needs_human_confirmation",
          factualEvidence: `deliverable.cta_target_path=${deliverable.cta_target_path}, but no matching content_deliverables row was resolved for this firm.`,
          canonicalSourceConsulted: "content_deliverables (cross-firm publication_path lookup)",
          immediateDisposition: "Hold. The destination this CTA is supposed to point at could not be identified.",
          rootCause: "cta_target_path does not match any non-archived deliverable's publication_path in the same firm.",
          proposedDurableSolution: "Operator confirms the correct target path, or corrects cta_target_path if it was mistyped.",
          authorityRequired: "Operator.",
          reusablePreflightRule: "A CTA target that cannot be resolved to a real sibling deliverable must never fall back to rendering the raw cta_target_path string as if it were a verified link.",
        }),
      );
    } else if (ctaResolution.requiresNativeArticle && !ctaResolution.nativeArticleReady) {
      out.push(
        finding("destination_target_unresolved", "cta_target_live_and_correct", "Required native LinkedIn Article not published", {
          releaseImpact: "blocks_today",
          factualEvidence: "The promoted deliverable carries a linkedin_article placement, but that placement's state is not ready/published.",
          canonicalSourceConsulted: "content_placements (target deliverable's linkedin_article placement)",
          immediateDisposition: "Hold this teaser/post. Do not substitute the website article URL -- the strategy requires the native Article specifically.",
          rootCause: "The native LinkedIn Article has not been published yet, or its placement has not been marked ready.",
          proposedDurableSolution: "Publish the native LinkedIn Article placement first (itself gated on channel_auth_missing today), then this teaser's CTA target resolves.",
          authorityRequired: "Depends on what blocks the native Article itself -- see that placement's own audit.",
          reusablePreflightRule: "Content-graph rule: when a promoted deliverable carries its own linkedin_article placement, a teaser pointing at it must resolve destination_target_unresolved while that placement is not ready -- it must never fall back to the deliverable's plain website URL as the CTA target.",
        }),
      );
    } else if (!ctaResolution.requiresNativeArticle && !ctaResolution.targetVerifiedLive) {
      out.push(
        finding("destination_target_unresolved", "cta_target_live_and_correct", "CTA target not verified live", {
          releaseImpact: "needs_human_confirmation",
          factualEvidence: "The promoted deliverable's own current-version webpage artifact has not passed its last validation (or does not exist).",
          canonicalSourceConsulted: "publication_artifacts, publication_artifact_validations (target deliverable)",
          immediateDisposition: "Hold. The page this CTA points at has not been confirmed live for the current version.",
          rootCause: "The target page's own publication (fact 3) is itself unresolved.",
          proposedDurableSolution: "Resolve the target deliverable's own destination_target_unresolved finding first.",
          authorityRequired: "Operator (deploy/reconcile the target page).",
          reusablePreflightRule: "A CTA target is never 'verified live' merely because a portal row exists for it -- only a validated webpage artifact for the target's own current version counts.",
        }),
      );
    }
  }

  return out;
}

function resolveFact4VisualRendition(
  input: ResolveReleaseGraphInput,
  canonicalSource: string,
): ReleaseGraphFinding[] {
  const { deliverable, currentVersion, placement, artifacts } = input;
  const out: ReleaseGraphFinding[] = [];
  const locale = deliverable.locale ?? "en-CA";

  const requiredRole = requiredRenditionRole(placement.destination);
  if (requiredRole === null && placement.destination !== "email_delivery") {
    out.push(
      finding("required_visual_rendition_missing", "required_visual_rendition", "Rendition role could not be determined", {
        releaseImpact: "needs_human_confirmation",
        factualEvidence: `No rendition-role rule is defined for destination "${placement.destination}".`,
        canonicalSourceConsulted: "content_placements.destination",
        immediateDisposition: "Fail closed. Do not guess a rendition role for this destination.",
        rootCause: "requiredRenditionRole() has no case for this destination value.",
        proposedDurableSolution: "Extend the rendition-role table with an explicit, reviewed rule for this destination before any release to it is audited as ready.",
        authorityRequired: "Engineering change to release-graph-audit.ts, reviewed the same way a new DR-105 registry rule would be.",
        reusablePreflightRule: "Fail closed (required_visual_rendition_missing) whenever requiredRenditionRole() returns no rule for a destination, rather than defaulting to either rendition role.",
      }),
    );
    return out;
  }
  if (requiredRole === null) return out; // email_delivery: no rendition-role requirement modeled in this phase

  const artifactTypes: PublicationArtifactType[] = requiredRole === "textless_html_headline" ? ["hero_image"] : ["social_image"];
  const matchingRoleArtifact = findArtifact(artifacts, artifactTypes, currentVersion?.id ?? null, locale);
  const wrongRoleArtifact = matchingRoleArtifact
    ? null
    : findArtifact(
        artifacts,
        (["hero_image", "social_image"] as PublicationArtifactType[]).filter((t) => !artifactTypes.includes(t)),
        currentVersion?.id ?? null,
        locale,
      );

  if (matchingRoleArtifact) {
    const details = matchingRoleArtifact.validation_result as { safe_area_ok?: boolean } | null;
    if (details && details.safe_area_ok === false) {
      out.push(
        finding("visual_safe_area_violation", "required_visual_rendition", "Recorded safe-area validation failed", {
          releaseImpact: "blocks_today",
          factualEvidence: `publication_artifacts.id=${matchingRoleArtifact.id} carries validation_result.safe_area_ok=false.`,
          canonicalSourceConsulted: "publication_artifacts.validation_result",
          immediateDisposition: "Hold. This exact asset has a recorded safe-area failure for its destination's crop.",
          rootCause: "The card/hero composition places baked text or a focal subject outside the destination platform's safe crop.",
          proposedDurableSolution: "Re-generate or re-crop the asset, then re-register and re-validate it -- this audit never re-crops an asset itself.",
          authorityRequired: "Operator/designer -- an actual visual-asset change, out of this audit's scope.",
          reusablePreflightRule: "Read validation_result.safe_area_ok defensively wherever it exists; never infer it from the artifact's mere presence.",
        }),
      );
    }
    return out;
  }

  if (wrongRoleArtifact) {
    const actualRole = actualRenditionRole(wrongRoleArtifact.artifact_type);
    out.push(
      finding("visual_rendition_role_mismatch", "required_visual_rendition", "Wrong rendition role bound to this destination", {
        releaseImpact: "blocks_today",
        factualEvidence: `Destination "${placement.destination}" requires ${requiredRole}, but the only current-version, current-locale image on record is publication_artifacts.id=${wrongRoleArtifact.id} (artifact_type=${wrongRoleArtifact.artifact_type}, rendition role ${actualRole ?? "unknown"}).`,
        canonicalSourceConsulted: "publication_artifacts",
        immediateDisposition: "Hold. Do not publish this asset to this destination -- it is the wrong visual object for the surface (e.g. a baked-text card reused as a textless website hero, or vice versa).",
        rootCause: "An asset registered for one channel's rendition role was reused for a destination requiring the other role, rather than each surface's own asset being generated and registered separately.",
        proposedDurableSolution: "Generate and register the correct-role asset for this destination; never treat the wrong-role asset as an acceptable substitute regardless of how visually similar it looks.",
        authorityRequired: "Operator/designer -- an actual visual-asset change, out of this audit's scope.",
        reusablePreflightRule: "required_visual_rendition_missing and visual_rendition_role_mismatch are different findings: absence of any image is the former, presence of the WRONG role is the latter -- never collapse them into one generic 'image missing' state.",
      }),
    );
    return out;
  }

  out.push(
    finding("required_visual_rendition_missing", "required_visual_rendition", `No ${requiredRole} rendition bound`, {
      releaseImpact: "blocks_today",
      factualEvidence: `No publication_artifacts row of type ${artifactTypes.join("/")} exists for version ${currentVersion?.id} at locale ${locale}.`,
      canonicalSourceConsulted: "publication_artifacts",
      immediateDisposition: "Hold. No visual asset of any kind is bound for this destination's required rendition role.",
      rootCause: "The required image was never generated or registered for this version/locale.",
      proposedDurableSolution: "Generate and register the required-role asset, then re-run this audit.",
      authorityRequired: "Operator/designer -- an actual visual-asset change, out of this audit's scope.",
      reusablePreflightRule: `Every destination with a non-null requiredRenditionRole must resolve a matching-role artifact before required_visual_rendition_missing can clear.`,
    }),
  );
  return out;
}

function resolveFact5DownloadableArtifact(
  input: ResolveReleaseGraphInput,
  canonicalSource: string,
): ReleaseGraphFinding[] {
  const { deliverable, currentVersion, artifacts } = input;
  if (deliverable.deliverable_role !== "lead_magnet_pdf") return [];

  const hasVersionAsset = deliverable.content_kind === "pdf" && !!currentVersion?.storage_path;
  const pdfArtifact = findArtifact(artifacts, ["pdf"], currentVersion?.id ?? null);
  if (hasVersionAsset || pdfArtifact) return [];

  return [
    finding("required_downloadable_artifact_missing", "required_downloadable_artifact", "PDF missing", {
      releaseImpact: "blocks_today",
      factualEvidence: `deliverable_role=lead_magnet_pdf, but neither deliverable_versions.storage_path nor a publication_artifacts row of type pdf is bound to version ${currentVersion?.id}.`,
      canonicalSourceConsulted: "deliverable_versions, publication_artifacts",
      immediateDisposition: "Hold. The promised downloadable file does not exist for this version -- never promote a download before this passes.",
      rootCause: "The PDF was never generated for this version, or was generated but never registered/bound.",
      proposedDurableSolution: "Generate the PDF from the approved version, record its SHA-256 from the actual downloaded bytes, and bind it before any promotional copy referencing it goes out.",
      authorityRequired: "Operator (generation/registration) -- no lawyer action required unless the PDF's own content changed.",
      reusablePreflightRule: "required_downloadable_artifact_missing must be checked from the actual bound bytes (version storage_path or a pdf-type publication_artifacts row), never inferred from the deliverable's title or portal metadata alone.",
    }),
  ];
}

function resolveFact7ComplianceWrapper(
  input: ResolveReleaseGraphInput,
  canonicalSource: string,
  releaseAuthorization: ReleaseAuthorizationResult | null,
): ReleaseGraphFinding[] {
  const { deliverable, currentVersion, placement, deliverablePlacements, artifacts, emailBranding } = input;

  if (placement.destination === "linkedin_article") {
    const locale = deliverable.locale ?? "en-CA";
    const destinationSurface = registryDestinationSurfaceFor(placement.destination);
    const { surface: sourceSurface, reason, authorization } = resolveWebsiteArticleSourceSurface(
      deliverable,
      currentVersion,
      deliverablePlacements,
      artifacts,
      releaseAuthorization,
      locale,
    );

    // Fail closed on the SOURCE edge before ever consulting the rule
    // mirror. Never assume a linkedin_article placement republishes the
    // CURRENT version of a website_article -- derive it from this
    // deliverable's actual content graph, including version binding, not
    // merely from a placement object's existence. The version-authorization
    // reason/rootCause text below is read directly from isVersionReleaseAuthorized's
    // own result (authorization.reason/kind) -- never re-derived or
    // re-summarized here, so this finding can never drift from what the
    // canonical helper actually decided.
    if (!sourceSurface || !destinationSurface) {
      const versionNotAuthorizedEvidence = authorization
        ? `This deliverable has a firm_website placement, but its current version is not release-authorized. ${authorization.reason}`
        : `This deliverable has a firm_website placement, but current_version_id is null -- there is no current version to evaluate for release authorization.`;
      const versionNotAuthorizedRootCause = authorization
        ? `source_version_not_authorized (${authorization.kind}) -- ${authorization.reason}`
        : "source_version_not_authorized (no_current_version) -- there is no current version to evaluate for release authorization.";
      const evidenceByReason: Record<SourceSurfaceUnresolvedReason, string> = {
        no_website_placement: `This deliverable's content_placements rows include no firm_website destination. The content-graph rule (preflight design §5/§4.1) requires a linkedin_article placement to republish the SAME deliverable's own firm_website placement; no such sibling placement exists.`,
        wrong_role: `This deliverable has a firm_website placement, but deliverable_role="${deliverable.deliverable_role}", not "article" -- its content-graph source surface is not website_article, so no DR-105 lookup can be attempted.`,
        version_not_release_authorized: versionNotAuthorizedEvidence,
        no_version_bound_artifact: `This deliverable has a firm_website placement and its current version is release-authorized, but no publication_artifacts row of type webpage is bound to ALL THREE of firm_id ${deliverable.firm_id}, version ${currentVersion?.id}, AND locale ${locale} specifically. Any existing webpage artifact belonging to a different firm, an older version, or a different locale must never be read as this release's source edge -- a cross-firm mismatch, content-changed-since-last-publish, and a locale mismatch are all exactly what this check exists to catch.`,
      };
      const rootCauseByReason: Record<SourceSurfaceUnresolvedReason, string> = {
        no_website_placement: "source_surface_unresolved -- this placement has no sibling firm_website placement to establish a website_article source edge.",
        wrong_role: "source_surface_unsupported -- a website placement exists but is not an article, so it does not correspond to the registry's website_article source surface.",
        version_not_release_authorized: versionNotAuthorizedRootCause,
        no_version_bound_artifact: "source_artifact_version_mismatch -- a webpage artifact exists for this deliverable, but not one bound to the exact firm, the exact version, AND the exact locale being republished; the source edge is stale, cross-firm, or locale-mismatched, not resolved.",
      };
      const proposedSolutionByReason: Record<SourceSurfaceUnresolvedReason, string> = {
        no_website_placement: "Operator creates the deliverable's firm_website placement first (per the content-graph rule), or confirms this linkedin_article placement is not actually a website-article republication and needs its own distinct DR-105 support.",
        wrong_role: "Operator confirms whether this deliverable is genuinely meant to be a website article (correcting deliverable_role), or that this linkedin_article placement needs its own distinct source-surface support, not assumed compatibility.",
        version_not_release_authorized: "The firm's lawyer individually approves the current version, or -- when requires_individual_review is false -- this firm's standing publishing authorization is active and covers it, through the existing approval/authorization workflow -- the same release-authorization gate this addendum already requires, re-checked here because fact 7 must never treat an unauthorized version as a valid source.",
        no_version_bound_artifact: "Operator (re)generates and registers a webpage publication_artifacts row bound to the exact current version, then re-runs this audit -- never treat an older version's artifact as still applying.",
      };
      return [
        finding(
          "source_path_unverified",
          "compliance_wrapper_and_sender",
          reason === "no_version_bound_artifact"
            ? "Website placement exists, but its bound artifact is for a different version than the one being republished"
            : reason === "version_not_release_authorized"
              ? "Current version is not release-authorized (individually or via standing authorization) -- cannot supply a source edge"
              : reason === "wrong_role"
                ? "This deliverable's website placement is not an article -- source surface unsupported"
                : "No resolved website-article source edge for this native Article placement",
          {
            releaseImpact: "needs_human_confirmation",
            factualEvidence: evidenceByReason[reason as SourceSurfaceUnresolvedReason],
            canonicalSourceConsulted: reason === "no_version_bound_artifact" ? "publication_artifacts" : reason === "version_not_release_authorized" ? "content_deliverables (approved_version_id vs. current_version_id) and standing_publishing_authorizations (via getStandingAuthorizationState)" : "content_placements",
            immediateDisposition: "Fail closed. Do not classify any DR-105 wrapper rule as documented or absent for this placement until its source surface -- including exact version binding -- is actually resolved.",
            rootCause: rootCauseByReason[reason as SourceSurfaceUnresolvedReason],
            proposedDurableSolution: proposedSolutionByReason[reason as SourceSurfaceUnresolvedReason],
            authorityRequired: reason === "version_not_release_authorized" ? "Firm's lawyer (individual approval) or an active standing publishing authorization -- never the operator alone." : "Operator -- resolving which content-graph edge applies, not a wrapper-wording decision.",
            reusablePreflightRule: "Never assume a linkedin_article placement's source surface is website_article from placement existence alone -- derive it from the deliverable's actual role, release-authorization status (via isVersionReleaseAuthorized, the one shared canonical helper), AND a webpage artifact bound to the exact current version, failing closed on any one of the four.",
          },
        ),
      ];
    }

    const matchingRule = findKnownDr105Rule({ firmId: deliverable.firm_id, locale, sourceSurface, destinationSurface });

    if (!matchingRule) {
      // Wrapper absent: the source/destination surface tuple resolved
      // cleanly, but no rule has ever been authored and reviewed for this
      // exact (firm, locale, source_surface, destination_surface) tuple.
      // This is a real content/doctrine gap for THIS release, never a
      // system-reader problem -- authoring a new rule requires a human
      // decision this audit cannot make or infer.
      return [
        finding("compliance_wrapper_missing", "compliance_wrapper_and_sender", "No DR-105 rule documented for this exact tuple", {
          releaseImpact: "blocks_today",
          factualEvidence: `No entry in docs/publication-operator/surface-presentation-adaptation-registry.md (or its hand-maintained mirror in this audit) matches (firm_id=${deliverable.firm_id}, locale=${locale}, source_surface=${sourceSurface}, destination_surface=${destinationSurface}). Distinct from a runtime-reader gap: even a human manually consulting the registry today would find nothing for this exact tuple.`,
          canonicalSourceConsulted: "docs/publication-operator/surface-presentation-adaptation-registry.md",
          immediateDisposition: "Hold this destination for this exact tuple. Do not draft, paraphrase, or copy another firm's, locale's, or surface's wrapper wording as a substitute.",
          rootCause: "wrapper_absent -- no DR-105 surface-adaptation rule has ever been authored and reviewed for this exact four-part tuple.",
          proposedDurableSolution: "Operator and the firm's lawyer author and review a new DR-105 rule for this exact tuple, at the same review bar as the one existing rule, before this destination is attempted.",
          authorityRequired: "Operator + firm's lawyer sign-off on the exact wrapper wording -- a real doctrine decision, not an engineering task.",
          reusablePreflightRule: "Check the registry (or its mirror) for a matching four-field tuple BEFORE citing the runtime-reader gap -- a missing rule and a missing reader are different facts with different owners, and a partial (firm, locale)-only match is not a real match.",
        }),
      ];
    }

    // A rule IS documented for this exact four-part tuple (wrapper not
    // absent), but no code path in this repository reads the registry file
    // or binds a matched rule to a specific release/receipt at runtime --
    // so it has never been, and cannot currently be, applied/verified for
    // any real release ("not bound"). Both facts stem from the same root
    // cause (preflight design §4.1a's resolve_surface_presentation_adaptation
    // step was designed but never implemented), so they are reported
    // together rather than as two separate findings that could drift.
    return [
      finding("compliance_wrapper_missing", "compliance_wrapper_and_sender", "Rule documented for this exact tuple, but not runtime-bound to any release", {
        releaseImpact: "system_improvement",
        factualEvidence: `A matching DR-105 rule IS documented for (firm_id=${deliverable.firm_id}, locale=${locale}, source_surface=${sourceSurface}, destination_surface=${destinationSurface}): rule_id=${matchingRule.ruleId}. No code path in this repository reads that file or binds it to a specific release/receipt at runtime (confirmed by direct inspection) -- so the rule, though it exists for this exact tuple, has never been applied/bound to any actual release.`,
        canonicalSourceConsulted: "docs/publication-operator/surface-presentation-adaptation-registry.md",
        immediateDisposition: "Hold automated publication for this destination; a human may still manually apply the documented rule text today if publishing by hand -- never draft new wording at publish time even so.",
        rootCause: "runtime_lookup_not_implemented -- the resolve_surface_presentation_adaptation step (preflight design §4.1a) was designed but never implemented, so no release can ever reach a 'bound' state for this rule today, regardless of content readiness.",
        proposedDurableSolution: "Implement the registry-lookup step as a manifest-loader function, exactly as preflight design §10 item 4 already specifies, and record its match as durable evidence (e.g. on the receipt) so 'bound' becomes a real, checkable state -- no further doctrine work is needed for this exact tuple, only engineering.",
        authorityRequired: "Engineering work only -- the wrapper wording itself is already reviewed and approved for this exact tuple; no further lawyer/operator content decision is needed here.",
        reusablePreflightRule: "compliance_wrapper_missing for linkedin_article must name the matched rule_id and all four matched dimensions when one exists -- an unconditional identical message for every linkedin_article placement conflates a real doctrine gap with a pure engineering gap and hides which authority is actually needed.",
      }),
    ];
  }

  if (placement.destination === "email_delivery") {
    if (!emailBranding) {
      return [
        finding("compliance_wrapper_missing", "compliance_wrapper_and_sender", "No sender identity/branding configured", {
          releaseImpact: "blocks_today",
          factualEvidence: "resolveEmailBranding() returned null for this firm -- intake_firms.branding.theme is not configured.",
          canonicalSourceConsulted: "src/lib/email-branding.ts",
          immediateDisposition: "Hold. No sender identity/visual shell exists to wrap this content for the email surface.",
          rootCause: "The firm has no configured email theme.",
          proposedDurableSolution: "Operator configures intake_firms.branding.theme for this firm.",
          authorityRequired: "Operator.",
          reusablePreflightRule: "email_delivery never resolves compliance_wrapper without a real, resolved EmailBranding object -- never a default/generic wrapper.",
        }),
      ];
    }
    return [
      finding("compliance_wrapper_missing", "compliance_wrapper_and_sender", "No canonical legal-wrapper text source registered for email", {
        releaseImpact: "system_improvement",
        factualEvidence: "renderEmailShell() accepts a caller-supplied footerHtml string; unlike DR-105's compliance_block_exact_text for LinkedIn, no canonical, reviewed legal-wrapper text source exists for the email surface in this codebase.",
        canonicalSourceConsulted: "src/lib/email-shell.ts",
        immediateDisposition: "Hold sends (not preview) until a canonical legal-wrapper text source is registered for email, the same way DR-105 registers one for LinkedIn Article.",
        rootCause: "Email was never given its own DR-105-equivalent compliance-wrapper registry entry.",
        proposedDurableSolution: "Author and register a canonical email legal-wrapper text (mailing address, unsubscribe language, sender identity) at the same review bar as the DR-105 LinkedIn rule, then reference it from every email send path.",
        authorityRequired: "Whoever owns DR-105-equivalent doctrine for this firm (operator + lawyer sign-off on the exact wording).",
        reusablePreflightRule: "Treat 'the branding shell renders' and 'the legal wrapper text is canonical and approved' as two separate facts -- resolving the first must never be read as resolving the second.",
      }),
    ];
  }

  return [];
}

/**
 * The DRG Law Minute case study, formalized: an email deliverable can have
 * a fully approved/in-review HTML artifact and still not be send-ready
 * merely because a durable unsubscribe-endpoint record cannot be found.
 *
 * This resolves from the firm's actual delivery-configuration data
 * (intake_firms.ghl_location_id), never from a search of this repository's
 * own source code. A repository-wide code search can only ever prove facts
 * about this codebase; the actual delivery platform (GHL, or any other) is
 * external to this repository, so its real unsubscribe-endpoint state is
 * outside what a code search can establish either way. Absence of a
 * verifying RECORD is the finding; it is never presented as proof the
 * external platform itself lacks the capability.
 *
 * Checked and reported separately from compliance_wrapper_missing -- the
 * legal-wrapper TEXT and the unsubscribe MECHANISM are two different
 * facts, and conflating them would let a future fix to one silently read
 * as having fixed both.
 */
function resolveUnsubscribeEndpoint(input: ResolveReleaseGraphInput, canonicalSource: string): ReleaseGraphFinding[] {
  const { placement, firmGhlLocationId } = input;
  if (placement.destination !== "email_delivery") return [];

  if (!firmGhlLocationId) {
    return [
      finding("unsubscribe_endpoint_pending", "channel_authorization_availability", "No delivery-platform account is connected for this firm", {
        releaseImpact: "system_improvement",
        factualEvidence: "intake_firms.ghl_location_id is null for this firm -- no GHL (or other) delivery-platform account is connected at all, so no unsubscribe-endpoint record could exist for it.",
        canonicalSourceConsulted: "intake_firms.ghl_location_id",
        immediateDisposition: "Hard-block any send for this destination. No override.",
        rootCause: "No delivery-platform account has been connected for this firm yet.",
        proposedDurableSolution: "Operator connects a delivery-platform account for this firm (GHL location or otherwise), then a real unsubscribe-endpoint record can be established and checked.",
        authorityRequired: "Operator (account connection) -- resolvable without new engineering once an account exists, but connecting one is an external platform step.",
        reusablePreflightRule: "Resolve unsubscribe_endpoint_pending from the firm's own delivery-configuration record (e.g. intake_firms.ghl_location_id), never from a repository-wide code search -- the two prove different things, and the platform itself is external to this repository.",
      }),
    ];
  }

  return [
    finding("unsubscribe_endpoint_pending", "channel_authorization_availability", "Delivery account connected, but no record confirms a working unsubscribe endpoint", {
      releaseImpact: "needs_human_confirmation",
      factualEvidence: `intake_firms.ghl_location_id is set for this firm (a GHL location is connected, used today for Voice/SMS), but no record anywhere in this system attests that this firm's email sends carry a functioning, verified unsubscribe endpoint. Whether GHL itself already provides one is unknown to this audit -- GHL is external to this repository and was not queried.`,
      canonicalSourceConsulted: "intake_firms.ghl_location_id",
      immediateDisposition: "Hard-block any automated send for this destination until an operator confirms directly with the delivery platform. No override based on this audit alone.",
      rootCause: "This system has no durable record-keeping for delivery-platform-level configuration facts like unsubscribe-endpoint status -- the fact may already be true externally and simply unrecorded here.",
      proposedDurableSolution: "Operator verifies directly in GHL (or the connected platform) whether a functioning unsubscribe endpoint exists for this firm's sends, then this system gains a durable way to record that confirmation (e.g. a delivery-configuration record) so future audits do not have to re-ask a human every time.",
      authorityRequired: "Operator verification today; a durable recording mechanism is a separate, future engineering task.",
      reusablePreflightRule: "A connected delivery-platform account is evidence a check is POSSIBLE, never evidence the check has been DONE -- unsubscribe_endpoint_pending must still fire until an actual confirmation is recorded, but the reason and the next action differ from the no-account-connected case.",
    }),
  ];
}

function resolveFact8ChannelAuth(input: ResolveReleaseGraphInput, canonicalSource: string): ReleaseGraphFinding[] {
  const { placement } = input;
  // firm_website has no channel-credential concept (manual deploy IS the
  // integration); email_delivery's channel-availability gap is reported
  // more specifically by resolveUnsubscribeEndpoint below, so it is not
  // double-reported here under the generic classification.
  if (placement.destination === "firm_website" || placement.destination === "email_delivery") return [];

  // No LinkedIn API client, no Google Business Profile API client, and no
  // email-delivery-platform integration exist anywhere in this codebase.
  // Whether post-publish evidence for this destination is even manually
  // verifiable is channel-validation.ts's own concern (isManuallyVerifiableDestination)
  // -- not re-checked here, since this pure module deliberately does not
  // depend on that server-only file (see this file's own header comment on
  // what it composes with).
  return [
    finding("channel_auth_missing", "channel_authorization_availability", "No channel integration exists for this destination", {
      releaseImpact: "system_improvement",
      factualEvidence: `No OAuth/API credential or delivery-platform integration exists in this codebase for destination "${placement.destination}".`,
      canonicalSourceConsulted: "src/lib/channel-validation.ts",
      immediateDisposition: "Hold this destination for every deliverable, regardless of content readiness, until real credential/integration work lands.",
      rootCause: "No engineering work has been done to integrate this channel.",
      proposedDurableSolution: "Real OAuth/API integration for this destination, scoped to the specific firm-owned account, reviewed and piloted per the promotion criteria already defined in preflight design §7A.",
      authorityRequired: "Engineering + an external platform/credential decision (account ownership, OAuth app registration) -- never something this audit or an operator alone can resolve.",
      reusablePreflightRule: "channel_auth_missing is always a system_improvement finding, never a per-release blocker an operator can clear by re-checking content -- content readiness and channel availability are independent facts.",
    }),
  ];
}

/**
 * Maps a content_placements.destination value that is genuinely external
 * (this codebase does not own or host it) to the platform + exact intended
 * surface the destination-identity gate (destination-identity.ts) needs.
 * Returns null for destinations this gate does not apply to:
 *   - firm_website  -- this codebase deploys and owns the route itself
 *     (fact 3's destination_target_unresolved already covers it).
 *   - email_delivery -- identity is the firm's own delivery-platform
 *     account (intake_firms.ghl_location_id), already resolved by
 *     resolveUnsubscribeEndpoint above; a distinct concept from an external
 *     social-platform account/page/location.
 * All four remaining destinations are LinkedIn or GBP surfaces -- exactly
 * the destinations channel_auth_missing already reports as having no
 * integration at all today.
 */
function externalPlatformAndSurfaceFor(
  destination: PlacementDestination,
): { platform: ExternalVerifiablePlatform; destinationSurface: string } | null {
  switch (destination) {
    case "linkedin_article":
      return { platform: "linkedin", destinationSurface: "linkedin_native_article" };
    case "linkedin_post":
      return { platform: "linkedin", destinationSurface: "linkedin_feed_post" };
    case "linkedin_company_page":
      return { platform: "linkedin", destinationSurface: "linkedin_company_page_profile" };
    case "google_business_profile":
      return { platform: "google_business_profile", destinationSurface: "google_business_profile_location" };
    case "firm_website":
    case "email_delivery":
      return null;
  }
}

/**
 * The exact-destination-identity gate (destination-identity.ts), applied to
 * every genuinely external placement. Reported under fact 8
 * (channel_authorization_availability) alongside channel_auth_missing --
 * both are real, independent gaps for the same destinations today
 * (channel_auth_missing: no API/OAuth integration exists at all;
 * destination_identity_unresolved/external_history_unavailable/
 * external_verification_target_mismatch: even if an integration existed,
 * this system does not yet know, or cannot yet confirm, EXACTLY which
 * account/page/location it would be allowed to touch) -- fixing one does
 * not fix the other, so both are reported, never collapsed into one.
 *
 * `configuredDestinationIdentity`/`observedExternalIdentity` are optional,
 * defaulting to null: every real caller in this codebase supplies null
 * today (no durable configuration model exists yet -- see
 * destination-identity.ts's header comment), which resolves this gate to
 * destination_identity_unresolved on every call. This function never
 * queries an external platform, never derives an identity from the firm's
 * name/domain, and never treats channel_auth_missing's absence-of-a-finding
 * (were it ever to stop firing) as evidence that a destination identity is
 * configured -- the two facts are checked and reported completely
 * independently.
 */
function resolveExternalDestinationIdentity(input: ResolveReleaseGraphInput, canonicalSource: string): ReleaseGraphFinding[] {
  const { deliverable, currentVersion, placement } = input;
  const target = externalPlatformAndSurfaceFor(placement.destination);
  if (!target) return [];

  const resolution = resolveDestinationIdentity({
    firmId: deliverable.firm_id,
    platform: target.platform,
    versionId: currentVersion?.id ?? null,
    configuredIdentity: input.configuredDestinationIdentity ?? null,
    observedIdentity: input.observedExternalIdentity ?? null,
  });

  if (resolution.kind === "destination_identity_confirmed") return [];

  const summaryByKind: Record<Exclude<typeof resolution.kind, "destination_identity_confirmed">, string> = {
    destination_identity_unresolved: "No exact destination identity is configured for this external platform",
    external_history_unavailable: "Destination identity is known, but no authorized history surface exists to verify against",
    external_verification_target_mismatch: "The queried account/location/surface does not match the configured destination identity",
  };
  const releaseImpactByKind: Record<Exclude<typeof resolution.kind, "destination_identity_confirmed">, ReleaseImpact> = {
    // Missing SYSTEM capability (no durable config model, or no authorized
    // history access exists yet) -- same category as channel_auth_missing,
    // never a per-release content gap an operator can clear today.
    destination_identity_unresolved: "system_improvement",
    external_history_unavailable: "system_improvement",
    // A mismatch means something IS configured and reachable, but it is
    // demonstrably the WRONG target -- a live, current, actionable
    // misconfiguration for this exact release, not a missing capability.
    external_verification_target_mismatch: "blocks_today",
  };

  return [
    finding(
      resolution.kind as Exclude<typeof resolution.kind, "destination_identity_confirmed">,
      "channel_authorization_availability",
      summaryByKind[resolution.kind as Exclude<typeof resolution.kind, "destination_identity_confirmed">],
      {
        releaseImpact: releaseImpactByKind[resolution.kind as Exclude<typeof resolution.kind, "destination_identity_confirmed">],
        factualEvidence: resolution.reason,
        canonicalSourceConsulted: resolution.evidenceSourceConsulted ?? "src/lib/destination-identity.ts (no evidence source reached)",
        immediateDisposition:
          resolution.kind === "external_verification_target_mismatch"
            ? "Hold. Do not verify, publish, or declare this content absent using the mismatched identity -- correct the configured/queried target first."
            : "Hold every verify/publish/absence conclusion for this destination until the exact destination identity is resolved. Never query a substitute account or public page in its place.",
        rootCause:
          resolution.kind === "destination_identity_unresolved"
            ? "No durable destination-identity configuration exists for this firm/platform (publication_destination_configs is proposed, not applied, and blocked by the migration-lineage freeze in effect since 2026-07-18)."
            : resolution.kind === "external_history_unavailable"
              ? "The exact account/page/location is known, but no authorized manager-level or API history surface has been established for it."
              : "The identity actually queried does not match the firm's configured, intended destination identity.",
        proposedDurableSolution:
          resolution.kind === "external_verification_target_mismatch"
            ? "Operator corrects whichever side is wrong -- the configured destination identity, or the account/query that produced the mismatched observation -- before any further verify/publish attempt for this destination."
            : "Once a durable destination-identity configuration model exists (firm_id + platform + account_or_location_id + destination_surface + status + a controlled credential/integration reference) and this firm's exact identity is configured with authorized history access, this gate resolves automatically -- no change to this resolver itself is needed.",
        authorityRequired:
          resolution.kind === "external_verification_target_mismatch"
            ? "Operator -- correcting a configuration/query mismatch, not a new platform/credential decision."
            : "Operator + an external platform/credential decision (account ownership, API/manager access grant) -- the same authority channel_auth_missing already requires, plus the schema-design/migration-freeze remediation this durable model needs.",
        reusablePreflightRule: "Never verify a placement as published, publish to it, or declare it absent for a genuinely external destination without first resolving its EXACT destination identity via resolveDestinationIdentity() -- destination_identity_unresolved/external_history_unavailable/external_verification_target_mismatch are distinct, independently-reachable fail-closed states, never collapsed into one generic 'not configured' message.",
      },
    ),
  ];
}

function resolveFact9PreviewFaithful(
  readinessStaleArtifacts: string[],
  canonicalSource: string,
): ReleaseGraphFinding[] {
  if (readinessStaleArtifacts.length === 0) return [];
  return [
    finding("preview_not_publish_faithful", "preview_artifact_current_and_faithful", "Registered evidence is stale relative to the current version", {
      releaseImpact: "blocks_today",
      factualEvidence: `evaluateDeliverableReadiness reports staleArtifacts: ${readinessStaleArtifacts.join(", ")} -- registered evidence exists only for an earlier version.`,
      canonicalSourceConsulted: "evaluateDeliverableReadiness (staleArtifacts)",
      immediateDisposition: "Hold. Whatever a human reviewed as 'the preview' does not represent the current release-authorized version -- it must not be treated as proof this version is ready.",
      rootCause: "The version advanced (a new approved version was posted) after the evidence for these requirements was registered, and nothing re-registered it for the new version.",
      proposedDurableSolution: "Re-generate and re-register evidence for the current version for each stale requirement; never carry forward an older version's registered artifact as if it still applied.",
      authorityRequired: "Operator (re-registration) -- the underlying content change may also require a fresh lawyer approval, already covered by fact 1.",
      reusablePreflightRule: "Reuse evaluateDeliverableReadiness's own staleArtifacts list for fact 9 rather than re-deriving version-staleness -- it is already the authoritative signal.",
    }),
  ];
}

function resolveFact10Receipt(input: ResolveReleaseGraphInput, canonicalSource: string): ReleaseGraphFinding[] {
  const { placement, currentReceipt } = input;

  // An existing receipt that is not yet verified, failed verification, or
  // is mid-correction is a genuinely ambiguous external state -- the
  // agent must never guess whether the underlying publication succeeded,
  // and must never retry automatically.
  if (currentReceipt && currentReceipt.verification_state !== "verified") {
    return [
      finding("ambiguous_external_state", "publication_evidence_receipt", `Existing receipt is ${currentReceipt.verification_state}, not verified`, {
        releaseImpact: "needs_human_confirmation",
        factualEvidence: `publication_receipts.id=${currentReceipt.id} has verification_state="${currentReceipt.verification_state}".`,
        canonicalSourceConsulted: "publication_receipts",
        immediateDisposition: "Do not retry publishing automatically. Investigate the prior attempt's real external outcome before any further action.",
        rootCause:
          currentReceipt.verification_state === "failed"
            ? "A previous publish attempt failed verification."
            : currentReceipt.verification_state === "reconciling"
              ? "A receipt correction is currently in progress."
              : "A receipt exists but has not yet been verified.",
        proposedDurableSolution: "Operator manually confirms the real external state and either verifies the existing receipt, records a correction, or (only after confirming nothing was actually published) proceeds with a fresh, idempotency-key-guarded attempt.",
        authorityRequired: "Operator investigation; any receipt correction requires the same authority as any other receipt write.",
        reusablePreflightRule: "Any receipt whose verification_state is not exactly 'verified' resolves ambiguous_external_state, never a silent pass-through as though it were resolved.",
      }),
    ];
  }

  // A missing receipt before anything has been attempted is the normal,
  // expected pre-publish state -- not a finding. A finding fires only when
  // the placement's OWN recorded lifecycle claims publication already
  // happened but no receipt backs that claim -- a genuine inconsistency
  // between the placement record and the evidence ledger.
  if (placement.state !== "published" || currentReceipt) return [];

  return [
    finding("publication_receipt_missing", "publication_evidence_receipt", "Placement marked published with no receipt on record", {
      releaseImpact: "needs_human_confirmation",
      factualEvidence: `content_placements.id=${placement.id} has state="published", but no publication_receipts row exists for it.`,
      canonicalSourceConsulted: "publication_receipts (via listCurrentReceiptsByPlacementForDeliverable)",
      immediateDisposition: "Investigate before treating this as either published or unpublished. Do not retry publishing automatically -- the external state is ambiguous.",
      rootCause: "Either the placement's state was set to published without ever capturing a receipt, or a receipt exists but was not correctly linked/queried.",
      proposedDurableSolution: "Operator manually verifies the actual external state (does the post/page/email genuinely exist) and either registers the missing receipt or corrects the placement's state.",
      authorityRequired: "Operator investigation; a correction to placement.state requires the same authority as any other placement write.",
      reusablePreflightRule: "publication_receipt_missing fires only on state=published with no receipt, never on state=planned/ready with no receipt -- the latter is the normal pre-publish condition, not a gap.",
    }),
  ];
}

// ─── Verdict + top-level entry point ────────────────────────────────────────

export function computeReleaseVerdict(findings: ReleaseGraphFinding[]): ReleaseVerdict {
  const impacts = new Set(findings.map((f) => f.releaseImpact));
  if (impacts.has("blocks_today")) return "hold";
  if (impacts.has("system_improvement")) return "system_improvement";
  if (impacts.has("needs_human_confirmation")) return "needs_verification";
  return "publish_now";
}

/**
 * Resolves and audits the full release graph for one deliverable version ×
 * one destination placement. Returns every finding across all ten facts,
 * the reused existing-preflight-gate result, and the aggregate verdict.
 */
export function resolveAndAuditReleaseGraph(input: ResolveReleaseGraphInput): ReleaseGraphAudit {
  const { deliverable, currentVersion, placement, artifacts, latestValidationByArtifactId, comments, currentReceipt, periodLifecycle, resolvedAt } = input;

  const canonicalSource = `content_deliverables.id=${deliverable.id}, deliverable_versions.id=${currentVersion?.id ?? "null"}`;

  // The ONE canonical release-authorization decision for this exact
  // deliverable/version, computed exactly once and passed to every
  // consumer below (fact 1, fact 7, and the existing-preflight-gate) --
  // never recomputed or re-derived independently by any of them, so all
  // three are structurally guaranteed to agree, not merely likely to.
  // Null only when there is no current version to evaluate at all (fact 1
  // itself reports that as content_absent, a separate, prior-in-priority
  // fact never conflated with authorization).
  const releaseAuthorization: ReleaseAuthorizationResult | null = currentVersion
    ? isVersionReleaseAuthorized({
        deliverableStatus: deliverable.status,
        approvedVersionId: deliverable.approved_version_id,
        targetVersionId: currentVersion.id,
        versionRequiresIndividualReview: currentVersion.requires_individual_review,
        standingAuthorizationActive: input.standingAuthorizationActive,
      })
    : null;

  const readinessInput: EvaluateReadinessInput = {
    deliverable,
    currentVersion,
    artifacts,
    latestValidationByArtifactId,
  };
  const readiness = evaluateDeliverableReadiness(readinessInput);

  const existingPreflight = buildPreflightReport({
    periodId: placement.period_id ?? "unscoped",
    periodLifecycle,
    deliverables: [deliverable],
    readyByDeliverableId: { [deliverable.id]: readiness.ready },
    commentsByDeliverableId: { [deliverable.id]: comments },
    placementsByDeliverableId: { [deliverable.id]: [placement] },
    currentReceiptsByPlacementId: { [placement.id]: currentReceipt },
    releaseAuthorizationByDeliverableId: releaseAuthorization ? { [deliverable.id]: releaseAuthorization } : undefined,
  });
  // No hand-rolled wording override for the !currentVersion case is needed
  // here: buildPreflightReport itself now has no fallback interpretation
  // when releaseAuthorizationByDeliverableId is absent for a deliverable
  // (which it is, above, exactly when currentVersion is null) -- it
  // reports release_authorization_context_unavailable directly, in
  // canonical vocabulary, without this caller needing to patch its wording
  // after the fact. See publication-preflight.ts's own §13.9 correction.
  const existingPreflightGate = existingPreflight.placements[0]
    ? { mayPublish: existingPreflight.placements[0].mayPublish, reason: existingPreflight.placements[0].reason }
    : { mayPublish: false, reason: "no placement report resolved" };

  const findings: ReleaseGraphFinding[] = [
    ...resolveFact1And2SourceAndSurface(input, canonicalSource, releaseAuthorization),
  ];

  // Facts 3-10 are moot without canonical content (fact 1 already returned
  // early with content_absent in that case, matching this module's
  // fail-fast contract for that specific gap).
  if (!findings.some((f) => f.classification === "content_absent")) {
    findings.push(
      ...resolveRendererDerivedMetadata(input, canonicalSource),
      ...resolveFact3And6Destination(input, canonicalSource),
      ...resolveFact4VisualRendition(input, canonicalSource),
      ...resolveFact5DownloadableArtifact(input, canonicalSource),
      ...resolveFact7ComplianceWrapper(input, canonicalSource, releaseAuthorization),
      ...resolveFact8ChannelAuth(input, canonicalSource),
      ...resolveExternalDestinationIdentity(input, canonicalSource),
      ...resolveUnsubscribeEndpoint(input, canonicalSource),
      ...resolveFact9PreviewFaithful(readiness.staleArtifacts, canonicalSource),
      ...resolveFact10Receipt(input, canonicalSource),
    );
  }

  return {
    deliverableId: deliverable.id,
    deliverableTitle: deliverable.title,
    versionId: currentVersion?.id ?? "",
    versionNumber: currentVersion?.version_number ?? null,
    placementId: placement.id,
    destination: placement.destination,
    locale: placement.locale,
    verdict: computeReleaseVerdict(findings),
    findings,
    existingPreflightGate,
    resolvedAt,
  };
}

/** Audit result for a non-archived deliverable with zero placements -- reported, never silently dropped (mirrors buildPreflightReport's own deliverablesWithNoPlacements list). */
export function auditDeliverableWithNoPlacements(
  deliverable: Pick<ContentDeliverable, "id" | "title">,
  resolvedAt: string,
): ReleaseGraphNoPlacementAudit {
  return {
    deliverableId: deliverable.id,
    deliverableTitle: deliverable.title,
    verdict: "needs_verification",
    findings: [
      finding("destination_target_unresolved", "intended_destination_surface", "No destination placement exists yet", {
        releaseImpact: "needs_human_confirmation",
        factualEvidence: `content_deliverables.id=${deliverable.id} has zero content_placements rows.`,
        canonicalSourceConsulted: "content_placements",
        immediateDisposition: "Cannot audit a release graph with no destination. Nothing to hold or publish yet.",
        rootCause: "No placement has been created for this deliverable through the approved system path.",
        proposedDurableSolution: "Operator creates the intended placement(s) explicitly through the existing placements API -- never inferred from the deliverable's role or title.",
        authorityRequired: "Operator.",
        reusablePreflightRule: "A deliverable with zero placements must be reported by name, exactly like buildPreflightReport's own deliverablesWithNoPlacements list -- never silently absent from a release-graph report.",
      }),
    ],
    resolvedAt,
  };
}
