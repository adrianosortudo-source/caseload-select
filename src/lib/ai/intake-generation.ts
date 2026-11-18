import 'server-only';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { toOpenAIJsonSchema } from './openai-schema';
import { getProvider, hasOpenAIKey, requestOpenAI } from './openai';

export type IntakeProvider = ReturnType<typeof getProvider>;
export interface IntakeOpenAIChannel {
  model: string;
  request: typeof requestOpenAI;
}

export function operationalIntakeProvider(): IntakeProvider {
  return getProvider('SCREEN_INTAKE_AI_PROVIDER');
}

export function intakeModel(): string {
  return process.env.SCREEN_OPENAI_MODEL?.trim() || 'gpt-6-luna';
}

export function hasGenerationKey(provider: IntakeProvider): boolean {
  if (provider === 'openai') return hasOpenAIKey();
  return Boolean(process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY);
}

/** Match transient statuses from either provider, including the bounded request deadline. */
export function isTransientGenerationError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'TimeoutError') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\b(408|429|500|502|503|504)\b/.test(message) ||
    /(ECONN|ETIMEDOUT|fetch failed|network|quota)/i.test(message);
}

interface JsonGenerationOptions {
  provider: IntakeProvider;
  model: string;
  name: string;
  instructions?: string;
  schema: Record<string, unknown>;
  geminiJsonOnly?: boolean;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
}

interface GeneratedJson {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

export function createIntakeJsonGenerator(options: JsonGenerationOptions, sendOpenAI = requestOpenAI): (prompt: string) => Promise<GeneratedJson> {
  if (options.provider === 'openai') {
    const schema = toOpenAIJsonSchema(options.schema);
    return (prompt) => sendOpenAI({
      model: options.model,
      instructions: options.instructions,
      input: prompt,
      maxOutputTokens: options.maxOutputTokens,
      format: { name: options.name, schema },
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  }
  const key = process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  const model = new GoogleGenerativeAI(key ?? '').getGenerativeModel({
    model: options.model,
    systemInstruction: options.instructions,
    generationConfig: {
      temperature: options.temperature,
      responseMimeType: 'application/json',
      ...(options.geminiJsonOnly ? {} : { responseSchema: options.schema as never }),
    },
  });
  return async (prompt) => {
    const { response } = await model.generateContent(prompt);
    return {
      text: response.text(),
      inputTokens: response.usageMetadata?.promptTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
    };
  };
}
