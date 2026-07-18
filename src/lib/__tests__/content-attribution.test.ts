/**
 * content-attribution.ts: I/O layer over content_attribution_evidence /
 * content_attribution_current. A minimal in-memory Postgrest mock proves
 * this module surfaces the database's own scope-validation errors rather
 * than swallowing or duplicating that logic (the database is the actual
 * enforcement; see
 * supabase/migrations/20260717030000_content_attribution_evidence.sql),
 * and that syncObservedEvidenceForLead is idempotent and deterministic.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;

const state: {
  evidence: Row[];
  leads: Row[];
  placements: Row[];
  nextError: string | null;
} = {
  evidence: [],
  leads: [],
  placements: [],
  nextError: null,
};

function chainable(rows: Row[]) {
  let current = rows;
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      current = current.filter((r) => r[col] === val);
      return builder;
    },
    gte: (col: string, val: unknown) => {
      current = current.filter((r) => (r[col] as string) >= (val as string));
      return builder;
    },
    lte: (col: string, val: unknown) => {
      current = current.filter((r) => (r[col] as string) <= (val as string));
      return builder;
    },
    order: () => builder,
    maybeSingle: () => Promise.resolve({ data: current[0] ?? null, error: null }),
    insert: (row: Row) => {
      if (state.nextError) {
        const err = state.nextError;
        state.nextError = null;
        return {
          select: () => ({
            single: () => Promise.resolve({ data: null, error: { message: err } }),
          }),
        };
      }
      const inserted = { id: `e-${state.evidence.length + 1}`, created_at: new Date(0).toISOString(), ...row };
      state.evidence.push(inserted);
      return {
        select: () => ({
          single: () => Promise.resolve({ data: inserted, error: null }),
        }),
      };
    },
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: current, error: null }),
  };
  return builder;
}

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "content_attribution_evidence") return chainable(state.evidence);
      if (table === "content_attribution_current") return chainable(state.evidence);
      if (table === "screened_leads") return chainable(state.leads);
      if (table === "content_placements") return chainable(state.placements);
      throw new Error(`unexpected table in mock: ${table}`);
    },
  },
}));

import {
  recordAttributionEvidence,
  listEvidenceForLead,
  syncObservedEvidenceForLead,
} from "@/lib/content-attribution";

const FIRM_ID = "f1111111-1111-1111-1111-111111111111";
const LEAD_ID = "l1111111-1111-1111-1111-111111111111";

beforeEach(() => {
  state.evidence = [];
  state.leads = [];
  state.placements = [];
  state.nextError = null;
});

describe("recordAttributionEvidence", () => {
  it("inserts an evidence row and returns it", async () => {
    const result = await recordAttributionEvidence({
      firmId: FIRM_ID,
      screenedLeadId: LEAD_ID,
      attributionState: "unknown",
      evidenceMethod: "insufficient_evidence",
      observedAt: "2026-07-01T00:00:00Z",
      recordedByRole: "system",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.firm_id).toBe(FIRM_ID);
    expect(result.evidence.attribution_state).toBe("unknown");
  });

  it("surfaces the database's own scope-validation error rather than swallowing it", async () => {
    state.nextError = "content attribution evidence must reference a screened lead from the same firm";
    const result = await recordAttributionEvidence({
      firmId: FIRM_ID,
      screenedLeadId: LEAD_ID,
      attributionState: "unknown",
      evidenceMethod: "insufficient_evidence",
      observedAt: "2026-07-01T00:00:00Z",
      recordedByRole: "system",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("same firm");
  });
});

describe("listEvidenceForLead", () => {
  it("returns only evidence for the requested firm and lead", async () => {
    await recordAttributionEvidence({
      firmId: FIRM_ID,
      screenedLeadId: LEAD_ID,
      attributionState: "unknown",
      evidenceMethod: "insufficient_evidence",
      observedAt: "2026-07-01T00:00:00Z",
      recordedByRole: "system",
    });
    await recordAttributionEvidence({
      firmId: "other-firm",
      screenedLeadId: "other-lead",
      attributionState: "unknown",
      evidenceMethod: "insufficient_evidence",
      observedAt: "2026-07-01T00:00:00Z",
      recordedByRole: "system",
    });
    const rows = await listEvidenceForLead(FIRM_ID, LEAD_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].screened_lead_id).toBe(LEAD_ID);
  });
});

describe("syncObservedEvidenceForLead", () => {
  it("returns an error when the lead is not found for this firm", async () => {
    const result = await syncObservedEvidenceForLead(FIRM_ID, LEAD_ID);
    expect(result.ok).toBe(false);
  });

  it("is a no-op when the lead has no UTM/referrer signal", async () => {
    state.leads = [
      {
        id: LEAD_ID,
        firm_id: FIRM_ID,
        utm_source: null,
        utm_medium: null,
        utm_campaign: null,
        utm_term: null,
        utm_content: null,
        referrer: null,
        submitted_at: "2026-07-01T00:00:00Z",
        created_at: "2026-07-01T00:00:00Z",
      },
    ];
    const result = await syncObservedEvidenceForLead(FIRM_ID, LEAD_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence).toBeNull();
  });

  it("normalizes UTM data into an evidence row on first sync", async () => {
    state.leads = [
      {
        id: LEAD_ID,
        firm_id: FIRM_ID,
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: null,
        utm_term: null,
        utm_content: null,
        referrer: null,
        submitted_at: "2026-07-01T00:00:00Z",
        created_at: "2026-07-01T00:00:00Z",
      },
    ];
    const result = await syncObservedEvidenceForLead(FIRM_ID, LEAD_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence?.evidence_method).toBe("verified_utm");
  });

  it("is idempotent: a second sync call does not insert a duplicate observed row", async () => {
    state.leads = [
      {
        id: LEAD_ID,
        firm_id: FIRM_ID,
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: null,
        utm_term: null,
        utm_content: null,
        referrer: null,
        submitted_at: "2026-07-01T00:00:00Z",
        created_at: "2026-07-01T00:00:00Z",
      },
    ];
    await syncObservedEvidenceForLead(FIRM_ID, LEAD_ID);
    const second = await syncObservedEvidenceForLead(FIRM_ID, LEAD_ID);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.evidence).toBeNull();
    expect(state.evidence).toHaveLength(1);
  });
});
