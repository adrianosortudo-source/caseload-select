// Operator-only benchmark. All texts come from the built-in fictional sites.
import { documents, questions } from "./fixtures.mjs";
import { scoreRetrieval } from "./score.mjs";
import { writeFile } from "node:fs/promises";

const [provider, output] = process.argv.slice(2);
if (!["openai", "gemini"].includes(provider) || !output) {
  throw new Error("Usage: node scripts/assist-search-evaluation/run.mjs openai|gemini <result.json>");
}
const openai = provider === "openai";
const model = openai ? "text-embedding-3-small" : "gemini-embedding-001";
const key = openai ? process.env.CASELOAD_OPENAI_API_KEY : process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
if (!key) throw new Error("The selected provider's project credential is unavailable.");

async function embed(texts, taskType) {
  const vectors = [];
  const endpoint = openai ? "https://api.openai.com/v1/embeddings" :
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents";
  const headers = openai ? { Authorization: `Bearer ${key}` } : { "x-goog-api-key": key };
  for (let i = 0; i < texts.length; i += 20) {
    const batch = texts.slice(i, i + 20);
    const body = openai ? { model, input: batch, dimensions: 768, encoding_format: "float" } : {
      requests: batch.map(text => ({
        model: `models/${model}`, content: { parts: [{ text }] }, taskType, outputDimensionality: 768,
      })),
    };
    const res = await fetch(endpoint, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`${provider} embeddings returned HTTP ${res.status}.`);
    const data = await res.json();
    const rows = openai ? data.data?.sort((a,b) => a.index - b.index) : data.embeddings;
    if (rows?.length !== batch.length || (openai && rows.some((row,j) => row.index !== j))) {
      throw new Error("Embedding batch count or ordering mismatch.");
    }
    vectors.push(...rows.map(row => openai ? row.embedding : row.values));
  }
  return vectors;
}
const documentVectors = await embed(documents.map(doc => doc.text), "RETRIEVAL_DOCUMENT");
const questionVectors = await embed(questions.map(q => q.text), "RETRIEVAL_QUERY");
const result = scoreRetrieval(documentVectors, questionVectors);
await writeFile(output, JSON.stringify({
  provider, model, dimensions: 768, timestamp: new Date().toISOString(),
  corpus: "two fictional firms, twelve pages, thirty queries; in-memory cosine retrieval",
  ...result,
}, null, 2) + "\n");
