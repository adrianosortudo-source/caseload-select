import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  portalCookie: undefined as string | undefined,
  qaCookie: "preview-read-only-token",
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      if (name === "portal_session" && state.portalCookie) return { value: state.portalCookie };
      if (name === "preview_qa_session") return { value: state.qaCookie };
      return undefined;
    },
  }),
  headers: async () => ({ get: () => "admin.caseloadselect.ca" }),
}));

import { POST, PUT } from "../route";
import { createSessionCookie } from "@/lib/portal-auth";

function request(method: "POST" | "PUT") {
  return new NextRequest("https://preview-qa-git-example.vercel.app/admin/prospects/research-import", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceName: "qa-adversarial", records: [] }),
  });
}

beforeEach(() => {
  vi.stubEnv("PORTAL_SECRET", "test-portal-secret");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("NEXT_PUBLIC_APP_DOMAIN", "caseloadselect.ca");
  // The portal cookie is valid. The separate QA cookie must nevertheless
  // make the direct mutation handler reject it before reading the body or DB.
  state.portalCookie = createSessionCookie("firm-1", {
    role: "operator",
    lawyer_id: "operator-1",
  }).value;
});

afterEach(() => vi.unstubAllEnvs());

describe("research import direct mutation QA denial", () => {
  it.each([
    ["POST", POST],
    ["PUT", PUT],
  ] as const)("rejects a mixed QA/operator cookie %s without relying on middleware", async (method, handler) => {
    const response = await handler(request(method));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });
});
