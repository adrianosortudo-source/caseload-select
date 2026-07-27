/**
 * loadPublicationPreflightForPeriod (the live /publication-preflight route's
 * loader): proves this loader actually computes and threads the canonical
 * two-path release-authorization result (release-authorization.ts) into
 * buildPreflightReport, per the §13.2g correction (2026-07-21) -- the
 * independent audit's finding that this was the one real production surface
 * still silently using the individual-approval-only fallback before that
 * fix landed. A minimal in-memory Postgrest-style query mock (same pattern
 * as content-period-export.test.ts) applies the actual .select/.eq/.in
 * filters the real Supabase chain would, so these tests exercise the real
 * assembly logic in publication-preflight-loader.ts, not just recorded
 * calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const PERIOD_ID = "950bad0b-fef6-4c5a-b949-fef5d9cbee90";
const DELIVERABLE_ID = "d1111111-1111-1111-1111-111111111111";
const CURRENT_VERSION_ID = "v2222222-2222-2222-2222-222222222222";
const PLACEMENT_ID = "p1111111-1111-1111-1111-111111111111";

type Row = Record<string, unknown>;

const state: {
  periods: Row[];
  deliverables: Row[];
  comments: Row[];
  placements: Row[];
  versions: Row[];
  readiness: Array<{ deliverableId: string; ready: boolean }>;
  standingAuthorization: { active: boolean } | null;
} = {
  periods: [],
  deliverables: [],
  comments: [],
  placements: [],
  versions: [],
  readiness: [],
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
    maybeSingle: () => Promise.resolve({ data: current[0] ?? null, error: null }),
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: current, error: null }),
  };
  return builder;
}

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "content_periods") return chainable(state.periods);
      if (table === "content_deliverables") return chainable(state.deliverables);
      if (table === "deliverable_comments") return chainable(state.comments);
      if (table === "content_placements") return chainable(state.placements);
      if (table === "deliverable_versions") return chainable(state.versions);
      throw new Error(`unexpected table in mock: ${table}`);
    },
  },
}));

vi.mock("@/lib/publication-readiness-loader", () => ({
  loadPeriodPublicationReadiness: () => Promise.resolve(state.readiness),
}));

vi.mock("@/lib/publication-receipts", () => ({
  listCurrentReceiptsByPlacementForDeliverable: () => Promise.resolve({}),
}));

vi.mock("@/lib/standing-publishing-authorization", () => ({
  getStandingAuthorizationState: () => Promise.resolve(state.standingAuthorization),
}));

import { loadPublicationPreflightForPeriod } from "@/lib/publication-preflight-loader";

function baseDeliverable(overrides: Row = {}): Row {
  return {
    id: DELIVERABLE_ID,
    firm_id: FIRM_ID,
    period_id: PERIOD_ID,
    title: "Renewal clause",
    status: "draft",
    current_version_id: CURRENT_VERSION_ID,
    approved_version_id: null,
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
    intended_path: "/journal/renewal-clause",
    required_artifact_type: "webpage",
    state: "ready",
    created_by_role: "operator",
    created_by_id: null,
    created_at: "2026-07-19T00:00:00Z",
    updated_at: "2026-07-19T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  state.periods = [{ id: PERIOD_ID, firm_id: FIRM_ID, readiness_lifecycle: "enforced" }];
  state.deliverables = [baseDeliverable()];
  state.comments = [];
  state.placements = [basePlacement()];
  state.versions = [{ id: CURRENT_VERSION_ID, requires_individual_review: false }];
  state.readiness = [{ deliverableId: DELIVERABLE_ID, ready: true }];
  state.standingAuthorization = { active: false };
});

describe("loadPublicationPreflightForPeriod: receives and applies canonical release-authorization context", () => {
  it("an eligible standing-authorization-only version (no individual approval) resolves mayPublish=true, not blocked as 'not approved'", async () => {
    state.deliverables = [baseDeliverable({ status: "draft", approved_version_id: null })];
    state.versions = [{ id: CURRENT_VERSION_ID, requires_individual_review: false }];
    state.standingAuthorization = { active: true };

    const report = await loadPublicationPreflightForPeriod(PERIOD_ID, FIRM_ID);
    expect(report).not.toBeNull();
    expect(report!.placements).toHaveLength(1);
    expect(report!.placements[0].mayPublish).toBe(true);
    expect(report!.placements[0].reason).toBeNull();
  });

  it("requires_individual_review=true blocks standing authorization even though it is active -- the override is respected end to end", async () => {
    state.deliverables = [baseDeliverable({ status: "draft", approved_version_id: null })];
    state.versions = [{ id: CURRENT_VERSION_ID, requires_individual_review: true }];
    state.standingAuthorization = { active: true };

    const report = await loadPublicationPreflightForPeriod(PERIOD_ID, FIRM_ID);
    expect(report!.placements[0].mayPublish).toBe(false);
    expect(report!.placements[0].reason).toMatch(/not release-authorized/);
    expect(report!.placements[0].reason).toContain("blocked_requires_individual_review");
  });

  it("individual approval still works exactly as before (Path A, unaffected by standing-authorization wiring)", async () => {
    state.deliverables = [baseDeliverable({ status: "approved", approved_version_id: CURRENT_VERSION_ID })];
    state.versions = [{ id: CURRENT_VERSION_ID, requires_individual_review: false }];
    state.standingAuthorization = { active: false };

    const report = await loadPublicationPreflightForPeriod(PERIOD_ID, FIRM_ID);
    expect(report!.placements[0].mayPublish).toBe(true);
  });

  it("inactive standing authorization, no individual approval on record -> not release-authorized, canonical wording, never bare 'not approved'", async () => {
    state.deliverables = [baseDeliverable({ status: "draft", approved_version_id: null })];
    state.versions = [{ id: CURRENT_VERSION_ID, requires_individual_review: false }];
    state.standingAuthorization = { active: false };

    const report = await loadPublicationPreflightForPeriod(PERIOD_ID, FIRM_ID);
    expect(report!.placements[0].mayPublish).toBe(false);
    expect(report!.placements[0].reason).toMatch(/not release-authorized/);
    expect(report!.placements[0].reason).toContain("standing_authorization_inactive");
  });

  it("getStandingAuthorizationState returning null (never configured) resolves standingAuthorizationActive=false, never assumed true", async () => {
    state.deliverables = [baseDeliverable({ status: "draft", approved_version_id: null })];
    state.versions = [{ id: CURRENT_VERSION_ID, requires_individual_review: false }];
    state.standingAuthorization = null;

    const report = await loadPublicationPreflightForPeriod(PERIOD_ID, FIRM_ID);
    expect(report!.placements[0].mayPublish).toBe(false);
    expect(report!.placements[0].reason).toContain("standing_authorization_inactive");
  });

  it("a deliverable whose current-version row failed to load is left OUT of the map, so buildPreflightReport's own explicit release_authorization_context_unavailable fires -- never a silent fallback to the individual-approval-only default, even though status/approved_version_id would otherwise pass that legacy check", async () => {
    // deliverable_versions query returns no row at all for this current_version_id
    // (a data-integrity anomaly this loader's queries do not expect).
    state.deliverables = [baseDeliverable({ status: "approved", approved_version_id: CURRENT_VERSION_ID })];
    state.versions = [];
    state.standingAuthorization = { active: true };

    const report = await loadPublicationPreflightForPeriod(PERIOD_ID, FIRM_ID);
    // buildPreflightReport itself has no fallback interpretation for a
    // missing map entry -- it fails closed with the explicit,
    // machine-readable reasonCode on its own; this loader does not need to
    // (and, as of this correction, does not) construct a synthetic
    // ReleaseAuthorizationResult to achieve that. If this deliverable were
    // instead routed through the legacy individual-approval-only default,
    // status "approved" + matching approved_version_id would have granted
    // mayPublish=true -- exactly the silent-fallback bypass this fix closes.
    expect(report!.placements[0].mayPublish).toBe(false);
    expect(report!.placements[0].reasonCode).toBe("release_authorization_context_unavailable");
    expect(report!.placements[0].reason).toMatch(/^release_authorization_context_unavailable:/);
    expect(report!.placements[0].reason).not.toMatch(/deliverable status is "approved"/);
    expect(report!.placements[0].reason).not.toMatch(/version drift/);
  });

  it("a deliverable with no current_version_id at all is left OUT of the map -> release_authorization_context_unavailable, never mayPublish=true from a stale approved_version_id alone", async () => {
    state.deliverables = [baseDeliverable({ status: "approved", approved_version_id: CURRENT_VERSION_ID, current_version_id: null })];
    state.versions = [{ id: CURRENT_VERSION_ID, requires_individual_review: false }];
    state.standingAuthorization = { active: false };

    const report = await loadPublicationPreflightForPeriod(PERIOD_ID, FIRM_ID);
    expect(report!.placements[0].mayPublish).toBe(false);
    expect(report!.placements[0].reasonCode).toBe("release_authorization_context_unavailable");
    expect(report!.placements[0].reason).toMatch(/^release_authorization_context_unavailable:/);
  });

  it("returns null when the period does not resolve for this firm (unaffected by the authorization wiring)", async () => {
    state.periods = [];
    const report = await loadPublicationPreflightForPeriod(PERIOD_ID, FIRM_ID);
    expect(report).toBeNull();
  });
});
