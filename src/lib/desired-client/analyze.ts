import "server-only";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getEligibleClarificationCodes } from "./clarifications";
import {
  buildDesiredClientSystemPrompt,
  buildDesiredClientUserPrompt,
  DESIRED_CLIENT_RESPONSE_SCHEMA,
} from "./prompt";
import { validateAnalysisResult } from "./output";
import type { AnalysisRequestEnvelope, AnalysisResult, ClarificationCode } from "./types";

const MODEL = "gemini-2.5-flash";
const REQUEST_TIMEOUT_MS = 12_000;

export type DesiredClientAnalysisOutcome =
  | { mode: "live"; result: AnalysisResult }
  | { mode: "invalid_output" }
  | { mode: "unavailable" };

export function desiredClientModelId(): string { return MODEL; }

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
        responseSchema: DESIRED_CLIENT_RESPONSE_SCHEMA as never,
      },
    }, { timeout: REQUEST_TIMEOUT_MS });
    const response = await model.generateContent(buildDesiredClientUserPrompt(request, eligibleCodes));
    let parsed: unknown;
    try { parsed = JSON.parse(response.response.text()); }
    catch { return { mode: "invalid_output" }; }
    const result = validateAnalysisResult(parsed, request.answers, eligibleCodes);
    return result ? { mode: "live", result } : { mode: "invalid_output" };
  } catch {
    // Provider exceptions can contain submitted text. Never log their messages.
    return { mode: "unavailable" };
  }
}

export function eligibleDesiredClientClarifications(request: AnalysisRequestEnvelope): ClarificationCode[] {
  return getEligibleClarificationCodes(request.answers, request.clarifications.map(({ code }) => code));
}
