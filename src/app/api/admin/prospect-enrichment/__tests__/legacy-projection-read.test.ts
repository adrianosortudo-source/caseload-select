import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadDatabase } from "../_package-read";
import { prospectEnrichmentProtocolHash as hash } from "@/lib/prospect-enrichment-hash";
import { createProspectEnrichmentFixtures, prospectEnrichmentFixtureUuid as uuid } from "@/lib/__fixtures__/prospect-enrichment-v1";
const state = vi.hoisted(() => ({ derive: vi.fn(), history: vi.fn() }));
vi.mock("../../../../../../scripts/prospect-enrichment/legacy-projection-mapper", () => ({ deriveLegacyAssessmentProjection: state.derive }));
vi.mock("@/lib/prospect-enrichment-reader", () => ({ getProspectEnrichmentFirmHistory: state.history }));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: {} }));
import { readProspectLegacyAssessmentProjectionProof } from "../_legacy-projection-read";
const firmId = uuid(8), parentId = uuid(801), batchId = uuid(899);
let tables: Record<string, Record<string, unknown>[]>;
function client(): ReadDatabase { return { from(table: string) { let rows = [...(tables[table] ?? [])]; const query = { select() { return query; }, eq(key: string, value: unknown) { rows = rows.filter((row) => row[key] === value); return query; }, limit(limit: number) { return Promise.resolve({ data: rows.slice(0, limit), error: null }); } }; return query; } } as unknown as ReadDatabase; }
function input() { return { envelope: createProspectEnrichmentFixtures()[7].envelope, claim: {} as never, parentAssessmentTarget: { table: "gta_prospect_qualification_assessments" as const, id: parentId, rowSha256: hash(tables.gta_prospect_qualification_assessments[0]) }, firmId, client: client() }; }
beforeEach(() => {
  tables = { gta_prospect_qualification_assessments: [{ id: parentId, firm_id: firmId, evidence_import_batch_id: batchId, criteria: { ownerVerified: false, unknown: null } }], gta_prospect_supplemental_evidence_import_batches: [{ id: batchId, state: "applied" }], gta_prospect_firms: [{ id: firmId, enrichment_revision: "7" }] };
  state.derive.mockReset().mockReturnValue({ observationSourceEventKey: "observation:" + "a".repeat(64), observationSemanticSha256: "b".repeat(64), parentAssessmentClientId: "assessment:synthetic-8", criteriaSelector: "/criteria/ownerVerified", selectedValueSha256: hash(false) });
  state.history.mockReset().mockResolvedValue({ table: "gta_prospect_qualification_assessments", revision: "7", revisionStable: true, items: [{ id: parentId, table: "gta_prospect_qualification_assessments", data: tables.gta_prospect_qualification_assessments[0] }], nextCursor: null });
});
describe("independent legacy projection read proof", () => {
  it("requires a deterministic mapper result, exact row/value hashes and same-firm accepted visibility", async () => {
    const result = await readProspectLegacyAssessmentProjectionProof(input());
    expect(result).toMatchObject({ databaseFirmId: firmId, parentAssessmentTarget: { id: parentId }, selectedValueSha256: hash(false) });
    expect(state.derive).toHaveBeenCalledWith(input().envelope, {}, { ownerVerified: false, unknown: null });
  });
  it.each(["mapper", "rowHash", "wrongFirm", "stagedBatch", "missingTarget", "projectionMismatch", "revisionChanged", "valueHash", "unsafeSelector"])("omits proof on %s instead of asserting preservation", async (failure) => {
    const request = input();
    if (failure === "mapper") state.derive.mockReturnValue(null);
    if (failure === "rowHash") request.parentAssessmentTarget.rowSha256 = "0".repeat(64);
    if (failure === "wrongFirm") request.firmId = uuid(9);
    if (failure === "stagedBatch") tables.gta_prospect_supplemental_evidence_import_batches[0].state = "staged";
    if (failure === "missingTarget") state.history.mockResolvedValue({ revision: "7", revisionStable: true, items: [], nextCursor: null });
    if (failure === "projectionMismatch") state.history.mockResolvedValue({ revision: "7", revisionStable: true, items: [{ id: parentId, table: "gta_prospect_qualification_assessments", data: { criteria: { ownerVerified: true } } }], nextCursor: null });
    if (failure === "revisionChanged") tables.gta_prospect_firms[0].enrichment_revision = "8";
    if (failure === "valueHash") state.derive.mockReturnValue({ ...state.derive(), selectedValueSha256: hash(true) });
    if (failure === "unsafeSelector") state.derive.mockReturnValue({ ...state.derive(), criteriaSelector: "/criteria/__proto__/ownerVerified" });
    expect(await readProspectLegacyAssessmentProjectionProof(request)).toBeNull();
  });
  it("exhausts empty filtered pages before claiming complete visibility", async () => {
    const final = await state.history(); state.history.mockReset().mockResolvedValueOnce({ revision: "7", revisionStable: true, items: [], nextCursor: "page-two" }).mockResolvedValueOnce(final);
    expect(await readProspectLegacyAssessmentProjectionProof(input())).not.toBeNull(); expect(state.history).toHaveBeenCalledTimes(2);
  });
});
