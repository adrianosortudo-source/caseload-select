import { NextRequest, NextResponse } from "next/server";
import { runNoShowEngine } from "@/lib/no-show";
import { isCronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runNoShowEngine();
  return NextResponse.json({ ok: true, ...result });
}
