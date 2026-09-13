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
});
