/**
 * Codex second-pass correction: loadPlanPublicationReadiness used to
 * resolve EVERY failure (a Supabase error on any of its five queries, or
 * any thrown exception) to the exact same shape it returns for a firm that
 * genuinely has zero content_deliverables rows. That made a database
 * failure indistinguishable from "nothing to report" in
 * PublicationReadinessSummary, which treats an empty result as "render
 * nothing." These tests pin the fix: `unavailable` is true on every real
 * failure path and false on the two success paths (genuinely empty, and
 * fully populated).
 *
 * loadPeriodPublicationReadiness (the activation-preflight sibling) is
 * covered separately below: it now throws on failure instead of returning
 * [] silently, since an empty array there would make
 * evaluateActivationPreflight report canActivate=true for the wrong
 * reason.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

interface TableResponse {
  data: unknown[] | null;
  error: { message: string } | null;
}

interface State {
  responses: Record<string, TableResponse>;
}

const state: State = { responses: {} };

function defaultResponses(): Record<string, TableResponse> {
  return {
    content_deliverables: { data: [], error: null },
    deliverable_versions: { data: [], error: null },
    publication_artifacts: { data: [], error: null },
    publication_artifact_validations: { data: [], error: null },
    content_periods: { data: [], error: null },
  };
}

// A "hybrid" thenable: awaiting it at any point resolves to that table's
// configured response, and .eq()/.in()/.order() all return another hybrid
// for the same table, so any chain shape (single .eq, double .eq,
// .in().order(), bare .in()) resolves correctly regardless of how many
// links the real query builder happens to have.
function hybrid(table: string): Promise<TableResponse> & {
  eq: (...args: unknown[]) => ReturnType<typeof hybrid>;
  in: (...args: unknown[]) => ReturnType<typeof hybrid>;
  order: (...args: unknown[]) => ReturnType<typeof hybrid>;
} {
  const p = Promise.resolve(state.responses[table] ?? { data: [], error: null }) as ReturnType<typeof hybrid>;
  p.eq = () => hybrid(table);
  p.in = () => hybrid(table);
  p.order = () => hybrid(table);
  return p;
}

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => hybrid(table),
    }),
  },
}));

import { loadPlanPublicationReadiness, loadPeriodPublicationReadiness } from "@/lib/publication-readiness-loader";

const FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const PERIOD_ID = "950bad0b-fef6-4c5a-b949-fef5d9cbee90";

beforeEach(() => {
  state.responses = defaultResponses();
});

describe("loadPlanPublicationReadiness: success paths never report unavailable", () => {
  it("a genuinely empty plan (zero content_deliverables rows, no error) is NOT unavailable", async () => {
    const result = await loadPlanPublicationReadiness(FIRM_ID);
    expect(result.unavailable).toBe(false);
    expect(result.summary).toEqual({ active: 0, ready: 0, blocked: 0, excluded: 0 });
  });
});

describe("loadPlanPublicationReadiness: every query-failure path reports unavailable, not clean-empty", () => {
  it("content_deliverables query error -> unavailable:true", async () => {
    state.responses.content_deliverables = { data: null, error: { message: "connection reset" } };
    const result = await loadPlanPublicationReadiness(FIRM_ID);
    expect(result.unavailable).toBe(true);
    expect(result.summary).toEqual({ active: 0, ready: 0, blocked: 0, excluded: 0 });
  });

  it("deliverable_versions (part of the 'lifecycle' join chain) query error -> unavailable:true", async () => {
    state.responses.content_deliverables = {
      data: [{ id: "d1", firm_id: FIRM_ID, current_version_id: "v1", period_id: null, title: "T", status: "approved" }],
      error: null,
    };
    state.responses.deliverable_versions = { data: null, error: { message: "timeout" } };
    const result = await loadPlanPublicationReadiness(FIRM_ID);
    expect(result.unavailable).toBe(true);
  });

  it("publication_artifacts query error -> unavailable:true", async () => {
    state.responses.content_deliverables = {
      data: [{ id: "d1", firm_id: FIRM_ID, current_version_id: null, period_id: null, title: "T", status: "approved" }],
      error: null,
    };
    state.responses.publication_artifacts = { data: null, error: { message: "rls denied" } };
    const result = await loadPlanPublicationReadiness(FIRM_ID);
    expect(result.unavailable).toBe(true);
  });

  it("publication_artifact_validations query error -> unavailable:true", async () => {
    state.responses.content_deliverables = {
      data: [{ id: "d1", firm_id: FIRM_ID, current_version_id: null, period_id: null, title: "T", status: "approved" }],
      error: null,
    };
    // publication_artifacts must return at least one row for the validations
    // query to even run (the loader short-circuits to an empty array
    // otherwise), so seed one artifact.
    state.responses.publication_artifacts = {
      data: [{ id: "a1", deliverable_id: "d1", version_id: null, artifact_type: "webpage" }],
      error: null,
    };
    state.responses.publication_artifact_validations = { data: null, error: { message: "timeout" } };
    const result = await loadPlanPublicationReadiness(FIRM_ID);
    expect(result.unavailable).toBe(true);
  });

  it("content_periods (lifecycle) query error -> unavailable:true", async () => {
    state.responses.content_deliverables = {
      data: [{ id: "d1", firm_id: FIRM_ID, current_version_id: null, period_id: PERIOD_ID, title: "T", status: "approved" }],
      error: null,
    };
    state.responses.content_periods = { data: null, error: { message: "connection reset" } };
    const result = await loadPlanPublicationReadiness(FIRM_ID);
    expect(result.unavailable).toBe(true);
  });
});

describe("loadPeriodPublicationReadiness: throws on failure instead of silently returning []", () => {
  it("throws when the content_deliverables query errors, rather than returning an empty array", async () => {
    state.responses.content_deliverables = { data: null, error: { message: "connection reset" } };
    await expect(loadPeriodPublicationReadiness(PERIOD_ID, FIRM_ID)).rejects.toThrow(/readiness data unavailable/);
  });

  it("returns [] (not a throw) for a genuinely empty period", async () => {
    const result = await loadPeriodPublicationReadiness(PERIOD_ID, FIRM_ID);
    expect(result).toEqual([]);
  });
});
