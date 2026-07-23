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
import { isVersionReleaseAuthorized, type ReleaseAuthorizationResult } from "@/lib/release-authorization";
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
    // "ready" so the deliverable-level-gate tests below exercise exactly
    // the gate they name, not this fixture's own placement.state; the
    // Workstream 4 describe block below overrides this per-case.
    state: "ready",
    created_by_role: "operator",
    created_by_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as ContentPlacement;
}

/**
 * Auto-derives a canonical release-authorization result from a deliverable's
 * own status/version fields (individual-approval path only, since that's
 * all this test file's fixtures ever populate) -- so every test in this
 * file that isn't specifically ABOUT authorization gets a correct,
 * automatically-consistent result matching the deliverable it constructed,
 * without needing to think about authorization explicitly. Tests that ARE
 * about authorization pass an explicit `releaseAuthorizationByDeliverableId`
 * override (or `omitReleaseAuthorization: true`) instead.
 */
function authorizationFor(deliverable: ContentDeliverable): Record<string, ReleaseAuthorizationResult> {
  return {
    [deliverable.id]: isVersionReleaseAuthorized({
      deliverableStatus: deliverable.status,
      approvedVersionId: deliverable.approved_version_id,
      targetVersionId: deliverable.current_version_id ?? "",
      versionRequiresIndividualReview: false,
      standingAuthorizationActive: false,
    }),
  };
}

function baseInput(overrides: {
  periodLifecycle?: "legacy_unreconciled" | "setup_required" | "enforced";
  deliverable?: ContentDeliverable;
  ready?: boolean;
  comments?: DeliverableComment[];
  placements?: ContentPlacement[];
  receipts?: Record<string, PublicationReceipt | null>;
  releaseAuthorizationByDeliverableId?: Record<string, ReleaseAuthorizationResult>;
  /** True to omit buildPreflightReport's releaseAuthorizationByDeliverableId key entirely -- distinct from supplying a map that simply lacks this deliverable's entry. */
  omitReleaseAuthorization?: boolean;
}) {
  const deliverable = overrides.deliverable ?? makeDeliverable();
  const placements = overrides.placements ?? [makePlacement({ deliverable_id: deliverable.id })];
  const base = {
    periodId: PERIOD,
    periodLifecycle: overrides.periodLifecycle ?? "enforced",
    deliverables: [deliverable],
    readyByDeliverableId: { [deliverable.id]: overrides.ready ?? true },
    commentsByDeliverableId: { [deliverable.id]: overrides.comments ?? [] },
    placementsByDeliverableId: { [deliverable.id]: placements },
    currentReceiptsByPlacementId: overrides.receipts ?? {},
  };
  if (overrides.omitReleaseAuthorization) return base;
  return {
    ...base,
    releaseAuthorizationByDeliverableId: overrides.releaseAuthorizationByDeliverableId ?? authorizationFor(deliverable),
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

  it("enforced period, deliverable not approved -> may_publish false via the canonical authorization result, not a locally re-derived status check", () => {
    const deliverable = makeDeliverable({ status: "in_review" });
    const report = buildPreflightReport(baseInput({ deliverable }));
    expect(report.placements[0].mayPublish).toBe(false);
    expect(report.placements[0].reason).toMatch(/not release-authorized/);
    expect(report.placements[0].reason).toContain("in_review");
  });

  it("approved_version_id != current_version_id (drift) -> may_publish false via the canonical authorization result", () => {
    const deliverable = makeDeliverable({ approved_version_id: "stale-version-id" });
    const report = buildPreflightReport(baseInput({ deliverable }));
    expect(report.placements[0].mayPublish).toBe(false);
    expect(report.placements[0].reason).toMatch(/not release-authorized/);
    expect(report.placements[0].reason).toContain("approved_version_mismatch");
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

  it("surfaces the current receipt when one exists, and its existence itself blocks may_publish (Workstream 4 idempotency)", () => {
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
      claim_id: null,
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
      release_path: null,
      standing_authorization_event_id: null,
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
    expect(report.placements[0].mayPublish).toBe(false);
    expect(report.placements[0].reason).toMatch(/already exists and is verified/);
  });
});

describe("buildPreflightReport: Workstream 4 idempotency (placement.state + existing receipt)", () => {
  function receiptWith(verification_state: PublicationReceipt["verification_state"]): PublicationReceipt {
    return {
      id: "r1",
      firm_id: FIRM,
      period_id: PERIOD,
      deliverable_id: "d1111111-1111-1111-1111-111111111111",
      placement_id: "pl111111-1111-1111-1111-111111111111",
      destination: "firm_website",
      locale: "en-CA",
      approved_version_id: VERSION,
      claim_id: null,
      artifact_id: null,
      artifact_sha256: null,
      public_url: "https://drglaw.ca/journal/example",
      external_post_id: null,
      published_at: new Date().toISOString(),
      actor_role: "operator",
      actor_id: null,
      actor_name: "Operator",
      verification_state,
      verified_at: verification_state === "verified" || verification_state === "failed" ? new Date().toISOString() : null,
      verification_method: verification_state === "verified" || verification_state === "failed" ? "url_fetch" : null,
      evidence_storage_bucket: null,
      evidence_storage_path: null,
      failure_reason: verification_state === "failed" ? "HTTP 404" : null,
      reconciles_receipt_id: null,
      created_at: new Date().toISOString(),
      release_path: null,
      standing_authorization_event_id: null,
    };
  }

  it("retired placement -> may_publish false", () => {
    const report = buildPreflightReport(baseInput({ placements: [makePlacement({ state: "retired" })] }));
    expect(report.placements[0].mayPublish).toBe(false);
    expect(report.placements[0].reason).toMatch(/retired/);
  });

  it("published placement -> may_publish false (already done, not a fresh publish target)", () => {
    const report = buildPreflightReport(baseInput({ placements: [makePlacement({ state: "published" })] }));
    expect(report.placements[0].mayPublish).toBe(false);
    expect(report.placements[0].reason).toMatch(/already marked published/);
  });

  it("planned placement (not yet marked ready) -> may_publish false", () => {
    const report = buildPreflightReport(baseInput({ placements: [makePlacement({ state: "planned" })] }));
    expect(report.placements[0].mayPublish).toBe(false);
    expect(report.placements[0].reason).toMatch(/not been marked ready/);
  });

  it("ready placement, no receipt -> the one genuine pass case", () => {
    const report = buildPreflightReport(baseInput({ placements: [makePlacement({ state: "ready" })] }));
    expect(report.placements[0].mayPublish).toBe(true);
  });

  it.each(["verified", "failed", "unverified", "reconciling"] as const)(
    "an existing receipt in verification_state=%s blocks republishing the same placement",
    (state) => {
      const placement = makePlacement({ state: "ready" });
      const report = buildPreflightReport(
        baseInput({ placements: [placement], receipts: { [placement.id]: receiptWith(state) } }),
      );
      expect(report.placements[0].mayPublish).toBe(false);
      expect(report.placements[0].reason).toBeTruthy();
    },
  );
});

describe("buildPreflightReport: Workstream 4 deliverablesWithNoPlacements coverage gap", () => {
  it("a non-archived deliverable with zero placements is surfaced explicitly, not silently dropped", () => {
    const deliverable = makeDeliverable();
    const report = buildPreflightReport(
      baseInput({ deliverable, placements: [] }),
    );
    expect(report.placements).toHaveLength(0);
    expect(report.deliverablesWithNoPlacements).toEqual([
      { deliverableId: deliverable.id, deliverableTitle: deliverable.title },
    ]);
  });

  it("an archived deliverable with zero placements is excluded from both lists (matches the readiness evaluator's own rule)", () => {
    const deliverable = makeDeliverable({ status: "archived" });
    const report = buildPreflightReport(baseInput({ deliverable, placements: [] }));
    expect(report.placements).toHaveLength(0);
    expect(report.deliverablesWithNoPlacements).toHaveLength(0);
  });

  it("a deliverable WITH placements never appears in deliverablesWithNoPlacements", () => {
    const report = buildPreflightReport(baseInput({}));
    expect(report.deliverablesWithNoPlacements).toHaveLength(0);
  });
});

describe("buildPreflightReport: releaseAuthorizationByDeliverableId (canonical two-path result) -- no fallback interpretation when absent", () => {
  it("releaseAuthorizationByDeliverableId omitted from buildPreflightReport's input entirely -> release_authorization_context_unavailable, fails closed explicitly, never re-derives from status/version equality", () => {
    const deliverable = makeDeliverable({ status: "approved" }); // deliberately a status that WOULD have passed the old legacy check, to prove there is no fallback re-derivation at all
    const report = buildPreflightReport(baseInput({ deliverable, omitReleaseAuthorization: true }));
    expect(report.placements[0].mayPublish).toBe(false);
    expect(report.placements[0].reasonCode).toBe("release_authorization_context_unavailable");
    expect(report.placements[0].reason).toMatch(/^release_authorization_context_unavailable:/);
  });

  it("releaseAuthorizationByDeliverableId supplied but with no entry for THIS deliverable -> release_authorization_context_unavailable, identical to full omission", () => {
    const deliverable = makeDeliverable({ status: "approved" });
    const someOtherDeliverableId = "d9999999-9999-9999-9999-999999999999";
    const report = buildPreflightReport(
      baseInput({
        deliverable,
        releaseAuthorizationByDeliverableId: {
          [someOtherDeliverableId]: isVersionReleaseAuthorized({
            deliverableStatus: "approved",
            approvedVersionId: "irrelevant",
            targetVersionId: "irrelevant",
            versionRequiresIndividualReview: false,
            standingAuthorizationActive: false,
          }),
        },
      }),
    );
    expect(report.placements[0].mayPublish).toBe(false);
    expect(report.placements[0].reasonCode).toBe("release_authorization_context_unavailable");
    expect(report.placements[0].reason).toMatch(/^release_authorization_context_unavailable:/);
  });

  it("every mayPublish=true placement, and every mayPublish=false placement for a reason OTHER than context-unavailability, carries reasonCode=null", () => {
    const authorizedReport = buildPreflightReport(baseInput({}));
    expect(authorizedReport.placements[0].mayPublish).toBe(true);
    expect(authorizedReport.placements[0].reasonCode).toBeNull();

    const unresolvedCommentReport = buildPreflightReport(
      baseInput({
        comments: [
          {
            id: "c1",
            deliverable_id: "d1111111-1111-1111-1111-111111111111",
            version_id: VERSION,
            firm_id: FIRM,
            author_role: "lawyer",
            author_id: null,
            author_name: null,
            annotation: null,
            body: "please fix",
            attachments: [],
            resolved: false,
            resolved_at: null,
            resolved_by_role: null,
            parent_comment_id: null,
            approval_record_id: null,
            created_at: new Date().toISOString(),
          } as DeliverableComment,
        ],
      }),
    );
    expect(unresolvedCommentReport.placements[0].mayPublish).toBe(false);
    expect(unresolvedCommentReport.placements[0].reasonCode).toBeNull();
  });

  it("supplied and authorized (standing_authorization path) -> bypasses the individual-approval-only check even though status is not approved", () => {
    const deliverable = makeDeliverable({ status: "in_review", approved_version_id: null });
    const authorization = isVersionReleaseAuthorized({
      deliverableStatus: deliverable.status,
      approvedVersionId: deliverable.approved_version_id,
      targetVersionId: deliverable.current_version_id!,
      versionRequiresIndividualReview: false,
      standingAuthorizationActive: true,
    });
    expect(authorization.authorized).toBe(true);
    expect(authorization.kind).toBe("standing_authorization");

    const report = buildPreflightReport({
      ...baseInput({ deliverable }),
      releaseAuthorizationByDeliverableId: { [deliverable.id]: authorization },
    });
    // Never blocked on deliverable status or version-id equality when the
    // canonical result says authorized -- proceeds to the readiness/comment/
    // lifecycle gates below, same as any other authorized placement.
    expect(report.placements[0].mayPublish).toBe(true);
    expect(report.placements[0].reason).toBeNull();
  });

  it("supplied and NOT authorized -> reason names the canonical kind, never the old 'not approved'/'version drift' wording", () => {
    const deliverable = makeDeliverable({ status: "draft", approved_version_id: null });
    const authorization = isVersionReleaseAuthorized({
      deliverableStatus: deliverable.status,
      approvedVersionId: deliverable.approved_version_id,
      targetVersionId: deliverable.current_version_id!,
      versionRequiresIndividualReview: false,
      standingAuthorizationActive: false,
    });
    expect(authorization.authorized).toBe(false);
    expect(authorization.kind).toBe("standing_authorization_inactive");

    const report = buildPreflightReport({
      ...baseInput({ deliverable }),
      releaseAuthorizationByDeliverableId: { [deliverable.id]: authorization },
    });
    expect(report.placements[0].mayPublish).toBe(false);
    expect(report.placements[0].reason).toMatch(/not release-authorized/);
    expect(report.placements[0].reason).toContain("standing_authorization_inactive");
    expect(report.placements[0].reason).not.toMatch(/not approved"/);
    expect(report.placements[0].reason).not.toMatch(/version drift/);
  });
});
