/**
 * Integration tests for the feedback-attachment upload route
 * (POST /api/portal/[firmId]/deliverables/[deliverableId]/attachments).
 *
 * Guards under test: auth (401), firm scope (404), missing file (400), size
 * cap (413), declared-mime rejection (415), and content-sniff mismatch (415)
 * -- a declared image/png whose bytes are not actually a PNG must be rejected
 * even though the header claims otherwise, mirroring the versions route's
 * existing sniff discipline.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const FIRM = "11111111-1111-1111-1111-111111111111";
const DELIV = "22222222-2222-2222-2222-222222222222";

type Actor = { role: string; id: string | null; name: string | null; email: string | null } | null;

const state: { actor: Actor; detail: unknown; uploadArgs: Record<string, unknown> | null } = {
  actor: null,
  detail: null,
  uploadArgs: null,
};

vi.mock("@/lib/deliverables-auth", () => ({
  resolveDeliverableActor: () =>
    Promise.resolve(state.actor ? { session: {}, actor: state.actor } : null),
}));

vi.mock("@/lib/deliverables", () => ({
  getDeliverableDetail: () => Promise.resolve(state.detail),
  uploadDeliverableFeedbackAsset: (args: Record<string, unknown>) => {
    state.uploadArgs = args;
    return Promise.resolve({ ok: true, storagePath: `deliverables/${FIRM}/${DELIV}/feedback/uuid-shot.png` });
  },
}));

import { POST } from "../route";

const OPERATOR: Actor = { role: "operator", id: null, name: "Operator", email: null };

function makeDetail(firmId = FIRM) {
  return { deliverable: { id: DELIV, firm_id: firmId, title: "T" }, versions: [], comments: [], approvals: [] };
}

function multipartReq(form: FormData) {
  return {
    formData: async () => form,
    headers: { get: () => "multipart/form-data; boundary=abc" },
    url: "https://app.caseloadselect.ca/x",
  } as never;
}

const params = () => ({ params: Promise.resolve({ firmId: FIRM, deliverableId: DELIV }) }) as never;

const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

beforeEach(() => {
  state.actor = OPERATOR;
  state.detail = makeDetail();
  state.uploadArgs = null;
});

describe("POST attachments", () => {
  it("401 when unauthenticated", async () => {
    state.actor = null;
    const form = new FormData();
    form.append("file", new File([PNG_HEADER], "a.png", { type: "image/png" }));
    const res = await POST(multipartReq(form), params());
    expect(res.status).toBe(401);
  });

  it("404 when the deliverable is another firm's", async () => {
    state.detail = makeDetail("99999999-9999-9999-9999-999999999999");
    const form = new FormData();
    form.append("file", new File([PNG_HEADER], "a.png", { type: "image/png" }));
    const res = await POST(multipartReq(form), params());
    expect(res.status).toBe(404);
  });

  it('400 when the "file" field is missing', async () => {
    const form = new FormData();
    const res = await POST(multipartReq(form), params());
    expect(res.status).toBe(400);
  });

  it("413 when the file exceeds the 25 MB cap", async () => {
    const big = new Uint8Array(25 * 1024 * 1024 + 1);
    const form = new FormData();
    form.append("file", new File([big], "big.png", { type: "image/png" }));
    const res = await POST(multipartReq(form), params());
    expect(res.status).toBe(413);
    expect(state.uploadArgs).toBeNull();
  });

  it("415 when the declared MIME type is not allowed", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3])], "a.exe", { type: "application/octet-stream" }));
    const res = await POST(multipartReq(form), params());
    expect(res.status).toBe(415);
  });

  it("415 when a declared image/png does not sniff as a real PNG", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3, 4])], "fake.png", { type: "image/png" }));
    const res = await POST(multipartReq(form), params());
    expect(res.status).toBe(415);
    expect(state.uploadArgs).toBeNull();
  });

  it("200 on a real PNG: stores under this deliverable's feedback prefix", async () => {
    const form = new FormData();
    form.append("file", new File([PNG_HEADER], "shot.png", { type: "image/png" }));
    const res = await POST(multipartReq(form), params());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.attachment.name).toBe("shot.png");
    expect(json.attachment.mime).toBe("image/png");
    expect(state.uploadArgs!.firmId).toBe(FIRM);
    expect(state.uploadArgs!.deliverableId).toBe(DELIV);
  });
});
