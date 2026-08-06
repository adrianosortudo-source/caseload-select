/**
 * Tests for POST /api/firm-profile/[token]/upload.
 *
 * Client-list intake widened this route to accept whatever raw file a firm
 * already has (spreadsheets, PDFs, documents, contact exports, photos of a
 * printed list) at up to 50 MB, rather than the original CSV/Excel/PDF-only
 * 10 MB cap. Coverage: the extension-fallback path for a blank/odd MIME
 * type, two of the newly widened formats, the new size ceiling, an
 * unsupported extension, and the pre-existing empty-file rejection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const state = {
  uploadArgs: null as { path: string; contentType: string } | null,
  uploadError: null as { message: string } | null,
};

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => Promise.resolve({ ok: true, active: false, remaining: 0, reset: 0, limit: 30 }),
  ipFromRequest: () => "203.0.113.9",
  rateLimitHeaders: () => ({}),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        upload: (path: string, _buffer: Uint8Array, opts: { contentType: string }) => {
          state.uploadArgs = { path, contentType: opts.contentType };
          return Promise.resolve({ data: { path }, error: state.uploadError });
        },
      }),
    },
  },
}));

import { POST } from "../route";

const TOKEN = "DRG-LAW-2026-07-22";

function multipartReq(form: FormData) {
  return {
    formData: async () => form,
  } as never;
}

const params = () => ({ params: Promise.resolve({ token: TOKEN }) }) as never;

beforeEach(() => {
  state.uploadArgs = null;
  state.uploadError = null;
});

describe("POST firm-profile upload", () => {
  it("accepts an xlsx sent with a blank MIME type via the extension fallback", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3])], "clients.xlsx", { type: "" }));
    const res = await POST(multipartReq(form), params());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(state.uploadArgs?.path).toContain("clients.xlsx");
  });

  it("accepts an image/heic photo of a printed list", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3])], "list-photo.heic", { type: "image/heic" }));
    const res = await POST(multipartReq(form), params());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("accepts a text/vcard contact export", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3])], "contacts.vcf", { type: "text/vcard" }));
    const res = await POST(multipartReq(form), params());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("rejects a file over the 50 MB cap", async () => {
    const big = new Uint8Array(50 * 1024 * 1024 + 1);
    const form = new FormData();
    form.append("file", new File([big], "huge.csv", { type: "text/csv" }));
    const res = await POST(multipartReq(form), params());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain("file too large");
  });

  it("rejects an unsupported extension", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3])], "script.exe", { type: "application/x-msdownload" }));
    const res = await POST(multipartReq(form), params());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain("unsupported file type");
  });

  it("rejects an empty file", async () => {
    const form = new FormData();
    form.append("file", new File([], "empty.csv", { type: "text/csv" }));
    const res = await POST(multipartReq(form), params());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("empty file");
  });
});
