import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlanOverview } from "@/lib/deliverables-pure";
import { ReviewOverview } from "../ContentPlan";

const EMPTY_OVERVIEW: PlanOverview = {
  total: 0,
  approved: 0,
  pending: 0,
  preapproved: 0,
  published: 0,
  changes: 0,
  draft: 0,
  weeks: 0,
  byFormat: [],
  nextPublish: null,
};

const ACTIVE_OVERVIEW: PlanOverview = {
  ...EMPTY_OVERVIEW,
  total: 4,
  approved: 1,
  pending: 1,
  preapproved: 2,
  weeks: 1,
  byFormat: [{ format: "Website articles", count: 4 }],
};

function render(overview: PlanOverview) {
  return renderToStaticMarkup(
    createElement(ReviewOverview, {
      overview,
      isOperator: true,
      firmId: "eec1d25e-a047-4827-8e4a-6eb96becca2b",
      settings: null,
      onChanged: () => {},
    }),
  );
}

const root = process.cwd();
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), "utf8");

describe("Deliverables client-review boundary", () => {
  it("renders the review overview without a publication-readiness or unavailable fallback", () => {
    expect(render(EMPTY_OVERVIEW)).toBe("");
    const html = render(ACTIVE_OVERVIEW);
    expect(html).toContain("Review overview");
    expect(html).toContain("pre-approved");
    expect(html).not.toContain("Publication readiness");
    expect(html).not.toContain("Unavailable");
    expect(html).not.toContain("could not be loaded");
  });

  it("does not load, derive, or render readiness diagnostics on the Deliverables page", () => {
    const page = read("src", "app", "portal", "[firmId]", "deliverables", "page.tsx");
    const plan = read("src", "components", "portal", "ContentPlan.tsx");
    const clientReviewSource = `${page}\n${plan}`;

    expect(clientReviewSource).not.toContain("loadPlanPublicationReadiness");
    expect(clientReviewSource).not.toContain("PublicationReadinessSummary");
    expect(clientReviewSource).not.toContain("sliceReadinessForPeriod");
    expect(clientReviewSource).not.toContain("planReadiness");
    expect(clientReviewSource).not.toContain("periodReadiness");
    expect(clientReviewSource).not.toContain("Publication readiness could not be loaded");
    expect(clientReviewSource).not.toContain("ActivateReadinessButton");
  });

  it("keeps technical readiness enforcement in the operator Release surface", () => {
    const releasePage = read("src", "app", "portal", "[firmId]", "deliverables", "periods", "[periodId]", "release", "page.tsx");
    const releaseView = read("src", "components", "portal", "control-room", "ReleaseTabView.tsx");
    expect(releasePage).toContain("readinessLifecycle={result.period.readiness_lifecycle}");
    expect(releaseView).toContain("Enable readiness enforcement");
    expect(releaseView).toContain("/activate-readiness");
    expect(releaseView).toContain("canRun && readinessLifecycle");
  });

  it("preserves operator-only archive and canonical standing-authorization inputs", () => {
    const page = read("src", "app", "portal", "[firmId]", "deliverables", "page.tsx");
    const plan = read("src", "components", "portal", "ContentPlan.tsx");
    expect(page).toContain('viewerRole === "operator" && archived === "1"');
    expect(page).toContain("standingAuthorizedDeliverableIds={standingAuthorizedDeliverableIds}");
    expect(plan).toContain("{isOperator && <ContentArchive");
    expect(plan).toContain("standingAuthorizedDeliverableIds");
  });
});
