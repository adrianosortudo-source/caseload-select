import "server-only";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { requestOpenAI, type AiProvider } from "@/lib/ai/openai";
import { toOpenAIJsonSchema } from "@/lib/ai/openai-schema";

interface VisionInput {
  provider: AiProvider;
  instructions: string;
  prompt: string;
  screenshot: Buffer;
  schemaName: string;
  schema: Record<string, unknown>;
  deadline: number;
}

export async function requestDesignJudgments(input: VisionInput) {
  const start = Date.now();
  const { provider } = input;
  const model = provider === "openai" ? process.env.WEBSITE_DESIGN_CHECK_OPENAI_MODEL?.trim() || "gpt-6.1-terra" : "gemini-2.5-flash";
  const result = await generate(input, model);
  console.info("[design-check] vision", {
    model, rubric: input.schemaName, durationMs: Date.now() - start,
    inputTokens: result.inputTokens, outputTokens: result.outputTokens,
  });
  return result;
}

async function generate(input: VisionInput, modelId: string) {
  const data = input.screenshot.toString("base64");
  if (input.provider === "openai") {
    const remaining = input.deadline - Date.now();
    if (remaining <= 0) throw new Error("Design review timed out");
    return requestOpenAI({
      model: modelId,
      instructions: input.instructions,
      input: [{ role: "user", content: [
        { type: "input_image", image_url: `data:image/png;base64,${data}`, detail: "high" },
        { type: "input_text", text: input.prompt },
      ] }],
      format: { name: input.schemaName, schema: toOpenAIJsonSchema(input.schema), strict: true },
      maxOutputTokens: 3072,
      signal: AbortSignal.timeout(Math.min(30000, remaining)),
    });
  }
  const apiKey = process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("No Gemini API key configured (set GOOGLE_AI_API_KEY or GEMINI_API_KEY).");
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: modelId,
    systemInstruction: input.instructions,
    generationConfig: { responseMimeType: "application/json", responseSchema: input.schema as never },
  });
  const result = await model.generateContent([
    { inlineData: { mimeType: "image/png", data } }, { text: input.prompt },
  ]);
  return {
    text: result.response.text(),
    inputTokens: result.response.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: result.response.usageMetadata?.candidatesTokenCount ?? 0,
  };
}
