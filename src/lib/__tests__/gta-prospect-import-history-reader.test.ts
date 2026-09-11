import { describe, expect, it } from "vitest";

import { listGtaProspectImportHistoryForOperator } from "../gta-prospect-import-history-reader";

const row = {
  source_name: "gta-operator-upload",
  source_sha256: "a".repeat(64),
  source_record_count: 20,
  state: "applied",
  applied_at: "2026-09-11T20:00:00+00",
  created_at: "2026-09-11T19:59:00+00",
};

describe("GTA prospect operator import-history reader", () => {
  it("accepts the narrow service-only batch metadata projection", async () => {
    const history = await listGtaProspectImportHistoryForOperator({ rpc: async (name) => {
      expect(name).toBe("list_gta_prospect_import_history_for_operator");
      return { data: [row], error: null };
    } });
    expect(history).toEqual([{
      sourceName: row.source_name,
      sourceSha256: row.source_sha256,
      sourceRecordCount: row.source_record_count,
      state: "applied",
      appliedAt: row.applied_at,
      createdAt: row.created_at,
    }]);
  });

  it("rejects raw-record columns and contradictory batch state", async () => {
    await expect(listGtaProspectImportHistoryForOperator({ rpc: async () => ({
      data: [{ ...row, canonical_record: {} }], error: null,
    }) })).rejects.toThrow("unexpected column");
    await expect(listGtaProspectImportHistoryForOperator({ rpc: async () => ({
      data: [{ ...row, state: "failed" }], error: null,
    }) })).rejects.toThrow("state and applied_at disagree");
  });
});
