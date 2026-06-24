/**
 * Integration tests for the version-posting route
 * (POST /api/portal/[firmId]/deliverables/[deliverableId]/versions).
 *
 * Guards under test:
 *   - auth                                            401
 *   - firm scope on the loaded deliverable            404
 *   - content_kind must match the payload shape       400  (text wants JSON, asset wants multipart)
 *   - asset MIME must match the kind                   415
 *   - text body is sanitised before persistence       (real sanitizer exercised)
 *
 * The actor resolver, uploader, and addVersion are mocked; the real
 * sanitizeExplainerHtml runs on the text path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const FIRM = "11111111-1111-1111-1111-111111111111";
const DELIV = "22222222-2222-2222-2222-222222222222";

type Actor = { role: string; id: string | null; name: string | null; email: string | null } | null;

interface State {
  actor: Actor;
  detail: unknown;
  addVersionArgs: Record<string, unknown> | null;
}

const state: State = { actor: null, detail: null, addVersionArgs: null };

vi.mock("@/lib/deliverables-auth", () => ({
  resolveDeliverableActor: () =>
    Promise.resolve(state.actor ? { session: {}, actor: state.actor } : null),
}));

vi.mock("@/lib/deliverables", () => ({
  getDeliverableDetail: () => Promise.resolve(state.detail),
  uploadDeliverableAsset: () => Promise.resolve({ ok: true, storagePath: "deliverables/x/y/z.png" }),
  addVersion: (args: Record<string, unknown>) => {
    state.addVersionArgs = args;
    return Promise.resolve({ ok: true, version: { id: "vNew", version_number: 3 } });
  },
}));

import { POST } from "../route";

const OPERATOR: Actor = { role: "operator", id: null, name: "Operator", email: null };

function makeDetail(kind: "text" | "image" | "pdf", firmId = FIRM) {
  return {
    deliverable: { id: DELIV, firm_id: firmId, title: "T", content_kind: kind },
    versions: [],
    comments: [],
    approvals: [],
  };
}

function jsonReq(body: unknown, contentType = "application/json") {
  return {
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? contentType : null) },
    json: async () => body,
    formData: async () => {
      throw new Error("not multipart");
    },
    url: "https://app.caseloadselect.ca/x",
  } as never;
}

function multipartReq(form: FormData) {
  return {
    headers: {
      get: (k: string) =>
        k.toLowerCase() === "content-type" ? "multipart/form-data; boundary=abc" : null,
    },
    formData: async () => form,
    json: async () => {
      throw new Error("not json");
    },
    url: "https://app.caseloadselect.ca/x",
  } as never;
}

const params = () => ({ params: Promise.resolve({ firmId: FIRM, deliverableId: DELIV }) }) as never;

beforeEach(() => {
  state.actor = OPERATOR;
  state.detail = makeDetail("text");
  state.addVersionArgs = null;
});

describe("POST versions", () => {
  it("401 when unauthenticated", async () => {
    state.actor = null;
    const res = await POST(jsonReq({ body_html: "<p>hi</p>" }), params());
    expect(res.status).toBe(401);
  });

  it("404 when the deliverable is another firm's", async () => {
    state.detail = makeDetail("text", "99999999-9999-9999-9999-999999999999");
    const res = await POST(jsonReq({ body_html: "<p>hi</p>" }), params());
    expect(res.status).toBe(404);
  });

  it("400 when a text deliverable is posted as multipart", async () => {
    state.detail = makeDetail("text");
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1])], "a.png", { type: "image/png" }));
    const res = await POST(multipartReq(form), params());
    expect(res.status).toBe(400);
  });

  it("400 when a text version has no body", async () => {
    state.detail = makeDetail("text");
    const res = await POST(jsonReq({ body_html: "   " }), params());
    expect(res.status).toBe(400);
  });

  it("200 on a text version, and the body is sanitised before persistence", async () => {
    state.detail = makeDetail("text");
    const res = await POST(
      jsonReq({ body_html: "<p>Keep this</p><script>alert(1)</script>", note: "v3 note" }),
      params(),
    );
    expect(res.status).toBe(200);
    const body = state.addVersionArgs!.bodyHtml as string;
    expect(body).toContain("Keep this");
    expect(body.toLowerCase()).not.toContain("<script");
    expect(state.addVersionArgs!.note).toBe("v3 note");
  });

  it("400 when an image deliverable is posted as JSON", async () => {
    state.detail = makeDetail("image");
    const res = await POST(jsonReq({ body_html: "<p>nope</p>" }), params());
    expect(res.status).toBe(400);
  });

  it("415 when the asset MIME does not match the kind", async () => {
    state.detail = makeDetail("image");
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1])], "a.pdf", { type: "application/pdf" }));
    const res = await POST(multipartReq(form), params());
    expect(res.status).toBe(415);
  });

  it("200 on a valid image asset version", async () => {
    state.detail = makeDetail("image");
    const form = new FormData();
    // Real PNG magic bytes: the route sniffs content (commit 28d229c) and
    // rejects a declared image/png whose body is not actually a PNG.
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    form.append("file", new File([pngHeader], "ad.png", { type: "image/png" }));
    form.append("note", "new creative");
    const res = await POST(multipartReq(form), params());
    expect(res.status).toBe(200);
    expect(state.addVersionArgs!.storagePath).toBe("deliverables/x/y/z.png");
    expect(state.addVersionArgs!.assetMime).toBe("image/png");
  });
});
