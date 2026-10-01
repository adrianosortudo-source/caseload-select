import "server-only";
import { GoogleGenerativeAI, type GenerationConfig } from "@google/generative-ai";
import { getEligibleClarificationCodes } from "./clarifications";
import {
  buildDesiredClientSystemPrompt,
  buildDesiredClientUserPrompt,
} from "./prompt";
import { isSafeSourcePath, validateAnalysisResult, type AnalysisValidationFailure } from "./output";
import { safeProviderFailureMetadata } from "./provider-diagnostics";
import type { AnalysisRequestEnvelope, AnalysisResult, ClarificationCode } from "./types";

const MODEL = "gemini-2.5-flash";
const REQUEST_TIMEOUT_MS = 24_000;

export type DesiredClientAnalysisOutcome =
  | { mode: "live"; result: AnalysisResult }
  | { mode: "invalid_output" }
  | { mode: "unavailable" };

export function desiredClientModelId(): string { return MODEL; }

function logRejectedOutput(
  requestId: string,
  failure: AnalysisValidationFailure,
): void {
  // Keep diagnostics in one message: Vercel's runtime log view drops extra
  // console arguments, which hid the bounded details when passed separately.
  console.warn(JSON.stringify({
    event: "[desired-client] analysis output rejected",
    requestId,
    model: MODEL,
    field: failure.field.slice(0, 80),
    reason: failure.reason.slice(0, 80),
    ...(failure.sourcePath && isSafeSourcePath(failure.sourcePath) ? { sourcePath: failure.sourcePath } : {}),
  }));
}

export async function runDesiredClientAnalysis(
  request: AnalysisRequestEnvelope,
  eligibleCodes: readonly ClarificationCode[],
): Promise<DesiredClientAnalysisOutcome> {
  const apiKey = process.env.GOOGLE_AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return { mode: "unavailable" };
  try {
    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({
      model: MODEL,
      systemInstruction: buildDesiredClientSystemPrompt(),
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 512 },
      } as GenerationConfig & { thinkingConfig: { thinkingBudget: number } },
    }, { timeout: REQUEST_TIMEOUT_MS });
    const response = await model.generateContent(buildDesiredClientUserPrompt(request, eligibleCodes));
    let parsed: unknown;
    try { parsed = JSON.parse(response.response.text()); }
    catch {
      logRejectedOutput(request.requestId, { field: "report", reason: "invalid_json" });
      return { mode: "invalid_output" };
    }
    let validationFailure: { field: string; reason: string } | null = null;
    const result = validateAnalysisResult(parsed, request.answers, eligibleCodes, (failure) => { validationFailure ??= failure; });
    if (!result) {
      logRejectedOutput(request.requestId, validationFailure ?? { field: "report", reason: "unclassified_validation_failure" });
    }
    return result ? { mode: "live", result } : { mode: "invalid_output" };
  } catch (error) {
    // Provider exceptions can contain submitted text. Never log their messages.
    console.warn("[desired-client] analysis provider request failed", {
      requestId: request.requestId,
      model: MODEL,
      ...safeProviderFailureMetadata(error),
    });
    return { mode: "unavailable" };
  }
}

export function eligibleDesiredClientClarifications(request: AnalysisRequestEnvelope): ClarificationCode[] {
  if (request.analysisIndex === 2) return [];
  return getEligibleClarificationCodes(request.answers, request.clarifications.map(({ code }) => code)).slice(0, 1);
}
