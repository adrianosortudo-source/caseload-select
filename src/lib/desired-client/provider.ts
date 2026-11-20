import { PUBLIC_TOOL_LANGUAGE } from "@/lib/ai/public-tool-language";
import "server-only";
import { requestPublicToolOpenAI } from "@/lib/ai/public-tool-pilot-budget";
import { GoogleGenerativeAI, type GenerationConfig } from "@google/generative-ai";
import { getProvider, hasOpenAIKey } from "@/lib/ai/openai";
import { toOpenAIJsonSchema } from "@/lib/ai/openai-schema";

function googleKey(): string | undefined {
  return process.env.GOOGLE_AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
}

export function desiredClientModelId(provider = getProvider("DESIRED_CLIENT_PROVIDER")): string {
  return provider === "openai"
    ? process.env.DESIRED_CLIENT_OPENAI_MODEL ?? "gpt-6-luna"
    : "gemini-2.5-flash";
}

export function desiredClientHasKey(provider = getProvider("DESIRED_CLIENT_PROVIDER")): boolean {
  return provider === "openai" ? hasOpenAIKey() : Boolean(googleKey());
}

interface GenerationSettings {
  instructions: string;
  schema: unknown;
  maxOutputTokens: number;
  thinkingBudget: number;
  timeoutMs: number;
}

export async function generateDesiredClientText(
  input: string,
  { instructions: task, schema, maxOutputTokens, thinkingBudget, timeoutMs }: GenerationSettings,
  provider = getProvider("DESIRED_CLIENT_PROVIDER"),
): Promise<{ text: string; finishReason?: string }> {
  const model = desiredClientModelId(provider);
  const instructions = `${task}\n\n${PUBLIC_TOOL_LANGUAGE}`;
  if (provider === "openai") {
    return requestPublicToolOpenAI({
      model, instructions, input, maxOutputTokens,
      format: { name: "best_case_profile", schema: toOpenAIJsonSchema(schema as Record<string, unknown>) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  }
  const key = googleKey();
  if (!key) throw new Error("Missing Gemini configuration");
  const gemini = new GoogleGenerativeAI(key).getGenerativeModel({
    model, systemInstruction: instructions,
    generationConfig: {
      temperature: 0.2, maxOutputTokens,
      responseMimeType: "application/json", responseSchema: schema,
      thinkingConfig: { thinkingBudget },
    } as GenerationConfig,
  }, { timeout: timeoutMs });
  const { response } = await gemini.generateContent(input);
  return { text: response.text(), finishReason: response.candidates?.[0]?.finishReason };
}
