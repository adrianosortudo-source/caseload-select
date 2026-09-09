import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeProspectStreetAddress } from "../gta-prospect-baseline-reconciliation";
import { deriveGtaProspectBatch012Summary, validateGtaProspectBatch012Document, type GtaProspectBatch012Document } from "../gta-prospect-batch-012";

const load = (name: string): GtaProspectBatch012Document => JSON.parse(readFileSync(resolve(process.cwd(), `docs/research/gta-prospect-batch-012/lanes/${name}.json`), "utf8")) as GtaProspectBatch012Document;
const west = load("west-north");
const east = load("east-outer");

describe("GTA prospect Batch 012", () => {
  it("validates the research-only lanes", () => {
    expect(() => validateGtaProspectBatch012Document(west)).not.toThrow();
    expect(() => validateGtaProspectBatch012Document(east)).not.toThrow();
    for (const record of [...west.records, ...east.records]) {
      expect(record).toMatchObject({ accepted: false, import_ready: false });
      expect(record.reconciliation).toMatchObject({ automatic_merge: false, static_baseline_count: 6025, live_ledger_state: "offline_pending" });
    }
  });

  it("derives the combined totals", () => {
    expect(deriveGtaProspectBatch012Summary([west, east])).toMatchObject({ raw_record_count: 32, distinct_canonical_domains: 32, source_queue_count: 10, held_count: 22, static_clear_count: 17, static_review_required_count: 15, accepted_count: 0, import_ready_count: 0, automatic_merge_count: 0 });
  });

  it("preserves suite identity and explicit contact provenance", () => {
    expect(normalizeProspectStreetAddress("200-342 Queen St W")).not.toBe(normalizeProspectStreetAddress("100-342 Queen Street West"));
    expect(normalizeProspectStreetAddress("Suite 204, 3100 Rutherford Road")).toBe(normalizeProspectStreetAddress("3100 Rutherford Road suite 204"));
    expect(west.records.find((record) => record.record_id === "B012-WN-02")?.leadership[0]).toMatchObject({ name: "Ida Morra-Caruso", relationship: "owner" });
    expect(east.records.find((record) => record.record_id === "B012-EAST-01")?.public_emails[0]).toMatchObject({ email: "operations@kelinylaw.ca", label: "general firm email" });
  });
});
