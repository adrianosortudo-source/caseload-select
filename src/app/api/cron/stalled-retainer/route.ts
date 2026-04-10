import { NextRequest, NextResponse } from "next/server";
import { runStalledRetainerEngine } from "@/lib/stalled-retainer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runStalledRetainerEngine();
  return NextResponse.json({ ok: true, ...result });
}
