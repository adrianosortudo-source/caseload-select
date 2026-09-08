import { describe, expect, it } from "vitest";
import { reconciledProspectSourceLabel } from "../reconciled-prospects-source";

describe("reconciled prospect source label", () => {
  it("makes mixed ledger and fixture provenance explicit", () => {
    expect(reconciledProspectSourceLabel({
      source: "hybrid",
      sourceCounts: { ledger: 103, fixture: 20 },
    })).toBe("governed research ledger (103 records) + reviewed fixture additions (20 records)");
  });

  it("distinguishes an empty ledger from an unavailable projection", () => {
    expect(reconciledProspectSourceLabel({
      source: "fixture",
      sourceCounts: { ledger: 0, fixture: 20 },
      fallbackReason: "ledger_empty",
    })).toContain("ledger has no records");
    expect(reconciledProspectSourceLabel({
      source: "fixture",
      sourceCounts: { ledger: 0, fixture: 20 },
      fallbackReason: "ledger_unavailable",
    })).toContain("ledger unavailable");
  });
});
