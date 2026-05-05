/**
 * Webhook outbox — I/O wrapper.
 *
 * Handles enqueue / mark-sent / mark-pending-with-backoff / mark-failed
 * transitions on the webhook_outbox table. Pure backoff math lives in
 * webhook-outbox-pure.ts.
 *
 * The flow used by action endpoints:
 *
 *   1. enqueueWebhook(payload, webhookUrl) → outbox row inserted (or
 *      existing returned via idempotency conflict)
 *   2. attempt synchronous fireGhlWebhook
 *   3. recordAttempt(outboxId, fireResult) → flips status to sent or
 *      reschedules the next attempt
 *
 * The retry cron (/api/cron/webhook-retry) sweeps `pending` rows whose
 * next_attempt_at has passed and re-runs steps 2–3.
 */

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import type { WebhookPayload } from "@/lib/ghl-webhook-pure";
import {
  decideAttemptOutcome,
  DEFAULT_MAX_ATTEMPTS,
} from "@/lib/webhook-outbox-pure";

export {
  nextAttemptDelaySeconds,
  nextAttemptAt,
  decideAttemptOutcome,
  DEFAULT_MAX_ATTEMPTS,
  type AttemptOutcome,
} from "@/lib/webhook-outbox-pure";

export interface OutboxRow {
  id: string;
  lead_id: string;
  firm_id: string;
  action: string;
  idempotency_key: string;
  payload: unknown;
  webhook_url: string;
  status: "pending" | "sent" | "failed";
  attempts: number;
  max_attempts: number;
}

export interface EnqueueResult {
  row: OutboxRow | null;
  alreadyExists: boolean;
  error?: string;
}

/**
 * Insert a new outbox row for this (lead_id, action) pair, or return the
 * existing row if one is already in flight (idempotency dedupe).
 */
export async function enqueueWebhook(
  payload: WebhookPayload,
  webhookUrl: string,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): Promise<EnqueueResult> {
  const insertRes = await supabase
    .from("webhook_outbox")
    .insert({
      lead_id: payload.lead_id,
      firm_id: payload.firm_id,
      action: payload.action,
      idempotency_key: payload.idempotency_key,
      payload,
      webhook_url: webhookUrl,
      max_attempts: maxAttempts,
    })
    .select("id, lead_id, firm_id, action, idempotency_key, payload, webhook_url, status, attempts, max_attempts")
    .single();

  if (!insertRes.error && insertRes.data) {
    return { row: insertRes.data as OutboxRow, alreadyExists: false };
  }

  // 23505 = unique violation on idempotency_key — load the existing row.
  if (insertRes.error?.code === "23505") {
    const existing = await supabase
      .from("webhook_outbox")
      .select("id, lead_id, firm_id, action, idempotency_key, payload, webhook_url, status, attempts, max_attempts")
      .eq("idempotency_key", payload.idempotency_key)
      .maybeSingle();
    if (existing.data) {
      return { row: existing.data as OutboxRow, alreadyExists: true };
    }
    return { row: null, alreadyExists: true, error: "idempotency conflict but row not found" };
  }

  return { row: null, alreadyExists: false, error: insertRes.error?.message };
}

/**
 * Record the outcome of a delivery attempt against an outbox row. Increments
 * attempts and sets status / next_attempt_at according to the pure decision
 * function.
 */
export async function recordAttempt(
  row: OutboxRow,
  result: { fired: boolean; reason?: string; http_status?: number },
): Promise<void> {
  const outcome = decideAttemptOutcome({
    fired: result.fired,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  });

  const baseUpdate = {
    attempts: row.attempts + 1,
    last_error: result.fired ? null : (result.reason ?? null),
    last_http_status: result.http_status ?? null,
  };

  if (outcome.next === "sent") {
    await supabase
      .from("webhook_outbox")
      .update({ ...baseUpdate, status: "sent", sent_at: new Date().toISOString() })
      .eq("id", row.id);
    return;
  }

  if (outcome.next === "failed") {
    await supabase
      .from("webhook_outbox")
      .update({ ...baseUpdate, status: "failed", failed_at: new Date().toISOString() })
      .eq("id", row.id);
    return;
  }

  // pending — keep status, push next_attempt_at forward
  await supabase
    .from("webhook_outbox")
    .update({ ...baseUpdate, next_attempt_at: outcome.nextAttemptAt.toISOString() })
    .eq("id", row.id);
}
