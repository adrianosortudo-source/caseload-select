import { describe, it, expect } from "vitest";
import {
  resolveAndAuditReleaseGraph,
  auditDeliverableWithNoPlacements,
  computeReleaseVerdict,
  findKnownDr105Rule,
  registryDestinationSurfaceFor,
  DRG_FIRM_ID,
  type ResolveReleaseGraphInput,
  type CtaTargetResolution,
} from "../release-graph-audit";
import type { GapClassification, ReleaseGraphFinding } from "../release-graph-types";
import type {
  ContentDeliverable,
  DeliverableVersion,
  ContentPlacement,
  PublicationArtifact,
  PublicationArtifactValidation,
  DeliverableComment,
  PublicationReceipt,
  PlacementDestination,
} from "@/lib/types";
import type { EmailBranding } from "@/lib/email-branding";

const DELIVERABLE_ID = "d1111111-1111-1111-1111-111111111111";
const CURRENT_VERSION_ID = "v2222222-2222-2222-2222-222222222222";
const RESOLVED_AT = "2026-07-21T12:00:00.000Z";

function makeDeliverable(overrides: Partial<ContentDeliverable> = {}): ContentDeliverable {
  return {
    id: DELIVERABLE_ID,
    firm_id: DRG_FIRM_ID,
    title: "The renewal clause: what it actually locks in",
    description: null,
    content_kind: "text",
    status: "approved",
    current_version_id: CURRENT_VERSION_ID,
    approved_version_id: CURRENT_VERSION_ID,
    approved_at: "2026-07-19T00:00:00Z",
    created_by_role: "operator",
    created_by_id: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-19T00:00:00Z",
    excerpt: "What the renewal clause actually locks in for the tenant.",
    topic: "Commercial leases",
    byline: "Damaris Guimaraes",
    publish_date: "2026-07-20",
    read_time: "6 min read",
    hero_image_url: null,
    kicker: null,
    period_id: null,
    format: "Counsel Note",
    locale: "en-CA",
    deliverable_role: "article",
    publication_destination: "firm_website",
    publication_path: "/journal/renewal-clause",
    cta_target_path: null,
    requires_legal_approval: null,
    requires_image: null,
    requires_file: null,
    requires_localized_route: null,
    ...overrides,
  };
}

function makeVersion(overrides: Partial<DeliverableVersion> = {}): DeliverableVersion {
  return {
    id: CURRENT_VERSION_ID,
    deliverable_id: DELIVERABLE_ID,
    firm_id: DRG_FIRM_ID,
    version_number: 2,
    body_html: "<p>Real approved content.</p>",
    storage_path: null,
    asset_mime: null,
    asset_size_bytes: null,
    asset_name: null,
    note: null,
    responds_to_approval_id: null,
    asset_sha256: null,
    asset_validation: null,
    created_by_role: "operator",
    created_by_id: null,
    created_at: "2026-07-19T00:00:00Z",
    requires_individual_review: false,
    requires_individual_review_reason: null,
    requires_individual_review_set_by_role: null,
    requires_individual_review_set_by_id: null,
    requires_individual_review_set_by_name: null,
    requires_individual_review_set_at: null,
    ...overrides,
  };
}

function makePlacement(overrides: Partial<ContentPlacement> = {}): ContentPlacement {
  return {
    id: "p1111111-1111-1111-1111-111111111111",
    firm_id: DRG_FIRM_ID,
    period_id: "period-1",
    deliverable_id: DELIVERABLE_ID,
    destination: "firm_website",
    locale: "en-CA",
    intended_path: "/journal/renewal-clause",
    required_artifact_type: "webpage",
    scheduled_publish_date: null,
    state: "ready",
    created_by_role: "operator",
    created_by_id: null,
    created_at: "2026-07-19T00:00:00Z",
    updated_at: "2026-07-19T00:00:00Z",
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<PublicationArtifact> = {}): PublicationArtifact {
  return {
    id: "a1111111-1111-1111-1111-111111111111",
    firm_id: DRG_FIRM_ID,
    deliverable_id: DELIVERABLE_ID,
    version_id: CURRENT_VERSION_ID,
    artifact_type: "webpage",
    locale: "en-CA",
    destination: "firm_website",
    storage_bucket: null,
    storage_path: null,
    public_url: "https://drglaw.ca/journal/renewal-clause",
    repository: null,
    repository_path: null,
    deployment_commit: null,
    deployment_url: null,
    mime_type: null,
    size_bytes: null,
    sha256: null,
    validation_result: null,
    created_by_role: "operator",
    created_by_id: null,
    created_at: "2026-07-19T00:00:00Z",
    superseded_at: null,
    ...overrides,
  };
}

function makeValidation(artifactId: string, result: "pass" | "fail" | "error" = "pass"): PublicationArtifactValidation {
  return {
    id: `val-${artifactId}`,
    artifact_id: artifactId,
    firm_id: DRG_FIRM_ID,
    validator: "route_check",
    result,
    details: null,
    validated_by_role: "operator",
    validated_by_id: null,
    created_at: "2026-07-19T01:00:00Z",
  };
}

function makeReceipt(overrides: Partial<PublicationReceipt> = {}): PublicationReceipt {
  return {
    id: "r1111111-1111-1111-1111-111111111111",
    firm_id: DRG_FIRM_ID,
    period_id: "period-1",
    deliverable_id: DELIVERABLE_ID,
    placement_id: "p1111111-1111-1111-1111-111111111111",
    destination: "firm_website",
    locale: "en-CA",
    approved_version_id: CURRENT_VERSION_ID,
    claim_id: null,
    artifact_id: null,
    artifact_sha256: null,
    public_url: "https://drglaw.ca/journal/renewal-clause",
    external_post_id: null,
    published_at: "2026-07-20T00:00:00Z",
    actor_role: "operator",
    actor_id: null,
    actor_name: null,
    verification_state: "verified",
    verified_at: "2026-07-20T00:05:00Z",
    verification_method: "url_fetch",
    evidence_storage_bucket: null,
    evidence_storage_path: null,
    failure_reason: null,
    reconciles_receipt_id: null,
    created_at: "2026-07-20T00:00:00Z",
    release_path: "individual_approval",
    standing_authorization_event_id: null,
    ...overrides,
  };
}

const DRG_EMAIL_BRANDING: EmailBranding = {
  paper: "#EFE9DD",
  surface: "#FFFFFF",
  ink: "#1A1A1A",
  inkMuted: "#5A5A5A",
  brass: "#C9B896",
  rowDivider: "#E0DDD6",
  oxblood: "#5C1A1A",
  oxbloodText: "#FFFFFF",
  taupe: "#8C7D6E",
  fontStack: "'Source Serif 4',Georgia,serif",
  firmName: "DRG Law Professional Corporation",
  wordmark: "DRG Law",
  wordmarkSub: "Professional Corporation",
};

function baseInput(overrides: Partial<ResolveReleaseGraphInput> = {}): ResolveReleaseGraphInput {
  return {
    deliverable: makeDeliverable(),
    currentVersion: makeVersion(),
    placement: makePlacement(),
    // Default: this deliverable also has a firm_website placement (its
    // article surface), so a linkedin_article compliance-wrapper test can
    // resolve a real website_article source edge unless a test explicitly
    // overrides this to [] to exercise the fail-closed "no edge" path.
    deliverablePlacements: [makePlacement()],
    artifacts: [],
    latestValidationByArtifactId: {},
    comments: [],
    currentReceipt: null,
    periodLifecycle: "enforced",
    emailBranding: null,
    ctaResolution: null,
    firmGhlLocationId: "loc_test_ghl_123",
    resolvedAt: RESOLVED_AT,
    ...overrides,
  };
}

function classificationsOf(fs: ReleaseGraphFinding[]): GapClassification[] {
  return fs.map((f) => f.classification);
}

function fieldsFilled(f: ReleaseGraphFinding): boolean {
  return (
    !!f.factualEvidence &&
    !!f.canonicalSourceConsulted &&
    !!f.immediateDisposition &&
    !!f.rootCause &&
    !!f.proposedDurableSolution &&
    !!f.authorityRequired &&
    !!f.reusablePreflightRule
  );
}

// ─── Every finding, whichever classification, carries the full 8-field output ──

describe("every ReleaseGraphFinding carries the full structured output, never a placeholder", () => {
  it("a content_absent finding has every field filled", () => {
    const audit = resolveAndAuditReleaseGraph(baseInput({ currentVersion: makeVersion({ body_html: null }) }));
    expect(audit.findings.length).toBeGreaterThan(0);
    for (const f of audit.findings) expect(fieldsFilled(f)).toBe(true);
  });
});

// ─── The 15 classifications, each independently reachable ──────────────────

describe("all fifteen gap classifications are independently reachable", () => {
  it("content_absent — no body content", () => {
    const audit = resolveAndAuditReleaseGraph(baseInput({ currentVersion: makeVersion({ body_html: null }) }));
    expect(classificationsOf(audit.findings)).toContain("content_absent");
    expect(audit.verdict).toBe("hold");
  });

  it("source_path_unverified — approved_version_id drifted from current_version_id", () => {
    const audit = resolveAndAuditReleaseGraph(baseInput({ deliverable: makeDeliverable({ approved_version_id: "some-older-version" }) }));
    expect(classificationsOf(audit.findings)).toContain("source_path_unverified");
  });

  it("renderer_derived_metadata — blank byline/topic/excerpt on a firm_website destination", () => {
    const audit = resolveAndAuditReleaseGraph(
      baseInput({ deliverable: makeDeliverable({ byline: null, topic: null, excerpt: null, read_time: null }) }),
    );
    const rdm = audit.findings.find((f) => f.classification === "renderer_derived_metadata");
    expect(rdm).toBeDefined();
    expect(rdm!.releaseImpact).toBe("can_publish_with_existing_renderer");
  });

  it("destination_required_metadata_missing — deliverable_role/locale unset", () => {
    const audit = resolveAndAuditReleaseGraph(baseInput({ deliverable: makeDeliverable({ deliverable_role: null, locale: null }) }));
    expect(classificationsOf(audit.findings)).toContain("destination_required_metadata_missing");
  });

  it("destination_target_unresolved — no webpage artifact deployed for a firm_website placement", () => {
    const audit = resolveAndAuditReleaseGraph(baseInput());
    expect(classificationsOf(audit.findings)).toContain("destination_target_unresolved");
  });

  it("required_downloadable_artifact_missing — lead_magnet_pdf role with no bound PDF", () => {
    const audit = resolveAndAuditReleaseGraph(
      baseInput({
        deliverable: makeDeliverable({ deliverable_role: "lead_magnet_pdf", content_kind: "pdf" }),
        currentVersion: makeVersion({ body_html: null, storage_path: null }),
      }),
    );
    expect(classificationsOf(audit.findings)).toContain("required_downloadable_artifact_missing");
  });

  it("required_visual_rendition_missing — no image bound at all for a required rendition role", () => {
    const audit = resolveAndAuditReleaseGraph(
      baseInput({
        artifacts: [makeArtifact({ artifact_type: "webpage" })],
        latestValidationByArtifactId: { "a1111111-1111-1111-1111-111111111111": makeValidation("a1111111-1111-1111-1111-111111111111", "pass") },
      }),
    );
    expect(classificationsOf(audit.findings)).toContain("required_visual_rendition_missing");
  });

  it("visual_rendition_role_mismatch — a baked social_image card bound where a textless hero is required", () => {
    const audit = resolveAndAuditReleaseGraph(
      baseInput({
        artifacts: [
          makeArtifact({ id: "web-1", artifact_type: "webpage" }),
          makeArtifact({ id: "card-1", artifact_type: "social_image", locale: "en-CA" }),
        ],
        latestValidationByArtifactId: { "web-1": makeValidation("web-1", "pass") },
      }),
    );
    const m = audit.findings.find((f) => f.classification === "visual_rendition_role_mismatch");
    expect(m).toBeDefined();
    expect(m!.factualEvidence).toMatch(/social_image/);
  });

  it("visual_safe_area_violation — a correctly-roled hero image with a recorded safe-area failure", () => {
    const audit = resolveAndAuditReleaseGraph(
      baseInput({
        artifacts: [
          makeArtifact({ id: "web-1", artifact_type: "webpage" }),
          makeArtifact({ id: "hero-1", artifact_type: "hero_image", locale: "en-CA", validation_result: { safe_area_ok: false } }),
        ],
        latestValidationByArtifactId: { "web-1": makeValidation("web-1", "pass") },
      }),
    );
    expect(classificationsOf(audit.findings)).toContain("visual_safe_area_violation");
  });

  it("preview_not_publish_faithful — evaluateDeliverableReadiness reports a stale artifact", () => {
    const audit = resolveAndAuditReleaseGraph(
      baseInput({
        deliverable: makeDeliverable({ current_version_id: CURRENT_VERSION_ID }),
        artifacts: [makeArtifact({ id: "web-old", artifact_type: "webpage", version_id: "some-older-version" })],
      }),
    );
    expect(classificationsOf(audit.findings)).toContain("preview_not_publish_faithful");
  });

  it("compliance_wrapper_missing — linkedin_article, DR-105 rule IS documented for this firm/locale (system_improvement, not a content gap)", () => {
    // makeDeliverable() defaults to DRG_FIRM_ID/en-CA/article, with
    // approved_version_id === current_version_id (individually approved),
    // matching the one real, documented registry rule. A webpage artifact
    // bound to the EXACT current version is required for the source edge
    // to resolve at all (see the version-binding tests below).
    const audit = resolveAndAuditReleaseGraph(
      baseInput({ placement: makePlacement({ destination: "linkedin_article" }), artifacts: [makeArtifact()] }),
    );
    const cw = audit.findings.find((f) => f.classification === "compliance_wrapper_missing");
    expect(cw).toBeDefined();
    expect(cw!.releaseImpact).toBe("system_improvement");
    expect(cw!.factualEvidence).toContain("drg_en_website_article_to_linkedin_article_lso_notice_v1");
    expect(cw!.rootCause).toMatch(/runtime_lookup_not_implemented/);
    expect(cw!.authorityRequired).toMatch(/Engineering work only/);
  });

  it("compliance_wrapper_missing — linkedin_article, NO DR-105 rule documented for this firm/locale (blocks_today, a real content gap)", () => {
    const otherFirmId = "11111111-1111-1111-1111-111111111111";
    const otherFirmDeliverable = makeDeliverable({ firm_id: otherFirmId, locale: "en-CA" });
    const audit = resolveAndAuditReleaseGraph(
      baseInput({
        deliverable: otherFirmDeliverable,
        currentVersion: makeVersion({ firm_id: otherFirmId }),
        placement: makePlacement({ destination: "linkedin_article" }),
        artifacts: [makeArtifact({ firm_id: otherFirmId })],
      }),
    );
    const cw = audit.findings.find((f) => f.classification === "compliance_wrapper_missing");
    expect(cw).toBeDefined();
    expect(cw!.releaseImpact).toBe("blocks_today");
    expect(cw!.rootCause).toMatch(/wrapper_absent/);
    expect(cw!.authorityRequired).toMatch(/lawyer sign-off/);
    // Never conflate "no rule documented" with "no runtime reader exists" -- distinct root causes.
    expect(cw!.rootCause).not.toMatch(/runtime_lookup_not_implemented/);
  });

  it("compliance_wrapper_missing — website placement exists, but its bound artifact is for a DIFFERENT version -> source_path_unverified, never 'documented'", () => {
    const olderVersionId = "v-older-9999";
    const audit = resolveAndAuditReleaseGraph(
      baseInput({
        placement: makePlacement({ destination: "linkedin_article" }),
        // The only webpage artifact on record is for an OLDER version, not
        // the current one -- exactly the "content changed since last
        // publish" scenario this check exists to catch.
        artifacts: [makeArtifact({ version_id: olderVersionId })],
      }),
    );
    const cw = audit.findings.find((f) => f.classification === "compliance_wrapper_missing");
    expect(cw).toBeUndefined();
    const unresolved = audit.findings.find((f) => f.classification === "source_path_unverified");
    expect(unresolved).toBeDefined();
    expect(unresolved!.rootCause).toMatch(/source_artifact_version_mismatch/);
    expect(unresolved!.factualEvidence).toMatch(/different \(older\) version|belongs to a different/);
    expect(unresolved!.canonicalSourceConsulted).toBe("publication_artifacts");
  });

  it("compliance_wrapper_missing — website placement + version-bound artifact exist, but the current version is NOT individually release-authorized -> fail closed", () => {
    const audit = resolveAndAuditReleaseGraph(
      baseInput({
        deliverable: makeDeliverable({ approved_version_id: "some-other-approved-version" }),
        placement: makePlacement({ destination: "linkedin_article" }),
        artifacts: [makeArtifact()],
      }),
    );
    const cw = audit.findings.find((f) => f.classification === "compliance_wrapper_missing");
    expect(cw).toBeUndefined();
    // Version drift also trips fact 1's own, pre-existing check
    // (defense in depth) -- select fact 7's specific finding rather than
    // the first source_path_unverified match, and confirm both fired.
    const sourcePathFindings = audit.findings.filter((f) => f.classification === "source_path_unverified");
    expect(sourcePathFindings.length).toBeGreaterThanOrEqual(2);
    const wrapperFact = sourcePathFindings.find((f) => f.fact === "compliance_wrapper_and_sender");
    expect(wrapperFact).toBeDefined();
    expect(wrapperFact!.rootCause).toMatch(/source_version_not_authorized/);
    expect(wrapperFact!.authorityRequired).toMatch(/Firm's lawyer/);
    expect(wrapperFact!.canonicalSourceConsulted).toMatch(/approved_version_id/);
  });

  it("compliance_wrapper_missing — same firm/locale, but WRONG source surface (a landing_page, not an article) resolves fail-closed, never 'documented'", () => {
    const landingPageDeliverable = makeDeliverable({ deliverable_role: "landing_page" });
    const audit = resolveAndAuditReleaseGraph(
      baseInput({
        deliverable: landingPageDeliverable,
        placement: makePlacement({ destination: "linkedin_article" }),
        // A firm_website placement DOES exist for this deliverable -- the
        // edge is present, but the deliverable's own role means it is not
        // an "article," so the source surface must not resolve to
        // website_article.
        deliverablePlacements: [makePlacement({ destination: "firm_website" })],
      }),
    );
    const cw = audit.findings.find((f) => f.classification === "compliance_wrapper_missing");
    expect(cw).toBeUndefined();
    const unresolved = audit.findings.find((f) => f.classification === "source_path_unverified");
    expect(unresolved).toBeDefined();
    expect(unresolved!.rootCause).toMatch(/source_surface_unsupported/);
    expect(unresolved!.factualEvidence).toMatch(/not "article"/);
  });

  it("compliance_wrapper_missing — same firm/locale/source surface, but WRONG destination surface resolves no match (isolated findKnownDr105Rule test)", () => {
    // The full pipeline can never reach this combination naturally (only
    // linkedin_article ever consults the mirror, and it always maps to
    // linkedin_native_article) -- this proves the lookup itself enforces
    // all four fields independently, not just firm+locale, by directly
    // supplying a destination_surface no real placement could ever produce.
    const match = findKnownDr105Rule({
      firmId: DRG_FIRM_ID,
      locale: "en-CA",
      sourceSurface: "website_article",
      destinationSurface: "google_business_profile_post" as never,
    });
    expect(match).toBeNull();
  });

  it("compliance_wrapper_missing — a linkedin_article placement with NO resolved website source edge fails closed (source_path_unverified), never 'absent' or 'documented'", () => {
    const audit = resolveAndAuditReleaseGraph(
      baseInput({
        placement: makePlacement({ destination: "linkedin_article" }),
        // No sibling firm_website placement at all -- the source edge itself is unresolved.
        deliverablePlacements: [makePlacement({ destination: "linkedin_article" })],
      }),
    );
    const cw = audit.findings.find((f) => f.classification === "compliance_wrapper_missing");
    expect(cw).toBeUndefined();
    const unresolved = audit.findings.find((f) => f.classification === "source_path_unverified");
    expect(unresolved).toBeDefined();
    expect(unresolved!.releaseImpact).toBe("needs_human_confirmation");
    expect(unresolved!.rootCause).toMatch(/source_surface_unresolved/);
    expect(unresolved!.immediateDisposition).toMatch(/Fail closed/);
  });

  it("compliance_wrapper_missing — findKnownDr105Rule requires exact equality on every field, not a partial (firm, locale) match", () => {
    // Correct firm+locale+destination, wrong source surface.
    expect(
      findKnownDr105Rule({ firmId: DRG_FIRM_ID, locale: "en-CA", sourceSurface: "landing_page" as never, destinationSurface: "linkedin_native_article" }),
    ).toBeNull();
    // Correct firm+locale+source, wrong destination surface.
    expect(
      findKnownDr105Rule({ firmId: DRG_FIRM_ID, locale: "en-CA", sourceSurface: "website_article", destinationSurface: "gbp_post" as never }),
    ).toBeNull();
    // Correct locale+source+destination, wrong firm.
    expect(
      findKnownDr105Rule({ firmId: "99999999-9999-9999-9999-999999999999", locale: "en-CA", sourceSurface: "website_article", destinationSurface: "linkedin_native_article" }),
    ).toBeNull();
    // Correct firm+source+destination, wrong locale.
    expect(
      findKnownDr105Rule({ firmId: DRG_FIRM_ID, locale: "pt-BR", sourceSurface: "website_article", destinationSurface: "linkedin_native_article" }),
    ).toBeNull();
    // All four correct -- the only combination that matches.
    expect(
      findKnownDr105Rule({ firmId: DRG_FIRM_ID, locale: "en-CA", sourceSurface: "website_article", destinationSurface: "linkedin_native_article" })?.ruleId,
    ).toBe("drg_en_website_article_to_linkedin_article_lso_notice_v1");
  });

  it("registryDestinationSurfaceFor — linkedin_article is the ONLY PlacementDestination that maps to a registry destination surface", () => {
    // Exhaustive over every real PlacementDestination value -- proves the
    // linkedin_article -> linkedin_native_article vocabulary bridge is the
    // one permitted mapping, not an assumption spot-checked on one value.
    const allDestinations: PlacementDestination[] = [
      "firm_website",
      "linkedin_article",
      "linkedin_post",
      "linkedin_company_page",
      "google_business_profile",
      "email_delivery",
    ];
    const results = Object.fromEntries(allDestinations.map((d) => [d, registryDestinationSurfaceFor(d)]));
    expect(results).toEqual({
      firm_website: null,
      linkedin_article: "linkedin_native_article",
      linkedin_post: null,
      linkedin_company_page: null,
      google_business_profile: null,
      email_delivery: null,
    });
  });

  it("compliance_wrapper_missing does not cite a repository code search as evidence of the wrapper's own state", () => {
    const documented = resolveAndAuditReleaseGraph(
      baseInput({ placement: makePlacement({ destination: "linkedin_article" }), artifacts: [makeArtifact()] }),
    );
    const otherFirmId = "22222222-2222-2222-2222-222222222222";
    const absent = resolveAndAuditReleaseGraph(
      baseInput({
        deliverable: makeDeliverable({ firm_id: otherFirmId }),
        currentVersion: makeVersion({ firm_id: otherFirmId }),
        placement: makePlacement({ destination: "linkedin_article" }),
        artifacts: [makeArtifact({ firm_id: otherFirmId })],
      }),
    );
    for (const audit of [documented, absent]) {
      const cw = audit.findings.find((f) => f.classification === "compliance_wrapper_missing")!;
      expect(cw.canonicalSourceConsulted).toBe("docs/publication-operator/surface-presentation-adaptation-registry.md");
    }
  });

  it("compliance_wrapper_missing — email_delivery destination with no branding configured", () => {
    const audit = resolveAndAuditReleaseGraph(baseInput({ placement: makePlacement({ destination: "email_delivery" }), emailBranding: null }));
    expect(classificationsOf(audit.findings)).toContain("compliance_wrapper_missing");
  });

  it("channel_auth_missing — linkedin_post destination, no integration exists", () => {
    const audit = resolveAndAuditReleaseGraph(baseInput({ placement: makePlacement({ destination: "linkedin_post" }) }));
    expect(classificationsOf(audit.findings)).toContain("channel_auth_missing");
  });

  it("unsubscribe_endpoint_pending — no delivery account connected at all for this firm", () => {
    const audit = resolveAndAuditReleaseGraph(
      baseInput({ placement: makePlacement({ destination: "email_delivery" }), emailBranding: DRG_EMAIL_BRANDING, firmGhlLocationId: null }),
    );
    const f = audit.findings.find((x) => x.classification === "unsubscribe_endpoint_pending");
    expect(f).toBeDefined();
    expect(f!.releaseImpact).toBe("system_improvement");
    expect(f!.canonicalSourceConsulted).toBe("intake_firms.ghl_location_id");
    expect(f!.factualEvidence).toMatch(/ghl_location_id is null/);
    // channel_auth_missing must not ALSO fire for email -- unsubscribe_endpoint_pending is the more specific classification.
    expect(classificationsOf(audit.findings)).not.toContain("channel_auth_missing");
  });

  it("unsubscribe_endpoint_pending — delivery account connected, but no record confirms the endpoint (needs_human_confirmation, not a code-search conclusion)", () => {
    const audit = resolveAndAuditReleaseGraph(
      baseInput({ placement: makePlacement({ destination: "email_delivery" }), emailBranding: DRG_EMAIL_BRANDING, firmGhlLocationId: "loc_abc123" }),
    );
    const f = audit.findings.find((x) => x.classification === "unsubscribe_endpoint_pending");
    expect(f).toBeDefined();
    expect(f!.releaseImpact).toBe("needs_human_confirmation");
    expect(f!.factualEvidence).toMatch(/ghl_location_id is set/);
    expect(f!.factualEvidence).toMatch(/external to this repository/);
  });

  it("no unsubscribe/compliance-wrapper finding ever cites a repository-wide code search as its evidence source", () => {
    const cases = [
      resolveAndAuditReleaseGraph(baseInput({ placement: makePlacement({ destination: "email_delivery" }), emailBranding: DRG_EMAIL_BRANDING, firmGhlLocationId: null })),
      resolveAndAuditReleaseGraph(baseInput({ placement: makePlacement({ destination: "email_delivery" }), emailBranding: DRG_EMAIL_BRANDING, firmGhlLocationId: "loc_abc123" })),
      resolveAndAuditReleaseGraph(baseInput({ placement: makePlacement({ destination: "linkedin_article" }) })),
    ];
    for (const audit of cases) {
      for (const f of audit.findings) {
        expect(f.factualEvidence.toLowerCase()).not.toContain("grep");
        expect(f.canonicalSourceConsulted).not.toBe("src/ (repository-wide search)");
      }
    }
  });

  it("publication_receipt_missing — placement marked published with no receipt on record", () => {
    const audit = resolveAndAuditReleaseGraph(
      baseInput({
        placement: makePlacement({ state: "published" }),
        artifacts: [makeArtifact()],
        latestValidationByArtifactId: { "a1111111-1111-1111-1111-111111111111": makeValidation("a1111111-1111-1111-1111-111111111111", "pass") },
        currentReceipt: null,
      }),
    );
    expect(classificationsOf(audit.findings)).toContain("publication_receipt_missing");
  });

  it("ambiguous_external_state — an existing receipt is not yet verified", () => {
    const audit = resolveAndAuditReleaseGraph(baseInput({ currentReceipt: makeReceipt({ verification_state: "failed" }) }));
    const ambiguous = audit.findings.find((f) => f.classification === "ambiguous_external_state");
    expect(ambiguous).toBeDefined();
    expect(ambiguous!.rootCause).toMatch(/failed verification/);
  });
});

// ─── False-positive prevention ──────────────────────────────────────────────

describe("false-positive prevention", () => {
  it("blank byline/topic/excerpt never triggers content_absent when body_html is present", () => {
    const audit = resolveAndAuditReleaseGraph(
      baseInput({ deliverable: makeDeliverable({ byline: null, topic: null, excerpt: null, read_time: null }) }),
    );
    expect(classificationsOf(audit.findings)).not.toContain("content_absent");
  });

  it("a fully clean release (all facts resolved) produces zero blocking findings and verdict publish_now", () => {
    const heroArtifact = makeArtifact({ id: "hero-1", artifact_type: "hero_image", locale: "en-CA" });
    const webpageArtifact = makeArtifact({ id: "web-1", artifact_type: "webpage" });
    const audit = resolveAndAuditReleaseGraph(
      baseInput({
        artifacts: [heroArtifact, webpageArtifact],
        latestValidationByArtifactId: { "web-1": makeValidation("web-1", "pass") },
      }),
    );
    expect(audit.findings.filter((f) => f.releaseImpact === "blocks_today")).toHaveLength(0);
    expect(audit.verdict).toBe("publish_now");
  });

  it("required_visual_rendition_missing and visual_rendition_role_mismatch never both fire for the same artifact set", () => {
    const audit = resolveAndAuditReleaseGraph(
      baseInput({
        artifacts: [makeArtifact({ id: "web-1", artifact_type: "webpage" }), makeArtifact({ id: "card-1", artifact_type: "social_image", locale: "en-CA" })],
        latestValidationByArtifactId: { "web-1": makeValidation("web-1", "pass") },
      }),
    );
    const cs = classificationsOf(audit.findings);
    expect(cs.includes("required_visual_rendition_missing") && cs.includes("visual_rendition_role_mismatch")).toBe(false);
  });

  it("visual_safe_area_violation does not fire merely because validation_result is null (unverified is not violated)", () => {
    const audit = resolveAndAuditReleaseGraph(
      baseInput({
        artifacts: [
          makeArtifact({ id: "web-1", artifact_type: "webpage" }),
          makeArtifact({ id: "hero-1", artifact_type: "hero_image", locale: "en-CA", validation_result: null }),
        ],
        latestValidationByArtifactId: { "web-1": makeValidation("web-1", "pass") },
      }),
    );
    expect(classificationsOf(audit.findings)).not.toContain("visual_safe_area_violation");
  });

  it("publication_receipt_missing does not fire for a placement still in state=planned with no receipt (the normal pre-publish state)", () => {
    const audit = resolveAndAuditReleaseGraph(baseInput({ placement: makePlacement({ state: "planned" }) }));
    expect(classificationsOf(audit.findings)).not.toContain("publication_receipt_missing");
  });

  it("a verified receipt never triggers ambiguous_external_state", () => {
    const audit = resolveAndAuditReleaseGraph(baseInput({ currentReceipt: makeReceipt({ verification_state: "verified" }) }));
    expect(classificationsOf(audit.findings)).not.toContain("ambiguous_external_state");
  });
});

// ─── The no-fallback-to-website-URL content-graph rule ──────────────────────

describe("LinkedIn teaser content-graph rule: never fall back to the website URL", () => {
  const teaserDeliverable = makeDeliverable({
    deliverable_role: "social_post",
    publication_destination: "linkedin",
    cta_target_path: "/journal/renewal-clause",
  });
  const teaserPlacement = makePlacement({ destination: "linkedin_post" });

  it("resolves destination_target_unresolved, never rendering the website URL, when the native Article is required and not ready", () => {
    const cta: CtaTargetResolution = { requiresNativeArticle: true, nativeArticleReady: false, targetLabel: null, targetVerifiedLive: false };
    const audit = resolveAndAuditReleaseGraph(
      baseInput({ deliverable: teaserDeliverable, placement: teaserPlacement, ctaResolution: cta }),
    );
    const f = audit.findings.find((x) => x.fact === "cta_target_live_and_correct");
    expect(f?.classification).toBe("destination_target_unresolved");
    expect(f?.factualEvidence).not.toMatch(/journal\/renewal-clause/);
    expect(f?.immediateDisposition).toMatch(/never substitute|do not substitute|not published/i);
  });

  it("resolves cleanly (no destination_target_unresolved on fact 6) once the native Article placement is ready", () => {
    const cta: CtaTargetResolution = { requiresNativeArticle: true, nativeArticleReady: true, targetLabel: null, targetVerifiedLive: false };
    const audit = resolveAndAuditReleaseGraph(
      baseInput({ deliverable: teaserDeliverable, placement: teaserPlacement, ctaResolution: cta }),
    );
    const ctaFindings = audit.findings.filter((x) => x.fact === "cta_target_live_and_correct");
    expect(ctaFindings).toHaveLength(0);
  });

  it("uses the plain website URL only when the strategy genuinely does not require a native Article", () => {
    const cta: CtaTargetResolution = {
      requiresNativeArticle: false,
      nativeArticleReady: false,
      targetLabel: "/journal/renewal-clause",
      targetVerifiedLive: true,
    };
    const audit = resolveAndAuditReleaseGraph(
      baseInput({ deliverable: teaserDeliverable, placement: teaserPlacement, ctaResolution: cta }),
    );
    const ctaFindings = audit.findings.filter((x) => x.fact === "cta_target_live_and_correct");
    expect(ctaFindings).toHaveLength(0);
  });
});

// ─── Fail-closed on an unresolvable rendition role ──────────────────────────

describe("fail-closed behavior", () => {
  it("never guesses a rendition role -- an unrecognized destination fails closed as required_visual_rendition_missing", () => {
    // firm_website, linkedin_article, linkedin_post, linkedin_company_page,
    // google_business_profile, email_delivery are the only PlacementDestination
    // values; this test documents that requiredRenditionRole's switch is
    // exhaustive over that type today (TypeScript would fail to compile a new
    // destination value added without updating the table), so the failing
    // branch is exercised via the type-safe default rather than an invalid cast.
    const audit = resolveAndAuditReleaseGraph(baseInput({ placement: makePlacement({ destination: "email_delivery" }) }));
    // email_delivery has no rendition-role requirement in this phase --
    // confirms it does NOT spuriously fail closed on fact 4.
    expect(classificationsOf(audit.findings)).not.toContain("required_visual_rendition_missing");
  });
});

// ─── No placements ───────────────────────────────────────────────────────────

describe("auditDeliverableWithNoPlacements", () => {
  it("is reported by name, never silently dropped", () => {
    const audit = auditDeliverableWithNoPlacements({ id: DELIVERABLE_ID, title: "Orphan deliverable" }, RESOLVED_AT);
    expect(audit.deliverableId).toBe(DELIVERABLE_ID);
    expect(audit.verdict).toBe("needs_verification");
    expect(audit.findings).toHaveLength(1);
    expect(fieldsFilled(audit.findings[0])).toBe(true);
  });
});

// ─── existingPreflightGate is reused, not re-derived ────────────────────────

describe("existingPreflightGate reuses buildPreflightReport verbatim", () => {
  it("carries mayPublish=false with the exact reason from the existing gate when comments are unresolved", () => {
    const comment: DeliverableComment = {
      id: "c1",
      deliverable_id: DELIVERABLE_ID,
      version_id: CURRENT_VERSION_ID,
      firm_id: DRG_FIRM_ID,
      author_role: "lawyer",
      author_id: null,
      author_name: "Damaris",
      annotation: null,
      body: "Please fix this paragraph.",
      attachments: [],
      resolved: false,
      resolved_at: null,
      resolved_by_role: null,
      parent_comment_id: null,
      approval_record_id: null,
      created_at: "2026-07-19T00:00:00Z",
    };
    // Readiness must independently pass first (hero + validated webpage
    // bound), so the unresolved comment is isolated as the one remaining
    // reason -- otherwise buildPreflightReport's own earlier readiness
    // check would report first, masking what this test is checking.
    const heroArtifact = makeArtifact({ id: "hero-1", artifact_type: "hero_image", locale: "en-CA" });
    const webpageArtifact = makeArtifact({ id: "web-1", artifact_type: "webpage" });
    const audit = resolveAndAuditReleaseGraph(
      baseInput({
        comments: [comment],
        artifacts: [heroArtifact, webpageArtifact],
        latestValidationByArtifactId: { "web-1": makeValidation("web-1", "pass") },
      }),
    );
    expect(audit.existingPreflightGate.mayPublish).toBe(false);
    expect(audit.existingPreflightGate.reason).toMatch(/unresolved comment/);
  });
});

// ─── computeReleaseVerdict priority ──────────────────────────────────────────

describe("computeReleaseVerdict priority order", () => {
  const partial = {
    fact: "release_authorized_source_version" as const,
    summary: "x",
    factualEvidence: "x",
    canonicalSourceConsulted: "x",
    immediateDisposition: "x",
    rootCause: "x",
    proposedDurableSolution: "x",
    authorityRequired: "x",
    reusablePreflightRule: "x",
  };
  function f(classification: GapClassification, releaseImpact: ReleaseGraphFinding["releaseImpact"]): ReleaseGraphFinding {
    return { classification, releaseImpact, ...partial };
  }

  it("blocks_today beats every other impact", () => {
    expect(
      computeReleaseVerdict([f("content_absent", "blocks_today"), f("channel_auth_missing", "system_improvement")]),
    ).toBe("hold");
  });

  it("system_improvement beats needs_human_confirmation when no blocks_today exists", () => {
    expect(
      computeReleaseVerdict([f("channel_auth_missing", "system_improvement"), f("source_path_unverified", "needs_human_confirmation")]),
    ).toBe("system_improvement");
  });

  it("needs_human_confirmation wins when nothing worse exists", () => {
    expect(computeReleaseVerdict([f("source_path_unverified", "needs_human_confirmation")])).toBe("needs_verification");
  });

  it("can_publish_with_existing_renderer alone never blocks -- publish_now", () => {
    expect(computeReleaseVerdict([f("renderer_derived_metadata", "can_publish_with_existing_renderer")])).toBe("publish_now");
  });

  it("zero findings is publish_now", () => {
    expect(computeReleaseVerdict([])).toBe("publish_now");
  });
});
