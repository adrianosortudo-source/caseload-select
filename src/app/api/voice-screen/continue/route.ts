import { NextRequest, NextResponse } from "next/server";
import { continuationView, scoreLiveState, validToken } from "@/lib/voice-screen-live";
import { inquiryByToken, liveConfig, saveInquiry } from "@/lib/voice-screen-store";
import { applyAnswer, getNextStep } from "@/lib/screen-engine/control";
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
    const body = JSON.parse(raw) as { revision?: number; slotId?: string; value?: string; skip?: boolean; finish?: boolean };
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "invalid_answer" }, 400);
    if (!Number.isInteger(body.revision) || (body.skip !== undefined && typeof body.skip !== "boolean") || (body.finish !== undefined && typeof body.finish !== "boolean") || Object.keys(body).some(key => !["revision", "slotId", "value", "skip", "finish"].includes(key))) return reply({ error: "invalid_answer" }, 400);
    if (body.finish === true && (body.slotId !== undefined || body.value !== undefined || body.skip !== undefined)) return reply({ error: "invalid_answer" }, 400);
    if (body.revision !== inquiry.revision || inquiry.status === "completed") return reply({ error: "refresh_required" }, 409);
    const next = getNextStep(inquiry.engine_state);
    let state = inquiry.engine_state;
    const answers = [...inquiry.answers];
    if (body.finish !== true) {
      if (!next.slot || body.slotId !== next.slot.id || typeof body.value !== "string" || body.value.length > 1500 || (!body.skip && !body.value.trim())) return reply({ error: "invalid_answer" }, 400);
      const value = body.skip ? "Not sure" : body.value.trim();
      if (!body.skip && next.slot.options?.length && !next.slot.options.some(option => option.value === value)) return reply({ error: "invalid_answer" }, 400);
      state = scoreLiveState(applyAnswer(state, next.slot.id, value));
      answers.push({ question: next.slot.question, answer: body.skip ? "Skipped by caller" : value, source: "screen", at: new Date().toISOString() });
    }
    const status = body.finish ? "completed" : "partial";
    if (!await saveInquiry(inquiry, state, answers, status)) return reply({ error: "refresh_required" }, 409);
    return reply(continuationView(state, inquiry.revision + 1, status));
  } catch (error) { return reply({ error: error instanceof SyntaxError ? "invalid_json" : "save_unavailable" }, error instanceof SyntaxError ? 400 : 503); }
}
