/**
 * activatePeriodReadiness's try/catch around loadPeriodPublicationReadiness
 * (Codex second-pass correction, src/lib/deliverables.ts:263-274) had zero
 * direct test coverage: the only route test mocks activatePeriodReadiness
 * itself away entirely, so its actual body never ran under test. This
 * exercises the REAL function against a REAL (mocked-at-the-Supabase-layer)
 * failure, proving the catch maps a thrown readiness-load failure to
 * {ok:false, error} rather than ever silently reporting {ok:true} or
 * throwing uncaught out of activatePeriodReadiness itself.
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
    content_periods: {
      data: [{ id: PERIOD_ID, firm_id: FIRM_ID, readiness_lifecycle: "setup_required" }],
      error: null,
    },
    content_deliverables: { data: [], error: null },
    deliverable_versions: { data: [], error: null },
    publication_artifacts: { data: [], error: null },
    publication_artifact_validations: { data: [], error: null },
  };
}

function hybrid(table: string): Promise<TableResponse> & {
  eq: (...args: unknown[]) => ReturnType<typeof hybrid>;
  in: (...args: unknown[]) => ReturnType<typeof hybrid>;
  order: (...args: unknown[]) => ReturnType<typeof hybrid>;
  select: (...args: unknown[]) => ReturnType<typeof hybrid>;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  update: (...args: unknown[]) => ReturnType<typeof hybrid>;
} {
  const rows = state.responses[table] ?? { data: [], error: null };
  const p = Promise.resolve(rows) as ReturnType<typeof hybrid>;
  p.eq = () => hybrid(table);
  p.in = () => hybrid(table);
  p.order = () => hybrid(table);
  p.select = () => hybrid(table);
  p.update = () => hybrid(table);
  p.maybeSingle = () =>
    Promise.resolve({
      data: Array.isArray(rows.data) ? (rows.data[0] ?? null) : null,
      error: rows.error,
    });
  return p;
}

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => hybrid(table),
  },
}));

import { activatePeriodReadiness } from "@/lib/deliverables";

const FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const PERIOD_ID = "950bad0b-fef6-4c5a-b949-fef5d9cbee90";

beforeEach(() => {
  state.responses = defaultResponses();
});

describe("activatePeriodReadiness: real catch branch around a real readiness-load failure", () => {
  it("maps a genuine loadPeriodPublicationReadiness throw to {ok:false, error}, never {ok:true}", async () => {
    state.responses.content_deliverables = { data: null, error: { message: "connection reset" } };
    const result = await activatePeriodReadiness({ periodId: PERIOD_ID, firmId: FIRM_ID });
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/readiness data unavailable/);
  });

  it("does not throw out of activatePeriodReadiness itself; the caller always gets a resolved result", async () => {
    state.responses.publication_artifacts = { data: null, error: { message: "rls denied" } };
    state.responses.content_deliverables = {
      data: [{ id: "d1", firm_id: FIRM_ID, current_version_id: null, period_id: PERIOD_ID, title: "T", status: "approved" }],
      error: null,
    };
    await expect(activatePeriodReadiness({ periodId: PERIOD_ID, firmId: FIRM_ID })).resolves.toBeDefined();
  });

  it("is idempotent: an already-enforced period short-circuits before the loader ever runs", async () => {
    state.responses.content_periods = {
      data: [{ id: PERIOD_ID, firm_id: FIRM_ID, readiness_lifecycle: "enforced" }],
      error: null,
    };
    // Force the loader to fail if it were somehow reached, proving the
    // idempotent short-circuit actually skips it.
    state.responses.content_deliverables = { data: null, error: { message: "should never be queried" } };
    const result = await activatePeriodReadiness({ periodId: PERIOD_ID, firmId: FIRM_ID });
    expect(result.ok).toBe(true);
  });
});
