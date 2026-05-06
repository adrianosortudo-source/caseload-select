/**
 * POST /api/admin/webhook-outbox/[outboxId]/retry
 *
 * Operator-only manual retry for a webhook outbox row. Useful when:
 *   - A row is in 'failed' state (max_attempts exhausted) and the operator
 *     has fixed the underlying GHL issue.
 *   - A row is in 'pending' state but the operator wants to fire it now
 *     instead of waiting for the next cron sweep.
 *   - A row is in 'sent' state and the operator wants to deliberately
 *     re-fire (rare; e.g. GHL workflow was broken at delivery time).
 *
 * Auth: Bearer CRON_SECRET (same secret used for the cron jobs and for
 * /api/portal/generate). Treats this as an operator-only surface.
 *
 * Behaviour: re-attempts delivery against the snapshotted webhook_url and
 * records the attempt. Does NOT increment attempts beyond max_attempts on
 * a manual retry — manual retries reset the attempt counter to 0 first so
 * the row can re-enter the normal retry cycle if it fails again.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { postToWebhookUrl } from "@/lib/ghl-webhook";
import { recordAttempt, type OutboxRow } from "@/lib/webhook-outbox";
import type { WebhookPayload } from "@/lib/ghl-webhook-pure";
import { isCronAuthorized } from "@/lib/cron-auth";
import { getOperatorSession } from "@/lib/portal-auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ outboxId: string }> }
) {
  // Two valid auth paths:
  //   1. Bearer CRON_SECRET / PG_CRON_TOKEN — operator curl, automation.
  //   2. Operator session cookie — operator console UI button.
  const cronAuthed = isCronAuthorized(req);
  const operatorSession = cronAuthed ? null : await getOperatorSession();
  if (!cronAuthed && !operatorSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { outboxId } = await params;

  const { data: row, error: fetchErr } = await supabase
    .from("webhook_outbox")
    .select(`
      id, lead_id, firm_id, action, idempotency_key,
      payload, webhook_url, status, attempts, max_attempts
    `)
    .eq("id", outboxId)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Reset the attempt counter to 0 so a manual retry on a 'failed' row goes
  // back into the normal retry cycle if this attempt also fails. Status
  // flips to 'pending' to signal it's back in flight.
  await supabase
    .from("webhook_outbox")
    .update({ status: "pending", attempts: 0, last_error: null, last_http_status: null })
    .eq("id", outboxId);

  const reset: OutboxRow = { ...(row as OutboxRow), status: "pending", attempts: 0 };
  const result = await postToWebhookUrl(reset.webhook_url, reset.payload as WebhookPayload);
  await recordAttempt(reset, result);

  return NextResponse.json({
    ok: true,
    outbox_id: outboxId,
    fired: result.fired,
    http_status: result.http_status,
    reason: result.reason,
  });
}
