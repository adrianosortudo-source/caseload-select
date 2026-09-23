import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ProspectEnrichmentEnvelope } from "@/lib/prospect-enrichment-contract";
import { buildProspectEnrichmentClientItems, parseProspectEnrichmentEnvelope } from "@/lib/prospect-enrichment-contract";
import { prospectEnrichmentProtocolHash as hash, prospectEnrichmentSha256 } from "@/lib/prospect-enrichment-hash";
const state = vi.hoisted(() => ({
  session: null as null | { role: string; firm_id: string; lawyer_id: string; exp: number },
  sameOrigin: true, packageDetail: vi.fn(), firmDetail: vi.fn(), firmHistory: vi.fn(), rpc: vi.fn(),
  tables: {} as Record<string, Record<string, unknown>[]>, dbError: false,
}));
vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: vi.fn(async () => state.session) }));
vi.mock("@/lib/client-import-server", () => ({ validateSameOrigin: vi.fn(() => state.sameOrigin) }));
vi.mock("../_package-read", () => ({ readPackageDetail: state.packageDetail }));
vi.mock("@/lib/prospect-enrichment-reader", async (original) => ({
  ...await original<typeof import("@/lib/prospect-enrichment-reader")>(), getProspectEnrichmentFirmDetail: state.firmDetail, getProspectEnrichmentFirmHistory: state.firmHistory,
}));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: {
  rpc: state.rpc,
  from: (table: string) => {
    let ids: string[] = [];
    const query = {
      select: () => query, in: (_column: string, values: string[]) => { ids = values; return query; },
      limit: async (limit: number) => ({ data: (state.tables[table] ?? []).filter((row) => ids.includes(String(row.id))).slice(0, limit), error: state.dbError ? { message: "private database failure" } : null }),
    };
    return query;
  },
} }));
import { POST } from "../packages/[packageId]/verify/route";
import { ReadApiError } from "../_read-common";

const id = "00000000-0000-4000-8000-000000000001";
const firmId = "00000000-0000-4000-8000-000000000002";
const sourceItemId = "00000000-0000-4000-8000-000000000003";
const observationItemId = "00000000-0000-4000-8000-000000000004";
const sourceEventId = "00000000-0000-4000-8000-000000000005";
const observationEventId = "00000000-0000-4000-8000-000000000006";
const targetId = "00000000-0000-4000-8000-000000000007";
const captureId = "00000000-0000-4000-8000-000000000008";
const source = {
  sourceId: "public-services", url: "https://example.example/services", requestedUrl: "https://example.example/services",
  finalUrl: "https://example.example/services", policyState: "public-source" as const,
  publicationLabel: null, publicationPrecision: "unknown" as const, publisher: "Synthetic Legal",
  observedAt: null, observedOn: "2026-09-23", retrievedAt: null, retrievalMethod: "public_html",
  retrievalOutcome: "success-positive", httpStatus: 200, bodySha256: "a".repeat(64), excerpt: "Family law services", missingProvenanceReason: null,
};
function setupFixture() {
  const content = { unknown: null, checked: false, excluded: [], candidate: "Synthetic Legal" };
  const payload: ProspectEnrichmentEnvelope = {
    schemaVersion: "prospect-enrichment/v1", runId: "synthetic-run", packageId: "synthetic-package", supersedesPackageId: null,
    sourceSystem: "synthetic-research", sourceName: "synthetic-research", generatedAt: "2026-09-23T12:00:00Z", mode: "propose",
    subject: { researchKey: "synthetic-legal", databaseFirmId: firmId, stableFirmId: null, sourceRecordKey: "synthetic-legal",
      canonicalDomain: "example.example", displayName: "Synthetic Legal", identityState: "resolved" },
    sources: [source], observations: [{ observationId: "service-family", evidenceState: "asserted", retractionReason: null,
      retractionSourceIds: [], missingProvenanceReason: null, kind: "service", observedAt: null, observedOn: "2026-09-23",
      sourceIds: [source.sourceId], data: { name: "Family law", matterFit: "strong-match" }, existingRecord: null }],
    assessment: null, originalResearch: { sourcePath: "synthetic/firm.json", sourcePointer: "/firm", sourceSha256: "b".repeat(64),
      contentSha256: hash(content), content, unmappedPaths: ["/checked", "/excluded", "/unknown"] },
    controls: { contactFormsSubmitted: false, chatSessionsStarted: false, outreachSent: false },
  };
  expect(parseProspectEnrichmentEnvelope(payload).ok).toBe(true);
  const lineage = buildProspectEnrichmentClientItems(payload);
  const items = [
    { itemId: sourceItemId, clientItemId: lineage[0].clientItemId, itemKind: "source", data: source, sourceIds: [] as string[], sourceEventId, hash: lineage[0].semanticSha256, targets: [] as unknown[] },
    { itemId: observationItemId, clientItemId: lineage[1].clientItemId, itemKind: "service", data: payload.observations[0], sourceIds: [source.sourceId], sourceEventId: observationEventId, hash: lineage[1].semanticSha256, targets: [] as unknown[] },
  ];
  state.tables.prospect_enrichment_source_events = lineage.map((item, index) => ({
    id: index ? observationEventId : sourceEventId, source_system: payload.sourceSystem, source_event_key: item.sourceEventKey, semantic_sha256: item.semanticSha256,
  }));
  const rawBody = JSON.stringify(payload);
  const record = {
    packageId: id, clientPackageId: payload.packageId, payloadSha256: hash(payload), state: "identity_hold", identityState: "unresolved",
    firmId: null as string | null, payload, rawBody, rawBodySha256: prospectEnrichmentSha256(rawBody), items, sources: payload.sources, events: [],
    reviewJson: null as unknown, reviewSha256: null as string | null, receipt: null as unknown, holds: ["synthetic_identity_hold"],
  };
  state.packageDetail.mockResolvedValue(record);
  return record;
}
function setupCanonical(record: ReturnType<typeof setupFixture>) {
  const fullRow = { id: targetId, firm_id: firmId, service_name: "Family law", matter_fit: "strong-match",
    source_url: source.url, evidence_ids: [], observed_at: null, source_observed_on: source.observedOn, source_observed_precision: "date" };
  const captureRow = { id: captureId, firm_id: firmId, requested_url: source.requestedUrl, final_url: source.finalUrl,
    publisher: source.publisher, retrieval_method: source.retrievalMethod, http_status: 200, sha256: source.bodySha256,
    retained_artifact: null, policy_state: "public-source", observed_at: null, source_observed_on: source.observedOn, source_observed_precision: "date" };
  const targets = [
    { targetTable: "prospect_service_observations", targetId, targetRowSha256: hash(fullRow), applicationKind: "inserted" },
    { targetTable: "prospect_source_captures", targetId: captureId, targetRowSha256: hash(captureRow), applicationKind: "inserted" },
  ];
  state.tables.prospect_service_observations = [fullRow]; state.tables.prospect_source_captures = [captureRow];
  record.items[1].targets = targets.map((target) => ({ item_id: observationItemId, target_table: target.targetTable,
    target_id: target.targetId, target_row_sha256: target.targetRowSha256, application_kind: target.applicationKind }));
  const review = { payloadSha256: record.payloadSha256, identity: { choice: "existing", firmId, coreInput: null },
    items: [{ itemId: sourceItemId, disposition: "retain_only", reason: "Retain original source", profileChoice: null },
      { itemId: observationItemId, disposition: "accept_new", reason: null, profileChoice: null }] };
  record.state = "applied"; record.firmId = firmId; record.reviewJson = review; record.reviewSha256 = hash(review);
  const receipt = { schemaVersion: "prospect-enrichment-apply-receipt/v1", packageId: id, clientPackageId: record.clientPackageId,
    payloadSha256: record.payloadSha256, reviewSha256: hash(review), appliedBy: id, appliedAt: "2026-09-23T13:00:00Z", firmId,
    stableFirmId: null, sourceRecordKey: "synthetic-legal", expectedRevisionSha256: "f".repeat(64),
    resultingRevisionSha256: hash({ schemaVersion: "prospect-enrichment-firm-revision/v1", firmId, revision: "12" }),
    items: record.items.map((item, index) => ({ itemId: item.itemId, clientItemId: item.clientItemId,
      disposition: index ? "accept_new" : "retain_only", targets: index ? targets : [] })), profileChoices: [] as unknown[] };
  record.receipt = receipt;
  const linked = { packageId: id, itemId: observationItemId, sourceEventId: observationEventId, data: record.items[1].data,
    sourceIds: [source.sourceId], sources: [source], originalResearch: record.payload.originalResearch,
    runId: record.payload.runId, payloadSha256: record.payloadSha256 };
  const visible = [fullRow, captureRow].map((row, index) => ({ id: row.id, table: targets[index].targetTable, data: { ...row },
    semanticSha256: hash(row), date: { observedAt: null, observedOn: source.observedOn, precision: "date" }, dateLabel: source.observedOn,
    freshness: "current", sourceUrls: [source.url], legacyCriteria: [], qualificationCategory: null,
    enrichment: [structuredClone(linked)], retractions: [] as unknown[], profileSource: null }));
  const firm = { firm: { id: firmId, displayName: "Synthetic Legal", websiteUrl: "https://example.example", sourceRecordKey: "synthetic-legal", revision: "12" },
    sections: [{ key: "profile", title: "Current profile", state: "available", items: visible, errorId: null, incomplete: false, nextCursors: {} as Record<string, string> }],
    complete: true, revisionStable: true, profileChoices: [] as unknown[], readAt: "2026-09-23T14:00:00Z", rendererVersion: "prospect-enrichment/v1" };
  state.firmDetail.mockResolvedValue(firm);
  return { receipt, review, firm, fullRow, captureRow };
}
let record: ReturnType<typeof setupFixture>;
beforeEach(() => {
  vi.clearAllMocks(); state.sameOrigin = true; state.dbError = false; state.tables = {};
  state.session = { role: "operator", firm_id: firmId, lawyer_id: id, exp: 2_000_000_000 };
  record = setupFixture();
  state.rpc.mockImplementation(async (_name, args) => ({ data: { verified: true, ...args.p_details }, error: null }));
});
const request = (body: unknown, headers: Record<string, string> = {}) => new NextRequest("http://127.0.0.1:3100/api/admin/prospect-enrichment/packages/" + id + "/verify",
  { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const invoke = (visibilityScope = "package", patch = {}) => POST(request({ visibilityScope, payloadSha256: record.payloadSha256, ...patch }), { params: Promise.resolve({ packageId: id }) });

describe("authenticated independent prospect visibility verification", () => {
  it("requires real operator auth before reading evidence and includes no-store on denial", async () => {
    state.session = null; const response = await invoke();
    expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(state.packageDetail).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("rejects wrong roles and cross-origin mutation requests before reads", async () => {
    state.session!.role = "lawyer"; expect((await invoke()).status).toBe(403);
    state.session!.role = "operator"; state.sameOrigin = false; expect((await invoke()).status).toBe(403);
    expect(state.packageDetail).not.toHaveBeenCalled();
  });
  it.each([{ visibilityScope: "all" }, { payloadSha256: "A".repeat(64) }, { extra: true }, { payloadSha256: null }])("requires the exact bounded two-field request %j", async (patch) => {
    expect((await invoke("package", patch)).status).toBe(422); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("rejects missing hash, malformed JSON and an oversized streamed body", async () => {
    const context = { params: Promise.resolve({ packageId: id }) };
    expect((await POST(request({ visibilityScope: "package" }), context)).status).toBe(422);
    expect((await POST(request("{"), context)).status).toBe(400);
    expect((await POST(request(" ".repeat(4097)), context)).status).toBe(413);
    expect(state.packageDetail).not.toHaveBeenCalled();
  });
  it("verifies held package visibility without asserting canonical application", async () => {
    const response = await invoke(), body = await response.json();
    expect(response.status).toBe(200); expect(body).toMatchObject({ verified: true, visibilityScope: "package", expectedReceiptSha256: null,
      sourceCount: 1, itemCount: 2, targetCount: 0, verificationVersion: "prospect-enrichment-readback/v1" });
    expect(state.firmDetail).not.toHaveBeenCalled();
    expect(state.rpc).toHaveBeenCalledWith("record_prospect_enrichment_verification_v1", expect.objectContaining({ p_package_id: id, p_payload_sha256: record.payloadSha256 }));
    expect(Object.keys(state.rpc.mock.calls[0][1].p_details).sort()).toEqual(["visibilityScope", "payloadSha256", "readbackSha256", "expectedReceiptSha256", "sourceCount", "itemCount", "targetCount", "verificationVersion"].sort());
    expect(JSON.stringify(body)).not.toContain("Synthetic Legal"); expect(record.state).toBe("identity_hold");
  });
  it.each(["raw", "payload", "source", "item", "item-hash", "source-event", "source-id"] as const)("refuses a mismatching %s read-back", async (kind) => {
    if (kind === "raw") record.rawBody += " ";
    if (kind === "payload") record.payloadSha256 = "f".repeat(64);
    if (kind === "source") record.sources = [];
    if (kind === "item") record.items.pop();
    if (kind === "item-hash") record.items[1].hash = "f".repeat(64);
    if (kind === "source-event") state.tables.prospect_enrichment_source_events[1].semantic_sha256 = "f".repeat(64);
    if (kind === "source-id") record.items[1].sourceIds = [];
    const response = await invoke(); expect(response.status).toBe(409); expect((await response.json()).verified).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each(["applied", "rejected", "superseded"])("does not verify %s as a staged package", async (value) => {
    record.state = value; expect((await invoke()).status).toBe(409); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("requires applied state before canonical reads", async () => {
    expect((await invoke("canonical")).status).toBe(409); expect(state.firmDetail).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("independently verifies canonical hashes, rendered values and source-linked original research", async () => {
    const { receipt } = setupCanonical(record);
    const response = await invoke("canonical"), body = await response.json();
    expect(response.status).toBe(200); expect(body).toMatchObject({ verified: true, visibilityScope: "canonical", targetCount: 2, expectedReceiptSha256: hash(receipt) });
    expect(body.report).toMatchObject({ visibilityScope: "canonical", rendererVersion: "prospect-enrichment/v1", identity: { firmId }, items: [{ visibleInPackage: true, visibleInFirm: null }, { visibleInPackage: true, visibleInFirm: true }], sources: [{ sourceId: "public-services", precision: "date_only" }] });
    expect(state.firmDetail).toHaveBeenCalledWith({ firmId });
    expect(JSON.stringify(body)).not.toContain("Family law");
  });
  it.each(["missing", "hash", "owner", "value", "lineage", "sources", "raw-research", "revision", "incomplete", "unstable", "disposition", "mapping", "profile"] as const)("does not record canonical verification for a %s mismatch", async (kind) => {
    const fixture = setupCanonical(record);
    if (kind === "missing") state.tables.prospect_service_observations = [];
    if (kind === "hash") fixture.fullRow.service_name = "Altered";
    if (kind === "owner") fixture.fullRow.firm_id = id;
    if (kind === "value") (fixture.firm.sections[0].items[0].data as Record<string, unknown>).service_name = "Altered";
    if (kind === "lineage") fixture.firm.sections[0].items[0].enrichment = [];
    if (kind === "sources") fixture.firm.sections[0].items[0].enrichment[0].sources = [];
    if (kind === "raw-research") fixture.firm.sections[0].items[0].enrichment[0].originalResearch = { ...record.payload.originalResearch, content: { changed: true } };
    if (kind === "revision") fixture.firm.firm.revision = "13";
    if (kind === "incomplete") fixture.firm.complete = false;
    if (kind === "unstable") fixture.firm.revisionStable = false;
    if (kind === "disposition") fixture.receipt.items[1].disposition = "retain_only";
    if (kind === "mapping") record.items[1].targets = [];
    if (kind === "profile") fixture.receipt.profileChoices.push({ choiceId: targetId, sourceItemId: observationItemId });
    const response = await invoke("canonical");
    expect(response.status).toBe(409); expect((await response.json()).verified).toBe(false); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("exhausts a normal paginated firm through the same history reader before verification", async () => {
    const fixture = setupCanonical(record);
    const target = fixture.firm.sections[0].items[0];
    fixture.firm.sections[0].items = [fixture.firm.sections[0].items[1], ...Array.from({ length: 24 }, (_, index) => ({ ...target, id: "00000000-0000-4000-8000-" + String(index + 20).padStart(12, "0") }))];
    fixture.firm.complete = false; fixture.firm.sections[0].incomplete = true;
    fixture.firm.sections[0].nextCursors = { prospect_service_observations: "page-two" };
    state.firmHistory.mockResolvedValue({ table: "prospect_service_observations", items: [target], nextCursor: null });
    expect((await invoke("canonical")).status).toBe(200);
    expect(state.firmHistory).toHaveBeenCalledWith({ firmId, table: "prospect_service_observations", cursor: "page-two", limit: 100 });
    expect(state.firmDetail).toHaveBeenCalledTimes(2);
  });
  it("continues an empty history page whose unapplied legacy rows were filtered out", async () => {
    const fixture = setupCanonical(record);
    fixture.firm.complete = false; fixture.firm.sections[0].incomplete = true;
    fixture.firm.sections[0].nextCursors = { prospect_service_observations: "page-two" };
    state.firmHistory.mockResolvedValueOnce({ table: "prospect_service_observations", items: [], nextCursor: "page-three" })
      .mockResolvedValueOnce({ table: "prospect_service_observations", items: [], nextCursor: null });
    expect((await invoke("canonical")).status).toBe(200);
    expect(state.firmHistory).toHaveBeenCalledTimes(2);
  });
  it("fails if the firm revision changes while reading later evidence pages", async () => {
    const fixture = setupCanonical(record);
    fixture.firm.complete = false; fixture.firm.sections[0].incomplete = true;
    fixture.firm.sections[0].nextCursors = { prospect_service_observations: "page-two" };
    state.firmHistory.mockResolvedValue({ table: "prospect_service_observations", items: [], nextCursor: null });
    state.firmDetail.mockResolvedValueOnce(fixture.firm).mockResolvedValueOnce({ ...fixture.firm, firm: { ...fixture.firm.firm, revision: "13" } });
    const response = await invoke("canonical");
    expect(response.status).toBe(409); expect((await response.json()).code).toBe("canonical_revision_mismatch");
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("fails instead of silently truncating firm coverage beyond 5,000 evidence rows", async () => {
    const fixture = setupCanonical(record), target = fixture.firm.sections[0].items[0];
    fixture.firm.sections[0].items = Array.from({ length: 5001 }, (_, index) => ({ ...target, id: String(index) }));
    const response = await invoke("canonical");
    expect(response.status).toBe(409); expect((await response.json()).code).toBe("canonical_coverage_limit");
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("rejects a section load error even when another section has a continuation cursor", async () => {
    const fixture = setupCanonical(record);
    fixture.firm.complete = false; fixture.firm.sections[0].state = "error";
    fixture.firm.sections[0].nextCursors = { prospect_service_observations: "page-two" };
    expect((await invoke("canonical")).status).toBe(409); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("preserves explicit nullable canonical values instead of treating null as absent", async () => {
    setupCanonical(record); expect((await invoke("canonical")).status).toBe(200);
  });
  it("never reports verified if the final locked RPC rejects a concurrent change", async () => {
    setupCanonical(record); state.rpc.mockResolvedValue({ data: null, error: { message: "revision_changed: private row data" } });
    const response = await invoke("canonical"), body = await response.json();
    expect(response.status).toBe(409); expect(body.verified).toBe(false); expect(JSON.stringify(body)).not.toContain("private row data");
  });
  it("requires a matching database verification receipt after successful reads", async () => {
    state.rpc.mockResolvedValue({ data: { verified: true, payloadSha256: "f".repeat(64) }, error: null });
    expect((await invoke()).status).toBe(503);
  });
  it("returns explicit dependency errors without leaking DB messages or recording success", async () => {
    state.dbError = true; const response = await invoke(), body = await response.json();
    expect(response.status).toBe(503); expect(body.verified).toBe(false); expect(JSON.stringify(body)).not.toContain("private");
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("preserves a missing-package 404", async () => {
    state.packageDetail.mockRejectedValue(new ReadApiError("The research package was not found.", 404));
    expect((await invoke()).status).toBe(404); expect(state.rpc).not.toHaveBeenCalled();
  });
});
