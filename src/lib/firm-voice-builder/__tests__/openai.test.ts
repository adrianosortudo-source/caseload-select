import { afterEach, expect, it, vi } from "vitest";
import { requestOpenAI } from "@/lib/ai/openai";
import { normalizeOpenAIVoiceProfile, runOpenAIVoiceTurn } from "../openai";
import { OPENING_MESSAGE, PROFILE_START_MARKER, PROFILE_END_MARKER, SYSTEM_PROMPT } from "../system-prompt";

vi.mock("@/lib/ai/openai", async (original) => ({
  ...await original<typeof import("@/lib/ai/openai")>(), requestOpenAI: vi.fn(),
}));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

it("keeps the raw previous profile in the revision context", async () => {
  vi.stubEnv("CASELOAD_OPENAI_API_KEY", "fictional-key");
  const raw = "[SECTION:7]\n" + PROFILE_START_MARKER + "\nPrior guide.\n" + PROFILE_END_MARKER;
  vi.mocked(requestOpenAI).mockResolvedValue({ text: raw, inputTokens: 42, outputTokens: 22 });
  const result = await runOpenAIVoiceTurn([
    { role:"interviewer",text:OPENING_MESSAGE },{ role:"lawyer",text:"Fictional answer" },
    { role:"interviewer",text:raw },{ role:"lawyer",text:"Please revise the opening." },
  ]);
  expect(result).toEqual({ mode:"live",text:raw });
  expect(requestOpenAI).toHaveBeenCalledWith(expect.objectContaining({
    instructions:expect.stringContaining(SYSTEM_PROMPT), input:[
      {role:"assistant",content:OPENING_MESSAGE},{role:"user",content:"Fictional answer"},
      {role:"assistant",content:raw},{role:"user",content:"Please revise the opening."},
    ],
  }));
});

it("uses only the dedicated project key", async () => {
  vi.stubEnv("CASELOAD_OPENAI_API_KEY", "");
  vi.stubEnv("GOOGLE_AI_API_KEY", "fictional-other-provider-key");
  expect(await runOpenAIVoiceTurn([])).toEqual({mode:"disabled"});
  expect(requestOpenAI).not.toHaveBeenCalled();
});


it("removes a redundant opening marker before the quick card without dropping profile or proof text", () => {
  const raw = [ "[SECTION:7]", PROFILE_START_MARKER, "My rules", PROFILE_START_MARKER,
    "Quick reference card", PROFILE_END_MARKER, "Proof pieces" ].join("\n");
  expect(normalizeOpenAIVoiceProfile(raw)).toBe([
    "[SECTION:7]", PROFILE_START_MARKER, "My rules", "Quick reference card", PROFILE_END_MARKER, "Proof pieces",
  ].join("\n"));
});
