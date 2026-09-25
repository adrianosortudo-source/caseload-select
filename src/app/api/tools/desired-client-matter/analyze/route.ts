import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { validateAnalysisRequest } from "@/lib/desired-client/validation";
import type { AnalysisFailureCode, AnalysisFailureEnvelope } from "@/lib/desired-client/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY_BYTES = 32_768;
const NO_STORE = { "Cache-Control": "no-store" };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(requestId: string, code: AnalysisFailureCode, status: number): NextResponse<AnalysisFailureEnvelope> {
  return NextResponse.json({ ok: false, requestId, error: { code } }, { status, headers: NO_STORE });
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
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, reason: "INVALID_BODY" };
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<AnalysisFailureEnvelope>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) {
    return fail(randomUUID(), "INVALID_REQUEST", 400);
  }

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
  const validation = validateAnalysisRequest(parsed);
  if (!validation.valid) return fail(requestId, "INVALID_REQUEST", 400);

  // Temporary safe scaffold: the external Gemini adapter remains disconnected
  // pending explicit action-time authorization for this answer payload and destination.
  return fail(validation.value.requestId, "AI_DISABLED", 503);
}
