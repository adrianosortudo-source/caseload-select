/**
 * Route-level coverage for POST /api/publishing-agent/hero-package.
 * Byte/identity-level pure logic is covered in
 * src/lib/__tests__/publishing-package-gateway.test.ts -- this file
 * exercises the route's own wiring: auth, Supabase I/O sequencing, no-write-
 * on-failure, and receipt shape. Supabase is mocked (same minimal
 * chainable-query-mock pattern as publication-preflight-loader.test.ts);
 * the route's real parsing/auth/validation/sequencing is exercised.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const TOKEN = "test-publishing-gateway-token-12345";
process.env.PUBLISHING_PACKAGE_GATEWAY_TOKEN = TOKEN;

const FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const OTHER_FIRM_ID = "11111111-1111-1111-1111-111111111111";
const DELIVERABLE_ID = "d1111111-1111-1111-1111-111111111111";
const URL = "https://app.caseloadselect.ca/api/publishing-agent/hero-package";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

function sha256Hex(buf: Buffer): string {
  return require("node:crypto").createHash("sha256").update(buf).digest("hex");
}

type DeliverableRow = { id: string; firm_id: string; status: string; locale: string | null; content_kind: string } | null;

const state: {
  deliverable: DeliverableRow;
  fetchError: { message: string } | null;
  uploadError: { message: string } | null;
  signResult: { data: { signedUrl: string } | null; error: { message: string } | null };
  updateError: { message: string } | null;
  updateCalls: Array<{ table: string; payload: unknown }>;
  uploadCalls: Array<{ bucket: string; path: string }>;
  removeCalls: Array<{ bucket: string; paths: string[] }>;
} = {
  deliverable: null,
  fetchError: null,
  uploadError: null,
  signResult: { data: { signedUrl: "https://signed.example/hero.png" }, error: null },
  updateError: null,
  updateCalls: [],
  uploadCalls: [],
  removeCalls: [],
};

function chainableSelect() {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: state.deliverable, error: state.fetchError }),
  };
  return builder;
}

function chainableUpdate(payload: unknown) {
  const builder = {
    eq: () => builder,
    then: (resolve: (v: { error: unknown }) => unknown) => {
      state.updateCalls.push({ table: "content_deliverables", payload });
      return resolve({ error: state.updateError });
    },
  };
  return builder;
}

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== "content_deliverables") throw new Error(`unexpected table in mock: ${table}`);
      return {
        select: () => chainableSelect(),
        update: (payload: unknown) => chainableUpdate(payload),
      };
    },
    storage: {
      from: (bucket: string) => ({
        upload: (path: string) => {
          state.uploadCalls.push({ bucket, path });
          return Promise.resolve({ data: state.uploadError ? null : { path }, error: state.uploadError });
        },
        createSignedUrl: () => Promise.resolve(state.signResult),
        remove: (paths: string[]) => {
          state.removeCalls.push({ bucket, paths });
          return Promise.resolve({ data: null, error: null });
        },
      }),
    },
  },
}));

import { POST } from "../route";

beforeEach(() => {
  state.deliverable = { id: DELIVERABLE_ID, firm_id: FIRM_ID, status: "approved", locale: "en-CA", content_kind: "text" };
  state.fetchError = null;
  state.uploadError = null;
  state.signResult = { data: { signedUrl: "https://signed.example/hero.png" }, error: null };
  state.updateError = null;
  state.updateCalls = [];
  state.uploadCalls = [];
  state.removeCalls = [];
});

function multipartReq(opts: {
  headers?: Record<string, string>;
  firmId?: string | null;
  deliverableId?: string | null;
  expectedLocale?: string | null;
  expectedContentKind?: string | null;
  expectedSha256?: string | null;
  fileBytes?: Buffer | null;
  fileName?: string;
  omitFile?: boolean;
}): NextRequest {
  const fd = new FormData();
  if (opts.firmId !== null) fd.set("firm_id", opts.firmId ?? FIRM_ID);
  if (opts.deliverableId !== null) fd.set("deliverable_id", opts.deliverableId ?? DELIVERABLE_ID);
  if (opts.expectedLocale !== null) fd.set("expected_locale", opts.expectedLocale ?? "en-CA");
  if (opts.expectedContentKind !== null) fd.set("expected_content_kind", opts.expectedContentKind ?? "text");
  const bytes = opts.fileBytes === null ? null : (opts.fileBytes ?? PNG_MAGIC);
  if (opts.expectedSha256 !== null) fd.set("expected_sha256", opts.expectedSha256 ?? (bytes ? sha256Hex(bytes) : "0".repeat(64)));
  if (!opts.omitFile && bytes) {
    fd.set("file", new File([new Uint8Array(bytes)], opts.fileName ?? "hero.png", { type: "image/png" }));
  }
  const headers = new Headers({ authorization: `Bearer ${TOKEN}`, ...(opts.headers ?? {}) });
  return new Request(URL, { method: "POST", headers, body: fd }) as unknown as NextRequest;
}

describe("POST /api/publishing-agent/hero-package: auth", () => {
  it("missing credential (no Authorization header) -> 401, no receipt, no Supabase calls at all", async () => {
    const fd = new FormData();
    const res = await POST(new Request(URL, { method: "POST", body: fd }) as unknown as NextRequest);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.receipt).toBeUndefined();
    expect(state.updateCalls).toHaveLength(0);
    expect(state.uploadCalls).toHaveLength(0);
  });

  it("wrong credential (well-formed Bearer, wrong value) -> 401, no receipt, no writes", async () => {
    const req = multipartReq({ headers: { authorization: "Bearer not-the-real-token" } });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(state.updateCalls).toHaveLength(0);
    expect(state.uploadCalls).toHaveLength(0);
  });
});

describe("POST /api/publishing-agent/hero-package: happy path", () => {
  it("valid PNG, matching hash, matching identity -> 200, confirmed, all 12 receipt fields present, exactly one hero_image_url write", async () => {
    const res = await POST(multipartReq({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const r = body.receipt;
    expect(r.finalValidationOutcome).toBe("confirmed");
    for (const field of [
      "operationId",
      "timestamp",
      "firmId",
      "deliverableId",
      "fileName",
      "mimeType",
      "byteSize",
      "computedSha256",
      "expectedSha256",
      "storageKey",
      "resultingHeroBinding",
      "finalValidationOutcome",
    ]) {
      expect(r).toHaveProperty(field);
    }
    expect(r.firmId).toBe(FIRM_ID);
    expect(r.deliverableId).toBe(DELIVERABLE_ID);
    expect(r.resultingHeroBinding).toBe("https://signed.example/hero.png");
    expect(state.updateCalls).toHaveLength(1);
    expect(state.updateCalls[0].payload).toMatchObject({ hero_image_url: "https://signed.example/hero.png" });
    expect(Object.keys(state.updateCalls[0].payload as object).sort()).toEqual(["hero_image_url", "updated_at"].sort());
  });

  it("JPG/JPEG and WebP bytes are also accepted", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x00, 0x00]);
    const res = await POST(multipartReq({ fileBytes: jpeg, expectedSha256: sha256Hex(jpeg) }));
    expect(res.status).toBe(200);

    const webp = Buffer.alloc(16);
    webp.write("RIFF", 0, "ascii");
    webp.writeUInt32LE(8, 4);
    webp.write("WEBP", 8, "ascii");
    const res2 = await POST(multipartReq({ fileBytes: webp, expectedSha256: sha256Hex(webp) }));
    expect(res2.status).toBe(200);
  });
});

describe("POST /api/publishing-agent/hero-package: validation rejections leave the existing binding unchanged", () => {
  it("unsupported MIME -> 415, no storage write, no binding write", async () => {
    const notAnImage = Buffer.from("plain text, not an image", "utf8");
    const res = await POST(multipartReq({ fileBytes: notAnImage, expectedSha256: sha256Hex(notAnImage) }));
    expect(res.status).toBe(415);
    expect(state.uploadCalls).toHaveLength(0);
    expect(state.updateCalls).toHaveLength(0);
  });

  it("over 10MB -> 413, no writes", async () => {
    const big = Buffer.concat([PNG_MAGIC, Buffer.alloc(10 * 1024 * 1024 + 1)]);
    const res = await POST(multipartReq({ fileBytes: big, expectedSha256: sha256Hex(big) }));
    expect(res.status).toBe(413);
    expect(state.uploadCalls).toHaveLength(0);
    expect(state.updateCalls).toHaveLength(0);
  });

  it("missing expected_sha256 field -> 400, no writes", async () => {
    const res = await POST(multipartReq({ expectedSha256: null }));
    expect(res.status).toBe(400);
    expect(state.updateCalls).toHaveLength(0);
  });

  it("SHA-256 mismatch -> 422, no writes", async () => {
    const res = await POST(multipartReq({ expectedSha256: "0".repeat(64) }));
    expect(res.status).toBe(422);
    expect(state.uploadCalls).toHaveLength(0);
    expect(state.updateCalls).toHaveLength(0);
  });

  it("wrong firm (deliverable belongs to a different firm than claimed firm_id) -> 404, no writes", async () => {
    state.deliverable = { id: DELIVERABLE_ID, firm_id: OTHER_FIRM_ID, status: "approved", locale: "en-CA", content_kind: "text" };
    const res = await POST(multipartReq({}));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.receipt.finalValidationOutcome).toBe("rejected_cross_firm");
    expect(state.updateCalls).toHaveLength(0);
  });

  it("wrong deliverable (no such row) -> 404, no writes", async () => {
    state.deliverable = null;
    const res = await POST(multipartReq({}));
    expect(res.status).toBe(404);
    expect(state.updateCalls).toHaveLength(0);
  });

  it("cross-firm deliverable is rejected even though the deliverable itself is real and otherwise valid", async () => {
    state.deliverable = { id: DELIVERABLE_ID, firm_id: OTHER_FIRM_ID, status: "approved", locale: "en-CA", content_kind: "text" };
    const res = await POST(multipartReq({}));
    const body = await res.json();
    expect(body.receipt.finalValidationOutcome).toBe("rejected_cross_firm");
  });

  it("wrong locale -> 404, rejected_locale_mismatch, no writes", async () => {
    state.deliverable = { id: DELIVERABLE_ID, firm_id: FIRM_ID, status: "approved", locale: "pt-BR", content_kind: "text" };
    const res = await POST(multipartReq({}));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.receipt.finalValidationOutcome).toBe("rejected_locale_mismatch");
    expect(state.updateCalls).toHaveLength(0);
  });

  it("wrong content kind -> 404, rejected_content_kind_mismatch, no writes", async () => {
    state.deliverable = { id: DELIVERABLE_ID, firm_id: FIRM_ID, status: "approved", locale: "en-CA", content_kind: "pdf" };
    const res = await POST(multipartReq({}));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.receipt.finalValidationOutcome).toBe("rejected_content_kind_mismatch");
    expect(state.updateCalls).toHaveLength(0);
  });

  it("archived deliverable -> 404, rejected_archived, no writes", async () => {
    state.deliverable = { id: DELIVERABLE_ID, firm_id: FIRM_ID, status: "archived", locale: "en-CA", content_kind: "text" };
    const res = await POST(multipartReq({}));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.receipt.finalValidationOutcome).toBe("rejected_archived");
    expect(state.updateCalls).toHaveLength(0);
  });

  it("no arbitrary storage path field is ever read -- the storage key is always server-derived", async () => {
    const fd = new FormData();
    fd.set("firm_id", FIRM_ID);
    fd.set("deliverable_id", DELIVERABLE_ID);
    fd.set("expected_locale", "en-CA");
    fd.set("expected_content_kind", "text");
    fd.set("expected_sha256", sha256Hex(PNG_MAGIC));
    fd.set("storage_path", "../../arbitrary/escape/path.png"); // must be silently ignored, not read anywhere
    fd.set("file", new File([new Uint8Array(PNG_MAGIC)], "hero.png", { type: "image/png" }));
    const res = await POST(new Request(URL, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: fd }) as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(state.uploadCalls[0].path).not.toContain("arbitrary");
    expect(state.uploadCalls[0].path.startsWith(`deliverables/hero/${FIRM_ID}/${DELIVERABLE_ID}/`)).toBe(true);
  });

  it("a remote 'url' field instead of an actual file part is never fetched -- rejected as a malformed request, no writes", async () => {
    const fd = new FormData();
    fd.set("firm_id", FIRM_ID);
    fd.set("deliverable_id", DELIVERABLE_ID);
    fd.set("expected_locale", "en-CA");
    fd.set("expected_content_kind", "text");
    fd.set("expected_sha256", sha256Hex(PNG_MAGIC));
    fd.set("url", "https://attacker.example/payload.png"); // must never be fetched
    const res = await POST(new Request(URL, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: fd }) as unknown as NextRequest);
    expect(res.status).toBe(400);
    expect(state.uploadCalls).toHaveLength(0);
    expect(state.updateCalls).toHaveLength(0);
  });

  it("storage upload failure -> no binding write attempted at all", async () => {
    state.uploadError = { message: "simulated storage failure" };
    const res = await POST(multipartReq({}));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.receipt.finalValidationOutcome).toBe("rejected_storage_write_failed");
    expect(state.updateCalls).toHaveLength(0);
  });
});
