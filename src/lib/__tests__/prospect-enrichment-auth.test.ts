import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { NextRequest } from "next/server";

const authState = vi.hoisted(() => ({
  session: null as null | { role: "operator"; firm_id: string; lawyer_id?: string; exp: number },
  sameOrigin: true,
}));

vi.mock("@/lib/portal-auth", () => ({
  getOperatorSession: vi.fn(async () => authState.session),
}));
vi.mock("@/lib/client-import-server", () => ({
  validateSameOrigin: vi.fn(() => authState.sameOrigin),
}));

import { readBoundedJson, requireProspectEnrichmentOperator } from "../prospect-enrichment-auth";

const operatorId = "11111111-1111-4111-8111-111111111111";
const request = () => new NextRequest("https://admin.example.test/api/admin/prospect-enrichment/packages", { method: "POST" });

beforeEach(() => {
  authState.session = { role: "operator", firm_id: "22222222-2222-4222-8222-222222222222", lawyer_id: operatorId, exp: 2_000_000_000 };
  authState.sameOrigin = true;
});

afterEach(() => vi.clearAllMocks());

describe("prospect-enrichment route authorization", () => {
  it("requires a current operator session", async () => {
    authState.session = null;
    const result = await requireProspectEnrichmentOperator(request(), true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("requires same-origin requests for operator mutations", async () => {
    authState.sameOrigin = false;
    const result = await requireProspectEnrichmentOperator(request(), true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("requires the operator's session-bound UUID for audited writes", async () => {
    authState.session = { role: "operator", firm_id: "22222222-2222-4222-8222-222222222222", exp: 2_000_000_000 };
    const result = await requireProspectEnrichmentOperator(request(), false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("returns the UUID from the verified operator session", async () => {
    const result = await requireProspectEnrichmentOperator(request(), false);
    expect(result).toEqual({ ok: true, operator: { id: operatorId, session: authState.session } });
  });
});

describe("bounded JSON request bodies", () => {
  it("returns parsed JSON and retains the exact UTF-8 body text", async () => {
    const body = '{"name":"café"}';
    const result = await readBoundedJson(new Request("https://admin.example.test", { method: "POST", body }), 100);
    expect(result).toEqual({ ok: true, text: body, value: { name: "café" } });
  });

  it("accepts opted-in gzip while bounding both compressed and decoded bytes", async () => {
    const original = Buffer.from('{"name":"café"}');
    const compressed = gzipSync(original);
    const options = { gzip: { maxCompressedBytes: compressed.byteLength, maxDecompressedBytes: original.byteLength } };
    const request = new Request("https://admin.example.test", { method: "POST", headers: { "content-encoding": "gzip" }, body: compressed });
    await expect(readBoundedJson(request, 100, options)).resolves.toMatchObject({ ok: true, text: original.toString("utf8"), value: { name: "café" } });
    const disabled = new Request("https://admin.example.test", { method: "POST", headers: { "content-encoding": "gzip" }, body: compressed });
    await expect(readBoundedJson(disabled, 100)).resolves.toMatchObject({ ok: false, status: 400 });
    const compressedTooLarge = new Request("https://admin.example.test", { method: "POST", headers: { "content-encoding": "gzip" }, body: compressed });
    await expect(readBoundedJson(compressedTooLarge, 100, { gzip: { ...options.gzip, maxCompressedBytes: compressed.byteLength - 1 } })).resolves.toMatchObject({ ok: false, status: 413 });
    const decodedTooLarge = new Request("https://admin.example.test", { method: "POST", headers: { "content-encoding": "gzip" }, body: compressed });
    await expect(readBoundedJson(decodedTooLarge, 100, { gzip: { ...options.gzip, maxDecompressedBytes: original.byteLength - 1 } })).resolves.toMatchObject({ ok: false, status: 413 });
    const malformed = new Request("https://admin.example.test", { method: "POST", headers: { "content-encoding": "gzip" }, body: Buffer.from("not-gzip") });
    await expect(readBoundedJson(malformed, 100, options)).resolves.toMatchObject({ ok: false, status: 400 });
    const trailing = new Request("https://admin.example.test", { method: "POST", headers: { "content-encoding": "gzip" }, body: Buffer.concat([compressed, Buffer.from("trailing")]) });
    await expect(readBoundedJson(trailing, 100, { gzip: { maxCompressedBytes: 100, maxDecompressedBytes: 100 } })).resolves.toMatchObject({ ok: false, status: 400 });
  });

  it("accepts a gzip body above the ordinary JSON cap only within its separate decoded ceiling", async () => {
    const original = Buffer.from(JSON.stringify({ payload: "x".repeat(17 * 1024 * 1024) }));
    const compressed = gzipSync(original);
    expect(compressed.byteLength).toBeLessThan(4 * 1024 * 1024);
    const request = new Request("https://admin.example.test", { method: "POST", headers: { "content-encoding": "gzip" }, body: compressed });
    const result = await readBoundedJson(request, 16 * 1024 * 1024, { gzip: { maxCompressedBytes: 4 * 1024 * 1024, maxDecompressedBytes: 32 * 1024 * 1024 } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(Buffer.byteLength(result.text)).toBe(original.byteLength);
    const plainRequest = new Request("https://admin.example.test", { method: "POST", body: original });
    await expect(readBoundedJson(plainRequest, 16 * 1024 * 1024, { gzip: { maxCompressedBytes: 4 * 1024 * 1024, maxDecompressedBytes: 32 * 1024 * 1024 } })).resolves.toMatchObject({ ok: false, status: 413 });
  });

  it("rejects a declared body over the byte limit before reading it", async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
    const request = new Request("https://admin.example.test", { method: "POST", body, headers: { "content-length": "101" }, duplex: "half" } as RequestInit);
    await expect(readBoundedJson(request, 100)).resolves.toMatchObject({ ok: false, status: 413 });
  });

  it("rejects a streamed body as soon as the byte limit is crossed", async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(80)); controller.enqueue(new Uint8Array(21)); controller.close(); } });
    const request = new Request("https://admin.example.test", { method: "POST", body, duplex: "half" } as RequestInit);
    await expect(readBoundedJson(request, 100)).resolves.toMatchObject({ ok: false, status: 413 });
  });

  it("rejects malformed JSON", async () => {
    const result = await readBoundedJson(new Request("https://admin.example.test", { method: "POST", body: "{" }), 100);
    expect(result).toMatchObject({ ok: false, status: 400 });
  });
});
