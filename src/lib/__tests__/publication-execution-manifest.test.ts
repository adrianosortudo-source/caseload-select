import { describe, it, expect } from "vitest";
import {
  buildPublicationExecutionManifest,
  resolveReleaseVersion,
  computeManifestIdempotencyKey,
  MANIFEST_SCHEMA_VERSION,
  type BuildManifestInput,
} from "@/lib/publication-execution-manifest";
import type { ContentDeliverable, ContentPlacement, DeliverableVersion, PublicationArtifact } from "@/lib/types";

const FIRM_ID = "11111111-1111-1111-1111-111111111111";
const DELIVERABLE_ID = "22222222-2222-2222-2222-222222222222";
const APPROVED_VERSION_ID = "33333333-3333-3333-3333-333333333333";
const CURRENT_VERSION_ID = APPROVED_VERSION_ID; // happy-path default: no drift
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
    current_version_id: CURRENT_VERSION_ID,
    approved_version_id: APPROVED_VERSION_ID,
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

function baseVersion(id: string, overrides: Partial<DeliverableVersion> = {}): DeliverableVersion {
  return {
    id,
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
    version_id: APPROVED_VERSION_ID,
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
  const approvedVersion = baseVersion(APPROVED_VERSION_ID);
  return {
    now: NOW,
    generatedBy: GENERATED_BY,
    firmId: FIRM_ID,
    period: { id: "66666666-6666-6666-6666-666666666666", readinessLifecycle: "enforced" },
    deliverable: baseDeliverable(),
    approvedVersion,
    currentVersion: approvedVersion,
    placement: basePlacement(),
    assets: [baseArtifact()],
    validatedArtifactIds: new Set([ARTIFACT_ID]),
    currentReceipt: null,
    standingAuthorizationActive: false,
    resolvedDestinationBaseUrl: "https://drglaw.ca",
    resolvedWebsiteBaseUrl: "https://drglaw.ca",
    explicitDestinationConfig: null,
    scheduledTimezone: "America/Toronto",
    latestClaim: null,
    ...overrides,
  };
}

describe("resolveReleaseVersion — the single source of truth for path + version", () => {
  it("path A: individual approval, no drift", () => {
    const approvedVersion = baseVersion(APPROVED_VERSION_ID);
    const r = resolveReleaseVersion({
      deliverable: { status: "approved", approved_version_id: APPROVED_VERSION_ID, current_version_id: APPROVED_VERSION_ID },
      approvedVersion,
      currentVersion: approvedVersion,
      standingAuthorizationActive: false,
    });
    expect(r.releaseAuthorizationPath).toBe("individual_approval");
    expect(r.releaseVersionId).toBe(APPROVED_VERSION_ID);
    expect(r.releaseVersion).toBe(approvedVersion);
    expect(r.blockReason).toBe(null);
  });

  it("path B: standing authorization releases the CURRENT version even when status is in_review", () => {
    const currentVersion = baseVersion("current-v3", { requires_individual_review: false });
    const r = resolveReleaseVersion({
      deliverable: { status: "in_review", approved_version_id: null, current_version_id: "current-v3" },
      approvedVersion: null,
      currentVersion,
      standingAuthorizationActive: true,
    });
    expect(r.releaseAuthorizationPath).toBe("standing_authorization");
    expect(r.releaseVersionId).toBe("current-v3");
    expect(r.releaseVersion).toBe(currentVersion);
    expect(r.blockReason).toBe(null);
  });

  it("path B never consults deliverable.status, mirroring claim_placement_for_publish()'s own gate", () => {
    for (const status of ["draft", "in_review", "changes_requested", "archived"] as const) {
      const currentVersion = baseVersion("current-v9", { requires_individual_review: false });
      const r = resolveReleaseVersion({
        deliverable: { status, approved_version_id: null, current_version_id: "current-v9" },
        approvedVersion: null,
        currentVersion,
        standingAuthorizationActive: true,
      });
      expect(r.releaseAuthorizationPath).toBe("standing_authorization");
    }
  });

  it("a version flagged requires_individual_review can NEVER release via standing authorization, even when it is active", () => {
    const currentVersion = baseVersion("current-v3", { requires_individual_review: true });
    const r = resolveReleaseVersion({
      deliverable: { status: "in_review", approved_version_id: null, current_version_id: "current-v3" },
      approvedVersion: null,
      currentVersion,
      standingAuthorizationActive: true,
    });
    expect(r.releaseAuthorizationPath).toBe(null);
    expect(r.releaseVersionId).toBe(null);
    expect(r.blockReason).toContain("requires_individual_review");
  });

  it("neither path applies: not approved, standing authorization inactive", () => {
    const currentVersion = baseVersion("current-v3", { requires_individual_review: false });
    const r = resolveReleaseVersion({
      deliverable: { status: "in_review", approved_version_id: null, current_version_id: "current-v3" },
      approvedVersion: null,
      currentVersion,
      standingAuthorizationActive: false,
    });
    expect(r.releaseAuthorizationPath).toBe(null);
    expect(r.releaseVersionId).toBe(null);
    expect(r.blockReason).toContain("no release authorization path");
  });

  it("version drift (approved != current) falls through to path B rather than forcing a block, when standing authorization applies", () => {
    const currentVersion = baseVersion("current-v4", { requires_individual_review: false });
    const r = resolveReleaseVersion({
      deliverable: { status: "approved", approved_version_id: "old-v3", current_version_id: "current-v4" },
      approvedVersion: baseVersion("old-v3"),
      currentVersion,
      standingAuthorizationActive: true,
    });
    expect(r.releaseAuthorizationPath).toBe("standing_authorization");
    expect(r.releaseVersionId).toBe("current-v4");
  });
});

describe("buildPublicationExecutionManifest — happy path (path A)", () => {
  it("produces an unblocked manifest with all fields populated from stored records only", () => {
    const manifest = buildPublicationExecutionManifest(baseInput());
    expect(manifest.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    expect(manifest.blocked).toBe(false);
    expect(manifest.blockReasons).toEqual([]);
    expect(manifest.firmId).toBe(FIRM_ID);
    expect(manifest.deliverableId).toBe(DELIVERABLE_ID);
    expect(manifest.placementId).toBe(PLACEMENT_ID);
    expect(manifest.approvedVersionId).toBe(APPROVED_VERSION_ID);
    expect(manifest.releaseVersionId).toBe(APPROVED_VERSION_ID);
    expect(manifest.releaseAuthorizationPath).toBe("individual_approval");
    expect(manifest.title).toBe("Founder vesting in Ontario corporations");
    expect(manifest.body).toContain("vesting schedule");
    expect(manifest.canonicalUrl).toBe("https://drglaw.ca/journal/founder-vesting-ontario");
    expect(manifest.trackedUrl).toContain("utm_content=" + PLACEMENT_ID);
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0].artifactId).toBe(ARTIFACT_ID);
    expect(manifest.assets[0].sha256).toBe("a".repeat(64));
    expect(manifest.assets[0].validated).toBe(true);
  });

  it("computes a deterministic idempotency key bound to releaseVersionId, stable across regenerations", () => {
    const m1 = buildPublicationExecutionManifest(baseInput());
    const m2 = buildPublicationExecutionManifest(baseInput({ now: "2026-07-19T00:00:00.000Z" }));
    expect(m1.idempotencyKey).toBe(m2.idempotencyKey);
    expect(m1.idempotencyKey).toBe(
      computeManifestIdempotencyKey(FIRM_ID, DELIVERABLE_ID, PLACEMENT_ID, APPROVED_VERSION_ID),
    );
  });

  it("hashes the exact release version's body_html, and the hash changes if the body differs", () => {
    const m1 = buildPublicationExecutionManifest(baseInput());
    const differentVersion = baseVersion(APPROVED_VERSION_ID, { body_html: "<p>different content</p>" });
    const m2 = buildPublicationExecutionManifest(
      baseInput({ approvedVersion: differentVersion, currentVersion: differentVersion }),
    );
    expect(m1.versionBodyHash).toHaveLength(64);
    expect(m1.versionBodyHash).not.toBe(m2.versionBodyHash);
  });
});

describe("buildPublicationExecutionManifest — path B (standing authorization) is not double-blocked", () => {
  it("an in_review, never-individually-approved deliverable is NOT blocked on content grounds when standing authorization applies", () => {
    const currentVersion = baseVersion("current-v7", { requires_individual_review: false });
    const manifest = buildPublicationExecutionManifest(
      baseInput({
        deliverable: baseDeliverable({ status: "in_review", approved_version_id: null, current_version_id: "current-v7" }),
        approvedVersion: null,
        currentVersion,
        assets: [baseArtifact({ version_id: "current-v7" })],
        validatedArtifactIds: new Set([ARTIFACT_ID]),
        standingAuthorizationActive: true,
      }),
    );
    expect(manifest.releaseAuthorizationPath).toBe("standing_authorization");
    expect(manifest.releaseVersionId).toBe("current-v7");
    expect(manifest.blocked).toBe(false);
    expect(manifest.blockReasons.some((r) => r.includes("not approved"))).toBe(false);
    expect(manifest.body).toContain("vesting schedule");
  });

  it("idempotency key changes when the current version changes under standing authorization -- two revisions never share a key", () => {
    const v1 = baseVersion("current-v1", { requires_individual_review: false });
    const v2 = baseVersion("current-v2", { requires_individual_review: false });
    const m1 = buildPublicationExecutionManifest(
      baseInput({
        deliverable: baseDeliverable({ status: "in_review", approved_version_id: null, current_version_id: "current-v1" }),
        approvedVersion: null,
        currentVersion: v1,
        assets: [baseArtifact({ version_id: "current-v1" })],
        standingAuthorizationActive: true,
      }),
    );
    const m2 = buildPublicationExecutionManifest(
      baseInput({
        deliverable: baseDeliverable({ status: "in_review", approved_version_id: null, current_version_id: "current-v2" }),
        approvedVersion: null,
        currentVersion: v2,
        assets: [baseArtifact({ version_id: "current-v2" })],
        standingAuthorizationActive: true,
      }),
    );
    expect(m1.idempotencyKey).not.toBe(m2.idempotencyKey);
  });
});

describe("buildPublicationExecutionManifest — blocking, never fabricated", () => {
  it("blocks when neither individual approval nor standing authorization applies", () => {
    const manifest = buildPublicationExecutionManifest(
      baseInput({ deliverable: baseDeliverable({ status: "in_review", approved_version_id: null }) }),
    );
    expect(manifest.blocked).toBe(true);
    expect(manifest.releaseVersionId).toBe(null);
    expect(manifest.blockReasons.some((r) => r.includes("no release authorization path"))).toBe(true);
  });

  it("never invents a body when the release version has none", () => {
    const empty = baseVersion(APPROVED_VERSION_ID, { body_html: null });
    const manifest = buildPublicationExecutionManifest(baseInput({ approvedVersion: empty, currentVersion: empty }));
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

  it("blocks when the required artifact type is not bound to the release version", () => {
    const manifest = buildPublicationExecutionManifest(baseInput({ assets: [] }));
    expect(manifest.blocked).toBe(true);
    expect(manifest.blockReasons.some((r) => r.includes('required type "hero_image"'))).toBe(true);
  });
});

describe("buildPublicationExecutionManifest — validated artifacts, never merely-registered ones", () => {
  it("blocks when a required-type asset is registered but never validated", () => {
    const manifest = buildPublicationExecutionManifest(baseInput({ validatedArtifactIds: new Set() }));
    expect(manifest.blocked).toBe(true);
    expect(manifest.blockReasons.some((r) => r.includes("registered but has never been validated"))).toBe(true);
    expect(manifest.assets[0].validated).toBe(false);
  });

  it("passes when the required-type asset has a passing validation on record", () => {
    const manifest = buildPublicationExecutionManifest(baseInput({ validatedArtifactIds: new Set([ARTIFACT_ID]) }));
    expect(manifest.blockReasons.some((r) => r.includes("validated"))).toBe(false);
  });
});

describe("buildPublicationExecutionManifest — release authorization path", () => {
  it("never offers standing_authorization for a version flagged requires_individual_review, even if the firm has it enabled", () => {
    const currentVersion = baseVersion("current-v8", { requires_individual_review: true });
    const manifest = buildPublicationExecutionManifest(
      baseInput({
        deliverable: baseDeliverable({ status: "in_review", approved_version_id: null, current_version_id: "current-v8" }),
        approvedVersion: null,
        currentVersion,
        standingAuthorizationActive: true,
      }),
    );
    expect(manifest.releaseAuthorizationPath).toBe(null);
    expect(manifest.blockReasons.some((r) => r.includes("requires_individual_review"))).toBe(true);
  });
});

describe("buildPublicationExecutionManifest — existing claim, no duplicate publish attempts", () => {
  it("blocks when an active claim already exists for this placement's exact release version", () => {
    const manifest = buildPublicationExecutionManifest(
      baseInput({ latestClaim: { status: "active", approvedVersionId: APPROVED_VERSION_ID } }),
    );
    expect(manifest.blocked).toBe(true);
    expect(manifest.blockReasons.some((r) => r.includes("active publication claim already exists"))).toBe(true);
    expect(manifest.destinationMetadata.latestClaimStatus).toBe("active");
  });

  it("does not block on a released or superseded claim (history, not a live conflict)", () => {
    for (const status of ["released", "superseded"] as const) {
      const manifest = buildPublicationExecutionManifest(
        baseInput({ latestClaim: { status, approvedVersionId: APPROVED_VERSION_ID } }),
      );
      expect(manifest.blockReasons.some((r) => r.includes("active publication claim already exists"))).toBe(false);
    }
  });

  it("does not block on an active claim for a DIFFERENT, superseded release version", () => {
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

  it("always reports LinkedIn and GBP destinations as unconfigured absent explicit configuration (no integration exists anywhere in this system)", () => {
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

describe("buildPublicationExecutionManifest — explicit destination configuration, corrective pass", () => {
  it("an explicit publication_destination_configs entry wins over firm_website evidence-based inference", () => {
    const manifest = buildPublicationExecutionManifest(
      baseInput({
        resolvedDestinationBaseUrl: "https://inferred-from-evidence.example",
        explicitDestinationConfig: { identifier: "https://drglaw.ca", label: "DRG Law primary site" },
      }),
    );
    expect(manifest.destinationAccount.configured).toBe(true);
    expect(manifest.destinationAccount.identifier).toBe("https://drglaw.ca");
    expect(manifest.destinationAccount.note).toContain("explicitly configured");
    expect(manifest.destinationAccount.note).toContain("DRG Law primary site");
  });

  it("explicit configuration is the only way a LinkedIn/GBP/email destination can ever report configured:true", () => {
    for (const destination of [
      "linkedin_post",
      "linkedin_article",
      "linkedin_company_page",
      "google_business_profile",
      "email_delivery",
    ] as const) {
      const manifest = buildPublicationExecutionManifest(
        baseInput({
          placement: basePlacement({ destination, required_artifact_type: null }),
          resolvedDestinationBaseUrl: null,
          explicitDestinationConfig: { identifier: "urn:li:organization:12345", label: null },
        }),
      );
      expect(manifest.destinationAccount.configured).toBe(true);
      expect(manifest.destinationAccount.identifier).toBe("urn:li:organization:12345");
    }
  });

  it("firm_website falls back to evidence-based inference only when no explicit configuration exists, and the note discloses the lower-trust fallback tier", () => {
    const manifest = buildPublicationExecutionManifest(
      baseInput({
        explicitDestinationConfig: null,
        resolvedDestinationBaseUrl: "https://drglaw.ca",
      }),
    );
    expect(manifest.destinationAccount.configured).toBe(true);
    expect(manifest.destinationAccount.identifier).toBe("https://drglaw.ca");
    expect(manifest.destinationAccount.note).toContain("no explicit publication_destination_configs entry");
    expect(manifest.destinationAccount.note).toContain("lower-trust");
  });
});

describe("buildPublicationExecutionManifest — CTA target, resolved independently of the placement's own destination", () => {
  it("resolves a GBP post's CTA target URL against the firm's website base, not the (unconfigured) GBP destination account", () => {
    const manifest = buildPublicationExecutionManifest(
      baseInput({
        deliverable: baseDeliverable({ deliverable_role: "gbp_post", cta_target_path: "/journal/founder-vesting-ontario" }),
        placement: basePlacement({ destination: "google_business_profile", intended_path: null, required_artifact_type: "social_image" }),
        assets: [baseArtifact({ artifact_type: "social_image" })],
        resolvedDestinationBaseUrl: null, // GBP itself is never configured
        resolvedWebsiteBaseUrl: "https://drglaw.ca", // but the website base IS known
      }),
    );
    expect(manifest.destinationAccount.configured).toBe(false); // GBP account itself still unconfigured
    expect(manifest.ctaTargetUrl).toBe("https://drglaw.ca/journal/founder-vesting-ontario");
    expect(manifest.ctaTrackedUrl).toContain("utm_medium=organic"); // the CTA points at the website, tracked as such
    expect(manifest.ctaTrackedUrl).toContain("utm_content=" + PLACEMENT_ID);
  });

  it("blocks a gbp_post/social_post with a cta_target_path that cannot be resolved (no validated website base on record)", () => {
    const manifest = buildPublicationExecutionManifest(
      baseInput({
        deliverable: baseDeliverable({ deliverable_role: "social_post", cta_target_path: "/journal/x" }),
        placement: basePlacement({ destination: "linkedin_post", intended_path: null, required_artifact_type: null }),
        resolvedDestinationBaseUrl: null,
        resolvedWebsiteBaseUrl: null,
      }),
    );
    expect(manifest.ctaTargetUrl).toBe(null);
    expect(manifest.blockReasons.some((r) => r.includes("cta_target_path is set but could not be resolved"))).toBe(true);
  });

  it("never sets a CTA target when the deliverable has no cta_target_path at all", () => {
    const manifest = buildPublicationExecutionManifest(baseInput());
    expect(manifest.ctaTargetUrl).toBe(null);
    expect(manifest.ctaTrackedUrl).toBe(null);
  });
});

describe("buildPublicationExecutionManifest — assets are ordered and hashed, never re-derived", () => {
  it("sorts assets deterministically, filters to the release version only, and preserves every stored field verbatim", () => {
    const otherVersionArtifact = baseArtifact({ id: "stale-asset", version_id: "some-other-version" });
    const artifact2 = baseArtifact({
      id: "99999999-9999-9999-9999-999999999999",
      artifact_type: "pdf",
      sha256: "b".repeat(64),
    });
    const manifest = buildPublicationExecutionManifest(
      baseInput({
        assets: [artifact2, baseArtifact(), otherVersionArtifact],
        validatedArtifactIds: new Set([ARTIFACT_ID, "99999999-9999-9999-9999-999999999999", "stale-asset"]),
        placement: basePlacement({ required_artifact_type: "hero_image" }),
      }),
    );
    // otherVersionArtifact is bound to a different version_id than the
    // release version and must never appear, even though it is "validated".
    expect(manifest.assets.map((a) => a.artifactId)).not.toContain("stale-asset");
    expect(manifest.assets.map((a) => a.artifactType)).toEqual(["hero_image", "pdf"]);
    expect(manifest.assets[1].sha256).toBe("b".repeat(64));
  });
});
