import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  host: "admin.caseloadselect.ca",
  cookie: undefined as string | undefined,
  row: { id: "operator-1" } as { id: string } | null,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  uploadCalls: [] as unknown[],
}));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => name.toLowerCase() === "host" ? state.host : null,
  }),
  cookies: async () => ({
    get: (name: string) => name === "portal_session" && state.cookie
      ? { value: state.cookie }
      : undefined,
  }),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return Promise.resolve({ data: state.row?.id ?? null, error: null });
    },
  },
}));

vi.mock("@/lib/preview-guard", () => ({
  denyWriteIfPreview: vi.fn(async () => null),
}));

vi.mock("@/lib/firm-files", () => ({
  listFirmFiles: vi.fn(async () => []),
  uploadFirmFile: vi.fn(async (args: unknown) => {
    state.uploadCalls.push(args);
    return {
      ok: true,
      file: {
        id: "file-1",
        kind: "link",
        section: "strategy",
        display_name: "Reference",
        size_bytes: null,
        mime_type: null,
        external_url: "https://example.test/reference",
        description: null,
        uploaded_by_role: "operator",
        created_at: "2026-09-02T00:00:00.000Z",
      },
    };
  }),
}));

vi.mock("@/lib/file-notify", () => ({
  notifyOnFirmFileUpload: vi.fn(async () => undefined),
}));

import { createSessionCookie } from "@/lib/portal-auth";
import { POST } from "../route";

const TARGET_FIRM_ID = "firm-2";

function setOperatorCookie() {
  state.cookie = createSessionCookie("firm-1", {
    role: "operator",
    lawyer_id: "operator-1",
  }).value;
}

function makeRequest(): NextRequest {
  const form = new FormData();
  form.set("kind", "link");
  form.set("section", "strategy");
  form.set("external_url", "https://example.test/reference");
  form.set("title", "Reference");
  return new Request(
    `https://${state.host}/api/portal/${TARGET_FIRM_ID}/files`,
    { method: "POST", body: form },
  ) as unknown as NextRequest;
}

function makeParams() {
  return { params: Promise.resolve({ firmId: TARGET_FIRM_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PORTAL_SECRET", "test-portal-secret");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_APP_DOMAIN", "caseloadselect.ca");
  state.host = "admin.caseloadselect.ca";
  state.cookie = undefined;
  state.row = { id: "operator-1" };
  state.rpcCalls = [];
  state.uploadCalls = [];
});

afterEach(() => vi.unstubAllEnvs());

describe("portal files operator session boundary", () => {
  it("rejects a legacy operator cookie on the lawyer app host before the write", async () => {
    state.host = "app.caseloadselect.ca";
    setOperatorCookie();

    const response = await POST(makeRequest(), makeParams());

    expect(response.status).toBe(401);
    expect(state.rpcCalls).toEqual([]);
    expect(state.uploadCalls).toEqual([]);
  });

  it("rejects a disabled operator on the admin host before the write", async () => {
    setOperatorCookie();
    state.row = null;

    const response = await POST(makeRequest(), makeParams());

    expect(response.status).toBe(401);
    expect(state.rpcCalls).toEqual([{
      name: "revalidate_operator_membership_v1",
      args: {
        p_lawyer_id: "operator-1",
        p_firm_id: "firm-1",
        p_record_sign_in: false,
      },
    }]);
    expect(state.uploadCalls).toEqual([]);
  });

  it("preserves an active operator cross-firm write on the admin host", async () => {
    setOperatorCookie();

    const response = await POST(makeRequest(), makeParams());

    expect(response.status).toBe(201);
    expect(state.uploadCalls).toHaveLength(1);
    expect(state.uploadCalls[0]).toMatchObject({
      firmId: TARGET_FIRM_ID,
      actor: { role: "operator", lawyer_id: "operator-1" },
    });
  });
});
