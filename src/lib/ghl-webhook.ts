/**
 * GHL outbound webhook — I/O wrapper around ghl-webhook-pure.
 *
 * Re-exports the pure types and builders, plus adds the fetch-and-deliver
 * function that hits the firm's ghl_webhook_url. Contract:
 * docs/ghl-webhook-contract.md.
 *
 * Delivery: at-most-once. Webhook fires AFTER the database update succeeds.
 * On HTTP failure or timeout, no retry; the DB row is in the correct state
 * regardless. Phase 3 hardening adds an outbox pattern.
 */

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import type { WebhookPayload } from "@/lib/ghl-webhook-pure";
import { enqueueWebhook, recordAttempt } from "@/lib/webhook-outbox";
import { safeFetch } from "@/lib/safe-outbound-fetch";

export {
  buildTakenPayload,
  buildPassedPayload,
  buildReferredPayload,
  buildDeclinedOosPayload,
  buildDeclinedBackstopPayload,
  cadenceTargetForBand,
  lawyerActionForBand,
  type WebhookAction,
  type WebhookPayload,
  type TakenPayload,
  type PassedPayload,
  type ReferredPayload,
  type DeclinedOosPayload,
  type DeclinedBackstopPayload,
  type LeadFacts,
  type DeclineSource,
} from "@/lib/ghl-webhook-pure";

const HTTP_TIMEOUT_MS = 8_000;

export interface WebhookDeliveryResult {
  fired: boolean;
  reason?: string;
  http_status?: number;
}

/**
 * Pure delivery primitive — POST a payload to a known URL with a timeout.
 * No DB lookup, no outbox; just the HTTP call. Used by both the high-level
 * deliverWebhook flow and the retry cron (which already has the URL
 * snapshotted on the outbox row).
 */
export async function postToWebhookUrl(
  url: string,
  payload: WebhookPayload,
): Promise<WebhookDeliveryResult> {
  if (!url || !url.trim()) return { fired: false, reason: "no webhook url" };

  // SSRF protection — Jim Manico audit APP-003. The firm's webhook URL
  // is operator-controlled and stored in intake_firms.ghl_webhook_url.
  // safeFetch resolves the hostname, blocks RFC 1918 / link-local /
  // loopback / cloud-metadata IPs, enforces an http(s)-only scheme
  // allow-list, and bounds the timeout. Without this, a tampered
  // intake_firms row could redirect lead PII into a private network
  // service or the cloud metadata endpoint.
  const result = await safeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: HTTP_TIMEOUT_MS,
  });

  return {
    fired: result.ok,
    reason: result.ok ? undefined : (result.reason ?? undefined),
    http_status: result.status ?? undefined,
  };
}

/**
 * Look up the firm's webhook URL. Returns null when not configured (callers
 * should treat this as "skip silently, do not enqueue retries").
 */
export async function getFirmWebhookUrl(firmId: string): Promise<string | null> {
  const { data: firm, error } = await supabase
    .from("intake_firms")
    .select("ghl_webhook_url")
    .eq("id", firmId)
    .maybeSingle();
  if (error || !firm) return null;
  const url = (firm.ghl_webhook_url ?? "").trim();
  return url.length > 0 ? url : null;
}

/**
 * Full at-least-once delivery via the webhook_outbox.
 *
 *   1. Look up the firm's webhook URL. If not configured → skip silently.
 *   2. Enqueue an outbox row (idempotency-keyed on lead_id:action). If a row
 *      already exists, this is a duplicate fire — return the existing state.
 *   3. POST synchronously. Update outbox row to sent / pending+backoff /
 *      failed depending on outcome.
 *
 * Action endpoints call this once and forget; the retry cron picks up any
 * row left in pending state with next_attempt_at <= now.
 */
export async function deliverWebhook(
  payload: WebhookPayload,
): Promise<WebhookDeliveryResult & { outbox_id?: string; already_in_flight?: boolean }> {
  const url = await getFirmWebhookUrl(payload.firm_id);
  if (!url) {
    return { fired: false, reason: "ghl_webhook_url not configured" };
  }

  const enq = await enqueueWebhook(payload, url);
  if (!enq.row) {
    return { fired: false, reason: enq.error ?? "outbox enqueue failed" };
  }

  // If the row was already in flight, do not re-attempt synchronously — the
  // retry cron is responsible. The action endpoint can return success either
  // way (the cadence will engage eventually).
  if (enq.alreadyExists && enq.row.status !== "pending") {
    return {
      fired: enq.row.status === "sent",
      reason: enq.row.status,
      outbox_id: enq.row.id,
      already_in_flight: true,
    };
  }
  if (enq.alreadyExists) {
    return {
      fired: false,
      reason: "already pending; retry cron will fire",
      outbox_id: enq.row.id,
      already_in_flight: true,
    };
  }

  const result = await postToWebhookUrl(url, payload);
  await recordAttempt(enq.row, result);
  return { ...result, outbox_id: enq.row.id, already_in_flight: false };
}

/**
 * Backward-compatible alias. New code should use deliverWebhook directly;
 * this keeps any existing callers working without breaking imports.
 *
 * @deprecated Use deliverWebhook instead.
 */
export async function fireGhlWebhook(
  _firmId: string,
  payload: WebhookPayload,
): Promise<WebhookDeliveryResult> {
  return deliverWebhook(payload);
}
