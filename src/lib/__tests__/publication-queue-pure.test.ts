import { describe, it, expect } from "vitest";
import { roughCategory } from "@/lib/publication-queue-pure";
import type { PreflightPlacementReport } from "@/lib/publication-preflight";

function baseRow(overrides: Partial<PreflightPlacementReport> = {}): PreflightPlacementReport {
  return {
    placementId: "p1",
    deliverableId: "d1",
    deliverableTitle: "Title",
    destination: "firm_website",
    locale: "en-CA",
    intendedPath: "/journal/x",
    requiredArtifactType: "hero_image",
    approvedVersionId: "v1",
    currentVersionId: "v1",
    deliverableReady: true,
    unresolvedCommentCount: 0,
    currentReceipt: null,
    mayPublish: true,
    reason: null,
    ...overrides,
  };
}

describe("roughCategory", () => {
  it("ready when mayPublish is true", () => {
    expect(roughCategory(baseRow())).toBe("ready");
  });

  it("already_published when the current receipt is verified", () => {
    expect(
      roughCategory(
        baseRow({
          mayPublish: false,
          reason: "a receipt for this placement already exists and is verified",
          currentReceipt: { id: "r1", verificationState: "verified", publishedAt: "2026-07-18", publicUrl: null, externalPostId: null },
        }),
      ),
    ).toBe("already_published");
  });

  it("ambiguous_external_state for unverified/failed/reconciling receipts", () => {
    for (const state of ["unverified", "failed", "reconciling"] as const) {
      expect(
        roughCategory(
          baseRow({
            mayPublish: false,
            currentReceipt: { id: "r1", verificationState: state, publishedAt: "2026-07-18", publicUrl: null, externalPostId: null },
          }),
        ),
      ).toBe("ambiguous_external_state");
    }
  });

  it("blocked_content for readiness/approval/version/comment reasons", () => {
    expect(roughCategory(baseRow({ mayPublish: false, reason: 'deliverable status is "in_review", not approved' }))).toBe(
      "blocked_content",
    );
    expect(roughCategory(baseRow({ mayPublish: false, reason: "1 unresolved comment on this deliverable" }))).toBe(
      "blocked_content",
    );
  });

  it("blocked_other for an unrecognized reason (fails closed, still blocked, not silently ready)", () => {
    expect(roughCategory(baseRow({ mayPublish: false, reason: "something else entirely" }))).toBe("blocked_other");
  });
});
