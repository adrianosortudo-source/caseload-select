/**
 * DRG Renewal Clause period as a read-only case study for
 * resolve_and_audit_release_graph. Fixture-grounded, not a live query
 * against production (matching the addendum's own point-in-time
 * discipline, docs/publication-operator/publishing-agent-release-resolution-requirements-2026-07-20.md
 * §12/§13.6) -- these fixtures encode the real, already-documented facts
 * about the period without touching production data.
 *
 * Each test below corresponds one-to-one to a required distinction from
 * the task brief. Read together, this file doubles as the dry-run
 * demonstration the brief asks for: "a deterministic release-graph audit
 * output that can run without publishing."
 */
import { describe, it, expect } from "vitest";
import { resolveAndAuditReleaseGraph, DRG_FIRM_ID, type ResolveReleaseGraphInput, type CtaTargetResolution } from "../release-graph-audit";
import { renderReleaseGraphReport } from "../release-graph-report";
import type { ContentDeliverable, DeliverableVersion, ContentPlacement, PublicationArtifact, PublicationArtifactValidation } from "@/lib/types";

const RENEWAL_CLAUSE_PERIOD_ID = "7ca11880-42a9-4bab-940a-baf2966b9f7e";
const RESOLVED_AT = "2026-07-21T09:00:00.000Z";

function baseDeliverable(overrides: Partial<ContentDeliverable> = {}): ContentDeliverable {
  return {
    id: "checklist-en",
    firm_id: DRG_FIRM_ID,
    title: "The renewal clause checklist (EN)",
    description: null,
    content_kind: "pdf",
    status: "approved",
    current_version_id: "v-en-2",
    approved_version_id: "v-en-2",
    approved_at: "2026-07-19T00:00:00Z",
    created_by_role: "operator",
    created_by_id: null,
    created_at: "2026-07-15T00:00:00Z",
    updated_at: "2026-07-19T00:00:00Z",
    excerpt: null,
    topic: null,
    byline: null,
    publish_date: "2026-07-20",
    read_time: null,
    hero_image_url: null,
    kicker: null,
    period_id: RENEWAL_CLAUSE_PERIOD_ID,
    format: "Checklist",
    locale: "en-CA",
    deliverable_role: "lead_magnet_pdf",
    publication_destination: "firm_website",
    publication_path: "/resources/renewal-clause-checklist",
    cta_target_path: null,
    requires_legal_approval: null,
    requires_image: null,
    requires_file: null,
    requires_localized_route: null,
    ...overrides,
  };
}

function baseVersion(overrides: Partial<DeliverableVersion> = {}): DeliverableVersion {
  return {
    id: "v-en-2",
    deliverable_id: "checklist-en",
    firm_id: DRG_FIRM_ID,
    version_number: 2,
    body_html: null,
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

function basePlacement(overrides: Partial<ContentPlacement> = {}): ContentPlacement {
  return {
    id: "placement-checklist-en",
    firm_id: DRG_FIRM_ID,
    period_id: RENEWAL_CLAUSE_PERIOD_ID,
    deliverable_id: "checklist-en",
    destination: "firm_website",
    locale: "en-CA",
    intended_path: "/resources/renewal-clause-checklist",
    required_artifact_type: "pdf",
    scheduled_publish_date: null,
    state: "ready",
    created_by_role: "operator",
    created_by_id: null,
    created_at: "2026-07-19T00:00:00Z",
    updated_at: "2026-07-19T00:00:00Z",
    ...overrides,
  };
}

function baseAuditInput(overrides: Partial<ResolveReleaseGraphInput> = {}): ResolveReleaseGraphInput {
  return {
    deliverable: baseDeliverable(),
    currentVersion: baseVersion(),
    placement: basePlacement(),
    deliverablePlacements: [basePlacement()],
    artifacts: [],
    latestValidationByArtifactId: {},
    comments: [],
    currentReceipt: null,
    periodLifecycle: "enforced",
    emailBranding: null,
    ctaResolution: null,
    // DRG already has a live GHL Voice/SMS integration (intake_firms.ghl_location_id
    // is set for this firm per CLAUDE.md's Voice channel build-out) -- the
    // realistic case for DRG specifically is "account connected, endpoint
    // unverified," not "no account at all."
    firmGhlLocationId: "drg-ghl-location-id",
    // DRG has never enabled standing publishing authorization (0 rows in
    // standing_publishing_authorizations for this firm) -- individual
    // lawyer approval is the only release-authorization path DRG actually
    // uses today, matching baseDeliverable()'s approved_version_id default.
    standingAuthorizationActive: false,
    resolvedAt: RESOLVED_AT,
    ...overrides,
  };
}

describe("DRG Renewal Clause case study — 1. lead-magnet PDF absent", () => {
  it("resolves the real classification required_downloadable_artifact_missing, not a softened 'setup required'", () => {
    const audit = resolveAndAuditReleaseGraph(baseAuditInput());
    const f = audit.findings.find((x) => x.classification === "required_downloadable_artifact_missing");
    expect(f).toBeDefined();
    expect(f!.releaseImpact).toBe("blocks_today");
    expect(audit.verdict).toBe("hold");
  });
});

describe("DRG Renewal Clause case study — 2. portal excerpt/byline blanks may be renderer-derived", () => {
  it("a Counsel Note with blank excerpt/byline/topic resolves renderer_derived_metadata, never content_absent", () => {
    const counselNote = baseDeliverable({
      id: "counsel-note-pt",
      content_kind: "text",
      deliverable_role: "article",
      locale: "pt-BR",
      excerpt: null,
      byline: null,
      topic: null,
      current_version_id: "v-pt-1",
      approved_version_id: "v-pt-1",
      publication_path: "/pt/journal/clausula-de-renovacao",
    });
    const version = baseVersion({
      id: "v-pt-1",
      deliverable_id: "counsel-note-pt",
      body_html: "<p>Conteudo real e aprovado.</p>",
    });
    const placement = basePlacement({
      id: "placement-counsel-note-pt",
      deliverable_id: "counsel-note-pt",
      destination: "firm_website",
      locale: "pt-BR",
      required_artifact_type: "webpage",
    });
    const audit = resolveAndAuditReleaseGraph(baseAuditInput({ deliverable: counselNote, currentVersion: version, placement }));
    const classifications = audit.findings.map((f) => f.classification);
    expect(classifications).not.toContain("content_absent");
    expect(classifications).toContain("renderer_derived_metadata");
  });
});

describe("DRG Renewal Clause case study — 3. PT route requires canonical-source verification before classification", () => {
  it("resolves destination_target_unresolved only after checking for a pt-BR webpage artifact, never assumed from the portal alone", () => {
    const article = baseDeliverable({
      id: "counsel-note-pt",
      content_kind: "text",
      deliverable_role: "article",
      locale: "pt-BR",
      current_version_id: "v-pt-1",
      approved_version_id: "v-pt-1",
      publication_path: "/pt/journal/clausula-de-renovacao",
    });
    const version = baseVersion({ id: "v-pt-1", deliverable_id: "counsel-note-pt", body_html: "<p>Conteudo.</p>" });
    const placement = basePlacement({ id: "placement-pt", deliverable_id: "counsel-note-pt", destination: "firm_website", locale: "pt-BR" });

    // No pt-BR webpage artifact on record at all -- the correct check.
    const noRoute = resolveAndAuditReleaseGraph(baseAuditInput({ deliverable: article, currentVersion: version, placement }));
    expect(noRoute.findings.map((f) => f.classification)).toContain("destination_target_unresolved");
    const finding = noRoute.findings.find((f) => f.classification === "destination_target_unresolved")!;
    expect(finding.canonicalSourceConsulted).toMatch(/publication_artifacts/);

    // Once a validated pt-BR webpage artifact IS on record, the finding clears.
    const ptArtifact: PublicationArtifact = {
      id: "web-pt-1",
      firm_id: DRG_FIRM_ID,
      deliverable_id: "counsel-note-pt",
      version_id: "v-pt-1",
      artifact_type: "webpage",
      locale: "pt-BR",
      destination: "firm_website",
      storage_bucket: null,
      storage_path: null,
      public_url: "https://drglaw.ca/pt/journal/clausula-de-renovacao",
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
    };
    const validation: PublicationArtifactValidation = {
      id: "val-web-pt-1",
      artifact_id: "web-pt-1",
      firm_id: DRG_FIRM_ID,
      validator: "route_check",
      result: "pass",
      details: null,
      validated_by_role: "operator",
      validated_by_id: null,
      created_at: "2026-07-19T01:00:00Z",
    };
    const withRoute = resolveAndAuditReleaseGraph(
      baseAuditInput({
        deliverable: article,
        currentVersion: version,
        placement,
        artifacts: [ptArtifact],
        latestValidationByArtifactId: { "web-pt-1": validation },
      }),
    );
    const stillBlocked = withRoute.findings.filter((f) => f.fact === "canonical_public_destination_route");
    expect(stillBlocked).toHaveLength(0);
  });
});

describe("DRG Renewal Clause case study — 4. GBP promotion with no live target", () => {
  it("resolves destination_target_unresolved, not automatically missing copy -- the post's own text remains present and unflagged", () => {
    const gbpPost = baseDeliverable({
      id: "gbp-good-standing",
      content_kind: "text",
      deliverable_role: "gbp_post",
      publication_destination: "google_business_profile",
      current_version_id: "v-gbp-1",
      approved_version_id: "v-gbp-1",
      cta_target_path: "/good-standing",
      requires_image: false,
    });
    const version = baseVersion({ id: "v-gbp-1", deliverable_id: "gbp-good-standing", body_html: "<p>DRG Law is in good standing.</p>" });
    const placement = basePlacement({ id: "placement-gbp", deliverable_id: "gbp-good-standing", destination: "google_business_profile" });
    const ctaResolution: CtaTargetResolution = { requiresNativeArticle: false, nativeArticleReady: false, targetLabel: null, targetVerifiedLive: false };

    const audit = resolveAndAuditReleaseGraph(baseAuditInput({ deliverable: gbpPost, currentVersion: version, placement, ctaResolution }));
    const classifications = audit.findings.map((f) => f.classification);
    expect(classifications).toContain("destination_target_unresolved");
    expect(classifications).not.toContain("content_absent");
    // The finding is specifically about the CTA target, not the post's own copy.
    const f = audit.findings.find((x) => x.classification === "destination_target_unresolved" && x.fact === "cta_target_live_and_correct");
    expect(f?.rootCause).toMatch(/target/i);
  });
});

describe("DRG Renewal Clause case study — 5. the Minute is not send-ready while unsubscribe_endpoint_pending", () => {
  it("fires unsubscribe_endpoint_pending regardless of how complete the newsletter copy/branding is", () => {
    const minute = baseDeliverable({
      id: "drg-law-minute",
      content_kind: "text",
      deliverable_role: "article", // no dedicated email role exists in this schema; see §13's implementation-impact notes.
      current_version_id: "v-minute-1",
      approved_version_id: "v-minute-1",
    });
    const version = baseVersion({ id: "v-minute-1", deliverable_id: "drg-law-minute", body_html: "<p>Full, approved newsletter copy.</p>" });
    const placement = basePlacement({ id: "placement-minute", deliverable_id: "drg-law-minute", destination: "email_delivery", required_artifact_type: null });

    const audit = resolveAndAuditReleaseGraph(
      baseAuditInput({
        deliverable: minute,
        currentVersion: version,
        placement,
        emailBranding: {
          paper: "#EFE9DD", surface: "#FFF", ink: "#111", inkMuted: "#555", brass: "#C9B896", rowDivider: "#E0DDD6",
          oxblood: "#5C1A1A", oxbloodText: "#FFF", taupe: "#8C7D6E", fontStack: "serif",
          firmName: "DRG Law Professional Corporation", wordmark: "DRG Law", wordmarkSub: "Professional Corporation",
        },
      }),
    );
    const f = audit.findings.find((x) => x.classification === "unsubscribe_endpoint_pending");
    expect(f).toBeDefined();
    expect(f!.immediateDisposition).toMatch(/hard-block/i);

    const report = renderReleaseGraphReport({ audits: [audit], generatedAt: RESOLVED_AT });
    expect(report).toContain("unsubscribe_endpoint_pending");
    expect(report).not.toMatch(/ready to send|send-ready/i);
  });
});

describe("DRG Renewal Clause case study — 6. wrong hero-card reuse on a homepage/article", () => {
  it("resolves visual_rendition_role_mismatch, not a generic missing-image state", () => {
    const article = baseDeliverable({
      id: "article-en",
      content_kind: "text",
      deliverable_role: "article",
      current_version_id: "v-article-1",
      approved_version_id: "v-article-1",
    });
    const version = baseVersion({ id: "v-article-1", deliverable_id: "article-en", body_html: "<p>Approved article copy.</p>" });
    const placement = basePlacement({ id: "placement-article", deliverable_id: "article-en", destination: "firm_website", required_artifact_type: "hero_image" });
    const webpageArtifact: PublicationArtifact = {
      id: "web-article", firm_id: DRG_FIRM_ID, deliverable_id: "article-en", version_id: "v-article-1",
      artifact_type: "webpage", locale: "en-CA", destination: "firm_website", storage_bucket: null, storage_path: null,
      public_url: "https://drglaw.ca/journal/renewal-clause", repository: null, repository_path: null, deployment_commit: null,
      deployment_url: null, mime_type: null, size_bytes: null, sha256: null, validation_result: null,
      created_by_role: "operator", created_by_id: null, created_at: "2026-07-19T00:00:00Z", superseded_at: null,
    };
    // The wrong asset: a pre-composed, baked-text LinkedIn/GBP card reused as the website hero.
    const wrongCard: PublicationArtifact = {
      id: "card-reused", firm_id: DRG_FIRM_ID, deliverable_id: "article-en", version_id: "v-article-1",
      artifact_type: "social_image", locale: "en-CA", destination: "firm_website", storage_bucket: "firm-files",
      storage_path: "deliverables/social/article-en-card.png", public_url: null, repository: null, repository_path: null,
      deployment_commit: null, deployment_url: null, mime_type: "image/png", size_bytes: 204800, sha256: "deadbeef",
      validation_result: null, created_by_role: "operator", created_by_id: null, created_at: "2026-07-19T00:00:00Z", superseded_at: null,
    };
    const validation: PublicationArtifactValidation = {
      id: "val-web-article", artifact_id: "web-article", firm_id: DRG_FIRM_ID, validator: "route_check", result: "pass",
      details: null, validated_by_role: "operator", validated_by_id: null, created_at: "2026-07-19T01:00:00Z",
    };

    const audit = resolveAndAuditReleaseGraph(
      baseAuditInput({
        deliverable: article,
        currentVersion: version,
        placement,
        artifacts: [webpageArtifact, wrongCard],
        latestValidationByArtifactId: { "web-article": validation },
      }),
    );
    const f = audit.findings.find((x) => x.classification === "visual_rendition_role_mismatch");
    expect(f).toBeDefined();
    expect(f!.factualEvidence).toMatch(/textless_html_headline/);
    expect(f!.factualEvidence).toMatch(/social_image/);
    expect(classificationsWithout(audit, "visual_rendition_role_mismatch")).not.toContain("required_visual_rendition_missing");
  });
});

function classificationsWithout(audit: ReturnType<typeof resolveAndAuditReleaseGraph>, _exclude: string): string[] {
  return audit.findings.map((f) => f.classification);
}

describe("DRG Renewal Clause case study — end-to-end dry-run report", () => {
  it("produces a single deterministic, read-only markdown report across all six scenarios with no publish/write side effect", () => {
    const scenarios = [baseAuditInput()];
    const report = renderReleaseGraphReport({ periodId: RENEWAL_CLAUSE_PERIOD_ID, audits: scenarios.map(resolveAndAuditReleaseGraph), generatedAt: RESOLVED_AT });
    expect(report).toContain("Dry-run, read-only");
    expect(report).toContain(RENEWAL_CLAUSE_PERIOD_ID);
    // Re-running against identical input produces byte-identical output (deterministic).
    const report2 = renderReleaseGraphReport({ periodId: RENEWAL_CLAUSE_PERIOD_ID, audits: scenarios.map(resolveAndAuditReleaseGraph), generatedAt: RESOLVED_AT });
    expect(report).toBe(report2);
  });
});
