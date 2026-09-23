import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  GtaProspectSupplementalEvidenceLedgerUnavailableError,
  listGtaProspectSupplementalEvidenceForOperator,
} from "@/lib/gta-prospect-supplemental-evidence-reader";

const row = {
  source_record_key: "gta-prospect-002-b002-11",
  firm_id: "FIRM-1C2XS2MW3NTR644JE1T3XVHFX2",
  canonical_domain: "example.test",
  identity_match_state: "confirmed",
  identity_observed_on: "2026-09-12",
  identity_confidence: "high",
  website_intake_channels: ["phone", "contact_form"],
  website_opportunity_state: "supported",
  website_observed_on: "2026-09-12",
  qualification_state: "qualified",
  qualification_cohort: "downtown_toronto_one_to_ten",
  qualification_assessed_on: "2026-09-12",
  qualification_criteria: { lawyerCount: true, downtownGeometry: true, sharedIdentity: true },
};

describe("GTA prospect supplemental evidence reader", () => {
  it("keeps rich qualification evidence alongside legacy rows without losing sources or missing gates", async () => {
    const richCriteria = {
      office: { city: "Toronto", sourceUrl: "https://example.test/contact", observedOn: "2026-09-23" },
      lawyerCount: 6,
      missingGates: ["independence", "recent-ad-verification"],
      advertisingStatus: "pixels-detected",
      directPublishedEmail: { name: "Example Principal", email: "principal@example.test", sourceUrl: "https://example.test/team", deliverability: null },
      gbpEvidence: false,
      researchFailures: [{ url: "https://example.test/roster", status: 403 }],
    };
    const richRow = { ...row, source_record_key: "q50-example-firm", qualification_state: "needs_evidence", qualification_cohort: "ontario_fifty", qualification_criteria: richCriteria };
    const result = await listGtaProspectSupplementalEvidenceForOperator({ rpc: async () => ({ data: [row, richRow], error: null }) });
    expect(result).toHaveLength(2);
    expect(result[0].qualification?.criteria).toEqual(row.qualification_criteria);
    expect(result[1].qualification?.state).toBe("needs_evidence");
    expect(result[1].qualification?.criteria).toEqual(richCriteria);
    // Own the returned snapshot, so later mutation of the RPC payload cannot
    // change evidence that callers have already received.
    richCriteria.office.city = "Changed";
    richCriteria.missingGates.push("new-gate");
    expect(result[1].qualification?.criteria.office).toEqual({ city: "Toronto", sourceUrl: "https://example.test/contact", observedOn: "2026-09-23" });
    expect(result[1].qualification?.criteria.missingGates).toEqual(["independence", "recent-ad-verification"]);
  });

  it.each([null, [], { nested: undefined }, { nested: NaN }, { nested: Infinity }, { nested: new Date() }, { nested: () => true }])("rejects non-JSON criteria: %j", async (invalidCriteria) => {
    await expect(listGtaProspectSupplementalEvidenceForOperator({ rpc: async () => ({ data: [{ ...row, qualification_criteria: invalidCriteria }], error: null }) }))
      .rejects.toThrow("qualification_criteria is invalid");
  });

  it("rejects cyclic evidence", async () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    await expect(listGtaProspectSupplementalEvidenceForOperator({ rpc: async () => ({ data: [{ ...row, qualification_criteria: cycle }], error: null }) }))
      .rejects.toThrow("qualification_criteria is invalid");
  });

  it("retains all 39 boolean and rich supplemental research records", async () => {
    const syntheticRows = Array.from({ length: 39 }, (_, index) => ({
      ...row,
      source_record_key: `fixture-${String(index + 1).padStart(2, "0")}`,
      qualification_state: index < 5 ? "qualified" : "needs_evidence",
      qualification_criteria: index < 5
        ? { gbpEvidence: index % 2 === 0, roster: true }
        : { status: "needs_evidence", observedLawyers: index + 1, missingGates: ["owner_role"], evidence: { sourceUrl: "https://fixture.example.test/team" } },
    }));
    const result = await listGtaProspectSupplementalEvidenceForOperator({ rpc: async () => ({ data: syntheticRows, error: null }) });
    expect(result).toHaveLength(39);
    expect(result.map((record) => record.qualification?.criteria)).toEqual(syntheticRows.map((item) => item.qualification_criteria));
  });

  it.each([
    ["depth above 12", (() => { let nested: unknown = "value"; for (let depth = 0; depth < 13; depth += 1) nested = { child: nested }; return nested; })()],
    ["serialized criteria above 256 KiB", { value: "x".repeat(256 * 1024) }],
    ["prototype key", JSON.parse('{"__proto__":{"polluted":true}}')],
    ["constructor key", JSON.parse('{"constructor":{"prototype":{"polluted":true}}}')],
  ])("rejects unsafe or oversized criteria: %s", async (_label, invalidCriteria) => {
    await expect(listGtaProspectSupplementalEvidenceForOperator({ rpc: async () => ({ data: [{ ...row, qualification_criteria: invalidCriteria }], error: null }) }))
      .rejects.toThrow("qualification_criteria is invalid");
  });

  it("returns only the narrow applied-evidence summary", async () => {
    const result = await listGtaProspectSupplementalEvidenceForOperator({ rpc: async () => ({ data: [row], error: null }) });
    expect(result).toEqual([{
      sourceRecordKey: "gta-prospect-002-b002-11",
      firmId: "FIRM-1C2XS2MW3NTR644JE1T3XVHFX2",
      canonicalDomain: "example.test",
      identity: { matchState: "confirmed", observedOn: "2026-09-12", confidence: "high" },
      websiteIntake: { channels: ["phone", "contact_form"], opportunityState: "supported", observedOn: "2026-09-12" },
      qualification: { state: "qualified", cohort: "downtown_toronto_one_to_ten", assessedOn: "2026-09-12", criteria: { lawyerCount: true, downtownGeometry: true, sharedIdentity: true } },
    }]);
  });

  it("treats a missing read projection as a safe unavailable state", async () => {
    await expect(listGtaProspectSupplementalEvidenceForOperator({ rpc: async () => ({ data: null, error: { code: "PGRST202", message: "missing" } }) }))
      .rejects.toBeInstanceOf(GtaProspectSupplementalEvidenceLedgerUnavailableError);
  });

  it("refuses a confirmed identity without its stable firm ID", async () => {
    const invalid = { ...row, firm_id: null };
    await expect(listGtaProspectSupplementalEvidenceForOperator({ rpc: async () => ({ data: [invalid], error: null }) }))
      .rejects.toThrow("confirmed identity has no stable firm_id");
  });

  it.each([12, 13])("enforces the exact criteria depth boundary for objects: %i", async (depth) => {
    let nested: unknown = "retained";
    for (let index = 1; index < depth; index++) nested = { next: nested };
    const qualification_criteria = { nested };
    const reading = listGtaProspectSupplementalEvidenceForOperator({ rpc: async () => ({ data: [{ ...row, qualification_criteria }], error: null }) });
    if (depth === 12) expect((await reading)[0].qualification?.criteria).toEqual(qualification_criteria);
    else await expect(reading).rejects.toThrow("qualification_criteria exceeds maximum depth 12");
  });

  it.each([12, 13])("counts array elements toward the same depth boundary: %i", async (depth) => {
    let nested: unknown = "retained";
    for (let index = 1; index < depth; index++) nested = [nested];
    const qualification_criteria = { nested };
    const reading = listGtaProspectSupplementalEvidenceForOperator({ rpc: async () => ({ data: [{ ...row, qualification_criteria }], error: null }) });
    if (depth === 12) expect((await reading)[0].qualification?.criteria).toEqual(qualification_criteria);
    else await expect(reading).rejects.toThrow("qualification_criteria exceeds maximum depth 12");
  });

  it.each([262143, 262144, 262145])("enforces the exact serialized UTF-8 byte boundary: %i", async (bytes) => {
    const available = bytes - Buffer.byteLength(JSON.stringify({ note: "" }), "utf8");
    const qualification_criteria = { note: "é".repeat(Math.floor(available / 2)) + "x".repeat(available % 2) };
    expect(Buffer.byteLength(JSON.stringify(qualification_criteria), "utf8")).toBe(bytes);
    const reading = listGtaProspectSupplementalEvidenceForOperator({ rpc: async () => ({ data: [{ ...row, qualification_criteria }], error: null }) });
    if (bytes <= 262144) expect((await reading)[0].qualification?.criteria).toEqual(qualification_criteria);
    else await expect(reading).rejects.toThrow("qualification_criteria exceeds 256 KiB");
  });

  it("counts JSON escaping rather than the unescaped text bytes", async () => {
    const qualification_criteria = { note: "\n".repeat(131067) };
    expect(Buffer.byteLength(qualification_criteria.note, "utf8")).toBeLessThan(262144);
    expect(Buffer.byteLength(JSON.stringify(qualification_criteria), "utf8")).toBeGreaterThan(262144);
    await expect(listGtaProspectSupplementalEvidenceForOperator({ rpc: async () => ({ data: [{ ...row, qualification_criteria }], error: null }) }))
      .rejects.toThrow("qualification_criteria exceeds 256 KiB");
  });

  it.each([new Date("2026-09-24"), new Map(), Object.create({ inherited: true })])("still rejects non-plain criteria roots", async (qualification_criteria) => {
    await expect(listGtaProspectSupplementalEvidenceForOperator({ rpc: async () => ({ data: [{ ...row, qualification_criteria }], error: null }) }))
      .rejects.toThrow("qualification_criteria is invalid");
  });

});
