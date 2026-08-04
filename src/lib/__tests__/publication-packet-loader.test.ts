/**
 * Loader coverage for loadPublicationPacketsForPeriod
 * (publication-packet-loader.ts). Same minimal chainable-query-mock
 * pattern as publication-preflight-loader.test.ts. The one genuinely
 * I/O-shaped piece -- CTA reachability -- is exercised via an injected
 * mock fetch, never a real network call.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const PERIOD_ID = "period-1111-1111-1111-111111111111";
const DELIVERABLE_ID = "d1111111-1111-1111-1111-111111111111";
const DELIVERABLE_ID_2 = "d2222222-2222-2222-2222-222222222222";
const VERSION_ID = "v1111111-1111-1111-1111-111111111111";
const PLACEMENT_ID = "p1111111-1111-1111-1111-111111111111";
const PLACEMENT_ID_2 = "p2222222-2222-2222-2222-222222222222";

type Row = Record<string, unknown>;

const state: {
  deliverables: Row[];
  versions: Row[];
  placements: Row[];
  artifacts: Row[];
  validations: Row[];
  receiptsByDeliverable: Record<string, Record<string, Row | null>>;
  standingAuthorization: { active: boolean } | null;
} = {
  deliverables: [],
  versions: [],
  placements: [],
  artifacts: [],
  validations: [],
  receiptsByDeliverable: {},
  standingAuthorization: null,
};

function chainable(rows: Row[]) {
  let current = rows;
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      current = current.filter((r) => r[col] === val);
      return builder;
    },
    in: (col: string, vals: unknown[]) => {
      current = current.filter((r) => vals.includes(r[col]));
      return builder;
    },
    order: () => builder,
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: current, error: null }),
  };
  return builder;
}

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "content_deliverables") return chainable(state.deliverables);
      if (table === "deliverable_versions") return chainable(state.versions);
      if (table === "content_placements") return chainable(state.placements);
      if (table === "publication_artifacts") return chainable(state.artifacts);
      if (table === "publication_artifact_validations") return chainable(state.validations);
      throw new Error(`unexpected table in mock: ${table}`);
    },
  },
}));

vi.mock("@/lib/publication-receipts", () => ({
  listCurrentReceiptsByPlacementForDeliverable: (deliverableId: string) =>
    Promise.resolve(state.receiptsByDeliverable[deliverableId] ?? {}),
}));

vi.mock("@/lib/standing-publishing-authorization", () => ({
  getStandingAuthorizationState: () => Promise.resolve(state.standingAuthorization),
}));

import { loadPublicationPacketsForPeriod } from "../publication-packet-loader";

function baseDeliverable(overrides: Row = {}): Row {
  return {
    id: DELIVERABLE_ID,
    firm_id: FIRM_ID,
    period_id: PERIOD_ID,
    title: "Renewal Clause",
    status: "approved",
    content_kind: "text",
    current_version_id: VERSION_ID,
    approved_version_id: VERSION_ID,
    locale: "en-CA",
    deliverable_role: "article",
    publication_destination: "firm_website",
    publication_path: "/journal/renewal-clause-ontario",
    cta_target_path: null,
    ...overrides,
  };
}

function baseVersion(overrides: Row = {}): Row {
  return {
    id: VERSION_ID,
    deliverable_id: DELIVERABLE_ID,
    firm_id: FIRM_ID,
    body_html: "<p>Approved copy.</p>",
    requires_individual_review: false,
    asset_validation: null,
    ...overrides,
  };
}

function basePlacement(overrides: Row = {}): Row {
  return {
    id: PLACEMENT_ID,
    firm_id: FIRM_ID,
    period_id: PERIOD_ID,
    deliverable_id: DELIVERABLE_ID,
    destination: "firm_website",
    locale: "en-CA",
    scheduled_publish_date: null,
    state: "ready",
    ...overrides,
  };
}

function baseArtifact(overrides: Row = {}): Row {
  return {
    id: "a1111111-1111-1111-1111-111111111111",
    firm_id: FIRM_ID,
    deliverable_id: DELIVERABLE_ID,
    version_id: VERSION_ID,
    artifact_type: "hero_image",
    locale: "en-CA",
    storage_path: "deliverables/hero/x.png",
    public_url: "https://drglaw.ca/x.png",
    validation_result: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

const WEBPAGE_ARTIFACT_ID = "a3333333-3333-3333-3333-333333333333";

/** Article role's real requirement profile needs a validated webpage artifact, not just a hero image -- see publication-packet.test.ts's identical fixture note (2026-07-22 audit follow-up). */
function baseWebpageArtifact(overrides: Row = {}): Row {
  return {
    id: WEBPAGE_ARTIFACT_ID,
    firm_id: FIRM_ID,
    deliverable_id: DELIVERABLE_ID,
    version_id: VERSION_ID,
    artifact_type: "webpage",
    locale: "en-CA",
    storage_path: null,
    public_url: "https://drglaw.ca/journal/renewal-clause-ontario",
    validation_result: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function passingValidation(artifactId: string, overrides: Row = {}): Row {
  return {
    id: `val-${artifactId}`,
    artifact_id: artifactId,
    firm_id: FIRM_ID,
    validator: "route_check",
    result: "pass",
    details: null,
    validated_by_role: "system",
    validated_by_id: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  state.deliverables = [baseDeliverable()];
  state.versions = [baseVersion()];
  state.placements = [basePlacement()];
  state.artifacts = [baseArtifact(), baseWebpageArtifact()];
  state.validations = [passingValidation(WEBPAGE_ARTIFACT_ID)];
  state.receiptsByDeliverable = {};
  state.standingAuthorization = { active: false };
});

describe("loadPublicationPacketsForPeriod: basic assembly", () => {
  it("returns null when the period has no deliverables for this firm", async () => {
    state.deliverables = [];
    const result = await loadPublicationPacketsForPeriod(PERIOD_ID, FIRM_ID, { siteOrigin: "https://drglaw.ca" });
    expect(result).toBeNull();
  });

  it("assembles one packet per deliverable x placement", async () => {
    const result = await loadPublicationPacketsForPeriod(PERIOD_ID, FIRM_ID, { siteOrigin: "https://drglaw.ca" });
    expect(result).not.toBeNull();
    expect(result!.packets).toHaveLength(1);
    expect(result!.packets[0].identity.deliverableId).toBe(DELIVERABLE_ID);
    expect(result!.titles[DELIVERABLE_ID]).toBe("Renewal Clause");
  });

  it("archived deliverables are excluded entirely", async () => {
    state.deliverables = [baseDeliverable({ status: "archived" })];
    const result = await loadPublicationPacketsForPeriod(PERIOD_ID, FIRM_ID, { siteOrigin: "https://drglaw.ca" });
    expect(result!.packets).toHaveLength(0);
  });
});

describe("loadPublicationPacketsForPeriod: mocked-fetch CTA resolution", () => {
  it("gbp_post deliverable with a cta_target_path -> fetchImpl is called, HEAD 200 -> cta_resolves passes", async () => {
    state.deliverables = [baseDeliverable({ deliverable_role: "gbp_post", cta_target_path: "/journal/renewal-clause-ontario" })];
    let calledUrl: string | null = null;
    const fetchImpl: typeof fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input);
      expect(init?.method).toBe("HEAD");
      return { status: 200 } as Response;
    });
    const result = await loadPublicationPacketsForPeriod(PERIOD_ID, FIRM_ID, { siteOrigin: "https://drglaw.ca", fetchImpl });
    expect(fetchImpl).toHaveBeenCalled();
    expect(calledUrl).toBe("https://drglaw.ca/journal/renewal-clause-ontario");
    const ctaCheck = result!.packets[0].checks.find((c) => c.name === "cta_resolves");
    expect(ctaCheck?.pass).toBe(true);
  });

  it("fetchImpl returns a non-2xx status -> cta_resolves fails with a named reason", async () => {
    state.deliverables = [baseDeliverable({ deliverable_role: "gbp_post", cta_target_path: "/journal/missing-page" })];
    const fetchImpl = vi.fn(async () => ({ status: 404 }) as Response);
    const result = await loadPublicationPacketsForPeriod(PERIOD_ID, FIRM_ID, { siteOrigin: "https://drglaw.ca", fetchImpl });
    const ctaCheck = result!.packets[0].checks.find((c) => c.name === "cta_resolves");
    expect(ctaCheck?.pass).toBe(false);
    expect(ctaCheck?.reason).toBeTruthy();
  });

  it("no cta_target_path at all -> fetchImpl never called", async () => {
    state.deliverables = [baseDeliverable({ cta_target_path: null })];
    const fetchImpl = vi.fn(async () => ({ status: 200 }) as Response);
    await loadPublicationPacketsForPeriod(PERIOD_ID, FIRM_ID, { siteOrigin: "https://drglaw.ca", fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("article-role deliverable (CTA not required) never triggers a fetch even without cta_target_path", async () => {
    state.deliverables = [baseDeliverable({ deliverable_role: "article" })];
    const fetchImpl = vi.fn(async () => ({ status: 200 }) as Response);
    const result = await loadPublicationPacketsForPeriod(PERIOD_ID, FIRM_ID, { siteOrigin: "https://drglaw.ca", fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    const ctaCheck = result!.packets[0].checks.find((c) => c.name === "cta_exists");
    expect(ctaCheck?.pass).toBe(true); // not required, so absence is not a blocker
  });

  it("a deliverable with TWO placements is fetched exactly ONCE, not once per placement (2026-07-22 audit follow-up)", async () => {
    state.deliverables = [baseDeliverable({ deliverable_role: "gbp_post", cta_target_path: "/journal/renewal-clause-ontario" })];
    state.placements = [
      basePlacement({ id: PLACEMENT_ID, destination: "google_business_profile" }),
      basePlacement({ id: PLACEMENT_ID_2, destination: "linkedin_post" }),
    ];
    const fetchImpl = vi.fn(async () => ({ status: 200 }) as Response);
    const result = await loadPublicationPacketsForPeriod(PERIOD_ID, FIRM_ID, { siteOrigin: "https://drglaw.ca", fetchImpl });
    expect(result!.packets).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

const DELIVERABLE_ID_3 = "d3333333-3333-3333-3333-333333333333";
const PLACEMENT_ID_3 = "p3333333-3333-3333-3333-333333333333";
const VERSION_ID_3 = "v3333333-3333-3333-3333-333333333333";
const WEBPAGE_ARTIFACT_ID_3 = "a4444444-4444-4444-4444-444444444444";

describe("loadPublicationPacketsForPeriod: period summary (mutually exclusive buckets) and one-reason-per-exception", () => {
  function threeDeliverableScenario() {
    // #1: published. #2: broken (no current version) -> blocked. #3: clean
    // and unpublished -> awaiting publication. Exercises all three summary
    // buckets simultaneously so their mutual exclusivity is actually tested,
    // not just each one in isolation.
    state.deliverables = [
      baseDeliverable({ id: DELIVERABLE_ID }),
      baseDeliverable({ id: DELIVERABLE_ID_2, current_version_id: null, approved_version_id: null }),
      baseDeliverable({ id: DELIVERABLE_ID_3, current_version_id: VERSION_ID_3, approved_version_id: VERSION_ID_3 }),
    ];
    state.versions = [baseVersion(), baseVersion({ id: VERSION_ID_3, deliverable_id: DELIVERABLE_ID_3 })];
    state.placements = [
      basePlacement({ id: PLACEMENT_ID, deliverable_id: DELIVERABLE_ID }),
      basePlacement({ id: PLACEMENT_ID_2, deliverable_id: DELIVERABLE_ID_2 }),
      basePlacement({ id: PLACEMENT_ID_3, deliverable_id: DELIVERABLE_ID_3 }),
    ];
    state.artifacts = [
      baseArtifact(),
      baseWebpageArtifact(),
      baseArtifact({ id: "a5555555-5555-5555-5555-555555555555", deliverable_id: DELIVERABLE_ID_3, version_id: VERSION_ID_3 }),
      baseWebpageArtifact({ id: WEBPAGE_ARTIFACT_ID_3, deliverable_id: DELIVERABLE_ID_3, version_id: VERSION_ID_3, public_url: "https://drglaw.ca/journal/good-standing-clause-ontario" }),
    ];
    state.validations = [passingValidation(WEBPAGE_ARTIFACT_ID), passingValidation(WEBPAGE_ARTIFACT_ID_3)];
    state.receiptsByDeliverable[DELIVERABLE_ID] = {
      [PLACEMENT_ID]: {
        id: "r1",
        firm_id: FIRM_ID,
        deliverable_id: DELIVERABLE_ID,
        placement_id: PLACEMENT_ID,
        destination: "firm_website",
        external_post_id: "urn:li:post:1",
        public_url: null,
        actor_role: "operator",
        verification_state: "verified",
        verified_at: new Date().toISOString(),
        published_at: new Date().toISOString(),
      },
    };
  }

  it("summary counts published/readyToPublish/needsAttention correctly, mutually exclusive, summing to total", async () => {
    threeDeliverableScenario();
    const result = await loadPublicationPacketsForPeriod(PERIOD_ID, FIRM_ID, { siteOrigin: "https://drglaw.ca" });
    expect(result!.summary.total).toBe(3);
    expect(result!.summary.published).toBe(1);
    expect(result!.summary.needsAttention).toBe(1); // deliverable #2: no current version
    expect(result!.summary.readyToPublish).toBe(1); // deliverable #3: clean, just not published yet
    expect(result!.summary.published + result!.summary.readyToPublish + result!.summary.needsAttention).toBe(result!.summary.total);
  });

  it("READINESS-ONLY failure (2026-07-22 audit follow-up: the exact partition-leak scenario) still sums to total -- a deliverable with a bound hero image but no deployed webpage counts as needsAttention, never a silent fourth state", async () => {
    // Deliberately reuses the default beforeEach deliverable/version/placement
    // but strips the webpage artifact + its validation, leaving only the
    // hero image -- every packet-level check passes, only the readiness
    // evaluator's webpage_artifact/webpage_validated/localized_route
    // requirements fail.
    state.artifacts = [baseArtifact()];
    state.validations = [];
    const result = await loadPublicationPacketsForPeriod(PERIOD_ID, FIRM_ID, { siteOrigin: "https://drglaw.ca" });
    expect(result!.summary.total).toBe(1);
    expect(result!.summary.needsAttention).toBe(1);
    expect(result!.summary.published + result!.summary.readyToPublish + result!.summary.needsAttention).toBe(result!.summary.total);
    const outstanding = result!.outstanding[0];
    expect(outstanding.state).toBe("blocked");
    expect(outstanding.reasons.some((r) => r.startsWith("readiness_requirements:"))).toBe(true);
  });

  it("outstanding.state distinguishes awaiting_publication (ready, just not done) from blocked (a real defect)", async () => {
    threeDeliverableScenario();
    const result = await loadPublicationPacketsForPeriod(PERIOD_ID, FIRM_ID, { siteOrigin: "https://drglaw.ca" });
    const blocked = result!.outstanding.find((o) => o.deliverableId === DELIVERABLE_ID_2);
    const awaiting = result!.outstanding.find((o) => o.deliverableId === DELIVERABLE_ID_3);
    expect(blocked?.state).toBe("blocked");
    expect(awaiting?.state).toBe("awaiting_publication");
    // An awaiting_publication entry's reasons list contains ONLY the
    // publication_proof line -- never a defect reason alongside it.
    expect(awaiting!.reasons).toHaveLength(1);
    expect(awaiting!.reasons[0]).toMatch(/^publication_proof: /);
    // A blocked entry's reasons must include at least one NON-proof reason.
    expect(blocked!.reasons.some((r) => !r.startsWith("publication_proof:"))).toBe(true);
  });

  it("outstanding items each carry one precise reason string per failed check, not one generic message", async () => {
    state.deliverables = [baseDeliverable({ current_version_id: null, approved_version_id: null })];
    state.artifacts = [];
    const result = await loadPublicationPacketsForPeriod(PERIOD_ID, FIRM_ID, { siteOrigin: "https://drglaw.ca" });
    expect(result!.outstanding).toHaveLength(1);
    expect(result!.outstanding[0].reasons.length).toBeGreaterThan(0);
    for (const reason of result!.outstanding[0].reasons) {
      expect(reason).toMatch(/^[a-z_]+: /); // "<check_name>: <specific reason>", never a bare generic string
    }
  });

  it("a published deliverable never appears in outstanding", async () => {
    state.receiptsByDeliverable[DELIVERABLE_ID] = {
      [PLACEMENT_ID]: {
        id: "r1",
        firm_id: FIRM_ID,
        deliverable_id: DELIVERABLE_ID,
        placement_id: PLACEMENT_ID,
        destination: "firm_website",
        external_post_id: "urn:li:post:1",
        actor_role: "operator",
        verification_state: "verified",
        verified_at: new Date().toISOString(),
        published_at: new Date().toISOString(),
      },
    };
    const result = await loadPublicationPacketsForPeriod(PERIOD_ID, FIRM_ID, { siteOrigin: "https://drglaw.ca" });
    expect(result!.outstanding).toHaveLength(0);
  });
});

describe("loadPublicationPacketsForPeriod: standing authorization threading", () => {
  it("active standing authorization is threaded through to legal_authorized, matching isVersionReleaseAuthorized's own path B", async () => {
    state.deliverables = [baseDeliverable({ status: "draft", approved_version_id: null })];
    state.standingAuthorization = { active: true };
    const result = await loadPublicationPacketsForPeriod(PERIOD_ID, FIRM_ID, { siteOrigin: "https://drglaw.ca" });
    expect(result!.packets[0].legalAuthorized).toBe(true);
  });

  it("getStandingAuthorizationState returning null resolves to inactive, never assumed true", async () => {
    state.deliverables = [baseDeliverable({ status: "draft", approved_version_id: null })];
    state.standingAuthorization = null;
    const result = await loadPublicationPacketsForPeriod(PERIOD_ID, FIRM_ID, { siteOrigin: "https://drglaw.ca" });
    expect(result!.packets[0].legalAuthorized).toBe(false);
  });
});
