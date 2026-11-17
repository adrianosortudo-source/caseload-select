import "server-only";
import { GoogleGenerativeAI, type GenerationConfig } from "@google/generative-ai";
import { getProvider, hasOpenAIKey, requestOpenAI } from "@/lib/ai/openai";
import { toOpenAIJsonSchema } from "@/lib/ai/openai-schema";

function googleKey(): string | undefined {
  return process.env.GOOGLE_AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
}

export function desiredClientModelId(): string {
  return getProvider("DESIRED_CLIENT_PROVIDER") === "openai"
    ? process.env.DESIRED_CLIENT_OPENAI_MODEL ?? "gpt-6-luna"
    : "gemini-2.5-flash";
}

export function desiredClientHasKey(): boolean {
  return getProvider("DESIRED_CLIENT_PROVIDER") === "openai" ? hasOpenAIKey() : Boolean(googleKey());
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
  { instructions, schema, maxOutputTokens, thinkingBudget, timeoutMs }: GenerationSettings,
): Promise<{ text: string; finishReason?: string }> {
  const model = desiredClientModelId();
  if (getProvider("DESIRED_CLIENT_PROVIDER") === "openai") {
    return requestOpenAI({
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
