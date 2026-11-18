import { performance } from "node:perf_hooks";
import { intakeModel } from "../../src/lib/ai/intake-generation";
import { llmExtractServer } from "../../src/lib/screen-llm-server";
import { initialiseState } from "../../src/lib/screen-engine/extractor";
import { mergeLlmResults } from "../../src/lib/screen-engine/llm/extractor";
import { getNextStep } from "../../src/lib/screen-engine/control";
import { computeBand } from "../../src/lib/screen-engine/band";
import { critical, fixtures, type Fixture } from "./fixtures";

export type Provider = "openai" | "gemini";

function matches(actual: string | null, expected: string | RegExp | null): boolean {
  return expected instanceof RegExp ? actual !== null && expected.test(actual) : actual === expected;
}

export async function evaluate(fixture: Fixture, provider: Provider, capture = false) {
  const state = {
    ...initialiseState(fixture.description),
    matter_type: fixture.matter,
    family_enabled: true,
  };
  const start = performance.now();
  let rawModelText: string | null = null;
  const extraction = await llmExtractServer(fixture.description, state, 16_000, provider,
    capture ? (text) => { rawModelText = text; } : undefined);
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
    ...(capture && {
      caseText: fixture.description,
      configuredModel: intakeModel(),
      rawModelText,
      extraction,
      initialState: state,
      mergedState: merged,
      nextStep: getNextStep(merged),
      band: computeBand(merged),
      expectations: Object.fromEntries(Object.entries(expected).map(([key, value]) =>
        [key, value instanceof RegExp ? { pattern: value.source, flags: value.flags } : value])),
    }),
  };
}

/** Only the fixed fictional catalog is accepted on a staff evaluation surface. */
export async function captureFixedOpenAICase(id: string) {
  const fixture = fixtures.find(item => item.id === id);
  if (!fixture) throw new Error("Unknown synthetic fixture");
  return evaluate(fixture, "openai", true);
}
