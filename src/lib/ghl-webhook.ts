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

export {
  buildTakenPayload,
  buildPassedPayload,
  buildDeclinedOosPayload,
  buildDeclinedBackstopPayload,
  cadenceTargetForBand,
  lawyerActionForBand,
  type WebhookAction,
  type WebhookPayload,
  type TakenPayload,
  type PassedPayload,
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
 * POST the payload to the firm's GHL webhook URL. Returns a verdict object
 * but never throws — every failure mode resolves to fired=false with a
 * reason string. Callers use the return value for logging only; the DB
 * state is already correct by the time this runs.
 */
export async function fireGhlWebhook(
  firmId: string,
  payload: WebhookPayload,
): Promise<WebhookDeliveryResult> {
  // Look up the firm's webhook URL. Empty / null → skip silently.
  const { data: firm, error } = await supabase
    .from("intake_firms")
    .select("ghl_webhook_url")
    .eq("id", firmId)
    .maybeSingle();

  if (error) return { fired: false, reason: `firm lookup failed: ${error.message}` };
  if (!firm) return { fired: false, reason: "firm not found" };

  const url = (firm.ghl_webhook_url ?? "").trim();
  if (!url) return { fired: false, reason: "ghl_webhook_url not configured" };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return {
      fired: res.ok,
      reason: res.ok ? undefined : `http ${res.status}`,
      http_status: res.status,
    };
  } catch (err) {
    return {
      fired: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
