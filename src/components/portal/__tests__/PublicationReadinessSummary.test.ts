/**
 * Release-gate test: proves a real periodId, threaded down from
 * ContentPlan.tsx's per-period slicing (sliceReadinessForPeriod), actually
 * reaches PublicationReadinessSummary and drives the "download manifest"
 * link's href, and that the link is entirely absent when no periodId is
 * supplied (the whole-plan ReviewOverview case, where there is no single
 * period to download).
 *
 * Renders with react-dom/server's renderToStaticMarkup rather than adding a
 * new jsdom/@testing-library/react dependency: this component's static
 * markup (including useState's initial value) is enough to prove the prop
 * reaches the DOM, which is exactly what this test needs to prove.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import PublicationReadinessSummary from "../PublicationReadinessSummary";
import { evaluateDeliverableReadiness } from "@/lib/publication-readiness";
import type { ContentDeliverable, DeliverableVersion } from "@/lib/types";

const FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const REAL_FOUNDER_VESTING_PERIOD_ID = "b2b2b2b2-2222-2222-2222-222222222222";

function makeBlockedDeliverable(): ContentDeliverable {
  return {
    id: "d1", firm_id: FIRM_ID, title: "Founder vesting in Ontario corporations", description: null,
    content_kind: "text", status: "in_review", current_version_id: "v1", approved_version_id: null,
    approved_at: null, created_by_role: "operator", created_by_id: null, created_at: "2026-07-14T00:00:00Z",
    updated_at: "2026-07-14T00:00:00Z", excerpt: null, topic: null, byline: null, publish_date: "2026-07-14",
    read_time: null, hero_image_url: null, kicker: null, period_id: REAL_FOUNDER_VESTING_PERIOD_ID, format: null,
    locale: "en-CA", deliverable_role: "article", publication_destination: "firm_website", publication_path: "/journal/founder-vesting-ontario",
    requires_legal_approval: null, requires_image: null, requires_file: null, requires_localized_route: null,
  };
}

function makeVersion(): DeliverableVersion {
  return {
    id: "v1", deliverable_id: "d1", firm_id: FIRM_ID, version_number: 1, body_html: "<p>real</p>",
    storage_path: null, asset_mime: null, asset_size_bytes: null, asset_name: null, note: null,
    responds_to_approval_id: null, asset_sha256: null, asset_validation: null,
    created_by_role: "operator", created_by_id: null, created_at: "2026-07-14T00:00:00Z",
  };
}

function buildReadiness() {
  const item = evaluateDeliverableReadiness({
    deliverable: makeBlockedDeliverable(),
    currentVersion: makeVersion(),
    artifacts: [],
    latestValidationByArtifactId: {},
  });
  return { summary: { active: 1, ready: 0, blocked: 1, excluded: 0 }, items: [item] };
}

describe("PublicationReadinessSummary: periodId reaches the rendered manifest link", () => {
  it("renders a download-manifest link containing the REAL period id when periodId is supplied and the viewer is an operator", () => {
    const html = renderToStaticMarkup(
      createElement(PublicationReadinessSummary, {
        firmId: FIRM_ID,
        isOperator: true,
        readiness: buildReadiness(),
        titles: { d1: "Founder vesting in Ontario corporations" },
        periodId: REAL_FOUNDER_VESTING_PERIOD_ID,
      }),
    );

    expect(html).toContain("Download manifest");
    expect(html).toContain(
      `/api/admin/content-periods/${REAL_FOUNDER_VESTING_PERIOD_ID}/publication-manifest?format=markdown`,
    );
    // Negative check: a DIFFERENT period's id must not appear anywhere,
    // proving this isn't a hardcoded/fallback URL.
    expect(html).not.toContain("/api/admin/content-periods/undefined/");
  });

  it("does NOT render a download-manifest link when periodId is omitted (the whole-plan summary case)", () => {
    const html = renderToStaticMarkup(
      createElement(PublicationReadinessSummary, {
        firmId: FIRM_ID,
        isOperator: true,
        readiness: buildReadiness(),
        titles: { d1: "Founder vesting in Ontario corporations" },
        // periodId intentionally omitted
      }),
    );

    expect(html).not.toContain("Download manifest");
    expect(html).not.toContain("/publication-manifest");
  });

  it("does NOT render a download-manifest link for a non-operator viewer even when periodId is supplied", () => {
    const html = renderToStaticMarkup(
      createElement(PublicationReadinessSummary, {
        firmId: FIRM_ID,
        isOperator: false,
        readiness: buildReadiness(),
        titles: { d1: "Founder vesting in Ontario corporations" },
        periodId: REAL_FOUNDER_VESTING_PERIOD_ID,
      }),
    );

    expect(html).not.toContain("Download manifest");
  });

  it("renders the blocked deliverable's real title and the fixed no-generation notice, never a generate/publish/approve control", () => {
    const html = renderToStaticMarkup(
      createElement(PublicationReadinessSummary, {
        firmId: FIRM_ID,
        isOperator: true,
        readiness: buildReadiness(),
        titles: { d1: "Founder vesting in Ontario corporations" },
        periodId: REAL_FOUNDER_VESTING_PERIOD_ID,
      }),
    );

    expect(html).toContain("Founder vesting in Ontario corporations");
    expect(html).toContain("Generation is not permitted here");
    for (const forbidden of ["Generate", "Publish", "Schedule", "Approve"]) {
      expect(html).not.toContain(forbidden);
    }
  });
});
