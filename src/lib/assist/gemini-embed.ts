/**
 * Gemini embedding client for Firm Assist (DR-100).
 *
 * Model: gemini-embedding-001 truncated to 768 output dimensions via
 * `outputDimensionality` (matches assist_corpus_chunks.embedding vector(768)).
 * `text-embedding-004` and `embedding-001` are NOT available on this
 * project's API key (confirmed live via ListModels, 2026-07-16); only the
 * gemini-embedding-* family supports embedContent here. Do not revert to
 * text-embedding-004 without re-checking ListModels for the key in use.
 *
 * Calls the REST endpoint directly rather than the @google/generative-ai
 * SDK: SDK v0.24.1's embedContent/batchEmbedContents request types do not
 * expose `outputDimensionality`, which is required to truncate the
 * model's native 3072-dim output down to 768.
 *
 * Normalization: gemini-embedding-001's truncated output is NOT
 * unit-normalized (confirmed live: L2 norm ~0.585 at 768 dims), but this
 * is not corrected here. pgvector's `vector_cosine_ops` computes true
 * cosine similarity (magnitude-invariant), so un-normalized vectors rank
 * identically to normalized ones under `<=>`. Only add normalization if a
 * future change switches to a magnitude-sensitive operator (L2/inner
 * product).
 *
 * Env key resolution mirrors screen-llm-server.ts: GOOGLE_AI_API_KEY
 * wins, GEMINI_API_KEY accepted.
 *
 * Two entry points because Gemini's embedding API distinguishes retrieval
 * task type: RETRIEVAL_DOCUMENT for corpus chunks at index time,
 * RETRIEVAL_QUERY for the visitor's question at answer time. Mixing them
 * up degrades retrieval quality even though both return 768 floats.
 */

const EMBEDDING_MODEL = 'gemini-embedding-001';
const OUTPUT_DIMENSIONALITY = 768;
const MAX_LLM_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [400, 1200];
// The batchEmbedContents endpoint caps requests per call; chunk larger
// batches client-side rather than relying on the API to reject them.
const MAX_BATCH_SIZE = 20;

export type EmbedMode = 'disabled' | 'live' | 'error';

export interface EmbedResult {
  mode: EmbedMode;
  vectors: number[][];
  reason?: string;
}

type TaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

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

async function embedOneBatch(texts: string[], taskType: TaskType, apiKey: string): Promise<number[][]> {
  // Ses.18 audit F6a: key travels as a header, not a ?key= query param.
  // URL query strings are far more likely to be captured in intermediate
  // request logging (proxies, CDN access logs, error trackers) than headers.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents`;
  const body = {
    requests: texts.map((text) => ({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: OUTPUT_DIMENSIONALITY,
    })),
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${errText.slice(0, 500)}`);
  }

  const json = (await res.json()) as { embeddings?: Array<{ values: number[] }> };
  if (!json.embeddings || json.embeddings.length !== texts.length) {
    throw new Error('embedding response shape mismatch');
  }
  return json.embeddings.map((e) => e.values);
}

async function embedBatch(texts: string[], taskType: TaskType): Promise<EmbedResult> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    return { mode: 'disabled', vectors: [], reason: 'No Gemini API key configured (set GOOGLE_AI_API_KEY or GEMINI_API_KEY)' };
  }
  if (texts.length === 0) return { mode: 'live', vectors: [] };

  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE);

    let lastErr: unknown = null;
    let succeeded = false;
    for (let attempt = 1; attempt <= MAX_LLM_ATTEMPTS; attempt++) {
      try {
        const batchVectors = await embedOneBatch(batch, taskType, apiKey);
        vectors.push(...batchVectors);
        succeeded = true;
        break;
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
    if (!succeeded) {
      return { mode: 'error', vectors: [], reason: lastErr instanceof Error ? lastErr.message : String(lastErr) };
    }
  }

  return { mode: 'live', vectors };
}

/** Embeds corpus chunks for storage. Batches internally; caller may pass any number of texts. */
export async function embedDocuments(texts: string[]): Promise<EmbedResult> {
  return embedBatch(texts, 'RETRIEVAL_DOCUMENT');
}

/** Embeds a single visitor question for retrieval. */
export async function embedQuery(text: string): Promise<EmbedResult> {
  return embedBatch([text], 'RETRIEVAL_QUERY');
}
