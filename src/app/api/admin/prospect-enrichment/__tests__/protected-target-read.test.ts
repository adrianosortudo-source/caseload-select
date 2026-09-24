import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/client-import-server", () => ({ validateSameOrigin: vi.fn(() => true) }));
import { prospectEnrichmentProtocolHash } from "@/lib/prospect-enrichment-hash";
import { readProtectedGtaTargetRows } from "../_protected-target-read";

const firmId = "00000000-0000-4000-8000-000000000001";
const rowId = "00000000-0000-4000-8000-000000000002";
const row = { id: rowId, firm_id: firmId, criteria: { score: 3 }, evidence_import_batch_id: null };
function client(data: unknown, error: unknown = null) {
  const rpc = vi.fn(async () => ({ data, error }));
  return { rpc };
}

describe("protected GTA target-row reader", () => {
  it("uses the fixed bounded RPC and verifies full-row SQL and JavaScript hashes", async () => {
    const db = client([{ row_json: row, row_sha256: prospectEnrichmentProtocolHash(row) }]);
    await expect(readProtectedGtaTargetRows({ client: db as never, firmId, table: "gta_prospect_qualification_assessments", ids: [rowId] })).resolves.toEqual([row]);
    expect(db.rpc).toHaveBeenCalledWith("read_prospect_enrichment_gta_target_rows_v1", {
      p_firm_id: firmId, p_table: "gta_prospect_qualification_assessments", p_ids: [rowId],
    });
  });

  it("rejects incomplete, cross-firm, duplicate, and hash-mismatched rows", async () => {
    await expect(readProtectedGtaTargetRows({ client: client([]) as never, firmId, table: "gta_prospect_qualification_assessments", ids: [rowId] })).rejects.toThrow();
    await expect(readProtectedGtaTargetRows({ client: client([{ row_json: { ...row, firm_id: rowId }, row_sha256: prospectEnrichmentProtocolHash({ ...row, firm_id: rowId }) }]) as never, firmId, table: "gta_prospect_qualification_assessments", ids: [rowId] })).rejects.toThrow();
    await expect(readProtectedGtaTargetRows({ client: client([{ row_json: row, row_sha256: "0".repeat(64) }]) as never, firmId, table: "gta_prospect_qualification_assessments", ids: [rowId] })).rejects.toThrow();
    const db = client([]);
    await expect(readProtectedGtaTargetRows({ client: db as never, firmId, table: "gta_prospect_qualification_assessments", ids: [rowId, rowId] })).rejects.toThrow();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("enforces the fixed table allowlist and 100-ID bound before calling SQL", async () => {
    const db = client([]);
    await expect(readProtectedGtaTargetRows({ client: db as never, firmId, table: "gta_prospect_import_batches", ids: [rowId] })).rejects.toThrow();
    await expect(readProtectedGtaTargetRows({ client: db as never, firmId, table: "gta_prospect_qualification_assessments", ids: Array.from({ length: 101 }, (_, index) => `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`) })).rejects.toThrow();
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
