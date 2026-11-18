import { createIntakeJsonGenerator, isTransientGenerationError, hasGenerationKey, intakeModel, operationalIntakeProvider, type IntakeOpenAIChannel } from './ai/intake-generation';
import {
  buildOptionMapSystemPrompt,
  buildOptionMapUserPrompt,
  buildOptionMapResponseSchema,
  parseOptionMapResponse,
  type OptionMapOption,
} from './llm-option-map-pure';

const MODEL = 'gemini-2.5-flash';
const TEMPERATURE = 0;
const MAX_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 400;

export interface OptionMapArgs {
  questionLabel: string;
  options: OptionMapOption[];
  reply: string;
  language: string;
}

export interface OptionMapResult {
  value: string | null;
  mode: 'live' | 'disabled' | 'error';
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function llmMapOptionReply(args: OptionMapArgs, provider = operationalIntakeProvider(), openAI?: IntakeOpenAIChannel): Promise<OptionMapResult> {
  if (!hasGenerationKey(provider)) {
    return { value: null, mode: 'disabled' };
  }

  if (!args.reply?.trim() || args.options.length === 0) {
    return { value: null, mode: 'error' };
  }

  const generate = createIntakeJsonGenerator({
    provider,
    model: provider === 'openai' ? openAI?.model ?? intakeModel() : MODEL,
    instructions: buildOptionMapSystemPrompt(),
    name: 'screen_option_map',
    schema: buildOptionMapResponseSchema(),
    temperature: TEMPERATURE,
    maxOutputTokens: 256,
    timeoutMs: 6000,
  }, openAI?.request);
  const userPrompt = buildOptionMapUserPrompt(args);

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await generate(userPrompt);
      const parsed = parseOptionMapResponse(result.text);
      return { value: parsed.value, mode: 'live' };
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS && isTransientGenerationError(err)) {
        console.warn(
          `[llm-option-map] transient error on attempt ${attempt}, retrying:`,
          err instanceof Error ? err.message : String(err),
        );
        await sleep(RETRY_BACKOFF_MS);
        continue;
      }
      break;
    }
  }

  console.warn(
    '[llm-option-map] failed, falling through to deterministic clarifier:',
    lastErr instanceof Error ? lastErr.message : String(lastErr),
  );
  return { value: null, mode: 'error' };
}
