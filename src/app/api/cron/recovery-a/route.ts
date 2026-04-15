import { NextRequest, NextResponse } from "next/server";
import { runRecoveryA } from "@/lib/recovery-a";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runRecoveryA();
  return NextResponse.json({ ok: true, ...result });
}
