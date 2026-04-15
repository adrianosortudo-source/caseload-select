import { NextRequest, NextResponse } from "next/server";
import { runRecoveryB } from "@/lib/recovery-b";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runRecoveryB();
  return NextResponse.json({ ok: true, ...result });
}
