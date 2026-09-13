import { NextRequest, NextResponse } from "next/server";
import { validToken } from "@/lib/voice-screen-live";
import { ContinuationError, continuationView, transitionContinuation } from "@/lib/voice-screen-continuation";
import { inquiryByToken, liveConfig, saveInquiry } from "@/lib/voice-screen-store";
import { checkRateLimit, ipFromRequest } from "@/lib/rate-limit";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
function reply(body: unknown, status = 200) { return NextResponse.json(body, { status, headers }); }
async function access(req: NextRequest) {
  if (!liveConfig() || !process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return { denied: reply({ error: "continuation_unavailable" }, 503) };
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return { denied: reply({ error: "invalid_origin" }, 403) };
  const limited = await checkRateLimit("screen", ipFromRequest(req));
  if (!limited.active) return { denied: reply({ error: "continuation_unavailable" }, 503) };
  if (!limited.ok) return { denied: reply({ error: "try_again_later" }, 429) };
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? null;
  if (!validToken(token)) return { denied: reply({ error: "link_unavailable" }, 404) };
  const inquiry = await inquiryByToken(token);
  return inquiry ? { inquiry } : { denied: reply({ error: "link_unavailable" }, 404) };
}
export async function GET(req: NextRequest) {
  try { const a = await access(req); return a.denied ?? reply(continuationView(a.inquiry!.engine_state, a.inquiry!.revision, a.inquiry!.status)); }
  catch { return reply({ error: "continuation_unavailable" }, 503); }
}
export async function POST(req: NextRequest) {
  try {
    const a = await access(req); if (a.denied) return a.denied;
    const inquiry = a.inquiry!;
    const raw = await req.text(); if (Buffer.byteLength(raw) > 4000) return reply({ error: "payload_too_large" }, 413);
    const next = transitionContinuation({
      state: inquiry.engine_state, answers: inquiry.answers,
      status: inquiry.status, revision: inquiry.revision,
    }, JSON.parse(raw));
    if (!await saveInquiry(inquiry, next.state, next.answers, next.status)) return reply({ error: "refresh_required" }, 409);
    return reply(continuationView(next.state, next.revision, next.status));
  } catch (error) {
    if (error instanceof ContinuationError) return reply({ error: error.code }, error.status);
    return reply({ error: error instanceof SyntaxError ? "invalid_json" : "save_unavailable" }, error instanceof SyntaxError ? 400 : 503);
  }
}
