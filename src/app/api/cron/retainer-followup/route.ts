import { NextRequest, NextResponse } from "next/server";
import { runRetainerFollowup } from "@/lib/retainer-followup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runRetainerFollowup();
  return NextResponse.json({ ok: true, ...result });
}
