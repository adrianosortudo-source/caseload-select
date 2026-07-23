/**
 * Tests for POST /api/firm-profile/[token]/submit.
 *
 * Client-list intake added a required two-path choice (share_with_us /
 * self_upload) with a CASL consent attestation, validated via
 * validateClientListSubmission before the row is inserted. Coverage: the
 * four 400 rejection paths, and the insert payload shape on the two happy
 * paths (share and self).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const state = {
  insertPayload: null as Record<string, unknown> | null,
  insertError: null as { message: string } | null,
};

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => Promise.resolve({ ok: true, active: false, remaining: 0, reset: 0, limit: 10 }),
  ipFromRequest: () => "203.0.113.9",
  rateLimitHeaders: () => ({}),
}));

vi.mock("@/lib/firm-onboarding-notification", () => ({
  sendOperatorNotification: () => Promise.resolve({ ok: true, sentTo: "adriano@caseloadselect.ca" }),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        state.insertPayload = payload;
        return {
          select: () => ({
            single: () =>
              Promise.resolve(
                state.insertError
                  ? { data: null, error: state.insertError }
                  : {
                      data: {
                        id: "row-1",
                        submission_token: payload.submission_token,
                        submitted_at: "2026-07-22T00:00:00Z",
                        legal_name: payload.legal_name,
                      },
                      error: null,
                    },
              ),
          }),
        };
      },
    }),
  },
}));

import { POST } from "../route";

const TOKEN = "DRG-LAW-2026-07-22";
const PREFIX = `${encodeURIComponent(TOKEN)}/`;

function jsonReq(body: Record<string, unknown>) {
  return { json: async () => body, headers: { get: () => null } } as never;
}

const params = () => ({ params: Promise.resolve({ token: TOKEN }) }) as never;

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    legal_name: "DRG Law",
    authorized_rep_email: "damaris@drglaw.ca",
    signed_name: "Damaris",
    ...overrides,
  };
}

beforeEach(() => {
  state.insertPayload = null;
  state.insertError = null;
});

describe("POST firm-profile submit, client-list validation", () => {
  it("400s when authorized_rep_email is missing", async () => {
    const res = await POST(jsonReq(baseBody({ authorized_rep_email: undefined })), params());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("authorized_rep_email is required");
  });

  it("400s when client_list_path is missing", async () => {
    const res = await POST(jsonReq(baseBody()), params());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("client_list_path is required (share_with_us or self_upload)");
  });

  it("400s when the share_with_us path has no files", async () => {
    const res = await POST(
      jsonReq(baseBody({ client_list_path: "share_with_us", client_list_attested: true, client_list_files: [] })),
      params(),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("at least one uploaded file is required on the share_with_us path");
  });

  it("400s when the self_upload path is not confirmed", async () => {
    const res = await POST(
      jsonReq(baseBody({ client_list_path: "self_upload", client_list_attested: true })),
      params(),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("self-upload confirmation is required");
  });

  it("400s when the consent attestation is missing", async () => {
    const res = await POST(
      jsonReq(baseBody({ client_list_path: "self_upload", client_list_self_upload_confirmed: true })),
      params(),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("the consent attestation is required");
  });

  it("share happy path: persists the path, files, attested timestamp, and confirmed=false", async () => {
    const file = {
      storage_path: `${PREFIX}profile/1-list.csv`,
      original_name: "list.csv",
      size_bytes: 1024,
      mime_type: "text/csv",
    };
    const res = await POST(
      jsonReq(
        baseBody({ client_list_path: "share_with_us", client_list_attested: true, client_list_files: [file] }),
      ),
      params(),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(state.insertPayload?.client_list_path).toBe("share_with_us");
    expect(state.insertPayload?.client_list_files).toEqual([file]);
    expect(state.insertPayload?.client_list_attested_at).toEqual(expect.any(String));
    expect(state.insertPayload?.client_list_self_upload_confirmed).toBe(false);
  });

  it("self happy path: persists an empty files array and confirmed=true", async () => {
    const res = await POST(
      jsonReq(
        baseBody({
          client_list_path: "self_upload",
          client_list_attested: true,
          client_list_self_upload_confirmed: true,
        }),
      ),
      params(),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(state.insertPayload?.client_list_path).toBe("self_upload");
    expect(state.insertPayload?.client_list_files).toEqual([]);
    expect(state.insertPayload?.client_list_self_upload_confirmed).toBe(true);
  });
});
