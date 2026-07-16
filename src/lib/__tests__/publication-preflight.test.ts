/**
 * buildPreflightReport (publication-preflight.ts): the single place that
 * decides may_publish per placement. Covers the fail-closed branches from
 * the mega-assignment's Workstream 7 spec: not-yet-enforced period,
 * enforced-but-not-approved, version drift, readiness-check failure,
 * unresolved comments, and the one genuine pass case. Also covers
 * multi-destination placements (one deliverable, two placements) and
 * archived-deliverable exclusion.
 */

import { describe, it, expect } from "vitest";
import { buildPreflightReport } from "@/lib/publication-preflight";
import type { ContentDeliverable, ContentPlacement, DeliverableComment, PublicationReceipt } from "@/lib/types";

const FIRM = "f1111111-1111-1111-1111-111111111111";
const PERIOD = "p1111111-1111-1111-1111-111111111111";
const VERSION = "v1111111-1111-1111-1111-111111111111";

function makeDeliverable(overrides: Partial<ContentDeliverable> = {}): ContentDeliverable {
  return {
    id: "d1111111-1111-1111-1111-111111111111",
    firm_id: FIRM,
    title: "Test deliverable",
    description: null,
    content_kind: "text",
    status: "approved",
    current_version_id: VERSION,
    approved_version_id: VERSION,
    approved_at: new Date().toISOString(),
    created_by_role: "operator",
    created_by_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    excerpt: null,
    topic: null,
    byline: null,
    publish_date: null,
    read_time: null,
    hero_image_url: null,
    ...overrides,
  } as ContentDeliverable;
}

function makePlacement(overrides: Partial<ContentPlacement> = {}): ContentPlacement {
  return {
    id: "pl111111-1111-1111-1111-111111111111",
    firm_id: FIRM,
    period_id: PERIOD,
    deliverable_id: "d1111111-1111-1111-1111-111111111111",
    destination: "firm_website",
    locale: "en-CA",
    intended_path: "/journal/example",
    required_artifact_type: "webpage",
    scheduled_publish_date: null,
    state: "planned",
    created_by_role: "operator",
    created_by_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as ContentPlacement;
}

function baseInput(overrides: {
  periodLifecycle?: "legacy_unreconciled" | "setup_required" | "enforced";
  deliverable?: ContentDeliverable;
  ready?: boolean;
  comments?: DeliverableComment[];
  placements?: ContentPlacement[];
  receipts?: Record<string, PublicationReceipt | null>;
}) {
  const deliverable = overrides.deliverable ?? makeDeliverable();
  const placements = overrides.placements ?? [makePlacement({ deliverable_id: deliverable.id })];
  return {
    periodId: PERIOD,
    periodLifecycle: overrides.periodLifecycle ?? "enforced",
    deliverables: [deliverable],
    readyByDeliverableId: { [deliverable.id]: overrides.ready ?? true },
    commentsByDeliverableId: { [deliverable.id]: overrides.comments ?? [] },
    placementsByDeliverableId: { [deliverable.id]: placements },
    currentReceiptsByPlacementId: overrides.receipts ?? {},
  };
}

describe("buildPreflightReport: fail-closed branches", () => {
  it("period not enforced (setup_required) -> may_publish false, actionable reason", () => {
    const report = buildPreflightReport(baseInput({ periodLifecycle: "setup_required" }));
    expect(report.placements).toHaveLength(1);
    expect(report.placements[0].mayPublish).toBe(false);
    expect(report.placements[0].reason).toMatch(/not yet been activated/);
  });

  it("period legacy_unreconciled -> may_publish false, historical reason (not 'blocked')", () => {
    const report = buildPreflightReport(baseInput({ periodLifecycle: "legacy_unreconciled" }));
    expect(report.placements[0].mayPublish).toBe(false);
    expect(report.placements[0].reason).toMatch(/historical/);
  });

  it("enforced period, deliverable not approved -> may_publish false with exact status", () => {
    const report = buildPreflightReport(
      baseInput({ deliverable: makeDeliverable({ status: "in_review" }) }),
    );
    expect(report.placements[0].mayPublish).toBe(false);
    expect(report.placements[0].reason).toContain('"in_review"');
  });

  it("approved_version_id != current_version_id (drift) -> may_publish false", () => {
    const report = buildPreflightReport(
      baseInput({ deliverable: makeDeliverable({ approved_version_id: "stale-version-id" }) }),
    );
    expect(report.placements[0].mayPublish).toBe(false);
    expect(report.placements[0].reason).toMatch(/version drift/);
  });

  it("readiness evaluator says not ready -> may_publish false", () => {
    const report = buildPreflightReport(baseInput({ ready: false }));
    expect(report.placements[0].mayPublish).toBe(false);
    expect(report.placements[0].reason).toMatch(/readiness checks/);
  });

  it("unresolved comment on the deliverable -> may_publish false, count in reason", () => {
    const deliverable = makeDeliverable();
    const comments: DeliverableComment[] = [
      {
        id: "c1",
        deliverable_id: deliverable.id,
        version_id: VERSION,
        firm_id: FIRM,
        author_role: "lawyer",
        author_id: null,
        author_name: "Damaris",
        annotation: null,
        body: "please fix this",
        attachments: [],
        resolved: false,
        resolved_at: null,
        resolved_by_role: null,
        parent_comment_id: null,
        approval_record_id: null,
        created_at: new Date().toISOString(),
      } as DeliverableComment,
    ];
    const report = buildPreflightReport(baseInput({ deliverable, comments }));
    expect(report.placements[0].mayPublish).toBe(false);
    expect(report.placements[0].reason).toContain("1 unresolved comment");
  });

  it("a resolved comment does not block, and an approval-record reply does not count", () => {
    const deliverable = makeDeliverable();
    const comments: DeliverableComment[] = [
      {
        id: "c1",
        deliverable_id: deliverable.id,
        version_id: VERSION,
        firm_id: FIRM,
        author_role: "lawyer",
        author_id: null,
        author_name: null,
        annotation: null,
        body: "resolved already",
        attachments: [],
        resolved: true,
        resolved_at: new Date().toISOString(),
        resolved_by_role: "operator",
        parent_comment_id: null,
        approval_record_id: null,
        created_at: new Date().toISOString(),
      } as DeliverableComment,
      {
        id: "c2",
        deliverable_id: deliverable.id,
        version_id: VERSION,
        firm_id: FIRM,
        author_role: "operator",
        author_id: null,
        author_name: null,
        annotation: null,
        body: "addressed in v2",
        attachments: [],
        resolved: false,
        resolved_at: null,
        resolved_by_role: null,
        parent_comment_id: null,
        approval_record_id: "approval-1",
        created_at: new Date().toISOString(),
      } as DeliverableComment,
    ];
    const report = buildPreflightReport(baseInput({ deliverable, comments }));
    expect(report.placements[0].mayPublish).toBe(true);
  });

  it("genuine pass: enforced, approved, no drift, ready, zero unresolved comments -> may_publish true", () => {
    const report = buildPreflightReport(baseInput({}));
    expect(report.placements[0].mayPublish).toBe(true);
    expect(report.placements[0].reason).toBeNull();
  });
});

describe("buildPreflightReport: multi-destination placements", () => {
  it("one deliverable with two placements reports both independently", () => {
    const deliverable = makeDeliverable();
    const websitePlacement = makePlacement({
      id: "pl-website",
      deliverable_id: deliverable.id,
      destination: "firm_website",
    });
    const linkedinPlacement = makePlacement({
      id: "pl-linkedin",
      deliverable_id: deliverable.id,
      destination: "linkedin_post",
      required_artifact_type: null,
    });
    const report = buildPreflightReport(
      baseInput({ deliverable, placements: [websitePlacement, linkedinPlacement] }),
    );
    expect(report.placements).toHaveLength(2);
    expect(report.placements.map((p) => p.placementId).sort()).toEqual(["pl-linkedin", "pl-website"]);
    expect(report.placements.every((p) => p.mayPublish)).toBe(true);
  });

  it("does not infer that two placements share a destination merely because they share a deliverable", () => {
    const deliverable = makeDeliverable();
    const websitePlacement = makePlacement({ id: "pl-a", deliverable_id: deliverable.id, destination: "firm_website" });
    const gbpPlacement = makePlacement({
      id: "pl-b",
      deliverable_id: deliverable.id,
      destination: "google_business_profile",
      required_artifact_type: null,
    });
    const report = buildPreflightReport(baseInput({ deliverable, placements: [websitePlacement, gbpPlacement] }));
    const destinations = report.placements.map((p) => p.destination).sort();
    expect(destinations).toEqual(["firm_website", "google_business_profile"]);
  });
});

describe("buildPreflightReport: archived exclusion and receipt passthrough", () => {
  it("excludes an archived deliverable entirely (no placements reported for it)", () => {
    const deliverable = makeDeliverable({ status: "archived" });
    const report = buildPreflightReport(baseInput({ deliverable }));
    expect(report.placements).toHaveLength(0);
  });

  it("surfaces the current receipt when one exists, and an already-verified receipt blocks mayPublish (idempotency, WS4)", () => {
    const deliverable = makeDeliverable();
    const placement = makePlacement({ deliverable_id: deliverable.id });
    const receipt: PublicationReceipt = {
      id: "r1",
      firm_id: FIRM,
      period_id: PERIOD,
      deliverable_id: deliverable.id,
      placement_id: placement.id,
      destination: "firm_website",
      locale: "en-CA",
      approved_version_id: VERSION,
      artifact_id: null,
      artifact_sha256: null,
      public_url: "https://drglaw.ca/journal/example",
      external_post_id: null,
      published_at: new Date().toISOString(),
      actor_role: "operator",
      actor_id: null,
      actor_name: "Operator",
      verification_state: "verified",
      verified_at: new Date().toISOString(),
      verification_method: "url_fetch",
      evidence_storage_bucket: null,
      evidence_storage_path: null,
      failure_reason: null,
      reconciles_receipt_id: null,
      created_at: new Date().toISOString(),
    };
    const report = buildPreflightReport(
      baseInput({ deliverable, placements: [placement], receipts: { [placement.id]: receipt } }),
    );
    expect(report.placements[0].currentReceipt).toEqual({
      id: "r1",
      verificationState: "verified",
      publishedAt: receipt.published_at,
      publicUrl: receipt.public_url,
      externalPostId: null,
    });
    // A placement that is already published and verified is a terminal
    // state, not something "may publish" should ever say yes to again.
    expect(report.placements[0].mayPublish).toBe(false);
    expect(report.placements[0].nextAction).toBe("already_published");
  });
});

describe("buildPreflightReport: idempotency -- retired placements and existing receipts (WS4)", () => {
  function receiptWithState(
    placementId: string,
    deliverableId: string,
    verificationState: PublicationReceipt["verification_state"],
  ): PublicationReceipt {
    return {
      id: "r-" + verificationState,
      firm_id: FIRM,
      period_id: PERIOD,
      deliverable_id: deliverableId,
      placement_id: placementId,
      destination: "firm_website",
      locale: "en-CA",
      approved_version_id: VERSION,
      artifact_id: null,
      artifact_sha256: null,
      public_url: "https://drglaw.ca/journal/example",
      external_post_id: null,
      published_at: new Date().toISOString(),
      actor_role: "operator",
      actor_id: null,
      actor_name: "Operator",
      verification_state: verificationState,
      verified_at: verificationState === "verified" || verificationState === "failed" ? new Date().toISOString() : null,
      verification_method: verificationState === "verified" || verificationState === "failed" ? "url_fetch" : null,
      evidence_storage_bucket: null,
      evidence_storage_path: null,
      failure_reason: verificationState === "failed" ? "HTTP 404" : null,
      reconciles_receipt_id: null,
      created_at: new Date().toISOString(),
    };
  }

  it("a retired placement never mayPublish, regardless of deliverable readiness", () => {
    const deliverable = makeDeliverable();
    const placement = makePlacement({ deliverable_id: deliverable.id, state: "retired" });
    const report = buildPreflightReport(baseInput({ deliverable, placements: [placement] }));
    expect(report.placements[0].mayPublish).toBe(false);
    expect(report.placements[0].reason).toMatch(/retired/);
    expect(report.placements[0].nextAction).toBe("already_retired");
  });

  it("a failed verification blocks mayPublish and routes to needs_reverification, not a silent republish", () => {
    const deliverable = makeDeliverable();
    const placement = makePlacement({ deliverable_id: deliverable.id });
    const receipt = receiptWithState(placement.id, deliverable.id, "failed");
    const report = buildPreflightReport(
      baseInput({ deliverable, placements: [placement], receipts: { [placement.id]: receipt } }),
    );
    expect(report.placements[0].mayPublish).toBe(false);
    expect(report.placements[0].nextAction).toBe("needs_reverification");
  });

  it("an unverified receipt blocks mayPublish and routes to needs_verification (verify the existing receipt, don't create another)", () => {
    const deliverable = makeDeliverable();
    const placement = makePlacement({ deliverable_id: deliverable.id });
    const receipt = receiptWithState(placement.id, deliverable.id, "unverified");
    const report = buildPreflightReport(
      baseInput({ deliverable, placements: [placement], receipts: { [placement.id]: receipt } }),
    );
    expect(report.placements[0].mayPublish).toBe(false);
    expect(report.placements[0].nextAction).toBe("needs_verification");
  });

  it("a reconciling receipt blocks mayPublish and routes to needs_verification", () => {
    const deliverable = makeDeliverable();
    const placement = makePlacement({ deliverable_id: deliverable.id });
    const receipt = receiptWithState(placement.id, deliverable.id, "reconciling");
    const report = buildPreflightReport(
      baseInput({ deliverable, placements: [placement], receipts: { [placement.id]: receipt } }),
    );
    expect(report.placements[0].mayPublish).toBe(false);
    expect(report.placements[0].nextAction).toBe("needs_verification");
  });

  it("the genuine pass case carries nextAction 'publish'", () => {
    const report = buildPreflightReport(baseInput({}));
    expect(report.placements[0].mayPublish).toBe(true);
    expect(report.placements[0].nextAction).toBe("publish");
  });
});

describe("buildPreflightReport: zero-placement deliverables surfaced as a gap (WS4)", () => {
  it("a deliverable with no placements is NOT silently omitted -- it appears in deliverablesWithNoPlacements", () => {
    const deliverable = makeDeliverable();
    const report = buildPreflightReport(
      baseInput({ deliverable, placements: [] }),
    );
    expect(report.placements).toHaveLength(0);
    expect(report.deliverablesWithNoPlacements).toEqual([
      { deliverableId: deliverable.id, deliverableTitle: deliverable.title },
    ]);
  });

  it("a deliverable with at least one placement does not appear in the gap list", () => {
    const report = buildPreflightReport(baseInput({}));
    expect(report.deliverablesWithNoPlacements).toHaveLength(0);
  });
});
