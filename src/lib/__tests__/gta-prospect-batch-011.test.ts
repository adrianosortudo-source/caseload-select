import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  isResearchCountInTargetBand,
  reconcileBatch011RecordWithBaseline,
  validateGtaProspectBatch011Document,
  type GtaProspectBatch011Document,
} from "../gta-prospect-batch-011";
import { normalizeProspectStreetAddress } from "../gta-prospect-baseline-reconciliation";

function lane(path: string): GtaProspectBatch011Document {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8")) as GtaProspectBatch011Document;
}

const toronto = lane("docs/research/gta-prospect-batch-011/lanes/toronto-core.json");
const westNorth = lane("docs/research/gta-prospect-batch-011/lanes/west-north.json");

describe("GTA prospect batch 011 research artifacts", () => {
  it("uses the versioned schema and preserves research-only gates", () => {
    expect(() => validateGtaProspectBatch011Document(toronto)).not.toThrow();
    expect(() => validateGtaProspectBatch011Document(westNorth)).not.toThrow();
    for (const record of [...toronto.records, ...westNorth.records]) {
      expect(record.accepted).toBe(false);
      expect(record.import_ready).toBe(false);
      expect(record.access.scope).toBe("public_first_party_read_only");
      expect(record.evidence.map((evidence) => evidence.kind)).toEqual(expect.arrayContaining(["roster", "office"]));
    }
  });

  it("holds the four cross-lane duplicates with their provenance instead of silently selecting a survivor", () => {
    const held = westNorth.records.filter((record) => record.reconciliation.state === "held_cross_lane_duplicate");
    expect(held.map((record) => record.canonical_domain).sort()).toEqual([
      "blacksutherland.com", "loopstranixon.com", "mccagueborlack.com", "millerthomson.com",
    ]);
    expect(held).toHaveLength(4);
    for (const record of held) {
      expect(record.reconciliation.provenance.some((entry) => entry.startsWith("cross_lane_counterpart="))).toBe(true);
      expect(record.accepted).toBe(false);
    }
  });

  it("keeps duplicate-domain validation strict outside the documented held duplicates", () => {
    const duplicate = { ...toronto.records[0], record_id: "B011-T-duplicate" };
    expect(() => validateGtaProspectBatch011Document({ ...toronto, records: [...toronto.records, duplicate] })).toThrow("Unclassified duplicate domain");
  });

  it("uses the shared baseline guard for fixture collisions without an automatic merge", () => {
    const record = toronto.records.find((item) => item.record_id === "B011-T-01");
    expect(record).toBeDefined();
    const review = reconcileBatch011RecordWithBaseline(record!, [{
      origin: "fixture", recordId: "fixture:black-sutherland", firmName: "Black Sutherland", canonicalDomain: "blacksutherland.com", city: "Toronto",
    }]);
    expect(review).toMatchObject({ state: "review_required", automaticMerge: false });
    expect(review.matches[0]).toMatchObject({ origin: "fixture", recordId: "fixture:black-sutherland" });
  });

  it("keeps suite identity distinct and does not store street addresses in batch evidence", () => {
    expect(normalizeProspectStreetAddress("200-342 Queen St W")).not.toBe(normalizeProspectStreetAddress("100-342 Queen Street West"));
    for (const record of [...toronto.records, ...westNorth.records]) {
      expect(JSON.stringify(record)).not.toMatch(/(?:suite|unit)\\s+\\d+/i);
    }
  });

  it("enforces count qualifiers without treating lower bounds as a capped size conclusion", () => {
    expect(isResearchCountInTargetBand({ observed_lawyer_count: 3, count_qualifier: "exact" })).toBe(true);
    expect(isResearchCountInTargetBand({ observed_lawyer_count: 20, count_qualifier: "at_least" })).toBe(true);
    expect(isResearchCountInTargetBand({ observed_lawyer_count: 21, count_qualifier: "at_least" })).toBe(false);
    expect(isResearchCountInTargetBand({ observed_lawyer_count: null, count_qualifier: "unknown" })).toBe(false);
  });

  it("retains source provenance while excluding public contact details", () => {
    for (const record of [...toronto.records, ...westNorth.records]) {
      expect(record.public_contact_provenance).toMatchObject({ status: "not_collected" });
      expect(JSON.stringify(record)).not.toMatch(/\b(?:email|phone|tel)\b/i);
      expect(JSON.stringify(record)).not.toContain("@");
    }
  });
});
