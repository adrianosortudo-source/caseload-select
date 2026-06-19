/**
 * Tests for the programmatic Files-hub upload endpoint
 * (POST /api/admin/firms/[firmId]/files).
 *
 * Coverage: auth reject (no cron token, no operator session), happy path via
 * operator session, happy path via cron bearer, invalid section, oversize.
 * The real firm-files I/O and signed-URL helpers are mocked; the route's own
 * parsing, auth, and validation are exercised.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

interface UploadResult {
  ok: boolean;
  file?: Record<string, unknown>;
  status?: number;
  reason?: string;
  message?: string;
}

const state: {
  cronAuthed: boolean;
  operatorSession: { firm_id: string; role: "operator"; lawyer_id: string | null; exp: number } | null;
  uploadResult: UploadResult;
  uploadCalls: unknown[];
} = {
  cronAuthed: false,
  operatorSession: null,
  uploadResult: { ok: true },
  uploadCalls: [],
};

vi.mock("@/lib/cron-auth", () => ({
  isCronAuthorized: () => state.cronAuthed,
}));

vi.mock("@/lib/portal-auth", () => ({
  getOperatorSession: () => Promise.resolve(state.operatorSession),
}));

vi.mock("@/lib/firm-files", () => ({
  uploadFirmFile: (args: unknown) => {
    state.uploadCalls.push(args);
    return Promise.resolve(state.uploadResult);
  },
  getFirmFileSignedUrl: () =>
    Promise.resolve({ ok: true, url: "https://signed.example/file", expires_in_seconds: 60 }),
}));

// Real-equivalent pure helpers, but a tiny size cap so oversize is testable
// without allocating 100 MB.
vi.mock("@/lib/firm-files-pure", () => {
  const SECTIONS = ["brand", "strategy", "reports", "assets", "admin"];
  return {
    isValidSection: (v: string) => SECTIONS.includes(v),
    FILE_SECTIONS: SECTIONS,
    MAX_FILE_SIZE_BYTES: 50,
  };
});

import { POST } from "../route";

const FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const URL = `https://app.caseloadselect.ca/api/admin/firms/${FIRM_ID}/files`;

function makeParams(): { params: Promise<{ firmId: string }> } {
  return { params: Promise.resolve({ firmId: FIRM_ID }) };
}

function multipartReq(opts: { section?: string; bytes?: number; filename?: string } = {}): NextRequest {
  const fd = new FormData();
  const content = "x".repeat(opts.bytes ?? 10);
  fd.append("file", new File([content], opts.filename ?? "backup.md", { type: "text/markdown" }));
  if (opts.section !== undefined) fd.append("section", opts.section);
  fd.append("note", "automation upload");
  return new Request(URL, { method: "POST", body: fd }) as unknown as NextRequest;
}

function okUpload(): UploadResult {
  return {
    ok: true,
    file: {
      id: "ff-1",
      firm_id: FIRM_ID,
      section: "admin",
      display_name: "backup.md",
      mime_type: "text/markdown",
      size_bytes: 10,
      uploaded_by_role: "operator",
      created_at: "2026-06-19T00:00:00.000Z",
    },
  };
}

beforeEach(() => {
  state.cronAuthed = false;
  state.operatorSession = null;
  state.uploadResult = okUpload();
  state.uploadCalls = [];
});

describe("POST /api/admin/firms/[firmId]/files", () => {
  it("rejects with 401 when neither cron token nor operator session is present", async () => {
    const res = await POST(multipartReq({ section: "admin" }), makeParams());
    expect(res.status).toBe(401);
    expect(state.uploadCalls).toHaveLength(0);
  });

  it("accepts an operator session and returns the created record (201)", async () => {
    state.operatorSession = { firm_id: FIRM_ID, role: "operator", lawyer_id: null, exp: Date.now() + 1000 };
    const res = await POST(multipartReq({ section: "admin" }), makeParams());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.file.section).toBe("admin");
    expect(body.file.filename).toBe("backup.md");
    expect(body.file.signed_url).toBe("https://signed.example/file");

    expect(state.uploadCalls).toHaveLength(1);
    const args = state.uploadCalls[0] as Record<string, unknown>;
    expect(args.firmId).toBe(FIRM_ID);
    expect(args.kind).toBe("file");
    expect(args.section).toBe("admin");
    expect((args.actor as { role: string }).role).toBe("operator");
  });

  it("accepts a cron bearer token (headless curl path)", async () => {
    state.cronAuthed = true;
    const res = await POST(multipartReq({ section: "reports" }), makeParams());
    expect(res.status).toBe(201);
    expect(state.uploadCalls).toHaveLength(1);
  });

  it("rejects an invalid section with 400 and does not upload", async () => {
    state.cronAuthed = true;
    const res = await POST(multipartReq({ section: "not_a_section" }), makeParams());
    expect(res.status).toBe(400);
    expect(state.uploadCalls).toHaveLength(0);
  });

  it("rejects a missing section with 400", async () => {
    state.cronAuthed = true;
    const res = await POST(multipartReq({}), makeParams());
    expect(res.status).toBe(400);
    expect(state.uploadCalls).toHaveLength(0);
  });

  it("rejects an oversize file with 413 and does not upload", async () => {
    state.cronAuthed = true;
    const res = await POST(multipartReq({ section: "admin", bytes: 100 }), makeParams());
    expect(res.status).toBe(413);
    expect(state.uploadCalls).toHaveLength(0);
  });

  it("supports the JSON base64 body shape", async () => {
    state.cronAuthed = true;
    const base64 = Buffer.from("hello").toString("base64");
    const req = new Request(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "note.txt", contentType: "text/plain", base64, section: "admin" }),
    }) as unknown as NextRequest;
    const res = await POST(req, makeParams());
    expect(res.status).toBe(201);
    expect(state.uploadCalls).toHaveLength(1);
  });
});
