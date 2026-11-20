import { createHash, randomUUID } from "node:crypto";
import type { AiProvider } from "@/lib/ai/openai";
import { publicPilotSession } from "@/lib/ai/public-tool-session";
import { writingProvider } from "@/lib/ai/writing-rollout";
import { startPilotMetrics } from "@/lib/ai/public-pilot-metrics";
import { matchesWritingProvider } from "@/lib/ai/writing-provider-policy";
import { desiredClientHasKey } from "@/lib/desired-client/provider";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, ipFromRequest, rateLimitHeaders, releaseDesiredClientProviderRun, reserveDesiredClientProviderCall } from "@/lib/rate-limit";
import { desiredClientModelId, runDesiredClientAnalysis } from "@/lib/desired-client/analyze";
import { validateAnalysisRequest } from "@/lib/desired-client/validation";
import type { AnalysisFailureCode, AnalysisFailureEnvelope, AnalysisSuccessEnvelope } from "@/lib/desired-client/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY_BYTES = 32_768;
const NO_STORE = { "Cache-Control": "no-store" };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function desiredClientAiEnabled(provider: AiProvider): boolean {
  return process.env.DESIRED_CLIENT_AI_ENABLED === "true" && desiredClientHasKey(provider) &&
    Boolean(process.env.UPSTASH_REDIS_REST_URL?.trim()) && Boolean(process.env.UPSTASH_REDIS_REST_TOKEN?.trim());
}

function desiredClientProviderCallLimit(): 3 {
  return 3;
}

/** Exposes only the enabled state so the tool can set honest expectations. */
export async function GET(request: Request): Promise<NextResponse<{ enabled: boolean; providerCallLimit: 3 }>> {
  const provider = writingProvider("best", publicPilotSession(request.headers));
  return NextResponse.json({ enabled: desiredClientAiEnabled(provider), providerCallLimit: desiredClientProviderCallLimit() }, { headers: NO_STORE });
}

function fail(requestId: string, code: AnalysisFailureCode, status: number, extraHeaders: Record<string, string> = {}, diagnostic?: { field: string; reason: string }, usage?: { providerCallsUsed: number; providerCallLimit: number }): NextResponse<AnalysisFailureEnvelope> {
  const safeDiagnostic = diagnostic && /^[a-z0-9_.]{1,80}$/.test(diagnostic.field) && /^[a-z0-9_]{1,80}$/.test(diagnostic.reason) ? diagnostic : undefined;
  return NextResponse.json({ ok: false, requestId, error: { code, ...(safeDiagnostic ? { diagnostic: safeDiagnostic } : {}) }, ...(usage ?? {}) }, { status, headers: { ...NO_STORE, ...extraHeaders } });
}

function requestIdFromBody(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const candidate = (value as Record<string, unknown>).requestId;
    if (typeof candidate === "string" && candidate.length <= 64 && UUID_PATTERN.test(candidate)) return candidate;
  }
  return randomUUID();
}

type BodyReadResult = { ok: true; text: string } | { ok: false; reason: "TOO_LARGE" | "INVALID_BODY" };

async function readBodyWithinLimit(request: NextRequest): Promise<BodyReadResult> {
  if (!request.body) return { ok: true, text: "" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_BODY_BYTES) {
        try { await reader.cancel(); } catch { /* The stream is already over the cap. */ }
        return { ok: false, reason: "TOO_LARGE" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "INVALID_BODY" };
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) }; }
  catch { return { ok: false, reason: "INVALID_BODY" }; }
}

export async function POST(request: NextRequest): Promise<NextResponse<AnalysisFailureEnvelope | AnalysisSuccessEnvelope>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) return fail(randomUUID(), "INVALID_REQUEST", 400);

  const origin = request.headers.get("origin");
  let requestOrigin = "";
  try { requestOrigin = new URL(request.url).origin; } catch { /* Invalid request URL is denied below. */ }
  if (!origin || origin !== requestOrigin || request.headers.get("sec-fetch-site") === "cross-site") {
    return fail(randomUUID(), "ORIGIN_DENIED", 403);
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) return fail(randomUUID(), "INVALID_REQUEST", 400);
    if (Number(contentLength) > MAX_BODY_BYTES) return fail(randomUUID(), "TOO_LARGE", 413);
  }

  const body = await readBodyWithinLimit(request);
  if (!body.ok && body.reason === "TOO_LARGE") return fail(randomUUID(), "TOO_LARGE", 413);
  if (!body.ok) return fail(randomUUID(), "INVALID_REQUEST", 400);

  let parsed: unknown;
  try { parsed = JSON.parse(body.text); } catch { return fail(randomUUID(), "INVALID_REQUEST", 400); }
  const requestId = requestIdFromBody(parsed);
  const identity = ipFromRequest(request);
  const provider = writingProvider("best", publicPilotSession(request.headers));
  if (!matchesWritingProvider(request.headers, provider)) {
    return fail(requestId, "AI_UNAVAILABLE", 409);
  }

  const validation = validateAnalysisRequest(parsed);
  if (!validation.valid) return fail(requestId, "INVALID_REQUEST", 400);

  if (!desiredClientAiEnabled(provider)) {
    return fail(validation.value.requestId, "AI_DISABLED", 503);
  }

  const buckets = [
    ["desiredClientAnalyze", identity],
    ["desiredClientDaily", identity],
    ["desiredClientGlobal", "all"],
  ] as const;
  for (const [bucket, identity] of buckets) {
    const decision = await checkRateLimit(bucket, identity);
    if (!decision.ok) return fail(validation.value.requestId, "RATE_LIMITED", 429, rateLimitHeaders(decision));
  }

  // Generate the complete profile from the answers submitted at review.
  const eligibleCodes: [] = [];
  const providerCallLimit = desiredClientProviderCallLimit();
  const ownerToken = randomUUID();
  const answerFingerprint = createHash("sha256").update(JSON.stringify(validation.value.answers)).digest("hex");
  const metrics = startPilotMetrics("best", provider, Date.now());
  metrics.attempt(provider);
  let outcome: Awaited<ReturnType<typeof runDesiredClientAnalysis>>;
  try {
    outcome = await runDesiredClientAnalysis(validation.value, eligibleCodes, providerCallLimit, async (expectedCallsUsed) =>
      reserveDesiredClientProviderCall({
        reviewRunId: validation.value.reviewRunId,
        answerRevision: validation.value.answerRevision,
        expectedCallsUsed,
        limit: providerCallLimit,
        answerFingerprint,
        ownerToken,
      }),
      provider,
    );
    metrics.finish(outcome.mode === "live" ? "completed" : "failed");
  } catch (error) {
    metrics.finish("failed");
    throw error;
  } finally {
    await releaseDesiredClientProviderRun(validation.value.reviewRunId, ownerToken);
  }
  const usage = { providerCallsUsed: outcome.providerCallsUsed, providerCallLimit: outcome.providerCallLimit };
  if (outcome.mode === "budget_rejected") {
    const code: AnalysisFailureCode = outcome.reason === "exhausted" ? "PROVIDER_CALL_LIMIT_REACHED" :
      outcome.reason === "stale" ? "ANALYSIS_RUN_STALE" :
      outcome.reason === "busy" ? "ANALYSIS_RUN_BUSY" :
      outcome.reason === "sequence_conflict" ? "ANALYSIS_RUN_SEQUENCE_CONFLICT" : "AI_UNAVAILABLE";
    const status = outcome.reason === "exhausted" ? 429 : outcome.reason === "unavailable" ? 503 : 409;
    return fail(validation.value.requestId, code, status, {}, undefined, usage);
  }
  if (outcome.mode === "unavailable") return fail(validation.value.requestId, "AI_UNAVAILABLE", 502, {}, undefined, usage);
  if (outcome.mode === "invalid_output") return fail(validation.value.requestId, "INVALID_AI_OUTPUT", 502, {}, outcome.diagnostic, usage);

  const response: AnalysisSuccessEnvelope = {
    ok: true,
    requestId: validation.value.requestId,
    answerRevision: validation.value.answerRevision,
    reviewRunId: validation.value.reviewRunId,
    ...usage,
    result: outcome.result,
  };
  console.info("[desired-client] analysis complete", {
    requestId: validation.value.requestId,
    outcome: "success",
    model: desiredClientModelId(provider),
  });
  return NextResponse.json(response, { headers: NO_STORE });
}
