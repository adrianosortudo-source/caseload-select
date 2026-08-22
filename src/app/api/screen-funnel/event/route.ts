import { NextRequest, NextResponse } from "next/server";
import { verifyScreenFunnelContextToken, isScreenFunnelTelemetryCollectionEnabled } from "@/lib/screen-funnel-context";
import { insertScreenFunnelEvent } from "@/lib/screen-funnel-event-store";
import { SCREEN_FUNNEL_MAX_PAYLOAD_BYTES, parseScreenFunnelEventV1 } from "@/lib/screen-funnel-schema";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";

function badRequest() {
  return new NextResponse(null, { status: 400 });
}

export async function POST(request: NextRequest) {
  // Disabled by default and deliberately short-circuited before body parsing
  // or database work. This permits code deployment before disclosure approval.
  if (!isScreenFunnelTelemetryCollectionEnabled()) return new NextResponse(null, { status: 204 });

  const limit = await checkRateLimit("screenFunnel", ipFromRequest(request));
  if (!limit.ok) return new NextResponse(null, { status: 429, headers: rateLimitHeaders(limit) });

  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > SCREEN_FUNNEL_MAX_PAYLOAD_BYTES)) return badRequest();
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return badRequest();
  }
  if (Buffer.byteLength(raw, "utf8") > SCREEN_FUNNEL_MAX_PAYLOAD_BYTES) return badRequest();

  let unknownPayload: unknown;
  try {
    unknownPayload = JSON.parse(raw);
  } catch {
    return badRequest();
  }
  const event = parseScreenFunnelEventV1(unknownPayload);
  if (!event) return badRequest();
  const context = verifyScreenFunnelContextToken(event.contextToken);
  if (!context) return badRequest();

  const result = await insertScreenFunnelEvent(event, context);
  if (result === "inserted" || result === "duplicate") return new NextResponse(null, { status: 204 });
  if (result === "conflict") return new NextResponse(null, { status: 409 });
  return new NextResponse(null, { status: 400 });
}
