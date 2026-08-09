import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeOverview } from "@/lib/deliverables-pure";
import type { PlanDeliverable } from "@/lib/deliverables-pure";

const root = process.cwd();
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), "utf8");
const item = (id: string, status: "in_review" | "changes_requested" = "in_review") => ({
  id, title: id, kicker: null, status, content_kind: "text", format: null,
  period_id: null, publish_date: null, published_at: null, current_version_id: `${id}-v2`, requires_individual_review: false,
} as PlanDeliverable);

describe("client review authorization projection", () => {
  it("counts only canonical standing-authorized ids; a V1 change hold on V2 and an individual-review item fail closed", () => {
    const overview = computeOverview([item("active"), item("held-v2"), item("individual")], {
      standingAuthorizedDeliverableIds: new Set(["active"]),
    });
    expect(overview.preapproved).toBe(1);
    expect(overview.pending).toBe(2);
  });

  it("uses the deliverable-scoped hold projection and falls closed on load failure", () => {
    const source = read("src", "app", "portal", "[firmId]", "deliverables", "page.tsx");
    expect(source).toContain("loadUnresolvedClientChangeHoldDeliverableIds");
    expect(source).toContain("heldDeliverableIds.has(deliverable.id)");
    expect(source).toContain("standingAuthorizedDeliverableIds = []");
  });

  it("shows a lawyer-only explicit resolution action that says it is not approval", () => {
    const source = read("src", "components", "portal", "DeliverableReview.tsx");
    expect(source).toContain("Mark requested changes resolved");
    expect(source).toContain("Resolving this hold does not approve this version.");
    expect(source).toContain('viewerRole === "lawyer"');
    expect(source).toContain("/change-holds/${unresolvedHold.id}/resolve");
    expect(source).toContain("await onSigned()");
    expect(source).toContain("Could not resolve the requested changes hold.");
  });

  it("keeps archive history out of the client list and server query", () => {
    const source = read("src", "app", "portal", "[firmId]", "deliverables", "page.tsx");
    const plan = read("src", "components", "portal", "ContentPlan.tsx");
    expect(source).toContain('viewerRole === "operator" && archived === "1"');
    expect(plan).toContain("{isOperator && <ContentArchive");
  });
});
