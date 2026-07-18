import { describe, it, expect } from "vitest";
import {
  buildPublicationExecutionManifest,
  computeManifestIdempotencyKey,
  MANIFEST_SCHEMA_VERSION,
  type BuildManifestInput,
} from "@/lib/publication-execution-manifest";
import type { ContentDeliverable, ContentPlacement, DeliverableVersion, PublicationArtifact } from "@/lib/types";

const FIRM_ID = "11111111-1111-1111-1111-111111111111";
const DELIVERABLE_ID = "22222222-2222-2222-2222-222222222222";
const VERSION_ID = "33333333-3333-3333-3333-333333333333";
const PLACEMENT_ID = "44444444-4444-4444-4444-444444444444";
const ARTIFACT_ID = "55555555-5555-5555-5555-555555555555";
const NOW = "2026-07-18T12:00:00.000Z";
const GENERATED_BY = { role: "operator" as const, id: "op-1", name: "Operator One" };

function baseDeliverable(overrides: Partial<ContentDeliverable> = {}): ContentDeliverable {
  return {
    id: DELIVERABLE_ID,
    firm_id: FIRM_ID,
    title: "Founder vesting in Ontario corporations",
    description: null,
    content_kind: "text",
    status: "approved",
    current_version_id: VERSION_ID,
    approved_version_id: VERSION_ID,
    approved_at: "2026-07-14T00:00:00.000Z",
    created_by_role: "operator",
    created_by_id: "op-1",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-14T00:00:00.000Z",
    excerpt: "What founders should know before signing.",
    topic: "Founder vesting",
    byline: "DRG Law",
    publish_date: "2026-07-14",
    read_time: "8 min read",
    hero_image_url: null,
    kicker: null,
    period_id: "66666666-6666-6666-6666-666666666666",
    format: "Counsel Note",
    locale: "en-CA",
    deliverable_role: "article",
    publication_destination: "firm_website",
    publication_path: "/journal/founder-vesting-ontario",
    cta_target_path: null,
    requires_legal_approval: null,
    requires_image: null,
    requires_file: null,
    requires_localized_route: null,
    ...overrides,
  } as ContentDeliverable;
}

function baseVersion(overrides: Partial<DeliverableVersion> = {}): DeliverableVersion {
  return {
    id: VERSION_ID,
    deliverable_id: DELIVERABLE_ID,
    firm_id: FIRM_ID,
    version_number: 2,
    body_html: "<p>Founders should confirm their vesting schedule before signing.</p>",
    storage_path: null,
    asset_mime: null,
    asset_size_bytes: null,
    asset_name: null,
    note: null,
    responds_to_approval_id: null,
    asset_sha256: null,
    asset_validation: null,
    created_by_role: "operator",
    created_by_id: "op-1",
    created_at: "2026-07-13T00:00:00.000Z",
    requires_individual_review: false,
    requires_individual_review_reason: null,
    requires_individual_review_set_by_role: null,
    requires_individual_review_set_by_id: null,
    requires_individual_review_set_by_name: null,
    requires_individual_review_set_at: null,
    ...overrides,
  } as DeliverableVersion;
}

function basePlacement(overrides: Partial<ContentPlacement> = {}): ContentPlacement {
  return {
    id: PLACEMENT_ID,
    firm_id: FIRM_ID,
    period_id: "66666666-6666-6666-6666-666666666666",
    deliverable_id: DELIVERABLE_ID,
    destination: "firm_website",
    locale: "en-CA",
    intended_path: "/journal/founder-vesting-ontario",
    required_artifact_type: "hero_image",
    scheduled_publish_date: null,
    state: "ready",
    created_by_role: "operator",
    created_by_id: "op-1",
    created_at: "2026-07-13T00:00:00.000Z",
    updated_at: "2026-07-13T00:00:00.000Z",
    ...overrides,
  } as ContentPlacement;
}

function baseArtifact(overrides: Partial<PublicationArtifact> = {}): PublicationArtifact {
  return {
    id: ARTIFACT_ID,
    firm_id: FIRM_ID,
    deliverable_id: DELIVERABLE_ID,
    version_id: VERSION_ID,
    artifact_type: "hero_image",
    locale: "en-CA",
    destination: "firm_website",
    storage_bucket: "firm-files",
    storage_path: "deliverables/hero/foo.png",
    public_url: null,
    repository: null,
    repository_path: null,
    deployment_commit: null,
    deployment_url: null,
    mime_type: "image/png",
    size_bytes: 204800,
    sha256: "a".repeat(64),
    validation_result: null,
    created_by_role: "operator",
    created_by_id: "op-1",
    ...overrides,
  } as unknown as PublicationArtifact;
}

function baseInput(overrides: Partial<BuildManifestInput> = {}): BuildManifestInput {
  return {
    now: NOW,
    generatedBy: GENERATED_BY,
    firmId: FIRM_ID,
    period: { id: "66666666-6666-6666-6666-666666666666", readinessLifecycle: "enforced" },
    deliverable: baseDeliverable(),
    approvedVersion: baseVersion(),
    placement: basePlacement(),
    assets: [baseArtifact()],
    currentReceipt: null,
    standingAuthorizationActive: false,
    resolvedDestinationBaseUrl: "https://drglaw.ca",
    scheduledTimezone: "America/Toronto",
    latestClaim: null,
    ...overrides,
  };
}

describe("buildPublicationExecutionManifest — happy path", () => {
  it("produces an unblocked manifest with all fields populated from stored records only", () => {
    const manifest = buildPublicationExecutionManifest(baseInput());
    expect(manifest.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    expect(manifest.blocked).toBe(false);
    expect(manifest.blockReasons).toEqual([]);
    expect(manifest.firmId).toBe(FIRM_ID);
    expect(manifest.deliverableId).toBe(DELIVERABLE_ID);
    expect(manifest.placementId).toBe(PLACEMENT_ID);
    expect(manifest.approvedVersionId).toBe(VERSION_ID);
    expect(manifest.releaseAuthorizationPath).toBe("individual_approval");
    expect(manifest.title).toBe("Founder vesting in Ontario corporations");
    expect(manifest.body).toContain("vesting schedule");
    expect(manifest.canonicalUrl).toBe("https://drglaw.ca/journal/founder-vesting-ontario");
    expect(manifest.trackedUrl).toContain("utm_content=" + PLACEMENT_ID);
    expect(manifest.trackedUrl).toContain("utm_medium=organic");
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0].artifactId).toBe(ARTIFACT_ID);
    expect(manifest.assets[0].sha256).toBe("a".repeat(64));
  });

  it("computes a deterministic idempotency key that never changes across regenerations of the same intent", () => {
    const m1 = buildPublicationExecutionManifest(baseInput());
    const m2 = buildPublicationExecutionManifest(baseInput({ now: "2026-07-19T00:00:00.000Z" }));
    expect(m1.idempotencyKey).toBe(m2.idempotencyKey);
    expect(m1.idempotencyKey).toBe(
      computeManifestIdempotencyKey(FIRM_ID, DELIVERABLE_ID, PLACEMENT_ID, VERSION_ID),
    );
  });

  it("hashes the exact approved body_html, and the hash changes if the body differs", () => {
    const m1 = buildPublicationExecutionManifest(baseInput());
    const m2 = buildPublicationExecutionManifest(
      baseInput({ approvedVersion: baseVersion({ body_html: "<p>different content</p>" }) }),
    );
    expect(m1.versionBodyHash).toHaveLength(64);
    expect(m1.versionBodyHash).not.toBe(m2.versionBodyHash);
  });
});

describe("buildPublicationExecutionManifest — blocking, never fabricated", () => {
  it("blocks when the deliverable is not approved", () => {
    const manifest = buildPublicationExecutionManifest(
      baseInput({ deliverable: baseDeliverable({ status: "in_review" }) }),
    );
    expect(manifest.blocked).toBe(true);
    expect(manifest.blockReasons.some((r) => r.includes('status is "in_review"'))).toBe(true);
  });

  it("blocks on version drift (current_version_id !== approved_version_id)", () => {
    const manifest = buildPublicationExecutionManifest(
      baseInput({ deliverable: baseDeliverable({ current_version_id: "different-version-id" }) }),
    );
    expect(manifest.blocked).toBe(true);
    expect(manifest.blockReasons.some((r) => r.includes("version drift"))).toBe(true);
    // Standing authorization path is never offered as a silent bypass for drift.
    expect(manifest.releaseAuthorizationPath).toBe(null);
  });

  it("never invents a body when the approved version has none", () => {
    const manifest = buildPublicationExecutionManifest(
      baseInput({ approvedVersion: baseVersion({ body_html: null }) }),
    );
    expect(manifest.body).toBe(null);
    expect(manifest.blocked).toBe(true);
    expect(manifest.blockReasons.some((r) => r.includes("no body_html"))).toBe(true);
  });

  it("blocks when locale or deliverable_role metadata is missing, never assuming a default", () => {
    const manifest = buildPublicationExecutionManifest(
      baseInput({ deliverable: baseDeliverable({ locale: null, deliverable_role: null }) }),
    );
    expect(manifest.blocked).toBe(true);
    expect(manifest.blockReasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("no locale set"),
        expect.stringContaining("no deliverable_role set"),
      ]),
    );
  });

  it("blocks when a role that carries its own placement has no intended_path/publication_path", () => {
    const manifest = buildPublicationExecutionManifest(
      baseInput({ placement: basePlacement({ intended_path: null }) }),
    );
    expect(manifest.blocked).toBe(true);
    expect(manifest.canonicalUrl).toBe(null);
    expect(manifest.trackedUrl).toBe(null);
  });

  it("blocks when the required artifact type is not bound to the approved version", () => {
    const manifest = buildPublicationExecutionManifest(baseInput({ assets: [] }));
    expect(manifest.blocked).toBe(true);
    expect(manifest.blockReasons.some((r) => r.includes('required type "hero_image"'))).toBe(true);
  });
});

describe("buildPublicationExecutionManifest — release authorization path", () => {
  it("falls back to standing_authorization only when individual approval does not apply and the firm has it enabled", () => {
    const manifest = buildPublicationExecutionManifest(
      baseInput({
        deliverable: baseDeliverable({ status: "in_review" }),
        standingAuthorizationActive: true,
      }),
    );
    expect(manifest.releaseAuthorizationPath).toBe("standing_authorization");
    // in_review still blocks the manifest overall -- releaseAuthorizationPath alone is never sufficient.
    expect(manifest.blocked).toBe(true);
  });

  it("never offers standing_authorization for a version flagged requires_individual_review, even if the firm has it enabled", () => {
    const manifest = buildPublicationExecutionManifest(
      baseInput({
        deliverable: baseDeliverable({ status: "in_review" }),
        approvedVersion: baseVersion({ requires_individual_review: true }),
        standingAuthorizationActive: true,
      }),
    );
    expect(manifest.releaseAuthorizationPath).toBe(null);
    expect(manifest.blockReasons.some((r) => r.includes("requires_individual_review"))).toBe(true);
  });

  it("blocks with no release path when neither individual approval nor standing authorization apply", () => {
    const manifest = buildPublicationExecutionManifest(
      baseInput({ deliverable: baseDeliverable({ status: "in_review" }), standingAuthorizationActive: false }),
    );
    expect(manifest.releaseAuthorizationPath).toBe(null);
    expect(manifest.blockReasons.some((r) => r.includes("no release authorization path"))).toBe(true);
  });
});

describe("buildPublicationExecutionManifest — existing claim, no duplicate publish attempts", () => {
  it("blocks when an active claim already exists for this placement and approved version", () => {
    const manifest = buildPublicationExecutionManifest(
      baseInput({ latestClaim: { status: "active", approvedVersionId: VERSION_ID } }),
    );
    expect(manifest.blocked).toBe(true);
    expect(manifest.blockReasons.some((r) => r.includes("active publication claim already exists"))).toBe(true);
    expect(manifest.destinationMetadata.latestClaimStatus).toBe("active");
  });

  it("does not block on a released or superseded claim (history, not a live conflict)", () => {
    for (const status of ["released", "superseded"] as const) {
      const manifest = buildPublicationExecutionManifest(
        baseInput({ latestClaim: { status, approvedVersionId: VERSION_ID } }),
      );
      expect(manifest.blockReasons.some((r) => r.includes("active publication claim already exists"))).toBe(false);
    }
  });

  it("does not block on an active claim for a DIFFERENT, superseded approved version", () => {
    const manifest = buildPublicationExecutionManifest(
      baseInput({ latestClaim: { status: "active", approvedVersionId: "some-other-version-id" } }),
    );
    expect(manifest.blockReasons.some((r) => r.includes("active publication claim already exists"))).toBe(false);
  });
});

describe("buildPublicationExecutionManifest — destination account, never guessed", () => {
  it("reports firm_website as unconfigured when no prior evidence resolves a base URL", () => {
    const manifest = buildPublicationExecutionManifest(baseInput({ resolvedDestinationBaseUrl: null }));
    expect(manifest.destinationAccount.configured).toBe(false);
    expect(manifest.destinationAccount.identifier).toBe(null);
    expect(manifest.canonicalUrl).toBe(null);
    expect(manifest.blocked).toBe(true);
  });

  it("always reports LinkedIn and GBP destinations as unconfigured (no integration exists anywhere in this system)", () => {
    for (const destination of ["linkedin_post", "linkedin_article", "linkedin_company_page", "google_business_profile"] as const) {
      const manifest = buildPublicationExecutionManifest(
        baseInput({
          placement: basePlacement({ destination, required_artifact_type: null }),
          resolvedDestinationBaseUrl: null,
        }),
      );
      expect(manifest.destinationAccount.configured).toBe(false);
      expect(manifest.destinationAccount.identifier).toBe(null);
    }
  });
});

describe("buildPublicationExecutionManifest — assets are ordered and hashed, never re-derived", () => {
  it("sorts assets deterministically and preserves every stored hash/path field verbatim", () => {
    const artifact2 = baseArtifact({
      id: "99999999-9999-9999-9999-999999999999",
      artifact_type: "pdf",
      sha256: "b".repeat(64),
    });
    const manifest = buildPublicationExecutionManifest(
      baseInput({
        assets: [artifact2, baseArtifact()],
        placement: basePlacement({ required_artifact_type: "hero_image" }),
      }),
    );
    expect(manifest.assets.map((a) => a.artifactType)).toEqual(["hero_image", "pdf"]);
    expect(manifest.assets[1].sha256).toBe("b".repeat(64));
  });
});
