import { NextRequest, NextResponse } from "next/server";
import { runRecoveryA } from "@/lib/recovery-a";
import { isCronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runRecoveryA();
  return NextResponse.json({ ok: true, ...result });
}
