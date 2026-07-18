/**
 * Release-gate test: proves a real periodId, threaded down from
 * ContentPlan.tsx's per-period slicing (sliceReadinessForPeriod), actually
 * reaches PublicationReadinessSummary and drives the "download manifest"
 * link's href, and that the link is entirely absent when no periodId is
 * supplied (the whole-plan ReviewOverview case, where there is no single
 * period to download).
 *
 * Also covers DR-097's explicit three-state period lifecycle
 * (legacy_unreconciled / setup_required / enforced), including the
 * regression the review caught in the first draft: a period defaulting to
 * "historical" whenever it isn't enforced wrongly labelled the CURRENT/
 * future period (not yet activated, but not legacy either) as historical.
 * The safe default is now "setup_required", never "historical".
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

function makeMetadataCompleteDeliverable(): ContentDeliverable {
  return {
    id: "d1", firm_id: FIRM_ID, title: "Founder vesting in Ontario corporations", description: null,
    content_kind: "text", status: "in_review", current_version_id: "v1", approved_version_id: null,
    approved_at: null, created_by_role: "operator", created_by_id: null, created_at: "2026-07-14T00:00:00Z",
    updated_at: "2026-07-14T00:00:00Z", excerpt: null, topic: null, byline: null, publish_date: "2026-07-14",
    read_time: null, hero_image_url: null, kicker: null, period_id: REAL_FOUNDER_VESTING_PERIOD_ID, format: null,
    locale: "en-CA", deliverable_role: "article", publication_destination: "firm_website", publication_path: "/journal/founder-vesting-ontario",
    cta_target_path: null,
    requires_legal_approval: null, requires_image: null, requires_file: null, requires_localized_route: null,
  };
}

function makeVersion(): DeliverableVersion {
  return {
    id: "v1", deliverable_id: "d1", firm_id: FIRM_ID, version_number: 1, body_html: "<p>real</p>",
    storage_path: null, asset_mime: null, asset_size_bytes: null, asset_name: null, note: null,
    responds_to_approval_id: null, asset_sha256: null, asset_validation: null,
    created_by_role: "operator", created_by_id: null, created_at: "2026-07-14T00:00:00Z",
    requires_individual_review: false, requires_individual_review_reason: null,
    requires_individual_review_set_by_role: null, requires_individual_review_set_by_id: null,
    requires_individual_review_set_by_name: null, requires_individual_review_set_at: null,
  };
}

/** Full metadata (role/locale/destination/path) but NO artifacts registered, so item.ready is false. */
function buildReadiness() {
  const item = evaluateDeliverableReadiness({
    deliverable: makeMetadataCompleteDeliverable(),
    currentVersion: makeVersion(),
    artifacts: [],
    latestValidationByArtifactId: {},
  });
  return { summary: { active: 1, ready: 0, blocked: 1, excluded: 0 }, items: [item] };
}

// makeMetadataCompleteDeliverable already has full role/locale/destination
// metadata, so once its period is "enforced" it is a genuine "blocked" item
// (missing hero_image/webpage_artifact), not "setup_required" or
// "historical_unreconciled". The manifest-link tests below only care about
// exercising the blocked-rendering path, so each explicitly enforces d1's
// period.
const ENFORCED_D1 = { d1: "enforced" as const };

describe("PublicationReadinessSummary: periodId reaches the rendered manifest link", () => {
  it("renders a download-manifest link containing the REAL period id when periodId is supplied and the viewer is an operator", () => {
    const html = renderToStaticMarkup(
      createElement(PublicationReadinessSummary, {
        firmId: FIRM_ID,
        isOperator: true,
        readiness: buildReadiness(),
        titles: { d1: "Founder vesting in Ontario corporations" },
        lifecycleByDeliverableId: ENFORCED_D1,
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
        lifecycleByDeliverableId: ENFORCED_D1,
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
        lifecycleByDeliverableId: ENFORCED_D1,
        periodId: REAL_FOUNDER_VESTING_PERIOD_ID,
      }),
    );

    expect(html).not.toContain("Download manifest");
  });

  it("does not expose the readiness panel or internal blocked labels to a lawyer", () => {
    const html = renderToStaticMarkup(
      createElement(PublicationReadinessSummary, {
        firmId: FIRM_ID,
        isOperator: false,
        readiness: buildReadiness(),
        titles: { d1: "Founder vesting in Ontario corporations" },
        lifecycleByDeliverableId: ENFORCED_D1,
        periodId: REAL_FOUNDER_VESTING_PERIOD_ID,
      }),
    );

    expect(html).toBe("");
    expect(html).not.toContain("Blocked");
    expect(html).not.toContain("metadata");
  });

  it("renders the blocked deliverable's real title and the fixed no-generation notice, never a generate/publish/approve control", () => {
    const html = renderToStaticMarkup(
      createElement(PublicationReadinessSummary, {
        firmId: FIRM_ID,
        isOperator: true,
        readiness: buildReadiness(),
        titles: { d1: "Founder vesting in Ontario corporations" },
        lifecycleByDeliverableId: ENFORCED_D1,
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

// Codex second-pass correction: a failed readiness load must render as an
// explicit, unmissable "unavailable" state for an operator, never as the
// same empty markup a genuinely clean/empty plan produces, and it must
// still be invisible to a lawyer (the unavailable check runs strictly
// after the isOperator gate).
describe("PublicationReadinessSummary: unavailable state (Codex second-pass correction)", () => {
  const EMPTY_READINESS = { summary: { active: 0, ready: 0, blocked: 0, excluded: 0 }, items: [] };

  it("renders an explicit unavailable banner for an operator, distinct from the clean-empty state", () => {
    const html = renderToStaticMarkup(
      createElement(PublicationReadinessSummary, {
        firmId: FIRM_ID,
        isOperator: true,
        readiness: { ...EMPTY_READINESS, unavailable: true },
      }),
    );

    expect(html).toContain("Unavailable");
    expect(html).toContain("could not be loaded");
    expect(html).not.toBe("");
  });

  it("the clean-empty state (unavailable: false, zero active/excluded) renders nothing, proving the two are visually distinct", () => {
    const html = renderToStaticMarkup(
      createElement(PublicationReadinessSummary, {
        firmId: FIRM_ID,
        isOperator: true,
        readiness: { ...EMPTY_READINESS, unavailable: false },
      }),
    );

    expect(html).toBe("");
  });

  it("renders nothing for a lawyer even when the load failed -- the lawyer-hide gate runs before the unavailable check", () => {
    const html = renderToStaticMarkup(
      createElement(PublicationReadinessSummary, {
        firmId: FIRM_ID,
        isOperator: false,
        readiness: { ...EMPTY_READINESS, unavailable: true },
      }),
    );

    expect(html).toBe("");
    expect(html).not.toContain("Unavailable");
  });

  it("the unavailable banner takes precedence over blocked-item rendering when both are somehow present", () => {
    const html = renderToStaticMarkup(
      createElement(PublicationReadinessSummary, {
        firmId: FIRM_ID,
        isOperator: true,
        readiness: { ...buildReadiness(), unavailable: true },
        titles: { d1: "Founder vesting in Ontario corporations" },
        lifecycleByDeliverableId: ENFORCED_D1,
      }),
    );

    expect(html).toContain("Unavailable");
    expect(html).not.toContain("Blocked");
  });
});

// DR-097: the release-gate bug this remediates, and the follow-up bug the
// review caught in the first fix (a nullable-timestamp-only model wrongly
// labelled the current/future period as historical, and made "Setup
// required" unreachable). The explicit three-state lifecycle fixes both.
describe("PublicationReadinessSummary: DR-097 explicit lifecycle rendering", () => {
  it("defaults to 'Setup required'/'Ready to activate', NEVER 'Historical', when lifecycleByDeliverableId is omitted", () => {
    // This is the regression the review caught: the safe default for an
    // unspecified period must not be "historical" (that label is reserved
    // for periods EXPLICITLY classified legacy), it must be
    // "setup_required" -- a period that simply has not been activated yet.
    const html = renderToStaticMarkup(
      createElement(PublicationReadinessSummary, {
        firmId: FIRM_ID,
        isOperator: true,
        readiness: buildReadiness(),
        titles: { d1: "Founder vesting in Ontario corporations" },
        periodId: REAL_FOUNDER_VESTING_PERIOD_ID,
        // lifecycleByDeliverableId intentionally omitted
      }),
    );

    expect(html).not.toContain("historical, not reconciled");
    expect(html).not.toContain("Blocked");
    expect(html).toContain("Setup required");
  });

  it("renders 'historical, not reconciled', never 'Blocked' or 'Setup required', ONLY when explicitly classified legacy_unreconciled", () => {
    const html = renderToStaticMarkup(
      createElement(PublicationReadinessSummary, {
        firmId: FIRM_ID,
        isOperator: true,
        readiness: buildReadiness(),
        titles: { d1: "Founder vesting in Ontario corporations" },
        periodId: REAL_FOUNDER_VESTING_PERIOD_ID,
        lifecycleByDeliverableId: { d1: "legacy_unreconciled" },
      }),
    );

    expect(html).toContain("historical, not reconciled");
    expect(html).not.toContain("Blocked");
    expect(html).not.toContain("Setup required");
  });

  it("renders 'Ready to activate' (green), not 'Setup required' (amber) or 'Historical', for a metadata-complete deliverable in a setup_required period -- the Founder Vesting case: current work, already clean, just not yet activated", () => {
    const hero = { id: "hero-fv", firm_id: FIRM_ID, deliverable_id: "d1", version_id: "v1", artifact_type: "hero_image" as const, locale: "en-CA", destination: "firm_website" as const, storage_bucket: "firm-files", storage_path: "images/hero.png", public_url: null, repository: null, repository_path: null, deployment_commit: null, deployment_url: null, mime_type: "image/png", size_bytes: 1024, sha256: "a".repeat(64), validation_result: null, created_by_role: "system" as const, created_by_id: null, created_at: "2026-07-14T00:00:00Z", superseded_at: null };
    const webpage = { ...hero, id: "wp-fv", artifact_type: "webpage" as const, storage_bucket: null, storage_path: null, public_url: "https://drglaw.ca/journal/founder-vesting-ontario", mime_type: null, size_bytes: null, sha256: null };
    const fullyReadyItem = evaluateDeliverableReadiness({
      deliverable: { ...makeMetadataCompleteDeliverable(), approved_version_id: "v1" },
      currentVersion: makeVersion(),
      artifacts: [hero, webpage],
      latestValidationByArtifactId: { "wp-fv": { id: "val-1", artifact_id: "wp-fv", firm_id: FIRM_ID, validator: "storage_object_check", result: "pass", details: null, validated_by_role: "system", validated_by_id: null, created_at: "2026-07-14T00:00:00Z" } },
    });
    const html = renderToStaticMarkup(
      createElement(PublicationReadinessSummary, {
        firmId: FIRM_ID,
        isOperator: true,
        readiness: { summary: { active: 1, ready: 1, blocked: 0, excluded: 0 }, items: [fullyReadyItem] },
        titles: { d1: "Founder vesting in Ontario corporations" },
        periodId: REAL_FOUNDER_VESTING_PERIOD_ID,
        lifecycleByDeliverableId: { d1: "setup_required" },
      }),
    );

    expect(html).toContain("Ready to activate");
    expect(html).not.toContain("historical, not reconciled");
    expect(html).not.toContain("bg-red-fail");
    // "Setup required" as a bucket label must not appear since nothing
    // needs work; the count chip legitimately says "1 setup required"
    // (the period-wide bucket), so assert on the DETAIL section instead.
    expect(html).not.toContain("still need work before this period can activate");
  });

  it("renders 'Setup required' (amber) with the specific missing requirements, not 'Ready to activate' or 'Historical', for an incomplete deliverable in a setup_required period", () => {
    const html = renderToStaticMarkup(
      createElement(PublicationReadinessSummary, {
        firmId: FIRM_ID,
        isOperator: true,
        readiness: buildReadiness(),
        titles: { d1: "Founder vesting in Ontario corporations" },
        periodId: REAL_FOUNDER_VESTING_PERIOD_ID,
        lifecycleByDeliverableId: { d1: "setup_required" },
      }),
    );

    expect(html).toContain("still need work before this period can activate");
    expect(html).not.toContain("Ready to activate");
    expect(html).not.toContain("historical, not reconciled");
    expect(html).not.toContain("bg-red-fail");
  });

  it("renders 'Blocked' (red) when the period is enforced and a genuine requirement fails", () => {
    const html = renderToStaticMarkup(
      createElement(PublicationReadinessSummary, {
        firmId: FIRM_ID,
        isOperator: true,
        readiness: buildReadiness(),
        titles: { d1: "Founder vesting in Ontario corporations" },
        periodId: REAL_FOUNDER_VESTING_PERIOD_ID,
        lifecycleByDeliverableId: ENFORCED_D1,
      }),
    );

    expect(html).toContain("Blocked");
    expect(html).not.toContain("historical, not reconciled");
    expect(html).not.toContain("Setup required");
  });

  it("renders 'Setup required' (amber), never red 'Blocked', when the period is enforced but only role/locale is missing (defense in depth)", () => {
    const noRole = evaluateDeliverableReadiness({
      deliverable: { ...makeMetadataCompleteDeliverable(), deliverable_role: null, locale: null },
      currentVersion: makeVersion(),
      artifacts: [],
      latestValidationByArtifactId: {},
    });
    const html = renderToStaticMarkup(
      createElement(PublicationReadinessSummary, {
        firmId: FIRM_ID,
        isOperator: true,
        readiness: { summary: { active: 1, ready: 0, blocked: 1, excluded: 0 }, items: [noRole] },
        titles: { d1: "Founder vesting in Ontario corporations" },
        periodId: REAL_FOUNDER_VESTING_PERIOD_ID,
        lifecycleByDeliverableId: ENFORCED_D1,
      }),
    );

    expect(html).toContain("Setup required");
    expect(html).not.toContain("bg-red-fail");
    expect(html).toContain("Founder vesting in Ontario corporations");
  });
});
