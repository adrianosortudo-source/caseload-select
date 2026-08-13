/**
 * Unit coverage for the caseload_prospects erasure wrapper (DR-114).
 *
 * The anonymisation itself lives in Postgres and is covered by
 * caseload-prospect-erasure.integration.test.ts against a real database.
 * What is worth mocking here is the wrapper's own contract: which RPC
 * arguments each selector shape produces (getting these wrong would silently
 * anonymise the wrong rows, or none), and that a refusal from the function
 * is surfaced as a failure rather than reported as a successful erasure.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { rpc: mocks.rpc } }));

import {
  anonymizeCaseloadProspects,
  countProspectSelectors,
  isProspectAnonymizationReason,
  runProspectRetentionSweep,
  PROSPECT_RETENTION_DAYS,
} from "../caseload-prospect-erasure";

function ok(count: number, ids: string[] = []) {
  return { data: { ok: true, anonymized_count: count, prospect_ids: ids }, error: null };
}

beforeEach(() => {
  mocks.rpc.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("countProspectSelectors", () => {
  it("counts only non-empty string selectors", () => {
    expect(countProspectSelectors({})).toBe(0);
    expect(countProspectSelectors({ email: "" })).toBe(0);
    expect(countProspectSelectors({ prospectId: 123 })).toBe(0);
    expect(countProspectSelectors({ email: "a@b.ca" })).toBe(1);
    expect(countProspectSelectors({ prospectId: "id", before: "2020-01-01" })).toBe(2);
  });
});

describe("isProspectAnonymizationReason", () => {
  it("accepts the three registered reasons and nothing else", () => {
    expect(isProspectAnonymizationReason("subject_request")).toBe(true);
    expect(isProspectAnonymizationReason("retention_sweep")).toBe(true);
    expect(isProspectAnonymizationReason("internal_test_record")).toBe(true);
    expect(isProspectAnonymizationReason("because")).toBe(false);
    expect(isProspectAnonymizationReason(undefined)).toBe(false);
  });
});

describe("anonymizeCaseloadProspects", () => {
  it("sends exactly one selector and nulls the other two", async () => {
    mocks.rpc.mockResolvedValue(ok(1, ["p1"]));

    await anonymizeCaseloadProspects({ prospectId: "p1" }, "subject_request");
    expect(mocks.rpc).toHaveBeenCalledWith("anonymize_caseload_prospects", {
      p_prospect_id: "p1",
      p_email: null,
      p_before: null,
      p_reason: "subject_request",
    });

    await anonymizeCaseloadProspects({ email: "a@b.ca" }, "subject_request");
    expect(mocks.rpc).toHaveBeenLastCalledWith("anonymize_caseload_prospects", {
      p_prospect_id: null,
      p_email: "a@b.ca",
      p_before: null,
      p_reason: "subject_request",
    });

    await anonymizeCaseloadProspects({ before: "2024-01-01T00:00:00.000Z" }, "retention_sweep");
    expect(mocks.rpc).toHaveBeenLastCalledWith("anonymize_caseload_prospects", {
      p_prospect_id: null,
      p_email: null,
      p_before: "2024-01-01T00:00:00.000Z",
      p_reason: "retention_sweep",
    });
  });

  it("returns the count and ids on success", async () => {
    mocks.rpc.mockResolvedValue(ok(2, ["p1", "p2"]));
    const result = await anonymizeCaseloadProspects({ email: "a@b.ca" }, "subject_request");
    expect(result).toEqual({ ok: true, anonymized_count: 2, prospect_ids: ["p1", "p2"] });
  });

  it("reports a transport error as a failure, never as a completed erasure", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "connection reset" } });
    const result = await anonymizeCaseloadProspects({ prospectId: "p1" }, "subject_request");
    expect(result.ok).toBe(false);
    expect(result.anonymized_count).toBe(0);
    expect(result.error).toBe("connection reset");
  });

  it("reports the function's own refusal as a failure", async () => {
    mocks.rpc.mockResolvedValue({
      data: { ok: false, error: "exactly one of p_prospect_id, p_email, p_before must be supplied" },
      error: null,
    });
    const result = await anonymizeCaseloadProspects({ prospectId: "p1" }, "subject_request");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exactly one/);
  });
});

describe("runProspectRetentionSweep", () => {
  it("sweeps with a cutoff of PROSPECT_RETENTION_DAYS before now", async () => {
    mocks.rpc.mockResolvedValue(ok(0));
    const now = new Date("2026-08-08T00:00:00.000Z");

    await runProspectRetentionSweep(now);

    const args = mocks.rpc.mock.calls[0][1];
    expect(args.p_reason).toBe("retention_sweep");
    expect(args.p_prospect_id).toBeNull();
    expect(args.p_email).toBeNull();

    const expected = new Date(
      now.getTime() - PROSPECT_RETENTION_DAYS * 86_400_000,
    ).toISOString();
    expect(args.p_before).toBe(expected);
  });
});
