import 'server-only';

export const ASSIST_SHADOW_MODEL = 'text-embedding-3-small';
export const ASSIST_SHADOW_DIMENSIONS = 768;
export const ASSIST_SHADOW_VERSION = 'openai/text-embedding-3-small/768/v1';
export const ASSIST_EMBED_BATCH = 20;

export function validShadowEmbedding(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === ASSIST_SHADOW_DIMENSIONS &&
    value.every(n => typeof n === 'number' && Number.isFinite(Math.fround(n))) &&
    value.some(n => Math.fround(n) !== 0);
}

/** The model uses the same embedding space for document text and future QA queries. */
export async function embedAssistShadowTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length || texts.length > ASSIST_EMBED_BATCH || texts.some(text => !text.trim())) {
    throw new Error('Expected 1 to 20 nonempty Assist chunks.');
  }
  const key = process.env.CASELOAD_OPENAI_API_KEY?.trim();
  if (!key) throw new Error('CaseLoad OpenAI project key unavailable.');
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({ model: ASSIST_SHADOW_MODEL, input: texts, dimensions: ASSIST_SHADOW_DIMENSIONS, encoding_format: 'float' }),
  });
  if (!response.ok) throw new Error('OpenAI embeddings returned HTTP ' + response.status + '.');
  const { model, data } = await response.json().catch(() => { throw new Error('Invalid Assist embedding response.'); });
  if (model !== ASSIST_SHADOW_MODEL || !Array.isArray(data) || data.length !== texts.length) {
    throw new Error('Unexpected Assist embedding model or batch size.');
  }
  const vectors: number[][] = [];
  for (const row of data) {
    if (!row || !Number.isInteger(row.index) || row.index < 0 || row.index >= texts.length ||
        vectors[row.index] || !validShadowEmbedding(row.embedding)) throw new Error('Invalid Assist embedding response.');
    vectors[row.index] = row.embedding;
  }
  return vectors;
}
