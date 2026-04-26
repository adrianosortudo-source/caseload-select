/**
 * POST /api/leads/[id]/review/complete
 *
 * Marks a review_request row as 'completed' when Adriano confirms the Google
 * review went live. Also cancels any remaining scheduled J9 sequence steps
 * so Touch 2 and 3 don't fire after the review is in.
 *
 * Body: { review_request_id: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { cancelSequenceByTrigger } from "@/lib/send-sequences";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: leadId } = await params;
  const { review_request_id } = (await req.json()) as { review_request_id: string };

  if (!review_request_id) {
    return NextResponse.json({ error: "review_request_id required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("review_requests")
    .update({ status: "completed" })
    .eq("id", review_request_id)
    .eq("lead_id", leadId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Cancel remaining scheduled J9 touches
  await cancelSequenceByTrigger(leadId, "review_request").catch((e) =>
    console.error("J9 cancel failed:", e)
  );

  return NextResponse.json({ ok: true });
}
