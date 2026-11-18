import { afterEach, describe, expect, it, vi } from "vitest";

const { handle } = vi.hoisted(() => ({ handle: vi.fn(async () => Response.json({ mode: "live" })) }));
vi.mock("@/lib/screen-extraction-handler", () => ({ handleScreenExtraction: handle }));
import { GET, POST } from "../route";
import { POST as legacyExtract } from "@/app/api/extract/route";

afterEach(() => { vi.unstubAllEnvs(); handle.mockClear(); });

describe("public demo provider disclosure", () => {
  it("reports the selected provider without processing a description", async () => {
    vi.stubEnv("SCREEN_DEMO_AI_PROVIDER", "openai");
    vi.stubEnv("CASELOAD_OPENAI_API_KEY", "test");
    const res = await GET(new Request("https://example.test/api/screen-demo/extract"));
    expect(await res.json()).toEqual({ provider: "openai", available: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(handle).not.toHaveBeenCalled();
  });

  it("requires the visitor's selected provider to match the current disclosure", async () => {
    vi.stubEnv("SCREEN_DEMO_AI_PROVIDER", "openai");
    vi.stubEnv("CASELOAD_OPENAI_API_KEY", "test");
    for (const selected of ["", "gemini"]) {
      const req = new Request("https://example.test/api/screen-demo/extract", {
        method: "POST", headers: { "X-Screen-Demo-Provider": selected, referer: "https://example.test/screen-demo-app/index.html" },
      });
      expect((await POST(req)).status).toBe(409);
    }
    expect(handle).not.toHaveBeenCalled();
    const req = new Request("https://example.test/api/screen-demo/extract", {
      method: "POST", headers: { "X-Screen-Demo-Provider": "openai" },
    });
    expect((await POST(req)).status).toBe(200);
    expect(handle).toHaveBeenCalledWith(req, "openai", "public-demo");
  });

  it("preserves the legacy Gemini disclosure for any referrer or client-supplied provider marker", async () => {
    vi.stubEnv("SCREEN_DEMO_AI_PROVIDER", "openai");
    vi.stubEnv("SCREEN_INTAKE_AI_PROVIDER", "openai");
    const req = new Request("https://example.test/api/extract", { method: "POST", headers: {
      referer: "https://example.test/screen-demo-app/index.html", "X-Screen-Demo-Provider": "openai",
    } });
    await legacyExtract(req);
    expect(handle).toHaveBeenCalledWith(req, "gemini");
  });
});
