/**
 * Gemini embedding client for Firm Assist (DR-100).
 *
 * Model: text-embedding-004, native 768-dim output (matches the
 * assist_corpus_chunks.embedding column). Env key resolution mirrors
 * screen-llm-server.ts: GOOGLE_AI_API_KEY wins, GEMINI_API_KEY accepted.
 *
 * Two entry points because Gemini's embedding API distinguishes retrieval
 * task type: RETRIEVAL_DOCUMENT for corpus chunks at index time,
 * RETRIEVAL_QUERY for the visitor's question at answer time. Mixing them up
 * degrades retrieval quality even though both return 768 floats.
 */

import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';

const EMBEDDING_MODEL = 'text-embedding-004';
const MAX_LLM_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [400, 1200];

export type EmbedMode = 'disabled' | 'live' | 'error';

export interface EmbedResult {
  mode: EmbedMode;
  vectors: number[][];
  reason?: string;
}

function resolveApiKey(): string | null {
  return process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY ?? null;
}

function isTransientEmbedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/\b(429|408|500|502|503|504)\b/.test(msg)) return true;
  if (/(ECONN|ETIMEDOUT|fetch failed|network)/i.test(msg)) return true;
  if (/quota/i.test(msg)) return true;
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedBatch(
  texts: string[],
  taskType: TaskType,
): Promise<EmbedResult> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    return { mode: 'disabled', vectors: [], reason: 'No Gemini API key configured (set GOOGLE_AI_API_KEY or GEMINI_API_KEY)' };
  }
  if (texts.length === 0) return { mode: 'live', vectors: [] };

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_LLM_ATTEMPTS; attempt++) {
    try {
      const result = await model.batchEmbedContents({
        requests: texts.map((text) => ({
          content: { role: 'user', parts: [{ text }] },
          taskType,
        })),
      });
      return {
        mode: 'live',
        vectors: result.embeddings.map((e) => e.values),
      };
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_LLM_ATTEMPTS && isTransientEmbedError(err)) {
        const wait = RETRY_BACKOFF_MS[attempt - 1] ?? 1200;
        console.warn(`[gemini-embed] transient error on attempt ${attempt}, retrying in ${wait}ms:`, err instanceof Error ? err.message : String(err));
        await sleep(wait);
        continue;
      }
      break;
    }
  }

  return {
    mode: 'error',
    vectors: [],
    reason: lastErr instanceof Error ? lastErr.message : String(lastErr),
  };
}

/** Embeds corpus chunks for storage. Batches internally; caller may pass up to ~100 texts. */
export async function embedDocuments(texts: string[]): Promise<EmbedResult> {
  return embedBatch(texts, TaskType.RETRIEVAL_DOCUMENT);
}

/** Embeds a single visitor question for retrieval. */
export async function embedQuery(text: string): Promise<EmbedResult> {
  return embedBatch([text], TaskType.RETRIEVAL_QUERY);
}
