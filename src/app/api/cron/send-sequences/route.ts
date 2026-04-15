import { NextRequest, NextResponse } from "next/server";
import { runSendSequences } from "@/lib/send-sequences";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runSendSequences();
  return NextResponse.json({ ok: true, ...result });
}
