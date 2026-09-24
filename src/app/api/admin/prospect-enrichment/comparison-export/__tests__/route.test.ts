import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildProspectEnrichmentClientItems } from "@/lib/prospect-enrichment-contract";
import { createProspectEnrichmentFixtures, prospectEnrichmentFixtureUuid } from "@/lib/__fixtures__/prospect-enrichment-v1";
import { prospectEnrichmentProtocolHash } from "@/lib/prospect-enrichment-hash";

const state = vi.hoisted(() => ({
  session: null as null | { role: string; firm_id: string; lawyer_id: string; exp: number },
  sameOrigin: true,
  from: vi.fn(),
}));
vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: vi.fn(async () => state.session) }));
vi.mock("@/lib/client-import-server", () => ({ validateSameOrigin: vi.fn(() => state.sameOrigin) }));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { from: state.from } }));

import { POST } from "../route";
import { readIdentity } from "../../_comparison-identity";

const id = "00000000-0000-4000-8000-000000000001";
function request(body: unknown) {
  return new NextRequest("http://127.0.0.1:3100/api/admin/prospect-enrichment/comparison-export", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:3100" }, body: JSON.stringify(body),
  });
}
function comparisonRequest(sourceNameOverride?: string) {
  const original = createProspectEnrichmentFixtures()[0].envelope;
  const envelope = { ...original, ...(sourceNameOverride ? { sourceName: sourceNameOverride } : {}) };
  const payloadSha256 = prospectEnrichmentProtocolHash(envelope);
  const clientItems = buildProspectEnrichmentClientItems(envelope).map((item) => ({ clientItemId: item.clientItemId, itemKind: item.itemKind, sourceEventKey: item.sourceEventKey, semanticSha256: item.semanticSha256 }));
  const entry = { entryId: "entry-synthetic", researchKey: envelope.subject.researchKey, clientPackageId: envelope.packageId, expectedPayloadSha256: payloadSha256, itemCount: clientItems.length, clientItems };
  const content = { schemaVersion: "prospect-enrichment-run-manifest/v1", runId: envelope.runId, sourceSystem: envelope.sourceSystem, sourceName: original.sourceName, sourceManifestSha256: "a".repeat(64), generatedAt: envelope.generatedAt, expectedPackageCount: 1, entries: [entry] };
  return { schemaVersion: "prospect-enrichment-comparison-request/v1", manifest: { ...content, manifestSha256: prospectEnrichmentProtocolHash(content) }, packages: [{ envelope, payloadSha256, legacyAssessmentProjectionClaims: [] }] };
}
beforeEach(() => { vi.clearAllMocks(); state.sameOrigin = true; state.session = { role: "operator", firm_id: id, lawyer_id: id, exp: 2_000_000_000 }; });

describe("comparison identity read", () => {
  it("passes the RPC data and error envelope to the database row validator", async () => {
    const envelope = createProspectEnrichmentFixtures()[0].envelope;
    const firmId = prospectEnrichmentFixtureUuid(991);
    const mapQuery = { select: vi.fn(), eq: vi.fn(), limit: vi.fn(async () => ({ data: [{ firm_id: firmId, mapping_status: "confirmed" }], error: null })) };
    mapQuery.select.mockReturnValue(mapQuery);
    mapQuery.eq.mockReturnValue(mapQuery);
    const client = {
      rpc: vi.fn(async () => ({ data: [{ firm_id: firmId, source_record_key: envelope.subject.sourceRecordKey, stable_firm_id: null, canonical_domain: null, enrichment_revision: 0 }], error: null })),
      from: vi.fn(() => mapQuery),
    } as never;

    await expect(readIdentity([envelope], client)).resolves.toEqual([{
      researchKey: envelope.subject.researchKey,
      databaseFirmId: firmId,
      stableFirmId: null,
      sourceRecordKey: envelope.subject.sourceRecordKey,
      canonicalDomain: null,
    }]);
  });
});
describe("protected comparison export route", () => {
  it("requires an operator session before parsing or reading private research", async () => {
    state.session = null;
    const response = await POST(request({ invalid: true }));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(state.from).not.toHaveBeenCalled();
  });
  it("requires the same-origin guard and operator role", async () => {
    state.sameOrigin = false;
    expect((await POST(request({ invalid: true }))).status).toBe(403);
    state.sameOrigin = true; state.session!.role = "lawyer";
    expect((await POST(request({ invalid: true }))).status).toBe(403);
    expect(state.from).not.toHaveBeenCalled();
  });
  it("rejects malformed requests without querying the database", async () => {
    const response = await POST(request({ schemaVersion: "wrong", manifest: {}, packages: [] }));
    expect(response.status).toBe(422);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(state.from).not.toHaveBeenCalled();
  });
  it("rejects a package whose source name differs from the frozen run before database access", async () => {
    const response = await POST(request(comparisonRequest("different-inventory")));
    expect(response.status).toBe(422);
    expect(state.from).not.toHaveBeenCalled();
  });
});
