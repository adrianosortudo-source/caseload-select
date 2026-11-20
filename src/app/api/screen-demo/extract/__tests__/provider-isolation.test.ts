import { afterEach, describe, expect, it, vi } from "vitest";

const { handle } = vi.hoisted(() => ({ handle: vi.fn(async () => Response.json({ mode: "live" })) }));
vi.mock("@/lib/screen-extraction-handler", () => ({ handleScreenExtraction: handle }));
import { GET, POST } from "../route";
import { POST as legacyExtract } from "@/app/api/extract/route";

afterEach(() => { vi.unstubAllEnvs(); handle.mockClear(); });

describe("public demo extraction compatibility", () => {
  it("reports live extraction as unavailable to an older tab", async () => {
    const res = GET();
    expect(await res.json()).toEqual({ available: false });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(handle).not.toHaveBeenCalled();
  });

  it.each(["openai", "gemini"])("keeps an older %s tab local regardless of stale consent", async (provider) => {
    vi.stubEnv("SCREEN_DEMO_AI_PROVIDER", provider);
    vi.stubEnv("SCREEN_DEMO_AI_OPENAI_PERCENT", "100");
    vi.stubEnv("CASELOAD_OPENAI_API_KEY", "test");
    vi.stubEnv("GOOGLE_AI_API_KEY", "test");
    const req = new Request("https://example.test/api/screen-demo/extract", {
      method: "POST",
      headers: { "X-Screen-Demo-Provider": provider, "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Fictional contract question" }),
    });
    const res = POST(req);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ mode: "disabled", extracted: {} });
    expect(req.bodyUsed).toBe(false);
    expect(handle).not.toHaveBeenCalled();
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
