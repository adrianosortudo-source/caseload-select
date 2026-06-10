import { NextRequest, NextResponse } from "next/server";
import { runDataRetention } from "@/lib/data-retention";
import { isCronAuthorized } from "@/lib/cron-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Meta webhook dedup claims (processed_channel_messages) only need to
// outlive Meta's redelivery window, which is hours. Seven days is generous.
const CHANNEL_DEDUP_RETENTION_DAYS = 7;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runDataRetention();

  // Best-effort sweep of expired Meta-channel webhook dedup claims.
  // Failure is reported in the response but never fails the retention run.
  const dedupCutoff = new Date(
    Date.now() - CHANNEL_DEDUP_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { error: dedupError } = await supabaseAdmin
    .from("processed_channel_messages")
    .delete()
    .lt("created_at", dedupCutoff);
  if (dedupError) {
    console.error(
      "[data-retention] processed_channel_messages cleanup failed:",
      dedupError.message,
    );
  }

  return NextResponse.json({
    ok: true,
    ...result,
    channel_message_dedup_cleanup: dedupError
      ? { ok: false, error: dedupError.message }
      : { ok: true },
  });
}
