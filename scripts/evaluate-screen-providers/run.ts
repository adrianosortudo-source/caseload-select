// From the checkout: node --conditions=react-server --import tsx scripts/evaluate-screen-providers/run.ts
// Uses only the immutable synthetic fixtures. Produces one JSON line per provider per case.
import { performance } from "node:perf_hooks";
import { llmExtractServer } from "../../src/lib/screen-llm-server";
import { initialiseState } from "../../src/lib/screen-engine/extractor";
import { mergeLlmResults } from "../../src/lib/screen-engine/llm/extractor";
import { critical, fixtures, type Fixture } from "./fixtures";

type Provider = "openai" | "gemini";

function matches(actual: string | null, expected: string | RegExp | null): boolean {
  return expected instanceof RegExp ? actual !== null && expected.test(actual) : actual === expected;
}

async function evaluate(fixture: Fixture, provider: Provider) {
  const state = {
    ...initialiseState(fixture.description),
    matter_type: fixture.matter,
    family_enabled: true,
  };
  const start = performance.now();
  const extraction = await llmExtractServer(fixture.description, state, 16_000, provider);
  const elapsedMs = Math.round(performance.now() - start);
  const merged = mergeLlmResults(state, extraction.extracted);
  const expected: Fixture["expected"] = { ...fixture.expected, __detected_language: fixture.language };
  const missingOrWrong: string[] = [];
  const mismatches: Record<string, { expected: string | null; raw: string | null; merged: string | null }> = {};
  const falseCritical: string[] = [];
  const rawFalseCritical: string[] = [];
  for (const key of new Set([...Object.keys(expected), ...critical])) {
    const reference = expected[key] ?? null;
    const raw = extraction.extracted[key] ?? null;
    const actual = key === "__detected_language" ? raw : merged.slots[key] ?? null;
    if (!matches(actual, reference)) {
      missingOrWrong.push(key);
      mismatches[key] = { expected: reference instanceof RegExp ? reference.source : reference, raw, merged: actual };
      if (actual !== null && critical.has(key)) falseCritical.push(key);
    }
    if (raw !== null && critical.has(key) && !matches(raw, reference)) rawFalseCritical.push(key);
  }
  return {
    fixture: fixture.id,
    provider,
    mode: extraction.mode,
    status: extraction.reason?.match(/\b([45]\d{2})\b/)?.[1],
    passed: extraction.mode === "live" && !missingOrWrong.length && !Object.keys(extraction.dropped ?? {}).length,
    missingOrWrong,
    ...(missingOrWrong.length && { mismatches }),
    falseCritical,
    rawFalseCritical,
    dropped: Object.keys(extraction.dropped ?? {}),
    elapsedMs,
    input: extraction.tokens?.prompt,
    output: extraction.tokens?.completion,
  };
}

async function main() {
  const selected = process.argv[2];
  if (selected && selected !== 'openai' && selected !== 'gemini') throw new Error("Invalid provider");
  const providers: Provider[] = selected === "openai" || selected === "gemini" ? [selected] : ['openai', 'gemini'];
  if ((providers.includes('openai') && !process.env.CASELOAD_OPENAI_API_KEY) ||
      (providers.includes('gemini') && !(process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY))) {
    throw new Error("Evaluation provider credentials are required.");
  }
  for (const fixture of fixtures) {
    // Start both providers together; finish the pair before starting the next.
    const pair = await Promise.all(providers.map(provider => evaluate(fixture, provider)));
    for (const result of pair) console.log(JSON.stringify(result));
  }
}

void main().catch(() => {
  console.error("SCREEN provider evaluation could not complete.");
  process.exitCode = 1;
});
