import { NextRequest, NextResponse } from "next/server";
import { processIncompleteIntakes } from "@/lib/incomplete-intake";
import { isCronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await processIncompleteIntakes();
  const triggered = results.filter((r) => r.action === "triggered").length;
  const skipped = results.filter((r) => r.action === "skipped").length;

  return NextResponse.json({
    ok: true,
    processed: results.length,
    triggered,
    skipped,
    details: results,
  });
}
