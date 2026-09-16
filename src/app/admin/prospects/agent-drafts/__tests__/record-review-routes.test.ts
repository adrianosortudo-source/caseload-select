import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  operator: null as { role: "operator" } | null,
  preview: null as { capability: "read" } | null,
  record: null as unknown,
  manifest: null as unknown,
  recordRead: vi.fn(),
  manifestRead: vi.fn(),
  previewRead: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: () => Promise.resolve(h.operator) }));
vi.mock("@/lib/preview-qa-auth", () => ({ getPreviewQaReadSession: (request: Request) => { h.previewRead(request); return Promise.resolve(h.preview); } }));
vi.mock("@/lib/gta-prospect-agent-draft-inbox", () => ({
  getGtaProspectAgentDraftRecordReview: (input: unknown) => h.recordRead(input),
  getGtaProspectAgentDraftReviewManifest: (input: unknown) => h.manifestRead(input),
}));

import { GET as recordGET } from "../[draftId]/records/[sourceRecordKey]/route";
import { GET as manifestGET } from "../[draftId]/review/route";

const draftId = "11111111-1111-4111-8111-111111111111";
const sourceRecordKey = "gta-prospect-review-001";
const request = (path: string) => new Request(`https://preview.example.vercel.app${path}`);
const recordContext = (id = draftId, key = sourceRecordKey) => ({ params: Promise.resolve({ draftId: id, sourceRecordKey: key }) });
const manifestContext = (id = draftId) => ({ params: Promise.resolve({ draftId: id }) });

beforeEach(() => {
  h.operator = null; h.preview = null; h.record = null; h.manifest = null;
  h.recordRead.mockReset(); h.manifestRead.mockReset(); h.previewRead.mockReset();
  h.recordRead.mockResolvedValue({ draftId, sourceRecordKey, reviewSha256: "a".repeat(64), disposition: "new", reason: "ok", firmName: "Review Firm", city: "Toronto", officeCities: ["Toronto"], websiteUrl: null, practiceAreas: [], observedLawyerCount: 2, observedLawyerCountQualifier: "exact", observedLawyerCountDisplay: "2", reconciliationStatus: "provisional_new", evidence: [], publicContacts: [] });
  h.manifestRead.mockResolvedValue({ draftId, reviewSha256: "a".repeat(64), recordCount: 1, records: [] });
});

describe("staged record review routes", () => {
  it("permits an operator and keeps the single-record projection private", async () => {
    h.operator = { role: "operator" };
    const response = await recordGET(request(`/admin/prospects/agent-drafts/${draftId}/records/${sourceRecordKey}`), recordContext());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(h.recordRead).toHaveBeenCalledWith({ draftId, sourceRecordKey });
    expect(h.previewRead).not.toHaveBeenCalled();
  });

  it("permits the separate preview QA principal for GET only", async () => {
    h.preview = { capability: "read" };
    const response = await recordGET(request(`/admin/prospects/agent-drafts/${draftId}/records/${sourceRecordKey}`), recordContext());
    expect(response.status).toBe(200);
    expect(h.previewRead).toHaveBeenCalledTimes(1);
  });

  it("denies unauthenticated readers before any package read", async () => {
    const response = await recordGET(request(`/admin/prospects/agent-drafts/${draftId}/records/${sourceRecordKey}`), recordContext());
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(h.recordRead).not.toHaveBeenCalled();
  });

  it("rejects invalid identifiers without loading a package", async () => {
    h.operator = { role: "operator" };
    h.recordRead.mockRejectedValue(new Error("sourceRecordKey is invalid."));
    const response = await recordGET(request(`/admin/prospects/agent-drafts/${draftId}/records/invalid`), recordContext(draftId, "invalid"));
    expect(response.status).toBe(400);
    expect(h.recordRead).toHaveBeenCalledOnce();
  });

  it("rejects an invalid draft identifier for the complete manifest", async () => {
    h.operator = { role: "operator" };
    h.manifestRead.mockRejectedValue(new Error("draftId must be a UUID."));
    const response = await manifestGET(request("/admin/prospects/agent-drafts/not-a-uuid/review"), manifestContext("not-a-uuid"));
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("returns not found without leaking a package", async () => {
    h.operator = { role: "operator" };
    h.recordRead.mockResolvedValue(null);
    const response = await recordGET(request(`/admin/prospects/agent-drafts/${draftId}/records/${sourceRecordKey}`), recordContext());
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("permits preview QA to load the full bounded manifest", async () => {
    h.preview = { capability: "read" };
    const response = await manifestGET(request(`/admin/prospects/agent-drafts/${draftId}/review`), manifestContext());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(h.manifestRead).toHaveBeenCalledWith({ draftId });
  });
});
