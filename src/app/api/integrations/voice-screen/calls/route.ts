import { NextRequest, NextResponse } from "next/server";
import { secretMatches } from "@/lib/voice-screen-live";
import { parseProviderCall } from "@/lib/voice-screen-provider";
import { ingestLiveCall, liveConfig } from "@/lib/voice-screen-store";
import { checkRateLimit, ipFromRequest } from "@/lib/rate-limit";
import { dispatchInvitation, senderConfig } from "@/lib/voice-screen-sender";
import { waitUntil } from "@vercel/functions";

export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  const config = liveConfig();
  if (!config) return NextResponse.json({ error: "parallel_journey_disabled" }, { status: 503 });
  // Dedicated static shared secret works with GHL custom webhook headers over TLS.
  // It is mandatory and independent of the original voice endpoint's soft rollout.
  if (!secretMatches(req.headers.get("x-v2s-secret"), config.webhookSecret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > 24000) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  try {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return NextResponse.json({ error: "ingest_limiter_unavailable" }, { status: 503 });
    const limited = await checkRateLimit("screen", `v2s-call:${ipFromRequest(req)}`);
    if (!limited.active) return NextResponse.json({ error: "ingest_limiter_unavailable" }, { status: 503 });
    if (!limited.ok) return NextResponse.json({ error: "try_again_later" }, { status: 429 });
    const raw = await req.text();
    if (Buffer.byteLength(raw) > 24000) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    const body = JSON.parse(raw) as { callId?: string };
    if (typeof body.callId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.callId)) return NextResponse.json({ error: "invalid_call_id" }, { status: 400 });
    const providerToken = process.env.V2S_GHL_VOICE_TOKEN;
    if (!providerToken) return NextResponse.json({ error: "provider_read_unconfigured" }, { status: 503 });
    // Hydrate this exact call. Never choose the contact's most recent call or
    // trust mutable GHL contact fields as evidence for a delayed event.
    const response = await fetch(`https://services.leadconnectorhq.com/voice-ai/dashboard/call-logs/${encodeURIComponent(body.callId)}?locationId=${encodeURIComponent(config.locationId)}`, {
      headers: { Authorization: `Bearer ${providerToken}`, Version: "2021-04-15", Accept: "application/json" },
      cache: "no-store", signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return NextResponse.json({ error: "provider_call_unavailable" }, { status: 503 });
    const call = parseProviderCall(await response.json(), config.locationId);
    if (!call) return NextResponse.json({ error: "invalid_current_call_payload" }, { status: 400 });
    if (call.callId !== body.callId) return NextResponse.json({ error: "call_identity_mismatch" }, { status: 403 });
    if (call.locationId !== config.locationId || call.agentId !== config.agentId) return NextResponse.json({ error: "outside_parallel_scope" }, { status: 403 });
    if (Date.parse(call.endedAt) > Date.now() + 60000) return NextResponse.json({ error: "invalid_call_time" }, { status: 400 });
    if (Date.now() - Date.parse(call.endedAt) > 86400000) return NextResponse.json({ error: "stale_call_event" }, { status: 400 });
    const result = await ingestLiveCall(call, config);
    if (result.created && senderConfig()) {
      waitUntil(dispatchInvitation(result.id).catch(() => undefined));
    }
    // Never return bearer token to webhook logs or shared contact fields.
    return NextResponse.json({ id: result.id, created: result.created, humanFollowUp: "pending" }, { status: result.created ? 201 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof SyntaxError ? "invalid_json" : "ingest_unavailable" }, { status: error instanceof SyntaxError ? 400 : 503 });
  }
}
