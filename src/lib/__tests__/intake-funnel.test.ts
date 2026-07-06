/**
 * intake-funnel tests (Codex audit 2026-07-07, finding 5).
 *
 * The report used to load rows into memory and count array lengths, so any
 * window past PostgREST's ~1000-row cap silently undercounted every total and
 * distribution. fetchIntakeFunnel now:
 *   - range-pages current-week leads and open matters to completion (the only
 *     sets whose rows are needed, for the distributions), and
 *   - uses exact head counts for prior-week totals and matters-created.
 *
 * The mock routes each query by table + shape:
 *   - screened_leads + range  -> current-week leads paged scan
 *   - screened_leads + head   -> a prior-week count (by status eq)
 *   - client_matters + range  -> open matters paged scan
 *   - client_matters + head   -> current vs prior matters (by lt presence)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const state: {
    leadPages: Record<string, unknown>[][]; // consumed one per screened_leads range scan page
    matterPages: Record<string, unknown>[][]; // consumed one per client_matters range scan page
    priorTotal: number;
    priorTaken: number;
    priorPassed: number;
    currentMatters: number;
    priorMatters: number;
  } = {
    leadPages: [],
    matterPages: [],
    priorTotal: 0,
    priorTaken: 0,
    priorPassed: 0,
    currentMatters: 0,
    priorMatters: 0,
  };

  function makeQuery(table: string) {
    let head = false;
    let statusEq: string | null = null;
    let hasLt = false;
    let hasRange = false;

    const resolve = () => {
      if (hasRange) {
        // paged scan
        if (table === "screened_leads") {
          const page = state.leadPages.shift() ?? [];
          return { data: page, error: null };
        }
        const page = state.matterPages.shift() ?? [];
        return { data: page, error: null };
      }
      if (head) {
        if (table === "screened_leads") {
          if (statusEq === "taken") return { count: state.priorTaken, error: null };
          if (statusEq === "passed") return { count: state.priorPassed, error: null };
          return { count: state.priorTotal, error: null };
        }
        // client_matters head: prior window carries an lt filter, current does not
        return { count: hasLt ? state.priorMatters : state.currentMatters, error: null };
      }
      return { data: [], error: null };
    };

    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: (_cols: string, opts?: { head?: boolean }) => { if (opts?.head) head = true; return q; },
      eq: (col: string, val: unknown) => { if (col === "status") statusEq = val as string; return q; },
      gte: () => q,
      lte: () => q,
      lt: () => { hasLt = true; return q; },
      is: () => q,
      order: () => q,
      range: () => { hasRange = true; return q; },
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
    });
    return q;
  }

  return {
    state,
    supabaseAdmin: { from: (table: string) => makeQuery(table) },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: h.supabaseAdmin }));

import { fetchIntakeFunnel } from "@/lib/intake-funnel";

const FIRM = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  h.state.leadPages = [];
  h.state.matterPages = [];
  h.state.priorTotal = 0;
  h.state.priorTaken = 0;
  h.state.priorPassed = 0;
  h.state.currentMatters = 0;
  h.state.priorMatters = 0;
});

function lead(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { band: "A", status: "taken", practice_area: "employment", matter_type: "wrongful_dismissal", created_at: "2026-07-06T00:00:00Z", ...over };
}

describe("fetchIntakeFunnel scale-safety", () => {
  it("counts current-week leads across MORE than one PostgREST page (no cap undercount)", async () => {
    // 1000 (full page, 900 taken + 100 passed) + 3 (short page, all taken) =
    // 1003 total, 903 taken, 100 passed. The old single-select would have
    // stopped at 1000.
    const fullPage = Array.from({ length: 1000 }, (_, i) => lead({ status: i < 900 ? "taken" : "passed" }));
    const shortPage = [lead(), lead(), lead()];
    h.state.leadPages = [fullPage, shortPage];
    h.state.matterPages = [[]];
    h.state.priorTotal = 10;
    h.state.priorTaken = 4;

    const report = await fetchIntakeFunnel(FIRM);

    expect(report.totalLeads.value).toBe(1003);
    expect(report.taken.value).toBe(903);
    expect(report.passed.value).toBe(100);
    // take rate uses the complete counts
    expect(report.takeRate.value).toBeCloseTo(903 / 1003, 6);
  });

  it("builds band / practice-area / matter-type distributions across all pages", async () => {
    h.state.leadPages = [
      [lead({ band: "A", practice_area: "employment", matter_type: "wrongful_dismissal" }), lead({ band: "B", practice_area: "estates", matter_type: "probate" })],
    ];
    h.state.matterPages = [[{ matter_stage: "intake" }, { matter_stage: "intake" }, { matter_stage: "active" }]];

    const report = await fetchIntakeFunnel(FIRM);

    expect(report.bands).toEqual([{ band: "A", count: 1 }, { band: "B", count: 1 }]);
    expect(report.topPracticeAreas).toContainEqual({ label: "employment", count: 1 });
    expect(report.topMatterTypes).toContainEqual({ label: "wrongful_dismissal", count: 1 });
    // matters-by-stage from the paged open-matters scan
    expect(report.mattersByStage).toEqual([{ stage: "intake", count: 2 }, { stage: "active", count: 1 }]);
  });

  it("uses exact head counts (not fetched arrays) for prior-week totals and matters created", async () => {
    h.state.leadPages = [[lead(), lead()]]; // current total 2, both taken
    h.state.matterPages = [[]];
    h.state.priorTotal = 5000; // a value only reachable via an exact count, well past the row cap
    h.state.priorTaken = 2500;
    h.state.priorPassed = 1000;
    h.state.currentMatters = 1500;
    h.state.priorMatters = 1200;

    const report = await fetchIntakeFunnel(FIRM);

    // delta = (current - prior) / prior, proving the prior head counts flow in
    expect(report.totalLeads.delta).toBeCloseTo((2 - 5000) / 5000, 6);
    expect(report.taken.delta).toBeCloseTo((2 - 2500) / 2500, 6);
    expect(report.passed.delta).toBeCloseTo((0 - 1000) / 1000, 6);
    expect(report.mattersCreated.value).toBe(1500);
    expect(report.mattersCreated.delta).toBeCloseTo((1500 - 1200) / 1200, 6);
  });

  it("suppresses deltas when the prior window is empty", async () => {
    h.state.leadPages = [[lead()]];
    h.state.matterPages = [[]];
    // all prior counts 0
    const report = await fetchIntakeFunnel(FIRM);
    expect(report.totalLeads.delta).toBeNull();
    expect(report.mattersCreated.delta).toBeNull();
  });
});
