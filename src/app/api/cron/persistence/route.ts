import { NextResponse } from "next/server";
import { runPersistenceEngine } from "@/lib/persistence";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // seconds — enough for a full sweep

export async function GET(req: Request) {
  // ── Auth: Vercel sets CRON_SECRET automatically for cron invocations ─────
  // In local dev (no CRON_SECRET set) the endpoint is open for testing.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const result = await runPersistenceEngine();

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    ...result,
  });
}
