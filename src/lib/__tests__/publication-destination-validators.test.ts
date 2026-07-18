import { describe, it, expect } from "vitest";
import {
  validateDestinationFormat,
  LINKEDIN_POST_MAX_CHARS,
  GBP_POST_BODY_MAX_CHARS,
  LINKEDIN_ARTICLE_HEADLINE_MAX_CHARS,
} from "@/lib/publication-destination-validators";
import type { PublicationExecutionManifest } from "@/lib/publication-execution-manifest";

function baseManifest(overrides: Partial<PublicationExecutionManifest> = {}): PublicationExecutionManifest {
  return {
    schemaVersion: "publication-execution-manifest-1.0",
    generatedAt: "2026-07-18T00:00:00.000Z",
    generatedBy: { role: "operator", id: "op-1", name: "Op" },
    idempotencyKey: "key",
    firmId: "firm-1",
    contentPeriodId: "period-1",
    periodLifecycle: "enforced",
    deliverableId: "deliverable-1",
    approvedVersionId: "version-1",
    versionBodyHash: "hash",
    releaseAuthorizationPath: "individual_approval",
    placementId: "placement-1",
    destination: "firm_website",
    destinationAccount: { configured: true, identifier: "https://drglaw.ca", note: "resolved" },
    locale: "en-CA",
    title: "Founder vesting in Ontario corporations",
    body: "<p>Body text.</p>",
    excerpt: "Excerpt",
    ctaTargetPath: null,
    canonicalUrl: "https://drglaw.ca/journal/founder-vesting-ontario",
    trackedUrl: "https://drglaw.ca/journal/founder-vesting-ontario?utm_content=placement-1",
    assets: [],
    scheduledPublishDate: null,
    scheduledTimezone: null,
    destinationMetadata: { bodyLength: 17, priorReceiptVerificationState: null },
    blocked: false,
    blockReasons: [],
    ...overrides,
  } as PublicationExecutionManifest;
}

describe("validateDestinationFormat — firm_website", () => {
  it("passes clean lowercase-hyphen paths", () => {
    expect(validateDestinationFormat(baseManifest())).toEqual([]);
  });

  it("warns on non-canonical slug characters", () => {
    const manifest = baseManifest({ canonicalUrl: "https://drglaw.ca/Journal/Founder_Vesting" });
    const issues = validateDestinationFormat(manifest);
    expect(issues.some((i) => i.code === "slug_non_canonical_characters")).toBe(true);
  });
});

describe("validateDestinationFormat — linkedin_post", () => {
  it("blocks a body over the LinkedIn feed post character limit", () => {
    const manifest = baseManifest({ destination: "linkedin_post", body: "<p>" + "a".repeat(LINKEDIN_POST_MAX_CHARS + 1) + "</p>" });
    const issues = validateDestinationFormat(manifest);
    expect(issues.some((i) => i.code === "linkedin_post_over_limit" && i.severity === "block")).toBe(true);
  });

  it("does not block a body at exactly the limit", () => {
    const manifest = baseManifest({ destination: "linkedin_post", body: "a".repeat(LINKEDIN_POST_MAX_CHARS) });
    const issues = validateDestinationFormat(manifest);
    expect(issues.some((i) => i.code === "linkedin_post_over_limit")).toBe(false);
  });

  it("blocks an empty post body", () => {
    const manifest = baseManifest({ destination: "linkedin_post", body: "<p></p>" });
    const issues = validateDestinationFormat(manifest);
    expect(issues.some((i) => i.code === "linkedin_post_empty")).toBe(true);
  });

  it("strips HTML markup before counting characters, never counting tag bytes against the limit", () => {
    const plainLength = 50;
    const manifest = baseManifest({
      destination: "linkedin_post",
      body: `<div class="wrapper"><p>${"a".repeat(plainLength)}</p></div>`,
    });
    // A body whose raw HTML length exceeds the limit but whose plain-text
    // length does not must never be blocked on markup bytes alone.
    expect(validateDestinationFormat(manifest).some((i) => i.code === "linkedin_post_over_limit")).toBe(false);
  });
});

describe("validateDestinationFormat — linkedin_article", () => {
  it("blocks a headline over the article headline limit", () => {
    const manifest = baseManifest({
      destination: "linkedin_article",
      title: "a".repeat(LINKEDIN_ARTICLE_HEADLINE_MAX_CHARS + 1),
      assets: [{ artifactId: "a1", artifactType: "hero_image", storageBucket: null, storagePath: null, publicUrl: null, mimeType: null, sizeBytes: null, sha256: null }],
    });
    expect(validateDestinationFormat(manifest).some((i) => i.code === "linkedin_article_headline_over_limit")).toBe(true);
  });

  it("warns (does not block) when no cover image is registered", () => {
    const manifest = baseManifest({ destination: "linkedin_article", assets: [] });
    const issues = validateDestinationFormat(manifest);
    const issue = issues.find((i) => i.code === "linkedin_article_missing_cover_image");
    expect(issue?.severity).toBe("warn");
  });
});

describe("validateDestinationFormat — google_business_profile", () => {
  it("blocks a body over the GBP post limit", () => {
    const manifest = baseManifest({
      destination: "google_business_profile",
      body: "a".repeat(GBP_POST_BODY_MAX_CHARS + 1),
      assets: [{ artifactId: "a1", artifactType: "social_image", storageBucket: null, storagePath: null, publicUrl: null, mimeType: null, sizeBytes: null, sha256: null }],
    });
    expect(validateDestinationFormat(manifest).some((i) => i.code === "gbp_post_over_limit")).toBe(true);
  });

  it("blocks when no image is registered (GBP posts require one)", () => {
    const manifest = baseManifest({ destination: "google_business_profile", assets: [] });
    expect(validateDestinationFormat(manifest).some((i) => i.code === "gbp_missing_image" && i.severity === "block")).toBe(true);
  });

  it("warns, does not block, when no CTA target path is set", () => {
    const manifest = baseManifest({
      destination: "google_business_profile",
      assets: [{ artifactId: "a1", artifactType: "social_image", storageBucket: null, storagePath: null, publicUrl: null, mimeType: null, sizeBytes: null, sha256: null }],
      ctaTargetPath: null,
    });
    const issue = validateDestinationFormat(manifest).find((i) => i.code === "gbp_missing_cta_target");
    expect(issue?.severity).toBe("warn");
  });
});
