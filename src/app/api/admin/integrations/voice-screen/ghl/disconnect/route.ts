import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { revokeGhlInstallation, voiceScreenScopeConfig } from "@/lib/voice-screen-store";

export async function POST(req: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  if (req.headers.get("origin") !== req.nextUrl.origin) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const config = voiceScreenScopeConfig();
  if (!config) return NextResponse.json({ error: "parallel_scope_unconfigured" }, { status: 503 });
  try {
    const body = await req.json() as { confirm?: unknown };
    if (body.confirm !== "DISCONNECT") return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
    const revoked = await revokeGhlInstallation(config, { locationId: config.locationId });
    return NextResponse.json({ disconnected: true, updated: revoked }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "disconnect_unavailable" }, { status: 503 });
  }
}
