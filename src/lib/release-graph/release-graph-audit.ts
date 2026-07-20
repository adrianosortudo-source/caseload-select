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
  resolvedAt: string;
}

/**
 * Hand-maintained mirror of the rule(s) currently registered in
 * docs/publication-operator/surface-presentation-adaptation-registry.md.
 * This exists ONLY so this audit can distinguish "no DR-105 rule has ever
 * been authored for this firm/locale/surface tuple" (a real content/
 * doctrine gap) from "a rule IS documented, but no runtime reader applies
 * or binds it to a specific release" (a system-enforcement gap) -- it is
 * NOT the runtime registry reader preflight design §10 item 4 describes,
 * and must be updated by hand, in the same PR, whenever the registry file
 * changes. If this table and the registry file drift, this audit will
 * report a stale answer.
 */
const KNOWN_DR105_RULES: Array<{ firmId: string; locale: string; ruleId: string }> = [
  { firmId: DRG_FIRM_ID, locale: "en-CA", ruleId: "drg_en_website_article_to_linkedin_article_lso_notice_v1" },
];

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

  if (deliverable.approved_version_id !== deliverable.current_version_id) {
    out.push(
      finding(
        "source_path_unverified",
        "release_authorized_source_version",
        "Release-authorization identity not confirmed",
        {
          releaseImpact: "needs_human_confirmation",
          factualEvidence: `approved_version_id=${deliverable.approved_version_id ?? "null"}, current_version_id=${deliverable.current_version_id}`,
          canonicalSourceConsulted: "content_deliverables (approved_version_id vs. current_version_id)",
          immediateDisposition: "Hold. Which version is actually release-authorized cannot yet be confirmed from stored state alone.",
          rootCause: deliverable.approved_version_id
            ? "Version drift: the current version is not the one the lawyer (or standing authorization) actually approved."
            : "The current version has never been formally approved by legal counsel.",
          proposedDurableSolution: "The firm's lawyer reviews and approves the current version (or the operator confirms an active standing authorization covers it) through the existing approval workflow -- never assumed from a live-looking public page.",
          authorityRequired: "Firm's lawyer (individual approval) or an active standing publishing authorization -- never the operator alone.",
          reusablePreflightRule: "Resolve fact 1 (release-authorized source version) via the two-path bar (individual approval OR active standing authorization not flagged requires_individual_review) before evaluating any other fact -- an unresolved identity here makes every downstream fact provisional.",
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
): ReleaseGraphFinding[] {
  const { deliverable, placement, emailBranding } = input;

  if (placement.destination === "linkedin_article") {
    const locale = deliverable.locale ?? "en-CA";
    const matchingRule = KNOWN_DR105_RULES.find((r) => r.firmId === deliverable.firm_id && r.locale === locale);

    if (!matchingRule) {
      // Wrapper absent: no rule has ever been authored and reviewed for
      // this exact firm/locale tuple, documented or otherwise. This is a
      // real content/doctrine gap for THIS release, never a system-reader
      // problem -- authoring a new rule requires a human decision this
      // audit cannot make or infer.
      return [
        finding("compliance_wrapper_missing", "compliance_wrapper_and_sender", "No DR-105 rule documented for this firm/locale", {
          releaseImpact: "blocks_today",
          factualEvidence: `No entry in docs/publication-operator/surface-presentation-adaptation-registry.md (or its hand-maintained mirror in this audit) matches (firm=${deliverable.firm_id}, locale=${locale}). Distinct from a runtime-reader gap: even a human manually consulting the registry today would find nothing for this exact tuple.`,
          canonicalSourceConsulted: "docs/publication-operator/surface-presentation-adaptation-registry.md",
          immediateDisposition: "Hold this destination for this firm/locale. Do not draft, paraphrase, or copy another firm's wrapper wording as a substitute.",
          rootCause: "wrapper_absent -- no DR-105 surface-adaptation rule has ever been authored and reviewed for this exact firm/locale/surface tuple.",
          proposedDurableSolution: "Operator and the firm's lawyer author and review a new DR-105 rule for this tuple, at the same review bar as the one existing rule, before this destination is attempted for this firm/locale.",
          authorityRequired: "Operator + firm's lawyer sign-off on the exact wrapper wording -- a real doctrine decision, not an engineering task.",
          reusablePreflightRule: "Check the registry (or its mirror) for a matching (firm, locale) entry BEFORE citing the runtime-reader gap -- a missing rule and a missing reader are different facts with different owners.",
        }),
      ];
    }

    // A rule IS documented for this exact tuple (wrapper not absent), but
    // no code path in this repository reads the registry file or binds a
    // matched rule to a specific release/receipt at runtime -- so it has
    // never been, and cannot currently be, applied/verified for any real
    // release ("not bound"). Both facts stem from the same root cause
    // (preflight design §4.1a's resolve_surface_presentation_adaptation
    // step was designed but never implemented), so they are reported
    // together rather than as two separate findings that could drift.
    return [
      finding("compliance_wrapper_missing", "compliance_wrapper_and_sender", "Rule documented, but not runtime-bound to any release", {
        releaseImpact: "system_improvement",
        factualEvidence: `A matching DR-105 rule IS documented for (firm=${deliverable.firm_id}, locale=${locale}): rule_id=${matchingRule.ruleId}. No code path in this repository reads that file or binds it to a specific release/receipt at runtime (confirmed by direct inspection) -- so the rule, though it exists, has never been applied/bound to any actual release.`,
        canonicalSourceConsulted: "docs/publication-operator/surface-presentation-adaptation-registry.md",
        immediateDisposition: "Hold automated publication for this destination; a human may still manually apply the documented rule text today if publishing by hand -- never draft new wording at publish time even so.",
        rootCause: "runtime_lookup_not_implemented -- the resolve_surface_presentation_adaptation step (preflight design §4.1a) was designed but never implemented, so no release can ever reach a 'bound' state for this rule today, regardless of content readiness.",
        proposedDurableSolution: "Implement the registry-lookup step as a manifest-loader function, exactly as preflight design §10 item 4 already specifies, and record its match as durable evidence (e.g. on the receipt) so 'bound' becomes a real, checkable state -- no further doctrine work is needed for this specific tuple, only engineering.",
        authorityRequired: "Engineering work only -- the wrapper wording itself is already reviewed and approved for this tuple; no further lawyer/operator content decision is needed here.",
        reusablePreflightRule: "compliance_wrapper_missing for linkedin_article must name the matched rule_id when one exists -- an unconditional identical message for every linkedin_article placement conflates a real doctrine gap with a pure engineering gap and hides which authority is actually needed.",
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
  });
  const existingPreflightGate = existingPreflight.placements[0]
    ? { mayPublish: existingPreflight.placements[0].mayPublish, reason: existingPreflight.placements[0].reason }
    : { mayPublish: false, reason: "no placement report resolved" };

  const findings: ReleaseGraphFinding[] = [
    ...resolveFact1And2SourceAndSurface(input, canonicalSource),
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
      ...resolveFact7ComplianceWrapper(input, canonicalSource),
      ...resolveFact8ChannelAuth(input, canonicalSource),
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
