import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { judgeAuthorityScreenshot, AUTHORITY_JUDGMENT_RUBRIC_ITEMS } from "../authority-vision";
import { judgeScreenshot, JUDGMENT_RUBRIC_ITEMS } from "../vision-judgment";
import { websiteReviewProvider } from "@/lib/ai/website-review-rollout";

const screenshot = Buffer.from("fixture screenshot");
function answer(keys: readonly { key: string }[]) {
  return Response.json({
    status: "completed",
    usage: { input_tokens: 190, output_tokens: 60 },
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
      judgments: keys.map(({ key }) => ({ item: key, score: 70, reason: "The visible heading stands apart." })),
    }) }] }],
  });
}
beforeEach(() => {
  vi.stubEnv("WEBSITE_DESIGN_CHECK_PROVIDER", "openai");
  vi.stubEnv("CASELOAD_OPENAI_API_KEY", "test");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Website Design Review on OpenAI", () => {
  it("runs both rubrics with the screenshot and reuses their validation, retry and usage contracts", async () => {
    vi.stubEnv("WEBSITE_DESIGN_CHECK_OPENAI_PERCENT", "10");
    const provider = websiteReviewProvider("WEBSITE_DESIGN_CHECK", "192.0.2.9");
    const mock = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => {
        vi.stubEnv("WEBSITE_DESIGN_CHECK_OPENAI_PERCENT", "0");
        return answer([]);
      })
      .mockResolvedValueOnce(answer(JUDGMENT_RUBRIC_ITEMS))
      .mockResolvedValueOnce(answer(AUTHORITY_JUDGMENT_RUBRIC_ITEMS));
    vi.stubGlobal("fetch", mock);
    const deadline = Date.now() + 5000;
    const design = await judgeScreenshot(screenshot, [], deadline, provider);
    const authority = await judgeAuthorityScreenshot(screenshot, "Site signals", deadline, provider);
    expect(design.judgments).toHaveLength(7);
    expect(authority.judgments).toHaveLength(6);
    expect(authority.screenshotHash).toBe(design.screenshotHash);
    expect(authority.usage).toEqual({ inputTokens: 190, outputTokens: 60 });
    expect(mock).toHaveBeenCalledTimes(3);
    for (const [url, options] of mock.mock.calls) {
      expect(url).toBe("https://api.openai.com/v1/responses");
      const body = JSON.parse(String(options?.body));
      expect(body.input[0].content).toContainEqual({
        type: "input_image", image_url: `data:image/png;base64,${screenshot.toString("base64")}`, detail: "high",
      });
      expect(body.text.format.schema.additionalProperties).toBe(false);
      expect(body.text.format.schema.properties.judgments.items.additionalProperties).toBe(false);
    }
  });
  it("returns a transport failure to the route's deterministic fallback without a second provider call", async () => {
    const mock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", mock);
    await expect(judgeScreenshot(screenshot, [])).rejects.toThrow();
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
