import { describe, it, expect } from "vitest";
import { evaluatePublicationPreflightStatus } from "@/lib/publication-preflight-status";
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

describe("evaluatePublicationPreflightStatus — precedence", () => {
  it("reports ready when nothing blocks and no destination issues exist", () => {
    const status = evaluatePublicationPreflightStatus(baseManifest());
    expect(status.category).toBe("ready");
    expect(status.reasons).toEqual([]);
  });

  it("already_published wins over every other signal, including a blocked manifest", () => {
    const status = evaluatePublicationPreflightStatus(
      baseManifest({
        blocked: true,
        blockReasons: ['deliverable status is "in_review", not approved'],
        destinationMetadata: { priorReceiptVerificationState: "verified" },
      }),
    );
    expect(status.category).toBe("already_published");
  });

  it("ambiguous_external_state fires for unverified/failed/reconciling receipts", () => {
    for (const state of ["unverified", "failed", "reconciling"] as const) {
      const status = evaluatePublicationPreflightStatus(
        baseManifest({ destinationMetadata: { priorReceiptVerificationState: state } }),
      );
      expect(status.category).toBe("ambiguous_external_state");
    }
  });

  it("ambiguous_external_state fires when an active competing claim already exists on the placement", () => {
    const status = evaluatePublicationPreflightStatus(
      baseManifest({
        blocked: true,
        blockReasons: [
          "an active publication claim already exists for this placement and approved version; publishing now would race a concurrent or in-progress attempt rather than create a new one",
        ],
        destinationMetadata: { priorReceiptVerificationState: null, latestClaimStatus: "active" },
      }),
    );
    expect(status.category).toBe("ambiguous_external_state");
  });

  it("blocked_content takes priority over authorization/configuration reasons on the same manifest", () => {
    const status = evaluatePublicationPreflightStatus(
      baseManifest({
        blocked: true,
        blockReasons: [
          'deliverable status is "in_review", not approved',
          "no release authorization path is currently available",
          "destination not configured: no LinkedIn account",
        ],
      }),
    );
    expect(status.category).toBe("blocked_content");
    expect(status.reasons).toEqual(['deliverable status is "in_review", not approved']);
  });

  it("blocked_authorization fires when content passes but no release path is available", () => {
    const status = evaluatePublicationPreflightStatus(
      baseManifest({
        blocked: true,
        blockReasons: ["no release authorization path is currently available: ..."],
      }),
    );
    expect(status.category).toBe("blocked_authorization");
  });

  it("blocked_missing_configuration fires when content and auth pass but destination is unconfigured", () => {
    const status = evaluatePublicationPreflightStatus(
      baseManifest({
        blocked: true,
        blockReasons: ["destination not configured: no destination website is on record for this firm yet"],
      }),
    );
    expect(status.category).toBe("blocked_missing_configuration");
  });

  it("blocked_destination_validation fires only after content/auth/config all pass", () => {
    const status = evaluatePublicationPreflightStatus(
      baseManifest({
        destination: "linkedin_post",
        body: "<p>" + "a".repeat(3001) + "</p>",
        destinationAccount: { configured: true, identifier: "linkedin", note: "n/a for this test" },
      }),
    );
    expect(status.category).toBe("blocked_destination_validation");
    expect(status.reasons[0]).toContain("exceeds the 3000-character");
  });

  it("an unrecognized block reason fails closed into blocked_content rather than defaulting to ready", () => {
    const status = evaluatePublicationPreflightStatus(
      baseManifest({ blocked: true, blockReasons: ["some future reason this module was never taught to classify"] }),
    );
    expect(status.category).toBe("blocked_content");
  });
});
