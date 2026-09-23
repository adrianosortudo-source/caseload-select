import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  session: null as null | { lawyer_id: string },
  sameOrigin: true,
  rpc: vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: {}, error: null as null | { code?: string; message?: string } })),
  packageDetail: vi.fn(async (_input: { packageId: string }) => ({
    payloadSha256: "a".repeat(64),
    newCoreOptions: null as unknown,
    items: [] as unknown[],
    identityOptions: [] as unknown[],
  })),
}));

vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: () => Promise.resolve(h.session) }));
vi.mock("@/lib/client-import-server", () => ({ validateSameOrigin: () => h.sameOrigin }));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { rpc: h.rpc } }));
vi.mock("@/app/api/admin/prospect-enrichment/_package-read", () => ({ readPackageDetail: h.packageDetail }));

import { NextRequest } from "next/server";
import { prospectEnrichmentReviewSha256, parseProspectEnrichmentReview } from "@/lib/prospect-enrichment-operator";
import { deriveProspectEnrichmentNewCoreInput, type ProspectEnrichmentNewCoreOptions } from "@/lib/prospect-enrichment-core-evidence";
import { POST } from "../route";

const packageId = "d4ef91de-47aa-44d5-9e86-17c6aa4d1c87";
const operatorId = "1b77517a-4510-41d3-a527-202d47a02a17";
const payloadSha256 = "a".repeat(64);
const unresolvedItemId = "bf172af1-94f2-48b8-94a1-cdb156a5c615";
const reviewBody = {
  payloadSha256,
  identity: { choice: "unresolved", firmId: null, coreInput: null },
  items: [{ itemId: unresolvedItemId, disposition: "retain_only", reason: "Identity remains unresolved.", profileChoice: null }],
};
const cityItemId = "d5c11bc6-82c0-4f9c-9e99-9a3ea4f31001";
const rosterItemId = "d5c11bc6-82c0-4f9c-9e99-9a3ea4f31002";
const selectedItemId = "d5c11bc6-82c0-4f9c-9e99-9a3ea4f31003";
const source = { sourceId: "firm-site", url: "https://example-law.test/team", requestedUrl: "https://example-law.test/team", finalUrl: "https://example-law.test/team", policyState: "public-source", publicationLabel: null, publicationPrecision: "unknown", publisher: "Example Law", observedAt: null, observedOn: "2026-09-23", retrievedAt: "2026-09-23T12:00:00.000Z", retrievalMethod: "http", retrievalOutcome: "success", httpStatus: 200, bodySha256: null, excerpt: "Example Law Professional Corporation official team and services page", missingProvenanceReason: null } as const;
const cityObservation = { observationId: "city", evidenceState: "asserted", retractionReason: null, retractionSourceIds: [], missingProvenanceReason: null, kind: "firm_fit", observedAt: null, observedOn: "2026-09-23", sourceIds: ["firm-site"], data: { office: { city: "Toronto" }, matterFit: "strong-match" }, existingRecord: null } as const;
const rosterObservation = { observationId: "roster", evidenceState: "asserted", retractionReason: null, retractionSourceIds: [], missingProvenanceReason: null, kind: "roster", observedAt: null, observedOn: "2026-09-23", sourceIds: ["firm-site"], data: { lawyerCount: 3, countQualifier: "exact", display: "3 lawyers", includedNames: [], excludedPeople: [] }, existingRecord: null } as const;
const newCoreOptions = {
  eligible: true, sourceRecordKey: "new-firm-1", firmName: "Example Law Professional Corporation", holds: [], firmNameSources: [source],
  cities: [{ itemId: cityItemId, sourceId: "firm-site", observation: cityObservation, source }], services: [],
  rosters: [{ itemId: rosterItemId, sourceId: "firm-site", observation: rosterObservation, source }], websiteSources: [source],
} as unknown as ProspectEnrichmentNewCoreOptions;
const newCore = deriveProspectEnrichmentNewCoreInput(newCoreOptions, {
  firmName: { sourceId: "firm-site" }, city: { itemId: cityItemId, sourceId: "firm-site" },
  officeCities: [{ itemId: cityItemId, sourceId: "firm-site" }], websiteUrl: { sourceId: "firm-site" },
  practiceAreas: [], roster: { itemId: rosterItemId, sourceId: "firm-site" },
}, "Example Law Professional Corporation has a Toronto office confirmed by the 2026-09-23 roster.");
const newReviewBody = {
  payloadSha256,
  identity: { choice: "new" as const, firmId: null, coreInput: newCore },
  items: [{ itemId: selectedItemId, disposition: "accept_new", reason: null, profileChoice: null }],
};

function request(body: unknown) {
  return new NextRequest(`https://admin.caseloadselect.ca/api/admin/prospect-enrichment/packages/${packageId}/review`, {
    method: "POST",
    headers: { origin: "https://admin.caseloadselect.ca", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  h.session = { lawyer_id: operatorId };
  h.sameOrigin = true;
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: {}, error: null });
  h.packageDetail.mockReset();
  h.packageDetail.mockResolvedValue({ payloadSha256, newCoreOptions, identityOptions: [{ value: "unresolved", eligible: true }, { value: "new", eligible: true }], items: [
    { itemId: unresolvedItemId, allowedDispositions: ["retain_only"], allowedDispositionsForNewIdentity: ["retain_only"], allowedProfileChoice: null },
    { itemId: selectedItemId, allowedDispositions: ["retain_only"], allowedDispositionsForNewIdentity: ["accept_new", "retain_only"], allowedProfileChoice: null },
  ] });
});

describe("prospect enrichment review route", () => {
  it("rejects anonymous callers before reading the body or reaching the database", async () => {
    h.session = null;
    const response = await POST(request(reviewBody), { params: Promise.resolve({ packageId }) });
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("rejects an invalid browser origin before calling the review RPC", async () => {
    h.sameOrigin = false;
    const response = await POST(request(reviewBody), { params: Promise.resolve({ packageId }) });
    expect(response.status).toBe(403);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("stores only a complete, explicitly covered review and returns the frozen revision receipt", async () => {
    const parsed = parseProspectEnrichmentReview(reviewBody);
    const reviewSha256 = prospectEnrichmentReviewSha256(parsed);
    h.rpc.mockResolvedValue({ data: { outcome: "reviewed", reviewSha256, expectedRevisionSha256: "b".repeat(64), reviewExpiresAt: new Date(Date.now() + 60_000).toISOString(), review: { diff: [] } }, error: null });
    const response = await POST(request(reviewBody), { params: Promise.resolve({ packageId }) });
    expect(response.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith("review_prospect_enrichment_package_v1", expect.objectContaining({
      p_package_id: packageId,
      p_payload_sha256: payloadSha256,
      p_review_sha256: reviewSha256,
      p_operator_id: operatorId,
    }));
    expect(await response.json()).toMatchObject({ reviewSha256, expectedRevisionSha256: "b".repeat(64), review: { diff: [] } });
  });

  it("does not allow an unresolved identity to approve canonical dispositions", async () => {
    const contradictory = { ...reviewBody, items: [{ ...reviewBody.items[0], disposition: "accept_new" }] };
    const response = await POST(request(contradictory), { params: Promise.resolve({ packageId }) });
    expect(response.status).toBe(422);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("rederives every new-firm core value from the current package evidence before review", async () => {
    const reviewSha256 = prospectEnrichmentReviewSha256(parseProspectEnrichmentReview(newReviewBody));
    h.rpc.mockResolvedValue({ data: { outcome: "reviewed", reviewSha256, expectedRevisionSha256: "b".repeat(64), reviewExpiresAt: new Date(Date.now() + 60_000).toISOString() }, error: null });
    const response = await POST(request(newReviewBody), { params: Promise.resolve({ packageId }) });
    expect(response.status).toBe(200);
    expect(h.packageDetail).toHaveBeenCalledWith({ packageId });
    expect(h.rpc).toHaveBeenCalledWith("review_prospect_enrichment_package_v1", expect.objectContaining({ p_package_id: packageId }));
  });

  it("rejects edited new-firm values and disallowed item actions before the review RPC", async () => {
    const editedCore = { ...newCore, city: "Ottawa" };
    const edited = { ...newReviewBody, identity: { ...newReviewBody.identity, coreInput: editedCore } };
    const editedResponse = await POST(request(edited), { params: Promise.resolve({ packageId }) });
    expect(editedResponse.status).toBe(422);
    expect(h.rpc).not.toHaveBeenCalled();
    const held = { ...newReviewBody, items: [{ ...newReviewBody.items[0], disposition: "accept_new" }] };
    h.packageDetail.mockResolvedValueOnce({ payloadSha256, newCoreOptions, identityOptions: [{ value: "new", eligible: true }], items: [{ itemId: selectedItemId, allowedDispositionsForNewIdentity: ["retain_only"], allowedProfileChoice: null }] });
    const heldResponse = await POST(request(held), { params: Promise.resolve({ packageId }) });
    expect(heldResponse.status).toBe(422);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("routes explicit rejection to the append-only rejection RPC", async () => {
    h.rpc.mockResolvedValue({ data: { outcome: "rejected", packageId }, error: null });
    const response = await POST(request({ action: "reject", payloadSha256, reason: "Candidate identity conflicts with the cited evidence." }), { params: Promise.resolve({ packageId }) });
    expect(response.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith("reject_prospect_enrichment_package_v1", expect.objectContaining({
      p_package_id: packageId,
      p_payload_sha256: payloadSha256,
      p_operator_id: operatorId,
    }));
  });
});
