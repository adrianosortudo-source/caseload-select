import { describe, expect, it, vi } from "vitest";

import { buildGtaProspectEvidenceImportPlan } from "../gta-prospect-evidence-import";

vi.mock("server-only", () => ({}));

import { applyGtaProspectOperatorEvidenceImport } from "../gta-prospect-operator-evidence-import";

const sourceKey = "gta-prospect-002-b002-11";
const firmId = "FIRM-1C2XS2MW3NTR644JE1T3XVHFX2";
const plan41Url = "https://gis.toronto.ca/arcgis/rest/services/cot_geospatial11/MapServer/44/query?f=geojson";

function packageRecord(overrides: Record<string, unknown> = {}) {
  return {
    packageType: "caseload-select.prospect-evidence",
    packageVersion: 1,
    packageId: "downtown-batch-2026-09-12",
    generatedAt: "2026-09-12T14:00:00.000Z",
    controls: { contactFormsSubmitted: false, chatSessionsStarted: false, outreachSent: false },
    evidence: [
      { evidenceId: "first-party-team", sourceUrl: "https://example.test/team", observedOn: "2026-09-12", sourceKind: "first_party", note: null },
      { evidenceId: "plan-41", sourceUrl: plan41Url, observedOn: "2026-09-12", sourceKind: "official_geospatial", note: null },
    ],
    identityMappings: [{
      sourceRecordKey: sourceKey, mappingId: "identity-baker-2026-09-12", matchState: "confirmed", firmId,
      candidateFirmIds: [], distinctFromFirmIds: [], canonicalDomain: "example.test", firmName: "Example Law",
      confidence: "high", observedOn: "2026-09-12", reason: "First-party canonical domain matches the governed firm.", evidenceIds: ["first-party-team"],
    }],
    downtownGeography: [{
      observationId: "geo-baker-2026-09-12", evidenceIds: ["plan-41"], geography: {
        sourceRecordKey: sourceKey, boundaryId: "toronto-downtown-secondary-plan-41", status: "inside", normalizedAddress: "1 Example Street, Toronto, ON",
        latitude: 43.65, longitude: -79.38, coordinateSourceType: "reviewed_geocoder", coordinateSourceUrl: "https://example.test/address",
        boundarySourceUrl: plan41Url, boundaryGeometrySha256: "a".repeat(64), observedOn: "2026-09-12", confidence: "high", note: null,
      },
    }],
    websiteIntakeFindings: [{
      sourceRecordKey: sourceKey, observationId: "intake-baker-2026-09-12", websiteUrl: "https://example.test", observedOn: "2026-09-12",
      visibleIntakeChannels: ["phone", "contact_form"], opportunityState: "supported", opportunityReason: "The visible contact form lacks a stated response expectation.", note: null,
      evidenceIds: ["first-party-team"],
    }],
    qualificationAssessments: [{
      sourceRecordKey: sourceKey, assessmentId: "qualification-baker-2026-09-12", assessedOn: "2026-09-12", state: "qualified",
      criteria: { rosterWithinOneToTen: true, downtownPlan41: true, sharedFirmIdentity: true, ownerDirectEmail: true, observableAdvertisingActivity: true, gbpOpportunity: true, websiteIntake: true },
      rationale: "Every required evidence-bearing criterion has been reviewed.", evidenceIds: ["first-party-team", "plan-41"],
    }],
    ...overrides,
  };
}

describe("GTA prospect supplemental evidence package", () => {
  it("accepts a strict, evidence-bearing package and produces a deterministic payload hash", async () => {
    const appliedSourceRecordKeys = new Set([sourceKey]);
    const first = await buildGtaProspectEvidenceImportPlan(packageRecord(), { appliedSourceRecordKeys });
    const second = await buildGtaProspectEvidenceImportPlan(packageRecord(), { appliedSourceRecordKeys });
    expect(first.rejected).toEqual([]);
    expect(first.accepted).toEqual(expect.objectContaining({ packageId: "downtown-batch-2026-09-12" }));
    expect(first.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.payloadSha256).toBe(second.payloadSha256);
    expect(first.summary).toEqual({ evidence: 2, identityMappings: 1, downtownGeography: 1, websiteIntakeFindings: 1, qualificationAssessments: 1 });
  });

  it("fails closed on unknown fields, missing ledger keys, and any contact action", async () => {
    const result = await buildGtaProspectEvidenceImportPlan(packageRecord({
      controls: { contactFormsSubmitted: true, chatSessionsStarted: false, outreachSent: false },
      unsupportedField: "nope",
    }), { appliedSourceRecordKeys: new Set() });
    expect(result.accepted).toBeNull();
    expect(result.rejected.map((issue) => issue.message)).toEqual(expect.arrayContaining([
      "unrecognized fields are forbidden: unsupportedField",
      "must be false for a no-contact evidence package",
      "does not exist in the applied GTA prospect ledger",
    ]));
  });

  it("does not let a qualified assessment conceal an unsupported criterion", async () => {
    const result = await buildGtaProspectEvidenceImportPlan(packageRecord({
      qualificationAssessments: [{
        ...packageRecord().qualificationAssessments[0],
        criteria: { ...packageRecord().qualificationAssessments[0].criteria, observableAdvertisingActivity: false },
      }],
    }), { appliedSourceRecordKeys: new Set([sourceKey]) });
    expect(result.accepted).toBeNull();
    expect(result.rejected).toEqual(expect.arrayContaining([expect.objectContaining({ message: "qualified requires every evidence-bearing criterion to be true" })]));
  });

  it("uses the one service-only atomic RPC and accepts an exact replay", async () => {
    const plan = await buildGtaProspectEvidenceImportPlan(packageRecord(), { appliedSourceRecordKeys: new Set([sourceKey]) });
    const rpc = vi.fn(async () => ({ data: { state: "already_applied", batch_id: "00000000-0000-0000-0000-000000000001" }, error: null }));
    await expect(applyGtaProspectOperatorEvidenceImport({ plan, client: { rpc } })).resolves.toMatchObject({ state: "already_applied", packageId: "downtown-batch-2026-09-12" });
    expect(rpc).toHaveBeenCalledWith("begin_gta_prospect_supplemental_evidence_import", expect.objectContaining({ p_package_sha256: plan.payloadSha256 }));
  });
});
