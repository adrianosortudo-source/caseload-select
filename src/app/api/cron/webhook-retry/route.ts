/**
 * GET /api/cron/webhook-retry
 *
 * Retry sweeper for the webhook outbox. Finds every row in 'pending' state
 * whose next_attempt_at has passed, re-attempts delivery via the snapshotted
 * webhook_url, and either flips to 'sent' / pushes next_attempt_at out via
 * exponential backoff / marks 'failed' if max_attempts has been reached.
 *
 * Auth: Bearer CRON_SECRET. Same scheduling story as triage-backstop —
 * NOT scheduled in vercel.json under Hobby plan; manually triggerable, or
 * upgrade Vercel to Pro and add an entry, or move to Supabase pg_cron.
 *
 * Batch: up to 50 rows per run. Wall-clock budget: ~30s for 50 rows at
 * 8s timeout each is generous; in practice most attempts return in <1s.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { postToWebhookUrl } from "@/lib/ghl-webhook";
import { recordAttempt, type OutboxRow } from "@/lib/webhook-outbox";
import type { WebhookPayload } from "@/lib/ghl-webhook-pure";
import { isCronAuthorized } from "@/lib/cron-auth";

const BATCH_LIMIT = 50;

interface RetryOutcome {
  outbox_id: string;
  lead_id: string;
  action: string;
  fired: boolean;
  http_status?: number;
  reason?: string;
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nowIso = new Date().toISOString();

  const { data: due, error } = await supabase
    .from("webhook_outbox")
    .select(`
      id, lead_id, firm_id, action, idempotency_key,
      payload, webhook_url, status, attempts, max_attempts
    `)
    .eq("status", "pending")
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const outcomes: RetryOutcome[] = [];

  for (const row of (due ?? []) as OutboxRow[]) {
    const result = await postToWebhookUrl(row.webhook_url, row.payload as WebhookPayload);
    await recordAttempt(row, result);
    outcomes.push({
      outbox_id: row.id,
      lead_id: row.lead_id,
      action: row.action,
      fired: result.fired,
      http_status: result.http_status,
      reason: result.reason,
    });
  }

  return NextResponse.json({
    ok: true,
    swept: outcomes.length,
    batch_limit: BATCH_LIMIT,
    outcomes,
  });
}
