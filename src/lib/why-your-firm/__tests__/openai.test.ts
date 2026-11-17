import { afterEach, expect, it, vi } from "vitest";
import { requestOpenAI } from "@/lib/ai/openai";
import { runAssist } from "../assist";

vi.mock("@/lib/ai/openai", async (original) => ({
  ...await original<typeof import("@/lib/ai/openai")>(), requestOpenAI: vi.fn(),
}));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

it("selects the disclosed provider and validates the rewrites it returns", async () => {
  vi.stubEnv("WHY_YOUR_FIRM_ASSIST_PROVIDER", "openai");
  vi.stubEnv("CASELOAD_OPENAI_API_KEY", "fictional-project-key");
  const request = {claim:"We give clients a written checklist."};
  const valid = {tightenedClaim:"Clients receive a written checklist.",category:"practice_focus",concerns:[]};
  vi.mocked(requestOpenAI)
    .mockResolvedValueOnce({text:JSON.stringify(valid),inputTokens:10,outputTokens:10})
    .mockResolvedValueOnce({text:JSON.stringify({...valid,category:"unsupported"}),inputTokens:10,outputTokens:10});
  expect(await runAssist(request)).toEqual({mode:"live",result:valid});
  expect(await runAssist(request)).toMatchObject({mode:"error"});
  expect(requestOpenAI).toHaveBeenCalledTimes(2);
  expect(requestOpenAI).toHaveBeenCalledWith(expect.objectContaining({
    model:"gpt-6-luna",format:expect.objectContaining({schema:expect.objectContaining({additionalProperties:false})}),
  }));
});

it("asks a visitor with an older disclosure to reload before sending their claim", async () => {
  vi.stubEnv("WHY_YOUR_FIRM_ASSIST_PROVIDER", "openai");
  const { POST } = await import("@/app/api/tools/why-your-firm/assist/route");
  const req = new Request("https://app.caseloadselect.ca/api/tools/why-your-firm/assist", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ claim: "A fictional claim with a dated checklist." }),
  }) as Parameters<typeof POST>[0];
  expect((await POST(req)).status).toBe(409);
  expect(requestOpenAI).not.toHaveBeenCalled();
});
