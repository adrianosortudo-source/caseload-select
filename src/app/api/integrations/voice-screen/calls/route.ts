import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { verifyGhlWebhookSignature } from "@/lib/ghl-webhook-signature";
import { parseProviderCall } from "@/lib/voice-screen-provider";
import { dispatchInvitation, senderConfig } from "@/lib/voice-screen-sender";
import { ingestLiveCall, liveConfig, voiceScreenIsEnabled, voiceScreenScopeConfig } from "@/lib/voice-screen-store";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 256 * 1024;

const ignored = (reason: string) => NextResponse.json(
  { accepted: true, processed: false, reason },
  { status: 200, headers: { "Cache-Control": "no-store" } },
);

async function boundedBody(req: NextRequest): Promise<Uint8Array | null> {
  const declared = req.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_BODY_BYTES) return null;
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel("payload_too_large").catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function POST(req: NextRequest) {
  const bytes = await boundedBody(req);
  if (!bytes) return ignored("payload_too_large");
  if (!verifyGhlWebhookSignature(bytes, req.headers.get("x-ghl-signature"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const mediaType = req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") return ignored("unsupported_content_type");

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return ignored("invalid_payload");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return ignored("invalid_payload");

  const scope = voiceScreenScopeConfig();
  if (!scope) return NextResponse.json({ error: "parallel_scope_unconfigured" }, { status: 503 });
  const identity = body as { type?: unknown; locationId?: unknown; agentId?: unknown; trialCall?: unknown };
  if (identity.type !== "VoiceAiCallEnd") return ignored("unsupported_event_type");
  if (identity.locationId !== scope.locationId || identity.agentId !== scope.agentId) return ignored("outside_parallel_scope");
  // Browser Web Calls are legitimate pilot evidence. A true trialCall receives
  // no relaxed scope, consent, phone-proof, retention or SMS-recipient gate.
  if (identity.trialCall !== undefined && typeof identity.trialCall !== "boolean") return ignored("invalid_current_call_payload");
  if (!voiceScreenIsEnabled()) return ignored("parallel_journey_disabled");

  const config = liveConfig();
  if (!config) return NextResponse.json({ error: "parallel_journey_unavailable" }, { status: 503 });
  const call = parseProviderCall(body, config.locationId);
  if (!call || call.locationId !== config.locationId || call.agentId !== config.agentId) return ignored("invalid_current_call_payload");
  const endedAt = Date.parse(call.endedAt);
  if (endedAt > Date.now() + 60_000) return ignored("invalid_call_time");
  if (Date.now() - endedAt > 86_400_000) return ignored("stale_call_event");

  try {
    const result = await ingestLiveCall(call, config);
    if (!result.id) return ignored(result.reason ?? "event_replay");
    if (result.created && senderConfig()) waitUntil(dispatchInvitation(result.id).catch(() => undefined));
    return NextResponse.json(
      { accepted: true, processed: true, created: result.created, humanFollowUp: "pending" },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "ingest_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
